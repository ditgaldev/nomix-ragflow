---
sidebar_position: 8
title: Nomix Business Gateway Integration Standard v1
sidebar_label: Business Gateway v1
slug: /business_gateway_integration
---

# RAGFlow Business Gateway 标准化接入

本文描述 Nomix Business Gateway Integration Standard v1 在 RAGFlow 中的落地。
Business Gateway 是业务 REST 调用和 Agent 工具调用的唯一业务数据入口；现有 Web、
管理端和官方 SDK 使用的原始 RAGFlow API 平面仍然存在，但必须放在管理网络中。

## 最终调用链

```text
业务系统 REST ───────────────┐
                            ├─> 专用 Gateway service root /api/v1/*
Nomix Agent 工具 -> npm Client ┘               │
                                                ├─ Token Introspection
                                                ├─ workspace -> tenant 映射
                                                ├─ action 校验
                                                ├─ tenant/ACL/scope 求交
                                                ├─审计与幂等
                                                └─同进程 RAGFlow 应用服务适配层

专用 Nginx：/api/v1/* -> Quart /api/business/v1/*
管理网络：原始 RAGFlow /api/v1/*（不得通过专用 Gateway service root 到达）
```

Gateway 在 Quart 进程中直接调用已注册的 RAGFlow 应用服务命令，不向自身发 HTTP
请求，也不使用原始 RAGFlow API Key。检索、解析、向量化和文档存储核心路径保持
不变。

## 三类凭据

| 凭据 | 持有方 | 用途 | 是否进入 npm/业务日志 |
|---|---|---|---|
| Business access token | 业务系统或 Harness 凭据服务 | 调用公共 `/api/v1`；每次由 Gateway Introspection 验证 | npm 只在请求时读取，不持久化、不输出 |
| Introspection client 凭据 | Gateway 服务端 secret store | Gateway 向身份系统验证 token；Basic 或 mTLS | 否 |
| 原始 RAGFlow API Key | 现有 RAGFlow 原始 API 平面，服务端 `api_token` 表 | 现有 Web、管理端或内部 SDK；不参与 Gateway | 绝不进入 Gateway、npm、Gateway 错误或审计 |

Business Gateway 没有“内部原始 API Key”配置项。若部署仍使用原始 API Key，沿用
RAGFlow 现有 `APIToken` 管理和数据库存储，不把该值复制到 Gateway 环境变量或
插件配置。

## Token Introspection 契约

v1 只支持 Token Introspection，不维护 JWT/JWKS 双轨。Gateway 使用 RFC 7662
表单请求发送 token，并以 Basic client authentication 或 mTLS 认证自身。非回环
地址必须使用 HTTPS；超时、非 2xx、超大或非法响应全部失败关闭为 503。

最小有效响应示例：

```json
{
  "active": true,
  "subject": "user:42",
  "actorSubject": "service:crm",
  "onBehalfOfSubject": "user:42",
  "workspaceId": "crm-shanghai",
  "actions": ["knowledge:retrieve", "dataset:read", "document:read"],
  "datasetScope": {"mode": "ids", "ids": ["kb-1", "kb-2"]},
  "documentScope": {"mode": "inherit"},
  "chatScope": {"mode": "ids", "ids": ["chat-1"]},
  "agentScope": {"mode": "ids", "ids": ["agent-1"]},
  "memoryScope": {"mode": "ids", "ids": ["memory-1"]},
  "expiresAt": "2026-08-28T14:30:00Z",
  "audience": ["nomix-ragflow-data"],
  "tokenUse": "data",
  "iss": "https://identity.example.com"
}
```

`datasetScope`、`documentScope`、`chatScope`、`agentScope` 和 `memoryScope` 是必需的
已解析权限结果；缺少任一字段都会失败关闭。`permissionRef` 可以同时
返回，但只作为外部授权决定的引用和审计关联键，不能代替 scopes，也不会在 RAGFlow
中解析或授予权限。业务角色、角色到 actions、permissionRef 到业务数据权限的关系均
由身份/业务系统维护；RAGFlow 只验证并强制执行。

服务端配置：

