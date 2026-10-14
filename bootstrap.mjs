#!/usr/bin/env node
/**
 * Orion Forge —— 部署引导脚本（运行在 Vercel 构建期）
 *
 * 这个仓库里【没有源码】，只有部署配置。构建时本脚本会：
 *   1. 读取你配置的私有产物访问令牌
 *   2. 从私有仓 Release 下载「已构建 + 已混淆」的 Vercel 产物（Build Output API）
 *   3. 校验 sha256 后解压到 .vercel/output
 *   4. 交回给 Vercel，跳过常规构建直接上线
 *
 * 需要的环境变量：
 *   ORION_FORGE_ARTIFACT_TOKEN  必填。能读取私有产物仓 Release 的 GitHub 令牌
 *   ORION_FORGE_ARTIFACT_REPO   可选，默认 suanx/orion-forge
 *   ORION_FORGE_ARTIFACT_TAG    可选，默认取 artifact.json 里的版本（fallback: latest）
 */

import { mkdir, writeFile, readFile, rm } from "node:fs/promises";
import { existsSync } from "node:fs";
import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import path from "node:path";
import { fileURLToPath } from "node:url";

const execFileAsync = promisify(execFile);

const REPO = process.env.ORION_FORGE_ARTIFACT_REPO || "suanx/orion-forge";
const TOKEN = process.env.ORION_FORGE_ARTIFACT_TOKEN || "";
const ARTIFACT_NAME = "orion-forge-prebuilt.tar.gz";
const OUT_DIR = path.resolve(".vercel/output");

function fail(msg, hint) {
  process.stderr.write(`\n✗ ${msg}\n`);
  if (hint) process.stderr.write(`  → ${hint}\n`);
  process.exit(1);
}

async function apiGet(url, accept) {
  const res = await fetch(url, {
    headers: {
      Authorization: `Bearer ${TOKEN}`,
      Accept: accept || "application/vnd.github+json",
      "User-Agent": "orion-forge-bootstrap",
      "X-GitHub-Api-Version": "2022-11-28",
    },
    redirect: accept === "application/octet-stream" ? "follow" : undefined,
  });
  if (!res.ok) {
    const detail = res.status === 401 || res.status === 403
      ? "令牌无效或权限不足（需要对私有产物仓的 Contents 读权限）"
      : res.status === 404
        ? "Release 或产物不存在（仓库名/版本标记写错了？）"
        : `HTTP ${res.status}`;
    fail(`请求 GitHub 失败: ${url}`, detail);
  }
  return res;
}

const TEXT_EXT = new Set([".js", ".mjs", ".cjs", ".json", ".html", ".css", ".txt"]);

async function walk(dir, out = []) {
  const { readdir: ls } = await import("node:fs/promises");
  let entries;
  try {
    entries = await ls(dir, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const e of entries) {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) await walk(full, out);
    else if (e.isFile() && TEXT_EXT.has(path.extname(e.name).toLowerCase())) out.push(full);
  }
  return out;
}

/**
 * 把产物里的 %%ORION_PUBLIC_<KEY>%% 占位符替换成部署者的环境变量。
 * 存在的意义：NEXT_PUBLIC_* 在构建期就被内联了，部署后再改 env 不生效，
 * 所以构建时用占位符，部署期在这里做一次注入。
 */
async function applyPlaceholders(outDir) {
  const pairs = Object.entries(process.env).filter(
    ([k, v]) => k.startsWith("ORION_PUBLIC_") && typeof v === "string" && v.length > 0,
  );
  if (pairs.length === 0) return 0;

  const files = await walk(outDir);
  let hits = 0;
  for (const file of files) {
    let text = await readFile(file, "utf8");
    let changed = false;
    for (const [key, value] of pairs) {
      const token = `%%${key}%%`;
      if (text.includes(token)) {
        text = text.split(token).join(value);
        changed = true;
        hits += 1;
      }
    }
    if (changed) await writeFile(file, text, "utf8");
  }
  return hits;
}

