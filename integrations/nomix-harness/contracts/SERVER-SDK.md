# Native RAGFlow server SDK / 原生服务端 SDK

1.1.2 恢复 `RagFlowBusinessClient`，直连仓库现有 `api/apps/restful_apis` 原生 API；不是恢复已删除的 RAGFlow Business Gateway。1.1.1 不含这些 SDK 出口，使用本指南需安装 1.1.2。

```text
Harness Agent → knowledge_* tools → 业务 Knowledge Gateway
                                      ↓ 权限、业务版本、资源映射
                                  Provider Adapter
                                      ↓ RagFlowBusinessClient（本包 ./client）
                                  RAGFlow /api/v1/**
```

SDK 是可复用的服务端调用库，不是 Harness 必须有的独立服务，也不注册工具。业务 Gateway 仍负责 ACL、幂等、审批授权、候选/活动版本、Worker、引用与下载链接；原生 API Key 只留在可信服务端。Agent 仍使用业务 ID、双凭据和受控 JSON，不能直接访问 SDK、原生 ID、原生参数或文件字节。

## Configuration / 配置

```ts
import { RagFlowBusinessClient } from '@nomix-ai/nomix-ragflow/client'
import type { RetrieveRequest } from '@nomix-ai/nomix-ragflow/types'

function createClient(baseURL: string, loadNativeApiKey: () => string | Promise<string>) {
  return new RagFlowBusinessClient({
    baseURL, // 例如 https://ragflow.example.com，服务根地址不带 /api/v1
    accessToken: loadNativeApiKey, // 由业务服务注入凭据加载函数
    timeoutMs: 60_000,
    maxResponseBytes: 16 * 1024 * 1024,
  })
}
```

`accessToken` 可以是非空字符串或每次请求解析的同步/异步函数。只发送原生 `Authorization: Bearer`，不向 RAGFlow 发送用户断言、Harness 服务令牌或伪造幂等保证。禁止跟随 HTTP 重定向。baseURL 可含反向代理路径前缀，不允许用户名、密码、query 或 fragment；部署方只配置可信地址。

所有方法最后一个参数可传 `{signal: AbortSignal}`。timeoutMs 范围 1–300000，覆盖凭据解析、请求和正文读取；maxResponseBytes 范围 1–67108864，只约束 JSON 缓冲，不是上传文件限制。没有自动重试。下载返回 `Response`，调用方必须消费或取消 body；流读取同样受请求超时和取消信号约束，不经过 Base64 或 Harness spill。

文件能力不要混用：`documents.upload` 仅接收非空的 `{body: Blob, displayName: string}[]` 并构造 FormData，不接收本地路径、fileResourceId、Node Readable 或 Web ReadableStream；也不提供断点续传或上传进度接口。文件获取和大小限制由业务端实施。下载不受 JSON 大小预算限制，但只有带 attachment Content-Disposition 的响应被当作文件；未带 attachment 的 JSON 先按原生 envelope 检查错误。`sessions.invoke` 是非流式 JSON 调用，不提供 SSE；“流式下载”不代表全部 SDK 操作都支持流式。

SDK 的资源 ID 参数须是非空、无首尾空白的字符串，不能为 `.`、`..` 或包含控制字符、斜杠、反斜杠、冒号；数字型消息 ID 需转成字符串。JSON 成功返回不会脱敏原生正文，也不校验全部 data 字段形状；业务 Adapter 必须检查自身依赖的字段后再投影为 Gateway DTO。

## Native operations / 原生能力

所有路径均自动加 `/api/v1`。JSON 方法返回原生 `{code:0,data?,message?,total?}`，不转换成业务 `{data,meta}`。保留各接口不同的分页形状；`data` 不保证存在。TypeScript 提供常用原生类型，动态 DSL/配置使用 `JsonObject`/`JsonValue`；运行时校验原生 envelope，不声称对所有原生 DTO 做关闭式 Schema 校验。

