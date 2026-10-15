# Orion Forge

[![Deploy with Vercel](https://vercel.com/button)](https://vercel.com/new/clone?repository-url=https%3A%2F%2Fgithub.com%2Fsuanx%2Forion-forge-deploy&env=POSTGRES_URL,BETTER_AUTH_SECRET,AGENT_API_KEY,ORION_FORGE_ARTIFACT_TOKEN&envDescription=Runtime%20secrets%20and%20artifact%20access%20token&envLink=https%3A%2F%2Fgithub.com%2Fsuanx%2Forion-forge-deploy%23%E7%8E%AF%E5%A2%83%E5%8F%98%E9%87%8F&project-name=orion-forge&repository-name=orion-forge)

云端编码 Agent 平台：在浏览器里下达指令，Agent 在云沙箱中写代码、跑命令、改仓库、提 PR。

本仓库只包含部署配置与引导脚本：点一键部署后，Vercel 构建阶段会自动下载预构建的应用产物，校验完整性后直接上线，仓库内没有源码。

## 对接 orion_agent 后能实现什么

[orion_agent](https://github.com/suanx/orion_agent)（移动端）接入本服务后：

| 功能 | 说明 |
| --- | --- |
| **云端 Agent 对话** | App 里发消息，云端 Agent 流式回复，支持展示推理过程，多轮工具调用自动完成 |
| **云端代码执行** | Agent 判断需要动手时自动在云沙箱里写代码、跑命令，App 端无需任何本地环境；纯问答不启动沙箱，不产生沙箱费用与冷启动等待 |
| **会话云端持久化** | App 的每个会话对应云端一个 session，历史消息存云端数据库；同一会话可在网页控制台查看、接着聊 |
| **断线重连 / 任务取消** | App 断网、被杀后可按 runId 重连恢复正在运行任务的输出，也可主动取消 |
| **模型服务端统一配置** | App 无需内置各家模型 Key，统一走服务端 `AGENT_MODEL_*` 指定的 OpenAI 兼容网关，换模型只改服务端配置 |
| **成本护栏与用量统计** | 每用户每日消费上限（`AGENT_DAILY_BUDGET_USD`，默认 50 美元），超出自动暂停新任务；用量按来源分类统计 |

### App 侧配置

| 配置项 | 值 |
| --- | --- |
| 服务地址 | 部署完成后的域名（如 `https://your-app.vercel.app`） |
| API Key | 部署时设置的 `AGENT_API_KEY`，以 `x-api-key` 或 `Authorization: Bearer` 请求头携带 |

### 对接接口

| 接口 | 方法 | 说明 |
| --- | --- | --- |
| `/api/agent/chat` | POST | 对话入口，流式返回（AI SDK UI Message 格式的 SSE） |
| `/api/models` | GET | 当前可用模型列表 |
| `/api/agent/streams/{runId}` | GET | 断线重连：重新接上运行中的任务流 |
| `/api/agent/streams/{runId}/cancel` | POST | 取消运行中的任务 |

请求体（OpenAI 风格，每次取最后一条 user 消息作为本轮输入，历史上下文由云端会话负责）：

```json
{
  "messages": [{ "role": "user", "content": "写个快排" }],
  "sessionId": "可选，续接上下文",
  "modelId": "可选，指定本次使用的模型",
  "max_tokens": 32768
}
```

- 首次请求自动创建会话，响应头 `x-session-id` / `x-chat-id` 带回；之后随请求携带即可延续上下文
- 运行中断线时，用响应头里的 `x-workflow-run-id` 调重连接口恢复输出

## 部署步骤

1. 点击上方按钮（或手动在 Vercel 新建项目并导入本仓库，框架预设选 Other）
2. 按下方清单填写环境变量
3. Deploy——构建阶段引导脚本自动下载预构建产物、校验完整性并直接上线
4. 部署完成后按「部署后配置」继续

## 环境变量

### 必填

| 变量 | 说明 |
| --- | --- |
| `POSTGRES_URL` | Postgres 连接串（Neon / Supabase / 自建均可） |
| `BETTER_AUTH_SECRET` | 会话签名密钥，`openssl rand -hex 32` 生成 |
| `AGENT_API_KEY` | Agent 对话 API 的访问密钥，`openssl rand -hex 32` 生成 |
| `ORION_FORGE_ARTIFACT_TOKEN` | 产物下载令牌：GitHub fine-grained PAT，需对产物仓库有 Contents: Read 权限，向产物维护者索取 |
| 登录 OAuth（至少一项） | GitHub 登录：`NEXT_PUBLIC_GITHUB_CLIENT_ID` + `GITHUB_CLIENT_SECRET`；Vercel 登录：`NEXT_PUBLIC_VERCEL_APP_CLIENT_ID` + `VERCEL_APP_CLIENT_SECRET` |

### 模型网关（建议配置）

| 变量 | 说明 |
| --- | --- |
| `AGENT_MODEL_BASE_URL` | OpenAI 兼容网关地址，如 `https://api.openai.com/v1` |
| `AGENT_MODEL_ID` | 默认模型 ID |
| `AGENT_MODEL_API_KEY` | 网关密钥；支持匿名访问的免费网关可留空 |

### 可选

| 变量 | 说明 |
| --- | --- |
| `REDIS_URL` / `KV_URL` | 缓存与速率限制；不填走内置降级路径 |
| `GITHUB_APP_ID` / `GITHUB_APP_PRIVATE_KEY` / `NEXT_PUBLIC_GITHUB_APP_SLUG` / `GITHUB_WEBHOOK_SECRET` | GitHub App 模式（比 OAuth App 权限更细，推荐） |
| `VERCEL_SANDBOX_BASE_SNAPSHOT_ID` | 复用预热快照，大幅缩短沙箱冷启动 |
| `AGENT_DAILY_BUDGET_USD` | 每用户每日消费上限（美元），默认 50，超出后当日暂停新任务 |
| `ELEVENLABS_API_KEY` | 语音播报 |
| `VERCEL_PROJECT_PRODUCTION_URL` | 生产域名，Vercel 上通常自动提供，一般无需手动配置 |
| `ORION_FORGE_ARTIFACT_TAG` | 锁定产物版本；不填则取 `artifact.json`（默认 `latest`） |
| `ORION_PUBLIC_*` | 构建期占位符注入，见下节 |

### 构建期占位符注入（ORION_PUBLIC_*）

`NEXT_PUBLIC_*` 变量在构建时就写死进产物，部署后再改环境变量不生效。产物里预留了 `%%ORION_PUBLIC_<KEY>%%` 占位符，部署构建时引导脚本会把同名 `ORION_PUBLIC_*` 环境变量的值替换进去。例如你的 OAuth 应用 ID 与产物内置默认值不同，配置 `ORION_PUBLIC_VERCEL_APP_CLIENT_ID` 即可覆盖。

## 部署后配置

1. 打开分配的域名，用配置的 OAuth 方式登录网页控制台
2. 在 Vercel 项目 Settings → Environment Variables 补上 `AGENT_MODEL_*`，保存后 Redeploy 生效
3. 按需配置 GitHub 集成、沙箱预热快照等可选项
4. 把服务地址与 `AGENT_API_KEY` 填进 orion_agent 的云端 Agent 设置，即可在 App 里使用上述云端能力

## 常见问题

**仓库里为什么没有代码？**
本仓库只承担部署入口（配置 + 引导脚本）。应用本体以预构建产物形式在部署构建时自动获取，产物仓库独立于本仓库维护。

**`ORION_FORGE_ARTIFACT_TOKEN` 从哪里来？**
向产物维护者索取：一个对产物仓库有 Contents: Read 权限的 GitHub fine-grained PAT。令牌无效或权限不足时，构建会直接失败并提示 401/403。

**应用怎么升级？**
`artifact.json` 的 `tag` 默认 `latest`，产物发布新版后在 Vercel 重新 Deploy 即可；想锁定版本就把 `tag` 改成具体版本号，或设置环境变量 `ORION_FORGE_ARTIFACT_TAG`。

**orion_agent 怎么对接？**
在 App 的云端 Agent 设置里填入部署域名与 `AGENT_API_KEY` 即可。模型由服务端 `AGENT_MODEL_*` 决定，App 无需单独配置模型。
