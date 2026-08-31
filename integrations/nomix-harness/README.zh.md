# @nomix-ai/nomix-ragflow

这是 RAGFlow Business Gateway 的类型化 Client 与 Nomix Harness 插件。两个入口
始终调用同一个业务 Gateway；npm 包不再连接原始 RAGFlow API，也不接受原始
RAGFlow API Key。

## 安装

```bash
npm install @nomix-ai/nomix-ragflow
```

要求 Node.js `^22.19 || >=24`。插件面向 Nomix Harness `^0.2.5`，运行时依赖由
Harness kernel 提供。

## TypeScript Client

`baseURL` 必须是专用 Business Gateway 的 service root，不能包含 `/api/v1`；
Client 会自动追加公共前缀。`accessToken` 可以是字符串或异步 provider，provider
会在每次请求时重新执行，因此 token 轮换无需重建 Client。

```ts
import { RagFlowBusinessClient } from '@nomix-ai/nomix-ragflow/client'

const ragflow = new RagFlowBusinessClient({
  baseURL: 'https://ragflow-business.example.com',
  accessToken: async () => businessIdentity.getAccessToken(),
  timeoutMs: 60_000,
  maxResponseBytes: 16 * 1024 * 1024,
})

const authorization = await ragflow.authorization.getContext()
const datasets = await ragflow.datasets.list({ limit: 20 })
const retrieval = await ragflow.retrieval.search({
  question: '最新版本有哪些变化？',
})
console.log(datasets.data, datasets.meta.nextCursor)
console.log(retrieval.data.chunks, retrieval.meta.nextCursor)
```

所有请求支持 `AbortSignal`；要求幂等的写操作还必须提供 `idempotencyKey`。更新和单资源
删除必须把最近一次读取返回的 `version` 放入 RequestOptions，Client 会发送 `If-Match`。
Gateway 错误统一抛出 `BusinessGatewayError`，包含 `code`、`status`、`requestId`、
`details`、`retryable` 和可选的 `retryAfterMs`；超时和取消会持续覆盖到响应体完整消费
结束。Client 不开放 tenant、workspace、subject、actions、scope
或任意可信认证头配置，这些值只能来自服务端验证后的业务令牌。
成功响应采用流式、有上限的缓冲区：默认 16 MiB，硬上限 64 MiB；Gateway 错误体另有
64 KiB 的解析上限。`RequestOptions.maxResponseBytes` 只能对单次请求进一步收紧，不能
突破 Client 的全局上限。

## Nomix Harness 插件

先安装 bundle：

```bash
nomix plugin --profile my-profile add @nomix-ai/nomix-ragflow
```

bundle 会挂载无 I/O 的 `ragflow-service` 能力定义，并写入一条禁用的 `ragflow`
组合配置。请在 Profile 的 `cordis.patch.yml` 中启用，并显式选择 Agent：

```yaml
- id: ragflow
  disabled: false
  config:
    baseURL: https://ragflow-business.example.com
    accessTokenRef: RAGFLOW_BUSINESS_ACCESS_TOKEN
    requestTimeoutMs: 60000
    agentPresets:
      - knowledge-worker
    workspaceRoot: .
    # Agent 文件读取当前是内存有界模式，硬上限为 64 MiB。
    maxFileBytes: 67108864
    artifactMaxBytes: 10485760
```

业务 access token 由 Harness 凭据服务保存。集成采用与 `nomix-crm` 一致的
Service Definition / Provider / Consumer 边界：Provider 在每次工具操作开始时，从
当前 Agent/session 上下文只解析一次 `accessTokenRef`，再创建该操作专属的
`RagFlowBusinessClient`；下一次操作会看到轮换后的 token。根级 Consumer 不解析、
不缓存凭据。指定 `providerId` 时精确绑定；未指定时只有“恰好一个可用 Provider”
才会执行，否则失败关闭。

Consumer 安装在选中的 Agent 作用域，根 Context 不注册 RAGFlow 工具。应使用
`agentPresets` 白名单，或显式配置 `attachToAllAgents: true`；两者都不提供会直接
报配置错误。工具、审批监听、fs、spill owner 和清理生命周期都归属该 Agent。
工具执行超时由 `requestTimeoutMs + 30 秒` 构成；额外时间只用于 Agent 凭据解析和
有界 artifact 处理，HTTP 请求本身仍严格在 `requestTimeoutMs` 时终止。