| SDK 分组 | 原生路径和语义 |
|---|---|
| `datasets` | `/datasets` 列表/创建/批量删除，`/datasets/{id}` 详情/PUT 更新；item `/metadata/config` GET/PUT 元数据配置；列表 total 在 envelope 顶层 |
| `documents` | `/datasets/{id}/documents` 列表、multipart 上传、显式 ID 删除；详情通过列表 `?id=` 查询，仍返回 `{total,docs}`；item GET 下载，PATCH 更新；集合 `/parse`、`/stop` 提交异步解析/停止 |
| `chunks` | 文档下 `/chunks` 列表/创建/显式 chunk_ids 删除；item GET/PATCH；原生普通 chunk 查询不等于编译产物查询 |
| `retrieval.search` | `POST /retrieval`；原生 question、dataset_ids、document_ids、向量/关键词、rerank、TOC/KG 等服务端参数 |
| `pageIndex.getStructure` | 文档下 `/structure/graph`，返回 `{templates}`，可能含多种 kind；不虚构独立 PageIndex search/build API |
| `templateGroups` | `/compilation-template-groups` 列表/创建；item GET/PUT/DELETE，原生模板结构由服务端验证 |
| `chats` | `/chats` 创建/列表/batchDelete；item GET/PATCH/DELETE，列表 data 为 `{chats,total}` |
| `agents` | `/agents` 创建/列表；item GET/PUT/DELETE，使用原生 DSL |
| `sessions` | 通过 `{kind:'chat'|'agent',ownerId}` 指定会话所属资源，列表/详情/创建/显式 ID 删除；updateChat 通过 PATCH 更新 chat 会话，原生无对应 agent 会话更新接口；invoke 调用 `/chat/completions` 或 `/agents/chat/completions`，强制 `stream:false` |
| `memories` | `/memories` 创建/列表，item PUT/DELETE；getConfig 调用 item `/config`，不是消息列表 |
| `memoryMessages` | `GET /memories/{id}` 列表；`POST /messages` 创建；`/messages/{memoryId}:{messageId}` 删除/状态更新，末尾 `/content` 读取；`/messages/search` 搜索，`GET /messages` 最近消息 |

列表使用原生查询名称（例如 page/page_size），不自动翻页。NativeQuery 数组编码为重复 query key；原生 memories 列表的 ids/owner_ids 要传逗号分隔字符串。所有删除集合必须提供非空、不重复的显式 ID，SDK 不提供 delete-all。SDK 不承诺覆盖 RAGFlow 全部管理端 API；以上是当前公开能力清单。

## Upload → parse → inspect → retrieve / 上传、解析、检索

以下代码延续上面的 import，在业务服务端运行。createClient/uploadCandidate/inspectCandidate/searchAuthorized 是接入示例函数，不是包内新增 API；凭据、授权集合和原生映射由调用方明确传入，不依赖未声明的全局变量。这些片段不是完整 Worker 或发布事务实现。

```ts
async function uploadCandidate(client: RagFlowBusinessClient, datasetId: string, blob: Blob, name: string, groupIds: string[], signal: AbortSignal) {
  const uploaded = await client.documents.upload(datasetId, [{ body: blob, displayName: name }], { signal })
  const doc = uploaded.data?.[0]
  if (!doc) throw new Error('Native upload did not return a document')
  await client.documents.update(datasetId, doc.id, {
    parser_config: { compilation_template_group_id: groupIds },
  }, { signal })
  await client.documents.startParse(datasetId, [doc.id], { signal })
  return doc.id // 仅已提交，不代表 READY，不立即发布业务版本
}

// Worker 后续读取状态并验证所需产物；这里不判断 READY 或激活版本。
async function inspectCandidate(client: RagFlowBusinessClient, datasetId: string, candidateDocumentId: string, signal: AbortSignal) {
  const metadata = await client.documents.get(datasetId, candidateDocumentId, { signal })
  const structure = await client.pageIndex.getStructure(datasetId, candidateDocumentId, { signal })
  return { metadata, structure }
}

async function searchAuthorized(client: RagFlowBusinessClient, query: string, authorizedDatasetIds: string[], authorizedActiveDocumentIds: string[], signal: AbortSignal) {
  // 本示例要求明确的已授权活动文档，空集合不得变成原生无限定检索。
  if (!authorizedDatasetIds.length || !authorizedActiveDocumentIds.length) return null
  const request: RetrieveRequest = {
    question: query,
    dataset_ids: authorizedDatasetIds,
    document_ids: authorizedActiveDocumentIds,
    toc_enhance: true,
    include_knowledge_compilation: true,
  }
  return client.retrieval.search(request, { signal })
}
```