```dotenv
NOMIX_BG_ENABLED=true
NOMIX_BG_INTROSPECTION_URL=https://identity.example.com/oauth2/introspect
NOMIX_BG_AUTHORITY=https://identity.example.com
NOMIX_BG_AUDIENCE=nomix-ragflow-data
NOMIX_BG_CURSOR_SECRET=<at-least-32-byte-random-server-secret>
NOMIX_BG_INTROSPECTION_AUTH_MODE=basic
NOMIX_BG_INTROSPECTION_CLIENT_ID=nomix-ragflow-gateway
NOMIX_BG_INTROSPECTION_CLIENT_SECRET=<server-secret>
NOMIX_BG_INTROSPECTION_TIMEOUT_SECONDS=3
NOMIX_BG_INTROSPECTION_RETRIES=1
NOMIX_BG_INTROSPECTION_CACHE_SECONDS=5
NOMIX_BG_INTROSPECTION_MAX_CONNECTIONS=100
NOMIX_BG_MAX_FILE_BYTES=67108864
NOMIX_BG_MAX_REQUEST_BYTES=75497472
NOMIX_BG_PROXY_MAX_REQUEST_BYTES=83886080
NOMIX_BG_READINESS_TIMEOUT_SECONDS=5
```

每个 Quart worker 在 serving 生命周期内只维护一个带连接池上限的 `aiohttp.ClientSession`；
请求之间复用 TLS 连接，token 本身不进入 session 默认 header，并在每次请求时单独发送。
worker 停止时显式关闭 session。`NOMIX_BG_ENABLED` 默认关闭，只有专用 Gateway 部署显式
开启后才注册数据平面路由，因此本集成不会改变普通 RAGFlow 部署的原始 API 行为。

`NOMIX_BG_CURSOR_SECRET` 仅保存在 Gateway 服务端，用于认证 opaque cursor。游标绑定
operation、workspace binding、subject、permissionRef、筛选条件、首屏快照键和最后排序键；
不能跨用户或跨查询复用。关系型列表按 `(create_time, id)`、chunk 按
`(create_timestamp, id)`、检索结果按 `(score, id)` 降序执行 keyset 查询，因此并发插入
不会让后续页重复或漂移。Memory 消息不修改 RAGFlow 的多后端 DocStore 接口，Gateway
按 `message_id` 快照从头执行有界扫描并过滤晚于快照的并发插入；扫描窗口上限为 10,000
条，超过时失败关闭并返回 `CURSOR_WINDOW_EXCEEDED`，不会退回页码游标。轮换该密钥会
主动使尚未消费的旧游标失效。

mTLS 使用 `NOMIX_BG_INTROSPECTION_CA_FILE`、`NOMIX_BG_INTROSPECTION_CERT_FILE` 和
`NOMIX_BG_INTROSPECTION_KEY_FILE`。证书、私钥和 client secret 只挂载到 Quart
容器。

Client 发送严格枚举的 `X-Nomix-Call-Source: rest|agent`，仅用于审计入口分类。
Gateway 会拒绝其他值，但该字段不参与身份、action、scope 或 workspace 判断；把它
改成 `agent` 不会增加任何权限。插件固定发送 `agent`，直接 Client 默认发送 `rest`。

## workspace、tenant 和 permissionRef

Introspection 返回外部 `workspaceId`，服务端按 `authority + workspaceId` 映射到
RAGFlow tenant 和内部 ACL 执行主体。映射未建立、停用、tenant 主体失效或执行
主体不再属于 tenant 时返回 403。

暴露专用 Gateway 入口前必须运行显式、幂等、仅前向的迁移命令。Gateway 表模型只
存在于 `api/apps/business_gateway/models.py`，不会进入 RAGFlow 原生模型注册和启动时
schema 同步：

```bash
NOMIX_BG_ENABLED=true quart --app api.apps business-gateway migrate
```

该命令创建：

- `business_gateway_workspace_binding`
- `business_gateway_idempotency`
- `business_gateway_audit_event`
- `business_gateway_schema_migration`

迁移由 `api/apps/business_gateway/migrations/` 下不可变的版本文件组成；已应用文件的
SHA-256 记录到迁移台账，任何事后修改都会阻止启动。多副本部署复用 RAGFlow 数据库的
advisory lock，只允许一个副本推进迁移。可在切流前执行只读检查：

```bash
NOMIX_BG_ENABLED=true quart --app api.apps business-gateway migration-status
```

启用 Gateway 后，Quart serving hook 也会检查迁移完整性；未迁移、checksum 漂移或缺表时
拒绝启动业务平面。

只有拥有部署管理权限的运维人员才能运行 Quart CLI：

```bash
quart --app api.apps business-gateway bind-workspace \
  --authority https://identity.example.com \
  --workspace-id crm-shanghai \
  --tenant-id <ragflow-tenant-id> \
  --execution-user-id <ragflow-user-id>
```

