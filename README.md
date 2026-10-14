# Orion Forge · 一键部署

[![Deploy with Vercel](https://vercel.com/button)](https://vercel.com/new/clone?repository-url=https%3A%2F%2Fgithub.com%2Fsuanx%2Forion-forge-deploy&env=POSTGRES_URL,BETTER_AUTH_SECRET,AGENT_API_KEY,ORION_FORGE_ARTIFACT_TOKEN&envDescription=Runtime%20secrets%20plus%20the%20private%20artifact%20token&envLink=https%3A%2F%2Fgithub.com%2Fsuanx%2Forion-forge-deploy%23%E7%8E%AF%E5%A2%83%E5%8F%98%E9%87%8F&project-name=orion-forge&repository-name=orion-forge)

> 这是 **部署门面仓**：里面没有源码，只有部署配置。
> 源码与构建产物都放在私有仓 `suanx/orion-forge`，构建期由下面的流程注入。

## 这是什么

Orion Forge 是云端编码 Agent 平台：浏览器里下指令，Agent 在沙箱里写代码、跑命令、改仓库。

点上面的按钮后发生的事情：

1. Vercel 把你账号下的这个仓库克隆一份，并创建一个项目
2. 构建阶段执行 `bootstrap.mjs`：用你提供的令牌从私有产物源下载**已构建 + 已混淆**的
   Vercel 产物，校验 sha256 后解压成 `.vercel/output`
3. Vercel 直接使用该输出上线，**不跑常规构建、不接触源码**

## 环境变量

### 必填

| 变量 | 说明 |
| --- | --- |
| `POSTGRES_URL` | Postgres 连接串（Drizzle 迁移的目标库） |
| `BETTER_AUTH_SECRET` | 会话签名密钥，`openssl rand -hex 32` 生成 |
| `AGENT_API_KEY` | Agent API 访问密钥，`openssl rand -hex 32` 生成 |
| `ORION_FORGE_ARTIFACT_TOKEN` | 读取私有产物源的 GitHub 令牌（fine-grained PAT，对私有仓 `suanx/orion-forge` 授予 Contents: Read） |

### 可选

| 变量 | 说明 |
| --- | --- |
| `REDIS_URL` / `KV_URL` | 缓存与速率限制；不填则走降级路径 |
| `NEXT_PUBLIC_VERCEL_APP_CLIENT_ID` / `VERCEL_APP_CLIENT_SECRET` | Vercel OAuth 登录；不填则只用 GitHub 登录 |
| `NEXT_PUBLIC_GITHUB_CLIENT_ID` / `GITHUB_CLIENT_SECRET` | GitHub OAuth（仓库访问） |
| `GITHUB_APP_ID` / `GITHUB_APP_PRIVATE_KEY` / `NEXT_PUBLIC_GITHUB_APP_SLUG` / `GITHUB_WEBHOOK_SECRET` | GitHub App 模式（推荐，权限更细） |
| `VERCEL_SANDBOX_BASE_SNAPSHOT_ID` | 复用预热快照，显著加快沙箱冷启动 |
| `ELEVENLABS_API_KEY` | 语音能力 |
| `VERCEL_PROJECT_PRODUCTION_URL` | 首次部署拿到域名后回填 |
| `ORION_FORGE_ARTIFACT_TAG` | 锁定产物版本；不填则取 `artifact.json`（默认 `latest`） |
| `ORION_PUBLIC_*` | 见下方「构建期已内联的变量」 |

### 构建期已内联的变量

Next.js 的 `NEXT_PUBLIC_*` 在**构建时**就被写死进产物，部署后再改环境变量不生效。
为此产物里保留了 `%%ORION_PUBLIC_<KEY>%%` 占位符，`bootstrap.mjs` 会在构建期把同名的
`ORION_PUBLIC_*` 环境变量替换进去。若你的 OAuth 应用 ID 与产物内置的默认值不同，
在 Vercel 环境变量里填 `ORION_PUBLIC_VERCEL_APP_CLIENT_ID` 即可覆盖。

## 常见问题

**为什么仓库里没有代码？**
源码在私有仓，公开仓只承担「一键部署」入口。你 clone 到的是配置，产物在构建时下载。

**产物版本怎么升级？**
`artifact.json` 里的 `tag` 默认是 `latest`，每次上游发版后重新部署即可拿到新版；
想锁版本就把 `tag` 改成具体 Release 标记，或设环境变量 `ORION_FORGE_ARTIFACT_TAG`。

**令牌没有权限会怎样？**
构建会直接失败并提示 401/403。产物源是私有仓 Release，令牌至少需要 Contents 读权限。

**如果 Vercel 没有采用 `.vercel/output`？**
该路径依赖 Vercel 构建系统对 Build Output API 的支持。极端情况下的兜底是改用
「自建 CI 直推」通道：在私有仓用 `vercel build` + `vercel deploy --prebuilt` 部署。