插件把请求标记为 `agent`，独立 Client 默认标记为 `rest`；该封闭字段只用于审计
分类，不参与身份、actions、workspace 或数据范围判断。因此 REST 和 Agent 始终进入
同一认证与授权路径。

十个工具包含 `ragflow_discover`，并覆盖检索、数据集、文档、传输、chunk、聊天、
会话、Agent 和 Memory。discover 只返回脱敏后的授权摘要（可用性、认证形态、action
数量、scope 模式与数量），不会暴露 subject、workspace ID、permissionRef、action
名称或原始 scope ID。所有 Agent 写操作都必须携带由调用方稳定生成的业务
`operationId`，并经过一次性 pre-execute 人工审批。同一不确定业务意图即使被 Harness
分配了新的 tool call ID，重试时也必须复用 `operationId`，插件会生成相同的
Agent/operation 绑定幂等键；新的业务意图必须使用新值。审批界面展示有界的目标 ID、
artifact 路径、版本、字段名和意图 ID。审批只是额外的人机门禁，Gateway 仍会校验
token 的 action 和数据范围。读操作可并行，写操作独占调度。工具返回封闭、可判别的
`status`、`summary`、`data`、`nextActions`、`artifacts`：小型 JSON 转为带类型的
JSON Pointer entries，大结果写入当前 Agent/session spill，只向模型暴露 artifact
reference。

Agent operation 绑定和“所有写操作审批”均从 canonical capability manifest 派生。
Harness 元数据还描述 Agent/Provider 选择、凭据解析、discover 脱敏、幂等归属、超时
组合、输出结构与 artifact 上限，但这些信息不授予任何权限。公共 request/query/path
与 operation 级响应类型由 Gateway OpenAPI 生成；Client 会按当前 operation 校验响应，
不再猜测列表 wrapper、invoke 字段或嵌套结果。`npm run contracts:check` 会在验证和发布
前阻止 npm 与服务端契约漂移。

上传只通过当前 Agent 的 fs Provider 读取；`workspaceRoot` 相对 session cwd，路径
穿越、末级符号链接、符号链接逃逸和 `maxFileBytes` 超限都会被拒绝。Agent 删除一次
只接收一个显式 ID 和当前 version；REST/Client 批量操作必须给出封闭且有限的 ID，
不存在隐式 `deleteAll`。

Harness 当前没有 workspace-safe 的二进制流式读取接口，因此 Agent 上传会在内存中
物化文件。插件默认值和硬上限均为 64 MiB，并避免在构造 `Blob` 前再复制一份完整
`Uint8Array`。更大的文件应由业务系统直接通过 REST 上传，并相应提高 Gateway 的
单文件、完整请求和代理三层预算；插件不会绕过 Harness fs 直接读取宿主机路径。

授权下载不会再把 Harness path 转成宿主机 Node path，并以当前 session 为 owner 写入
Harness spill。Harness 0.2.5 的 SpillStore 只有文本接口，因此在下载前按
`floor(artifactMaxBytes / 4) * 3` 计算原始二进制上限，确保 base64 编码结果不会超过
`artifactMaxBytes`。二进制暂时使用明确标注的 `.base64` 文本 artifact，保留原始文件名、媒体
类型、大小和摘要；base64 内容不会进入模型可见结果。未来接入原生二进制 artifact
Provider 时，无需改变 Gateway Client 或工具契约。

## 导出入口

- 包根：Client、公共类型、错误和 capability manifest。
- `./client`：独立的 `RagFlowBusinessClient`。
- `./plugin`：Harness 生命周期入口 `name`、`inject`、`Config`、`apply`。
- `./types`：公共类型。
- `./errors`：`BusinessGatewayError`。
- `./manifest`：canonical Business Gateway capability 快照。
- `./service`：无 I/O 的 `RagFlowRuntime` Provider 中立能力缝。
- `./provider`：Business Gateway endpoint 与 Agent 凭据绑定。
- `./consumer`：Agent 作用域工具、审批、fs 与 artifact 集成。

## 从 0.x 迁移

1.0 是明确的破坏性升级：删除 `RagFlowClient`、`RagFlowApiError`、`apiKey`、
`apiKeyRef`、`apiVersion`、原始 API 路径和直连回退。请把旧 RAGFlow 地址替换为
专用 Gateway service root，把原始 API Key 替换为业务 access token（插件中使用
凭据引用）。不提供兼容模式。

服务端部署、权限、action、scope、审计和网络边界详见 RAGFlow 工程中的 Business
Gateway 落地文档。

许可证：Apache-2.0。