CLI 只管理 workspace 到 RAGFlow tenant/执行主体的服务本地映射以及幂等记录；不存在
本地 grant/revoke 命令。迁移会删除早期预发布的 `business_gateway_resource_grant` 表，
避免 RAGFlow 成为第二个授权源。

`subject` 同样由 Introspection 提供并由 Gateway 固定。Chat/Agent session 和 memory
message 在服务端绑定、查询并逐项校验该 subject；客户端的 `userId`/`user_id` 会按伪造
授权上下文字段返回 400，不能用来读取同 workspace 内其他业务用户的数据。

## 稳定 action 表

| 资源 | actions |
|---|---|
| 授权上下文发现 | `authorization:read` |
| 检索 | `knowledge:retrieve` |
| Dataset | `dataset:read`, `dataset:create`, `dataset:update`, `dataset:delete` |
| Document | `document:read`, `document:upload`, `document:update`, `document:delete`, `document:parse` |
| Chunk | `chunk:read`, `chunk:create`, `chunk:update`, `chunk:delete` |
| Chat | `chat:read`, `chat:create`, `chat:update`, `chat:delete` |
| Session | `session:read`, `session:create`, `session:update`, `session:delete`, `session:invoke` |
| Agent | `agent:read`, `agent:create`, `agent:update`, `agent:delete` |
| Memory | `memory:read`, `memory:create`, `memory:update`, `memory:delete` |
| Memory message | `memory-message:read`, `memory-message:create`, `memory-message:update`, `memory-message:delete` |

每个 endpoint 的 action 来自唯一 canonical manifest：
`api/apps/business_gateway/capabilities.v1.json`。同一清单生成 Quart 路由元数据、
OpenAPI、npm `./manifest` 快照和漂移测试；映射到 Agent 的 operation 还显式声明
`agentTool`、`agentAction`，会话操作再声明 `agentKind`。manifest 只描述能力，不授予权限。

## 数据范围计算

最终 dataset 范围始终是以下三者的交集：

1. token Introspection 返回的已解析 `datasetScope`；
2. workspace 映射的 RAGFlow tenant；
3. 内部执行主体经 `KnowledgebaseService.accessible` 得到的现有 ACL。

Document 再与 `DocumentService.accessible` 求交。`documentScope=inherit` 继承有效
dataset 范围，显式 document ID scope 只会进一步收窄。Chunk 必须同时属于已授权
document 和 dataset；RAGFlow v1 没有独立 chunk grant。

Chat、Agent 和 Memory 分别与 `chatScope`、`agentScope`、`memoryScope` 及当前 tenant
归属求交。Chat/Agent 中持久化的 dataset 引用还必须全部落在有效 dataset ACL 中；其
session/message 再叠加 subject 隔离。这样 tenant 只是最外层边界，不会退化成“同租户
全可见”。

- 显式 `datasetIds`、`documentIds`、`chatId`、`agentId`、`memoryId` 或资源路径中只要有一个越权 ID，整次请求统一
  返回 404，不部分执行，也不指出哪个 ID 越权。
- 检索未提供 `datasetIds` 时，Gateway 注入服务端计算出的有效 dataset 范围；范围
  为空时返回空结果，绝不枚举原始 API Key 可见数据集。
- Dataset/document/chunk 的列表、详情、下载、更新、删除、解析和统计使用同一范围。
- 批量写在任何副作用之前逐项预检，最多接受 1000 个非空字符串 ID；不存在
  `deleteAll`。
- 新 dataset/chat/agent/memory 强制归属映射 tenant，新 document 强制归属已授权的父
  dataset；Gateway 不写本地业务 grant。后续读取仍要求身份系统在新 token 中返回包含
  该资源的对应 scope。
- `permissionRef` 只记录外部授权决定，不会扩大 scope，也不会因创建资源而被 Gateway
  自动修改。
- 请求 body、query 或普通请求头中的 tenant、workspace、subject、actions、scope
  和 permissionRef 不可信，直接拒绝或由专用代理清除，不能覆盖服务端上下文。

## REST 示例

`baseURL` 是专用 service root，外部路径始终以 `/api/v1` 开始：

```bash
curl --fail-with-body \
  -H "Authorization: Bearer $BUSINESS_ACCESS_TOKEN" \
  -H "Content-Type: application/json" \
  https://ragflow-business.example.com/api/v1/retrieval \
  --data '{"question":"销售合同的续签规则是什么？","limit":20}'
```

写操作按 manifest 要求携带幂等键：