业务端不能把空授权集合解释为无限定检索。常规混合检索、toc_enhance 和 include_knowledge_compilation 是原生检索控制，不等于 SDK 新实现了一套树推理算法。PageIndex 模板配置、解析和编译沿用 RAGFlow，服务端能力取决于实际部署及产物。业务 Gateway 决定是否使用章节增强/多路融合，并做权限和 active version 后置校验；原生返回不能直接交给模型。

重新解析可能清理该原生文档已有产物。因此业务替换/重建需要独立候选文档，不能对 active 文档直接 startParse 后声称旧版本仍完整可读。解析受理成功、progress 到顶或一次 stop 请求成功都不等于业务 READY/CANCELLED；由 Worker 结合权威状态与产物判断。SDK 没有伪造 parseAndWait、发布事务或无损替换。

## Errors and migration / 错误与迁移

`RagFlowApiError` 保留 status 和 code：原生非零数值 code（含 HTTP 200 错误）、HTTP_状态码、REDIRECT_REJECTED、REQUEST_CANCELLED、REQUEST_TIMEOUT、REQUEST_FAILED、ACCESS_TOKEN_UNAVAILABLE、RESPONSE_TOO_LARGE、INVALID_JSON_RESPONSE、INVALID_API_RESPONSE、INVALID_DOWNLOAD_RESPONSE。错误 message 为固定说明，不带原生远端异常文本、地址或 API Key；本地参数校验可抛 TypeError。SDK 的成功数据仍是原生数据，不是 Agent 安全响应。

HTTP 非 2xx 优先按 HTTP 错误处理，不保留远端正文。批量解析/删除等原生操作可能部分执行后报错；任何超时/错误都不能推导为“没有副作用”。SDK 不自动重试、不伪造原生不存在的 Idempotency-Key/If-Match 语义，业务 Worker 必须核对状态后恢复。

旧 SDK 的服务端连接能力保留，但依赖已删除 Gateway 的协议不复活：

| 旧 Gateway 能力/习惯 | 当前迁移方式 |
|---|---|
| 专用代理地址、业务令牌、Gateway envelope | 原生 baseURL/API Key；按原生 envelope 和 snake_case 字段接入 |
| PageIndex build/status/retrieval 专用路径 | 模板配置 + documents.startParse/get + pageIndex.getStructure + retrieval.search；不虚构不存在的原生接口 |
| Gateway 操作状态、幂等、乐观锁、权限上下文 | 业务 Gateway 持久化并实施；不是 SDK 或 RAGFlow 原生 HTTP 的保证 |
| 文档 get 返回单个 DTO | 原生列表按 ID 查询，返回 `{total,docs}`；item GET 是下载 |
| 消息批量写、任意消息更新、统一会话调用路径 | 原生 POST /messages 的 memory_id 数组只表示同一消息写入的记忆库；仅提供原生状态更新；chat/agent 分路且非 SSE |

验证覆盖所有 SDK 方法的 native method/path 存在性、请求编码、真实本地 HTTP multipart、流式文件读取、原生错误、超时取消和包入口隔离。原生路由存在性不等于真实部署端到端通过；发布/业务上线前仍须在实际 RAGFlow 和业务 Gateway 上验证授权上传、解析产物、检索、引用与下载完整流程。
