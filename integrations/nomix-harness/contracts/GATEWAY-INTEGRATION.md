# 业务 Knowledge Gateway 实现与接入指南

适用于 `@nomix-ai/nomix-ragflow` **0.3.0**、Nomix Harness **0.2.9**，HTTP 契约版本为 **v1**。本文随 npm 包发布，供任何业务系统实施自己的 Gateway；不绑定客户、租户命名、角色体系、数据库或 Web 框架。

本文说明业务端必须实现的行为，不表示安装 npm 包后已获得 Gateway 服务、数据库迁移、Worker 或权限系统。插件提供的是 Harness 工具及 Gateway 调用端；真实业务端仍须完成文末验收。

## 1. 从发布包取得唯一契约

业务系统在包发布后更新依赖并锁定版本：

```bash
npm install --save-exact @nomix-ai/nomix-ragflow@0.3.0
```

接入依据按以下顺序使用，不从对话记录或其他项目复制一份独立接口定义：

| 发布入口 | 用途 |
|---|---|
| `@nomix-ai/nomix-ragflow/knowledge-openapi.json` | 唯一 Agent/Gateway HTTP 契约：标准 path/query/header/body、响应、示例及 `x-nomix-business-rules` |
| `@nomix-ai/nomix-ragflow/knowledge-contract` | 同源生成的业务 TypeScript 类型，例如 `KnowledgeDocumentDetail`、`DocumentOperationAcceptedResponse` |
| `@nomix-ai/nomix-ragflow/manifest` 的 `knowledgeGatewayCapabilityManifest` | 20 个接口与工具、Action、审批、并发、幂等和安全读取重试规则 |
| 本文 | Gateway 职责、业务流程、实施顺序和验收要求；不另行定义 HTTP Schema |
| [中英文 README 中的配置与工具说明](../README.zh.md) | Harness 安装、Agent preset 与工具分组配置 |

例如在业务项目中读取已安装包的契约，并引用生成类型：

```ts
import { readFileSync } from 'node:fs'
import type { KnowledgeDocumentDetail } from '@nomix-ai/nomix-ragflow/knowledge-contract'
import { knowledgeGatewayCapabilityManifest } from '@nomix-ai/nomix-ragflow/manifest'

const openapi = JSON.parse(readFileSync(
  new URL(import.meta.resolve('@nomix-ai/nomix-ragflow/knowledge-openapi.json')),
  'utf8',
))
// 用 openapi 生成/校验 HTTP 边界；用 KnowledgeDocumentDetail 约束详情投影。
// manifest 中的 actions 是待执行的权限检查，不是授权结果。
```

类型检查不等于运行时校验。业务项目应使用支持 OpenAPI 3.1 / JSON Schema 2020-12 的校验器，并按 `x-nomix-business-rules` 实现跨字段、权限和生命周期约束。DTO 使用自己的内部模型映射得到，不能直接返回 ORM 实体。

## 2. 两个 Gateway 边界不能混用

```text
业务系统创建/刷新 Session ──> Harness businessIdentity 绑定当前用户断言
                                          │
Harness Agent → knowledge_* 工具 → 通用插件 → 业务 Knowledge Gateway
                                               │ 权限、版本、操作、引用、检索编排
                                               ↓
                                      服务端 Provider Adapter
                                               ↓
                       RAGFlow Business Gateway 或原生 RAGFlow API
                                               ↓
                            RAGFlow 解析、PageIndex、向量检索
```