```bash
curl --fail-with-body \
  -X POST \
  -H "Authorization: Bearer $BUSINESS_ACCESS_TOKEN" \
  -H "Idempotency-Key: crm-op-8f92b7" \
  -H "Content-Type: application/json" \
  https://ragflow-business.example.com/api/v1/datasets \
  --data '{"name":"CRM 合同知识库","description":"由 CRM workspace 管理"}'
```

更新和单资源删除还必须携带最近一次读取返回的 `version`：

```bash
curl --fail-with-body \
  -X PATCH \
  -H "Authorization: Bearer $BUSINESS_ACCESS_TOKEN" \
  -H "If-Match: 1787971200123" \
  -H "Content-Type: application/json" \
  https://ragflow-business.example.com/api/v1/datasets/dataset-1 \
  --data '{"description":"经审批的新说明"}'
```

版本校验在 action、workspace、scope 和现有 ACL 校验之后执行，隐藏资源仍统一返回 404。
Gateway 直接复用 RAGFlow 已有 `update_time` 作为数字版本，并用现有 Redis 对同一资源的
Gateway 写入加分布式锁；不向原始 RAGFlow model 增加字段，也不修改原始 service 逻辑。

成功体统一为 `{ "data": ..., "meta": { "requestId": ... } }`。列表使用 opaque
`cursor` 和 1–100 的 `limit`，响应 meta 返回 `hasNext` 和 `nextCursor`，调用方不能
解析 cursor。

每项 operation 都有独立的封闭顶层 request schema，OpenAPI 与运行时校验共用同一份
contract；未知字段会返回 400。tenant、workspace、subject、actions、scope、permissionRef
等可信上下文字段即使藏在嵌套配置中也会被递归拒绝。DSL、模型参数和业务 inputs 这类本身
可扩展的值仍以显式命名的 object 字段承载，但不能覆盖授权上下文。

Quart 适配器只调用 RAGFlow application/service、Peewee persistence、对象存储和文档索引
接口；不创建内部 HTTP 请求上下文，不查找原始 REST view，也不使用 loopback 或 API Key。
Business Gateway 的 subject/scope 过滤、Agent DSL 能力限制、幂等与审计均封装在
`api/apps/business_gateway/`；原生 RAGFlow Web/API、Chat、Memory、检索、解析、向量化和
Agent 运行逻辑不承载业务系统权限语义，也不因插件接入而改变行为。

## npm Client 与 Agent

RAGFlow 插件与 CRM 插件遵循同一 Harness 分层：`plugin.ts` 只负责配置、凭据引用、
生命周期和 pre-execute hook；`tools.ts` 只负责封闭的语义工具 schema、结构化 observation
与稳定工具调用幂等键；`client.ts` 是 REST 和 Agent 共用的唯一传输实现；服务端 manifest
是 endpoint/action/risk/idempotency 的唯一能力清单。RAGFlow 仅因文件上传多出
`workspaceRoot`、`maxFileBytes` 与文件安全适配。

npm 的请求、query 和 path 类型由 Gateway OpenAPI 生成到 `src/openapi.generated.ts`，canonical
capability 同步生成可发布的 `src/capabilities.generated.json` 快照；`npm run contracts:generate`
更新二者，`npm run contracts:check` 在验证和发布前阻止漂移。
Agent 写审批、幂等键生成和 operation 绑定均读取同一 capability，而不是维护独立写操作表。

与 CRM 的刻意差异只有领域需要的加强项：RAGFlow Agent 的所有写操作均审批；RAGFlow
使用现有 tenant/ACL 与 dataset/document/chat/agent/memory scope 求交，而不是复制 CRM 的 PostgreSQL
RLS。身份、actions 和业务数据权限都由同一个外部授权系统给出，Gateway 只负责验证、
映射内部执行主体、求交和强制执行。以上差异都留在 Business Gateway/Harness 边界，
不改变 RAGFlow 原生业务路径。

Agent 的 update/delete 输入要求使用此前读取到的 `version`，Client 只把它放入
`If-Match`，不开放任意请求头。Agent 删除操作一次只接收一个显式资源 ID；REST/Client
保留的批量命令仍要求有限 ID 列表、全量权限预检和必需幂等键。

TypeScript 直接调用：

```ts
import { RagFlowBusinessClient } from '@nomix-ai/nomix-ragflow/client'

const client = new RagFlowBusinessClient({
  baseURL: 'https://ragflow-business.example.com',
  accessToken: () => identity.getCurrentAccessToken(),
  timeoutMs: 60_000,
})

const authorization = await client.authorization.getContext()
const result = await client.retrieval.search(
  { question: '列出客户约定的 SLA' },
  { signal: abortController.signal },
)

console.log(result.data.chunks)
console.log(result.meta.nextCursor)
```