async function resolveTag() {
  if (process.env.ORION_FORGE_ARTIFACT_TAG) return process.env.ORION_FORGE_ARTIFACT_TAG;
  try {
    const cfg = JSON.parse(await readFile("artifact.json", "utf8"));
    if (cfg?.tag) return cfg.tag;
  } catch {
    /* artifact.json 缺失则走 latest */
  }
  return "latest";
}

async function main() {
  if (!TOKEN) {
    fail(
      "缺少 ORION_FORGE_ARTIFACT_TOKEN",
      "这是读取私有产物仓 Release 的 GitHub 令牌，在 Vercel 项目环境变量里配置；没有它拿不到预构建产物。",
    );
  }

  const tag = await resolveTag();
  process.stdout.write(`→ 产物源: ${REPO} @ ${tag}\n`);

  const releaseUrl =
    tag === "latest"
      ? `https://api.github.com/repos/${REPO}/releases/latest`
      : `https://api.github.com/repos/${REPO}/releases/tags/${encodeURIComponent(tag)}`;

  const releaseRes = await apiGet(releaseUrl);
  const release = await releaseRes.json();

  const asset = (release.assets || []).find((a) => a.name === ARTIFACT_NAME);
  const sumAsset = (release.assets || []).find((a) => a.name === `${ARTIFACT_NAME}.sha256`);
  if (!asset) {
    fail(
      `Release ${release.tag_name} 里没有 ${ARTIFACT_NAME}`,
      `该 Release 现有 asset: ${(release.assets || []).map((a) => a.name).join(", ") || "(空)"}`,
    );
  }

  process.stdout.write(`→ 下载产物 ${asset.name} (${(asset.size / 1024 / 1024).toFixed(2)}MB)\n`);
  const binRes = await apiGet(
    `https://api.github.com/repos/${REPO}/releases/assets/${asset.id}`,
    "application/octet-stream",
  );
  const buf = Buffer.from(await binRes.arrayBuffer());

  let expected = null;
  if (sumAsset) {
    const sumRes = await apiGet(
      `https://api.github.com/repos/${REPO}/releases/assets/${sumAsset.id}`,
      "application/octet-stream",
    );
    expected = (await sumRes.text()).trim().split(/\s+/)[0];
  }
  const actual = createHash("sha256").update(buf).digest("hex");
  if (expected && expected !== actual) {
    fail("产物 sha256 校验失败", `期望 ${expected}，实际 ${actual}。产物可能损坏或被替换，已中止部署。`);
  }
  process.stdout.write(`✓ sha256 校验通过 ${expected ? `(${actual.slice(0, 12)}…)` : "(无校验文件)"}\n`);

  const tarball = path.resolve(`.artifact-cache/${ARTIFACT_NAME}`);
  await mkdir(path.dirname(tarball), { recursive: true });
  await writeFile(tarball, buf);

  if (existsSync(OUT_DIR)) await rm(OUT_DIR, { recursive: true, force: true });
  await mkdir(OUT_DIR, { recursive: true });
  await execFileAsync("tar", ["-xzf", tarball, "-C", OUT_DIR]);

  process.stdout.write(
    `✓ 产物已解压到 .vercel/output（Release ${release.tag_name}）\n` +
      `  Vercel 将直接使用该输出，不再执行常规构建。\n`,
  );

  const hits = await applyPlaceholders(OUT_DIR);
  if (hits > 0) {
    process.stdout.write(`✓ 注入 ${hits} 处 ORION_PUBLIC_* 占位符\n`);
  }

  await writeFile(
    ".artifact-cache/resolved.json",
    `${JSON.stringify(
      { repo: REPO, release: release.tag_name, asset: asset.name, sha256: actual, size: asset.size },
      null,
      2,
    )}\n`,
    "utf8",
  );
}

// 被直接执行时才跑引导流程；被 import 时只暴露函数（便于离线自测）
const invokedDirectly =
  process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url));
if (invokedDirectly) {
  main().catch((err) => {
    process.stderr.write(`✗ 引导失败: ${err?.stack ?? err}\n`);
    process.exit(1);
  });
}

export { applyPlaceholders, walk };