| 层级 | 负责 | 不负责 |
|---|---|---|
| Harness | Session/Agent 循环、执行身份、工具审批与调度、取消信号、日志、SpillStore | 业务 ACL、文档发布事务、RAGFlow 调优 |
| 通用插件 | 20 个业务工具、逐次身份解析、关闭式输入输出、HTTP 调用、安全错误、UTF-8 JSON spill | 本地文件上传、二进制传输、客户角色、权限缓存、数据库和 Worker |
| 业务 Knowledge Gateway | 双身份认证、最终授权、文件资源校验、业务 ID 映射、版本生命周期、幂等任务、审计、引用再授权、检索编排 | 改写 Harness 循环或 RAGFlow 解析/检索算法 |
| 服务端 Provider Adapter | 把授权后的业务命令映射到 RAGFlow 能力，把 Provider 状态/结果投影为业务 DTO | 向模型返回 Provider 地址、Key、模型/Pipeline 或底层资源标识 |
| RAGFlow | 原有解析、索引、PageIndex、检索和重排执行 | 业务系统的角色体系、知识发布审批和业务文档 ID 定义 |

`./client` 的 `RagFlowBusinessClient` 连接本仓库已有的 **RAGFlow Business Gateway**（专用 service root 下的 `/api/v1/**`，服务端 `api/apps/business_gateway`），不是上图的业务 Knowledge Gateway，也不是原生 REST 客户端。

业务 Adapter 若使用它，应在服务端独立取得对应的 Business access token；若使用原生 RAGFlow API，应自行适配并把 API Key 留在服务端。不能把 Harness 服务令牌和用户断言原样当作 RAGFlow 凭据。两个边界的路径、DTO、错误、版本和分页都不同。

## 3. 身份、权限和 Harness 接线

### 3.1 配置与 Session 绑定