Client 的分页列表和 retrieval 保留 REST 的 `{data, meta}` envelope，下一页必须原样
传回 `meta.nextCursor`，不得解析或自行构造 cursor。

Harness 配置：

```yaml
- id: ragflow
  disabled: false
  config:
    baseURL: https://ragflow-business.example.com
    accessTokenRef: RAGFLOW_BUSINESS_ACCESS_TOKEN
    requestTimeoutMs: 60000
    workspaceRoot: .
    # Agent 上传当前以 Harness 内存读取为边界，最大 64 MiB。
    maxFileBytes: 67108864
```

插件从当前 `exec.agent.ctx.credentials` 解析凭据，每次工具执行创建执行级 Client，
且 Client 每次请求重新解析 token；进程级插件 Context 不保存业务 token。所有 Agent 写操作都触发一次性 pre-execute
审批；工具参数变化后必须重新审批。审批不能增加 token actions 或 scope，Gateway
仍按相同规则返回 403/404。Agent 自动用稳定 tool call ID 与规范化输入生成
Idempotency-Key。

上传工具继续执行 workspaceRoot 路径归一化、路径穿越和符号链接逃逸检查，并在
发起 multipart 请求前限制文件大小；成功 observation 的 `artifacts` 返回 document ID
和名称。下载通过同一 Client 获取授权内容，按 `artifactMaxBytes` 同时检查声明长度和
实际流式字节数。当前 Harness `SpillStore` 只提供文本写入接口，因此二进制会在当前
Agent/session owner 下保存为有界的 `.base64` 文本 artifact；原始名称、媒体类型、字节数
和 SHA-256 保留在 artifact 元数据中，base64 内容不会进入模型可见 observation。原生二进制
artifact 需要 Harness 增加 binary/fs artifact provider 后再切换，本次 RAGFlow 插件不会
私自扩展或替换 Harness 契约。

Harness 当前没有 workspace-safe 的流式二进制读取接口，Agent 上传需要把文件物化在
内存中。插件因此把默认值和硬上限都设为 64 MiB，并在 `Blob` 构造前不再额外复制完整
字节数组。大文件由业务系统直接调用 REST 上传；服务端可以按容量规划提高三层预算，
但必须保持 `NOMIX_BG_MAX_FILE_BYTES < NOMIX_BG_MAX_REQUEST_BYTES <
NOMIX_BG_PROXY_MAX_REQUEST_BYTES`。Gateway 还要求完整请求至少比单文件上限多 8 MiB，
用于 multipart boundary、字段和文件名等开销。

OpenAPI 为每个 operation 定义独立响应 schema。npm 代码生成器据此生成精确的
`OperationData<operation>`，Client 在返回前按 operation 校验 `{data, meta}`；列表、
invoke 和管理操作均不再通过字段探测、响应猜测或类型强转兼容旧形状。

## REST、Client、Agent 映射

| 公共 REST `/api/v1` | Client | Agent tool |
|---|---|---|
| `GET /gateway-context` | `authorization.getContext` | `ragflow_discover` |
| `POST /retrieval` | `retrieval.search` | `ragflow_retrieval` |
| `/datasets*` CRUD/list | `datasets.*` | `ragflow_manage_datasets` |
| dataset metadata config | `datasets.getMetadataConfig/updateMetadataConfig` | `ragflow_manage_documents` |
| `/datasets/{datasetId}/documents*` | `documents.*` | `ragflow_manage_documents` |
| upload/download/parse | `documents.upload/download/startParse/cancelParse` | `ragflow_transfer_documents` |
| document chunks | `chunks.*` | `ragflow_manage_chunks` |
| `/chats*` | `chats.*` | `ragflow_manage_chats` |
| chat/agent sessions 与 invoke | `sessions.*` | `ragflow_manage_sessions` |
| `/agents*` | `agents.*` | `ragflow_manage_agents` |
| memories 与 memory messages | `memories.*`, `memoryMessages.*` | `ragflow_manage_memories` |

精确 method/path/action/agentAction/idempotency 映射以 `/api/v1/capabilities`、
`/api/v1/openapi.json` 和 npm `@nomix-ai/nomix-ragflow/manifest` 为准。Agent 没有
隐藏 endpoint、额外 action 或第二认证路径。

## 错误、幂等与审计

错误体：

```json
{
  "error": {
    "code": "ACTION_NOT_ALLOWED",
    "message": "The business subject is not allowed to perform this action.",
    "requestId": "...",
    "details": {"requiredActions": ["dataset:create"]},
    "retryable": false
  }
}
```

| HTTP | 典型含义 |
|---|---|
| 400 | 请求 schema、cursor、可信上下文字段或必需幂等键无效 |
| 401 | Bearer token 缺失、无效或过期 |
| 403 | action 缺失、audience/tokenUse 不符或 workspace 停用 |
| 404 | 资源不存在、跨 tenant/workspace 或不在有效 dataset/document/chat/agent/memory/chunk 范围 |
| 409 | 幂等键冲突、同键请求仍在执行、资源版本过期或同资源写入正在执行 |
| 413 | `FILE_TOO_LARGE` 表示单个上传文件超限；`REQUEST_TOO_LARGE` 表示完整 JSON/multipart 请求体超限 |
| 428 | PATCH/PUT/单资源 DELETE 未提供有效 `If-Match` 版本 |
| 503 | Introspection、文档存储或内部依赖不可用，Memory 游标超过有界扫描窗口，或幂等执行结果待人工核对；失败关闭 |

GET 的 idempotency 为 `none`；POST 创建、上传、解析、invoke 和批量写为
`required`；PATCH、PUT、DELETE 为 `supported`。记录按 workspace binding、tenant、
subject、permission/scope、operation 和幂等键 SHA-256 隔离（不使用 token 指纹，
因此 token 轮换不破坏重放语义），保存规范化请求 hash 和响应 24 小时；同键不同请求返回
409，尚未越过副作用边界的 reservation 使用两分钟租约并可安全回收。命令执行前，Gateway
在同一数据库事务中写入 `business_gateway_execution_intent` 并把幂等记录转为
`executing`；执行意图只包含 operation、稳定资源 ID、父资源 ID 和对象存储定位等无凭据恢复
信息。活动执行具有 30 分钟恢复租约，租约内同键并发请求返回可重试 409，不会和原请求并行
探测或执行。

副作用之后无法提交响应与审计时记录转为 `uncertain`。携带同一 Idempotency-Key、且通过
最新 token、action、scope 和 ACL 校验的请求会先走权威状态恢复：

删除后的资源无法再次通过普通存在性 ACL 查询，因此执行意图另存不可逆的 retry lookup hash
和授权快照 hash。只有 tenant、subject、actor、workspace binding、执行主体、permissionRef、
全部资源 scope 与规范化请求 hash 均与原命令一致时，才允许以原执行意图签发恢复 seal；仍然
存在的 dataset 父资源还会重新与当前 `KnowledgebaseService.accessible` 求交。原始
Idempotency-Key、token 和对象 key 不写入该索引。

- Chat/Session/Agent 创建使用幂等记录派生的稳定资源 ID；文档上传为每个文件预分配稳定
  document ID。数据库资源与对象都存在时可重建原响应。
- Chat/Session/Agent 删除通过权威关系表证明目标状态。
- Dataset 删除按原有 service 语义继续收敛关系数据和 dataset index，并验证二者均不可见；
  不扩展原服务的对象删除语义。
- 文档删除是收敛式 saga：按执行前保存的 bucket/key 和 dataset/document ID 继续清理关系
  数据、对象存储与文档索引，并在全部验证为空后完成。
- chunk 创建验证确定性 chunk ID；chunk 删除重放幂等清理并按文档索引权威计数修正
  `chunk_num`。
- parse/cancel 通过执行前 task ID 集合及 document run 状态证明新任务或取消状态。

恢复成功会以 `X-Idempotent-Replay: true`、`X-Idempotency-Recovered: true` 返回，并在同一
数据库事务中完成幂等 CAS 和 `recovered` 审计。探测依赖不可用、证据不完整，或 operation
没有安全恢复策略时仍返回不可重试的 `IDEMPOTENCY_OUTCOME_UNKNOWN`，绝不猜测结果；此时才
进入人工 runbook。响应缓存和成功/恢复审计均与对应幂等终态在同一数据库事务提交。
`cleanup-idempotency` 只清理过期的 `reserved/completed` 及其执行意图，不会删除未知结果
证据。

<a id="idempotency-reconciliation-runbook"></a>

### 幂等未知结果处置 runbook

1. 自动恢复已经失败后，收到 `RagFlowBusinessGatewayUncertainIdempotency` 或
   `RagFlowBusinessGatewayStuckExecution` 后，暂停对应 operation/租户的人工重试；不要更换
   Idempotency-Key 绕过失败关闭。