- 按 [README 配置示例](../README.zh.md#harness-组合) 安装 `business-identity`、`service`、`gateway-provider`、`plugin` 四行。Provider 与 Consumer 在 bundle 中默认禁用，配置完成后分别启用。
- `gatewayBaseURL` 填业务 Gateway 的服务根地址，例如 `https://knowledge-gateway.example.com`，不要包含 `/internal/v1/knowledge`；插件会追加这一固定路径。若根地址带部署前缀，该前缀也会保留。非回环地址必须 HTTPS，禁止地址内凭据、query、fragment 和 HTTP 重定向。
- Provider 的 `serviceTokenRef` 是 Harness 凭据服务中的引用，不是令牌正文。Provider 与 Consumer 的 `requestTimeoutMs` 应一致，`artifactMaxBytes` 也按同一预算配置；默认分别为 60000 ms、10485760 bytes。
- 业务宿主在创建/刷新 Session 后，向运行该 Session 的 Harness Context 调用 `ctx.businessIdentity.bindSession({ sessionId, userAssertion, expiresAtEpochSeconds })`。断言到期时间必须在当前时间之后、10 分钟以内，并与签名内容的有效期一致。Session 结束调用返回的释放函数。
- 绑定是进程内的 Session 身份端口，不是本包提供的远程登录接口。业务系统与 Harness 分开部署时，由自己的可信 Session 桥接把断言送到对应运行实例；重启/迁移后重新绑定，不能把用户断言放进静态插件配置。
- 插件只保管断言和绑定到期时间，不验证签名、不计算角色或范围。签发、刷新、撤销、签名/签发方/受众/有效期验证，以及断言与实际 Session 的绑定验证都归业务端。不能仅信任单独传来的 Session 字符串。

### 3.2 每次请求的协议

| 头 | 来源与 Gateway 要求 |
|---|---|
| `Authorization: Bearer <service-token>` | Harness 服务身份；验证可信调用方，不能据此授予用户全部知识权限 |
| `X-User-Assertion` | 当前 Session 绑定的用户断言；验证业务用户、租户/组织归属及有效性 |
| `X-Harness-Session-Id` | Harness 实际 Session；与断言的可信绑定核对 |
| `X-Tool-Call-Id` | Harness 工具执行身份；用于审计关联，不是授权凭证 |
| `X-Request-Id` | 插件请求关联 ID；Gateway 在安全响应及服务端审计中关联它 |
| `Idempotency-Key` | 所有变更请求必需；由工具执行身份生成，详见第 6 节。GET、search、下载链接签发不要求此头 |

当前插件不发送 `X-Nomix-User-Assertion`、`X-Nomix-Session-Id`、`X-Nomix-Tool-Call-Id`、`traceparent`、`approvalId` 或调用方自填的写入 `operationId`。Gateway 应按上表接入，不要求模型补造这些字段。Gateway 自己生成/维护 trace，并通过 `meta.traceId` 返回关联标识。

### 3.3 最终授权

1. 同时验证服务令牌与用户断言；缺失、过期、撤销或错配必须失败关闭。
2. 根据当前业务主体计算租户、部门/门店、安全域及资源 ACL，再检查 endpoint 的 Action。角色和 Action 的关系完全由各业务系统定义，不从 Agent preset 名推断权限。
3. 显式业务资源 ID 必须校验存在性、归属和当前可见性；查询范围只能收窄有效授权范围。业务 ID 是不透明字符串，插件不能从字符串形式识别冒充的 Provider ID，Gateway 必须查自己的映射并拒绝未知/错配资源。
4. 列表、详情、查询操作、检索、引用和下载都执行授权；后台处理完成不意味着自动向原请求者开放结果。检索在调用 Provider 前与返回结果后各校验一次，后置检查包含当前 active version。
5. ACL 变更、审批记录和角色维护使用业务管理接口，不向 Agent 加 ACL 或完整章节树工具。管理界面的路由/表结构由业务项目定义，不属于本包 HTTP 契约。

Harness `ask` 是工具执行前的人工确认，不等于业务授权或发布审核。当前协议不携带 Harness 审批证明；Gateway 不能据工具名称推断“已审批”。业务若要求发布审核，应在自己的可信流程中保存、校验审核状态，再允许版本激活；不向本包请求体追加审批字段。`allow` 也不意味着跳过 Gateway 授权。

## 4. Gateway 必须实现的 20 个接口

下表路径均相对于 **`/internal/v1/knowledge`**；冒号动作是路径的一部分。所有接口返回 JSON，成功状态按契约返回，删除也不能返回空的 204。完整请求字段、必填项和响应 Schema 见 [OpenAPI](knowledge-gateway.openapi.json)。

| 工具 | HTTP | 成功状态 | Harness 审批 | Gateway Action / 业务功能 |
|---|---|---|---|---|
| `knowledge_space_list` | `GET /spaces` | 200 | allow | `SPACE_VIEW`；可见空间分页 |
| `knowledge_space_create` | `POST /spaces` | 201 | ask | `SPACE_CREATE`；创建业务空间及受控 Provider 配置 |
| `knowledge_space_get` | `GET /spaces/{spaceId}` | 200 | allow | `SPACE_VIEW`；空间详情 |
| `knowledge_space_update` | `PATCH /spaces/{spaceId}` | 200 | ask | `SPACE_UPDATE`；更新名称/描述 |
| `knowledge_space_delete` | `POST /spaces/{spaceId}:delete` | 202 | ask | `SPACE_DELETE`；提交空空间删除任务 |
| `knowledge_document_list` | `GET /spaces/{spaceId}/documents` | 200 | allow | `DOCUMENT_VIEW`；可见文档分页 |
| `knowledge_document_upload` | `POST /spaces/{spaceId}/documents` | 202 | allow | `DOCUMENT_UPLOAD`；提交单个文件资源的首次入库 |
| `knowledge_document_get` | `GET /documents/{documentId}` | 200 | allow | `DOCUMENT_VIEW`；正式双版本详情 |
| `knowledge_document_update` | `PATCH /documents/{documentId}` | 200 | allow | `DOCUMENT_UPDATE`；更新名称/业务元数据 |
| `knowledge_document_replace` | `POST /documents/{documentId}:replace` | 202 | ask | `DOCUMENT_UPDATE`；以新文件建立候选版本 |
| `knowledge_document_enable` | `POST /documents/{documentId}:enable` | 200 | ask | `DOCUMENT_UPDATE`；启用文档，不能绕过版本就绪检查 |
| `knowledge_document_disable` | `POST /documents/{documentId}:disable` | 200 | ask | `DOCUMENT_UPDATE`；停用文档并阻止后续检索 |
| `knowledge_document_reindex` | `POST /documents/{documentId}:reindex` | 202 | ask | `DOCUMENT_REINDEX`；基于现有文件重建候选版本 |
| `knowledge_document_delete` | `POST /documents/{documentId}:delete` | 202 | ask | `DOCUMENT_DELETE`；提交删除并阻止新读取 |
| `knowledge_document_download` | `POST /documents/{documentId}:create-download-link` | 200 | ask | `DOCUMENT_DOWNLOAD`；签发当前 active version 的短期下载链接 |
| `knowledge_search` | `POST /search` | 200 | allow | `KNOWLEDGE_SEARCH`；授权范围内的业务检索 |
| `knowledge_source_read` | `GET /citations/{citationId}` | 200 | allow | `DOCUMENT_VIEW`；引用重新授权及正文上下文 |
| `knowledge_operation_get` | `GET /operations/{operationId}` | 200 | allow | `RESOURCE_VIEW`；按目标资源查看权限查询操作状态 |
| `knowledge_operation_cancel` | `POST /operations/{operationId}:cancel` | 200 | ask | `ORIGINAL_OPERATION_PERMISSION`；校验原操作权限并取消 |
| `knowledge_operation_retry` | `POST /operations/{operationId}:retry` | 202 | ask | `ORIGINAL_OPERATION_PERMISSION` + `OPERATION_RETRY`；建立人工重试子操作 |

`RESOURCE_VIEW` 和 `ORIGINAL_OPERATION_PERMISSION` 要按操作关联的真实资源/原命令解析，不能作为授予全部资源的万能权限。工具按 read 8 个、write 累积 16 个、admin 全部 20 个安装。读取可并发，所有变更 exclusive；Harness 的 exclusive 不替代 Gateway 跨 Session、跨实例的并发控制。

关键字段边界：

- 每次变更只处理一个资源。查询中的 ID 数组不代表支持批量写；没有批量 `items`、旧 `ragflow_*` 工具或六个聚合 action 工具。
- 工具输入 `knowledgeSpaceId` 由插件放入 HTTP `{spaceId}`；上传 HTTP body 是 `fileResourceId/documentName/metadata?`，不重复放入空间 ID，也不发送二进制。
- 替换传 `fileResourceId/expectedVersion/reason?`；重建不接收新文件或 metadata。文档更新用 `name`，不是上传用的 `documentName`。
- 文档变更 JSON 中的 `expectedVersion` 是最近详情 `lockVersion` 或摘要 `version`，允许 0；空间锁版本从 1 起。不是 `If-Match`，也不是技术版本号 `versionNo/versionNumber`。冲突后重新读取，不能自动递增再试。
- 空间创建的 profile 固定为 `enterprise-long-document`，由 Gateway 映射为服务端配置；安全域 code 必须验证业务归属。空间更新仅名称、描述、expectedVersion；删除需要 expectedVersion 和 reason，非空或仍有未完成操作时拒绝，不提供 cascade/force。
- 元数据只允许 category/tags/versionLabel/productCode，NFC 后 trim、区分大小写、序列化最多 4096 UTF-8 bytes。PATCH 省略不变、字符串 null 清除、tags=[] 清空；响应四字段齐全，缺失字符串为 null、标签为 []。过滤规则与字段上限见 [README](../README.zh.md#正式文档详情分页与元数据) 和 OpenAPI。

## 5. HTTP 返回不能只包一层 data

顶层只能有 `data`、`meta`。meta 必含 `success/requestId/traceId/timestamp/apiVersion/pagination/error`，`apiVersion` 为 `v1`，timestamp 使用 UTC `Z`。成功 data 非 null、error=null；失败 data=null、pagination=null，error 必含 code/message/retryable/fieldErrors（没有字段错误也返回 []）。

### 异步提交：202 不等于处理完成

以下为 `DocumentOperationAcceptedResponse`，不是文档详情：

<!-- schema: DocumentOperationAcceptedResponse -->
```json
{
  "data": { "documentId": "document-1", "operationId": "operation-1", "status": "PENDING" },
  "meta": {
    "success": true, "requestId": "request-1", "traceId": "trace-1",
    "timestamp": "2026-09-05T00:00:00Z", "apiVersion": "v1", "pagination": null, "error": null
  }
}
```

### 列表：授权过滤后再计数、分页

空间/文档列表只接受 page（默认 1）、pageSize（默认 20，1–100），不使用 cursor/limit。HTTP data 为 `{items}`，分页只在 meta.pagination；插件再投影为工具 `{items,pagination}`，Gateway 不能预先返回这个工具投影。

<!-- schema: KnowledgeDocumentListResponse -->
```json
{
  "data": { "items": [] },
  "meta": {
    "success": true, "requestId": "request-2", "traceId": "trace-2",
    "timestamp": "2026-09-05T00:00:00Z", "apiVersion": "v1",
    "pagination": { "page": 1, "pageSize": 20, "totalItems": 0, "totalPages": 0, "hasNext": false },
    "error": null
  }
}
```

响应 page/pageSize 回显请求；totalItems 只统计可见且满足条件的资源。totalPages=ceil(totalItems/pageSize)，hasNext=(page<totalPages)；空集合总页数为 0，越界页 items=[]，条数不能超过本页剩余数量。非列表接口 pagination=null。

### 错误：业务说明，不透传 Provider 异常

例如乐观锁冲突返回 HTTP 409：

<!-- schema: ErrorEnvelope -->
```json
{
  "data": null,
  "meta": {
    "success": false, "requestId": "request-3", "traceId": "trace-3",
    "timestamp": "2026-09-05T00:00:00Z", "apiVersion": "v1", "pagination": null,
    "error": { "code": "KNOWLEDGE_CONFLICT", "message": "文档已更新，请重新读取后提交。", "retryable": false, "fieldErrors": [] }
  }
}
```

通用错误为 `KNOWLEDGE_UNAUTHENTICATED/FORBIDDEN/NOT_FOUND/CONFLICT/OPERATION_PENDING/PROVIDER_UNAVAILABLE/INVALID_INPUT`（每项均带 `KNOWLEDGE_` 前缀）。保留元数据专用错误；非空空间、未完成操作、不可取消/重试等业务原因使用契约约定的安全码。身份错误通常 401、Action 拒绝 403、不可见资源 404、冲突 409、输入非法 400/422、Provider 临时故障 503。HTTP 状态与 meta.success 必须一致。

插件不会把远端 message、fieldErrors、堆栈或内部 URL 原样传给模型。非法 JSON、裸 DTO、旧封装、额外 Provider 字段、资源 ID 错配会触发不可自动重试的 `KNOWLEDGE_GATEWAY_PROTOCOL_ERROR`。业务端同样应脱敏自己的日志和响应，而不是依赖插件替它清理任意正文中的秘密。

## 6. 写入、版本发布与 Worker

### 6.1 业务端需要持久化什么

不规定数据库表名，但需要能可靠维护：业务空间和安全域、文档及锁版本、active/candidate 两个版本指针、文件资源及所有权、每个版本的 Provider 映射/产物、operation 与父子重试关系、幂等记录、引用定位/授权关联、审计事件。租户与资源归属必须由可信业务上下文确定。

空间、文档、技术版本和操作是四套状态；使用 [OpenAPI 的 lifecycle 枚举](knowledge-gateway.openapi.json)，不能把 Worker 的内部状态直接当成 Document.status 返回。

### 6.2 上传 → 解析/编译 → 发布

1. 用户通过业务文件管理接口上传文件，得到 `fileResourceId`。Gateway 校验文件归属、可访问性、大小、类型及业务安全检查；文件资源 ID 不等于任意对象存储 key 或 URL。
2. 收到上传工具请求后，完成身份/权限与幂等校验，再持久化业务 document、candidate version、operation 及可靠投递记录；返回 202 受理 DTO。持久化和投递可用事务 Outbox 实现，不能仅启动一个随 HTTP 请求退出而丢失的内存任务。
3. Worker 按空间的受控配置，通过 Provider Adapter 上传/解析，并在需要时执行 RAGFlow 的 PageIndex/知识编译。沿用 Provider 的任务和产物语义，不建立第二套解析算法，不让模型填写模型 ID、Pipeline、TOC/KG 或向量参数。
4. 以可靠 Provider 状态和所需产物验证是否 READY；请求已入队、解析百分比到顶都不能单独代替完整就绪检查。若业务要求发布审核，在业务侧通过后才激活。
5. 在业务事务中校验候选仍属于当前 operation、版本与权限/发布条件仍有效，原子切换 active 指针并清空 candidate；旧 active 进入 RETIRED。首次上传前 active=null，失败不伪造可检索版本。
6. `knowledge_operation_get` 查询操作，`knowledge_document_get` 返回正式双版本详情；插件不会长时间阻塞等待全部解析完成。

### 6.3 替换、重建、停用与删除

- replace 使用新文件，reindex 使用现有文件，均建立独立候选产物；构建期间保留旧 active，不原地覆盖旧版本所需的 Provider 数据。
- 每个文档只允许一个候选处理流程；Gateway 用数据库约束/锁与 expectedVersion 防止不同 Session/副本并发覆盖。冲突返回业务冲突或操作进行中，不能靠 Harness exclusive 代替。
- 替换/重建失败或取消保留旧 active；失败/取消候选继续出现在详情里。成功后候选槽位为 null。人工重试复用同一候选 version，关联新的子 operation。
- 停用、删除与异步激活竞争时，Worker 不能把已停用/删除的文档重新激活；新读取、检索、引用和下载必须看到最新状态。删除的物理清理失败不能恢复业务可见性。
- 只有 `Document.status=ACTIVE` 且 `activeVersion.status=READY` 才具备可检索状态；实际返回还要通过空间、安全域和用户 ACL。`searchable` 不是免授权标记。
- 详情返回 `spaceId/lockVersion/activeVersion/candidateVersion`，列表与同步变更使用各自的摘要 DTO（例如 `knowledgeSpaceId/version`），不要混成一种 DTO。未知进度为 null、progressSource=UNAVAILABLE；READY/RETIRED 为 100，不能按时间编造进度。

### 6.4 幂等、重试与取消

- 插件使用 `sessionId + rootCallId + toolCallId + toolName` 派生稳定 `Idempotency-Key`。同一次 Harness 执行重放保持同键；模型重新发起一个新工具调用是新执行，不保证同键。
- Gateway 对可信主体/业务隔离域、接口、幂等键建立唯一约束，并保存规范化请求摘要、操作 ID 与受理结果；同键同请求返回同一业务结果，同键不同请求返回冲突。重放仍要校验当前授权，令牌刷新不应制造第二次副作用。
- 数据库提交、任务投递和 Provider 副作用之间要可恢复。子步骤也需稳定的执行身份或权威状态核对；HTTP 超时/断线不能被当成“肯定未执行”，不得换键盲目重做。
- 插件不自动重试任何变更 HTTP，也不自动重试下载链接签发。仅安全 GET/search 最多尝试两次、共享一次超时预算，并尊重 `retryable:false`；正文中断属于传输故障，完整非法 JSON/Schema 属于协议错误。
- Worker 自动处理在同一 operation 内遵守 `automaticRetry.maximumAttempts=5`。显式人工重试需原操作权限和 `OPERATION_RETRY`，在原操作可重试时创建带 `parentOperationId` 的子 operation；同一根操作最多 3 次人工重试，不能通过对子操作重试清零次数。
- 取消 HTTP 等待只终止本次调用/读取，不证明后台任务已撤销。已受理任务必须通过 `:cancel` 处理，协调 Provider 取消及迟到结果；只有确认取消后才能投影 CANCELLED，已完成或不可取消状态返回冲突。

## 7. 检索、PageIndex、引用与下载

### 7.1 检索编排

1. 校验 `query` 和业务筛选条件：knowledgeSpaceIds 提供时 1–20 项；documentIds 最多 20 项，[] 或省略表示没有限定单个文档；limit 为 1–8，默认 8。未指定范围时也只使用服务端当前有效授权范围，不能扩大为所有 Provider 资源。
2. 在授权、元数据条件及 ACTIVE/READY 版本集合内取得 Provider 映射。metadataFilter 不同字段 AND、数组内 OR，tagsAll 必须全部匹配；显式空过滤数组非法。
3. Gateway 根据已配置能力、问题和文档决定检索路径：普通语义/关键词问题可走 RAGFlow 常规混合检索；章节定位、跨章节长文档问题可使用已就绪 PageIndex；需要时执行多路检索。Agent 不直接选择底层模式。
4. 多路结果按排序位置进行 RRF 融合、去重及必要的段落合并，再输出排序和业务 score（0–1）。不能直接比较不同通道未校准的原始 score/similarity。去重应绑定同一业务文档的 active version 和来源位置，防止不同版本或重叠命中占满限额。
5. Provider 返回后，再查当前授权、文档状态和 active version，移除越权/失效结果后应用输出限额并建立业务 citation。资源/版本在检索中途变化也不能漏过后置校验。
6. 最多 8 条、单文档最多 4 条、单条 content 最多 2500 Unicode code points、总 content 最多 16000。chapterPath 有界；page 是检索命中的页码，不是 citation 的 pageStart/pageEnd。

若无授权的相关证据，成功 data 为 `{ "hits": [], "reason": "NO_AUTHORIZED_RELEVANT_EVIDENCE" }`。Provider 故障不能伪装为空证据。PageIndex 尚未就绪或某一路失败时，是否允许使用仍有效的常规检索由 Gateway 的受控策略决定；不能隐式扩大授权范围、使用候选版本或谎称已完成 PageIndex 检索。

插件不提供 PageIndex 完整树工具。章节树管理、编译配置和效果评估在业务管理端/Provider Adapter 完成，仍使用 RAGFlow 已有能力。

### 7.2 引用正文

Gateway 创建不透明 citationId，保存或安全绑定业务文档、命中版本、来源位置及授权关联。读 citation 必须重新校验当前调用者、有效性、文档状态和版本；不能仅凭“上次检索看得到”就返回全文，也不能把旧引用静默指向新版本正文。

contextBefore/contextAfter 按规范化文档的 Unicode code point 计数，默认各 1000、范围 0–5000。beforeContent/ matchedContent/afterContent 分别最多 5000/2500/5000，总计最多 12500；回显请求量，准确填写实际量、页范围、截断标记及 EXACT_OFFSET 或 CHUNK_APPROXIMATE。只能得到近似定位时不能宣称精确。

### 7.3 下载与大结果

下载请求体固定 `{}`，只接受业务 documentId；Gateway 校验 DOCUMENT_DOWNLOAD 后签发当前 active version 链接，返回规定的文件信息、versionId、downloadUrl、expiresAt、expiresInSeconds=60。Agent 不能选择历史版本、TTL、存储 key 或直接提交 URL。

链接由业务文件下载入口负责兑付、安全校验和到期控制，不暴露 RAGFlow 内网地址/API Key。二进制上传下载始终由业务服务端/管理界面处理，不经过 Agent 工具，也没有 Base64 spill。

Gateway 返回有界完整 JSON，不自行返回 Harness artifact。插件超过 12000 UTF-8 bytes 的内联结果通过 `SpillStore.saveText` 保存；业务检索/引用上限在 spill 前仍须满足。Harness 宿主负责配置可用的 spill 存储及 Session 隔离的读取能力。关闭式 Schema 不是正文脱敏器，业务端必须保证正文和链接适合交给当前用户及模型。

## 8. 审计、接入顺序与上线验收

服务端审计关联服务身份、业务主体、Session、tool call、request、trace、目标业务资源、Action、授权结果、operation/父操作、幂等摘要和状态变化。Provider 标识留在受控服务端诊断中，不进入 Agent 响应；服务令牌、用户断言、API Key、签名下载 URL 不写入普通日志。限流、任务容量、告警与失败恢复由部署方落实，不靠增加模型参数解决。

### 实施顺序

1. 发布方按现有流程推送源码与 `nomix-v0.3.0` 标签；标签 CI 只验证/构建。通过后推送同一提交到 `npm-nomix-ragflow`，由工作流检查标签一致性、打包审计、发布已验证制品。本文不改变发布工作流，也不表示该版本已发布。
2. 业务系统锁定已发布包，直接读取包内 OpenAPI；实现身份/异常包装、20 个路由及 DTO 投影。不能只重命名路径和请求头而保留原有响应格式。
3. 完成权限、文件资源、持久化 operation/幂等、双版本事务、Worker 与 Provider Adapter；检索融合、引用和下载一并适配。
4. 先在测试环境配置 Gateway Provider 和 Agent toolset，绑定真实测试 Session，完成下面的端到端验收，再切生产流量。仅更新 npm 依赖不会自动升级业务 Gateway。

### 业务项目必须独立验收

| 场景 | 必须证明 |
|---|---|
| 契约一致 | 20 个路由、method、请求、状态码、data/meta、分页和 Schema 示例一致；额外字段/裸 DTO 被拒绝 |
| 身份 | 双凭据缺失、过期、撤销、错误 Session 均拒绝；刷新绑定生效，多 Session/多实例不串身份 |
| 权限 | 不同用户/租户交叉读写、操作状态、文件资源、citation、download 均不可越权；preset 不增加业务权限 |
| 首次上传 | fileResourceId → 202 → Worker → READY/激活 → 查询操作 → 检索 → 引用正文完整通过 |
| 替换/重建 | 构建期间旧 active 可读；成功原子切换；失败/取消保留旧 active 和可观察候选，不读候选产物 |
| 并发与幂等 | 跨 Session/实例同键同请求不重复执行，同键异请求冲突；lockVersion=0 可回传，过期锁失败；崩溃后投递/副作用可恢复 |
| 审批/重试/取消 | ask 拒绝不执行；业务授权独立检查；后台重试上限、人工根操作 3 次上限、取消与完成竞争符合状态 |
| 检索效果 | 常规检索、PageIndex、多路 RRF/去重、单文档/总输出上限及空证据正确；Provider 故障不伪装空结果 |
| 权限/版本变化 | 检索期间撤权或切版有后置过滤；旧 citation 再读失败关闭；停用/删除后新访问和迟到 Worker 激活被阻止 |
| 分页与元数据 | ACL 后计数，空/越界页正确；NFC/trim、PATCH 清除、过滤 AND/OR/tagsAll 和非法空数组一致 |
| 下载与 spill | 当前版本链接 60 秒到期；工具不传二进制；大 JSON 的实际保存和按 Session 读取可用且不泄露 Provider 信息 |

发布包的 `npm run verify` 检查插件契约、类型、行为与打包；Mock Gateway 和真实 Harness 测试不等于上述真实业务端验收。验证边界见 [ALIGNMENT.md](ALIGNMENT.md)。