2. 从管理网络读取不含凭据的待处置队列，并保存 `recordId`、`operation` 和
   `requestHash` 三元组。队列同时给出 `recoveryStrategy`、`recoveryAttempts` 和脱敏的
   `lastRecoveryError` 和仅含资源 ID 的 `recoveryTargets`，不暴露完整 descriptor、对象 key 或
   业务凭据：

   ```bash
   quart --app api.apps business-gateway list-uncertain-idempotency --json-output
   ```

3. 结合追加式 Gateway 审计、RAGFlow tenant 内资源、对象存储和文档引擎核对副作用。缺少
   成功审计不能单独证明副作用未发生，因为崩溃可能发生在副作用之后、审计提交之前。
4. 先执行只读 dry-run。确认副作用已发生时，必须提供可从权威状态重建的准确 HTTP 状态和
   `{data,meta}` 响应，且 `meta.requestId` 非空：

   ```bash
   quart --app api.apps business-gateway reconcile-idempotency \
     --record-id <record-id> \
     --expected-operation datasets.create \
     --expected-request-hash <sha256-from-queue> \
     --outcome applied \
     --response-status 201 \
     --response-json '{"data":{"id":"<dataset-id>"},"meta":{"requestId":"<original-request-id>"}}' \
     --dry-run
   ```

   确认副作用没有发生时，dry-run 使用 `--outcome not-applied`，且不得提供 response 参数。
5. 由第二名运维复核三元组、证据和 dry-run 输出后，原样移除 `--dry-run` 执行。命令在数据库
   事务中使用 compare-and-set；记录已被其他处置修改时会失败，不会覆盖终态。
6. 再次列出队列并确认对应记录消失、uncertain/stale 指标归零。无法准确重建 applied 响应，
   或无法确定副作用是否发生时，保持 `uncertain` 并升级处理，不能猜测。

至少每季度在预生产环境演练一次：注入测试专用 uncertain 记录，分别验证 `applied` 重放与
`not-applied` 释放路径；不得在生产业务数据上为了演练制造未知结果。

更新、单资源删除和 Memory message/chunk 的父资源状态变化采用乐观并发控制。Client 的
`RequestOptions.version` 生成 `If-Match`；版本缺失返回 428，版本过期返回
`VERSION_CONFLICT` 409。chunk 以父 document 为并发边界，memory message 以父 memory
为并发边界。批量操作没有伪造复合 ETag，而是依靠显式 ID、逐项预检和幂等语义。

每次已认证请求追加审计事件，包括 requestId、subject/actor/on-behalf-of、workspace、
tenant、operation、action、资源 ID、REST/Agent 调用标记、结果、HTTP 状态、耗时、
token 指纹和幂等键 hash。审计、日志和错误只保存哈希或脱敏值，不保存 token、
Introspection secret 或原始 RAGFlow API Key。

## 网络部署

使用 `docker/docker-compose-business-gateway.yml` 与原 compose 合并，并从 secret
store 提供 `docker/.env.business-gateway.example` 中的服务端变量。专用入口模板是
`docker/nginx/business-gateway.conf.template`，只匹配 `/api/v1/*` 并改写到
`/api/business/v1/*`；其他路径一律 404。公开 listener 只监听 TLS 8443，证书和私钥通过
`BUSINESS_GATEWAY_TLS_CERT_FILE`/`BUSINESS_GATEWAY_TLS_KEY_FILE` 只读挂载；不提供明文
业务端口。上传预算分为三层：`NOMIX_BG_MAX_FILE_BYTES` 限制单文件，
`NOMIX_BG_MAX_REQUEST_BYTES` 限制 Quart 完整请求并至少预留 8 MiB multipart 开销，
`NOMIX_BG_PROXY_MAX_REQUEST_BYTES` 限制 Nginx 公共入口且必须大于 Quart 限制。默认值
分别为 64 MiB、72 MiB 和 80 MiB；代理启动时会拒绝不满足大小顺序的配置。

原始 RAGFlow 的 9380、Web、登录和管理入口必须绑定管理网段、内部负载均衡或防火墙，
不能发布到业务客户端所在网络。专用 Gateway 入口不能复用原始 RAGFlow service
root；仅增加一个反向代理而不隔离原始端口，不构成完整网络边界。

`GET /api/v1/health` 只表示进程存活；负载均衡必须使用 `GET /api/v1/ready`，它会检查
数据库、Redis、文档引擎、对象存储、迁移台账、Introspection 实际可达性和游标签名配置。
内部 Prometheus 从管理网络抓取 Quart 的 `/api/business/v1/_metrics`；专用公网代理明确
屏蔽 `/api/v1/_metrics`。`docker/monitoring/business-gateway-alerts.yml` 提供 not-ready、
Introspection、审计写失败和 uncertain idempotency 告警规则。

切流和每次发布前先运行只读网络门禁（不会接受 HTTP 生产地址）：

```bash
NOMIX_BG_TEST_BASE_URL=https://ragflow-business.example.com \
NOMIX_BG_TEST_ACCESS_TOKEN="$BUSINESS_ACCESS_TOKEN" \
python scripts/verify-business-gateway-deployment.py
```

该门禁通过公开 HTTPS 入口检查 readiness、逐项 capability 的未认证 401、一致错误 envelope、
原始 RAGFlow API/公开 metrics 不可达，以及真实 token 返回五类 scope。也可用
`pytest -m integration test/integration/business_gateway/test_production_gateway.py` 纳入部署流水线。

随后使用两个专用测试 workspace 身份运行可写、随机命名并自清理的真实数据平面门禁：

```bash
NOMIX_BG_TEST_BASE_URL=https://ragflow-business.example.com \
NOMIX_BG_TEST_ACCESS_TOKEN_A="$WORKSPACE_A_TEST_TOKEN" \
NOMIX_BG_TEST_ACCESS_TOKEN_B="$WORKSPACE_B_TEST_TOKEN" \
NOMIX_BG_LIVE_ALLOW_WRITES=true \
NOMIX_BG_TEST_REPORT_FILE=business-gateway-live-data-plane.json \
python -m scripts.business_gateway_live_data_plane
```

两个 token 必须映射到不同 subject 和 workspace，并只用于门禁；它们需要
`authorization:read`、`knowledge:retrieve`、dataset create/read/update/delete、document
upload/read/update/delete/parse actions，以及允许创建门禁资源的 dataset/document scope。门禁
并发创建两个 dataset，验证同键重放与请求冲突、伪造上下文头无效、跨 workspace
dataset/document 的读写删除及 retrieval 统一 404、真实对象存储上传下载、真实解析和
显式/服务端选择检索，最后只删除本次随机 ID 对应的资源。清理失败会让门禁失败并写入
脱敏报告，token 不进入报告。

仓库中的 `business-gateway-production-gate.yml` 串行执行两个门禁，使用
`business-gateway-production` Environment 的两个 secret、显式写授权变量和并发互斥；脱敏
报告作为 30 天构建 artifact 保存。也可用
`pytest -m integration test/integration/business_gateway/test_live_data_plane.py` 接入受保护的部署流水线。

<a id="production-release-runbook"></a>

### 生产发布 runbook

- 在切流前运行 `business-gateway migration-status`，确认迁移台账、checksum 和所有 Gateway
  表就绪；不允许应用副本在启动时隐式修表。
- `/api/v1/ready` 的数据库、Redis、文档引擎、对象存储、Introspection 和游标签名检查必须
  全部通过；任一失败都停止发布。
- 从业务网络验证专用 service root 只能访问 Gateway `/api/v1/*`，原始 RAGFlow API、Web、
  登录、管理端和 `_metrics` 均不可达。
- 运行只读门禁和两个 workspace 的可写数据平面门禁，并留存脱敏报告；任何清理失败都要先
  处置残留随机资源再继续发布。
- 检查 uncertain、stale executing、audit failure、introspection failure 告警均为零，并确认
  告警路由能到达值班人员。
- 先灰度一个 Gateway 实例，观察 401/403/404/409/503、延迟与审计写入，再逐步切流；回滚只
  回滚应用和代理，不回滚前向数据库迁移。

## 1.0 兼容性变化

npm 1.0 是破坏性升级，不提供直连兼容模式：

- 删除 `RagFlowClient`、`RagFlowApiError`、`apiKey`、`apiKeyRef` 和 `apiVersion`。
- `baseURL` 改为专用 Gateway service root，且不包含 `/api/v1`。
- Client 使用 `accessToken` 字符串或 provider；插件使用 `accessTokenRef`。
- 删除原始 API 路径、隐式 dataset 枚举、`deleteAll` 和任何直连回退。
- 新增独立 `./client`、`./plugin`、`./types`、`./errors`、`./manifest` 导出。
- Introspection 契约必须同时返回 `chatScope`、`agentScope`、`memoryScope`；旧响应会以
  `AUTH_CONTEXT_INCOMPLETE` 失败关闭，不会回退为 tenant 全可见。

旧配置必须显式迁移。不要把旧 RAGFlow API Key 复制到新的 access token 字段。
