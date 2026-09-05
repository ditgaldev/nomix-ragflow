# @nomix-ai/nomix-ragflow

1.1.2 提供 Harness 知识插件，恢复直连 RAGFlow 原生 API 的服务端 SDK，不恢复额外的 RAGFlow Gateway 服务层。

- `@nomix-ai/nomix-ragflow/plugin` 为 Nomix Harness Agent 安装企业知识工具，只消费 `KnowledgeService`。
- `@nomix-ai/nomix-ragflow/gateway-provider` 单独配置 Gateway 地址和服务凭据，仅访问 `/internal/v1/knowledge/**`。替换此配置行即可替换 Provider，不改工具。
- `@nomix-ai/nomix-ragflow/business-identity` 提供 `dsh-business-identity` Session 身份绑定端口。

插件不直连 RAGFlow，也不修改 RAGFlow 的解析、PageIndex、索引、检索或重排逻辑。ACL、审批校验、业务范围过滤、引用再授权、异步操作、审计、Provider 选择以及业务 ID 到 RAGFlow ID 的映射全部属于业务系统 Knowledge Gateway。

这是通用知识插件，不是某个客户的专用集成。任何业务系统均可实现同一份 Knowledge Gateway 契约，配置自己的地址、服务凭证引用、Session 断言及 Agent preset。插件不内置客户名单、业务角色映射或客户专属权限规则。一个已配置的 Provider 对应一个 Gateway；不同部署或隔离的 Harness Context 使用各自配置，模型不能选择或修改 Gateway 地址。

业务系统升级接入请从随 npm 包发布的 [Gateway 实现与接入指南](contracts/GATEWAY-INTEGRATION.md) 开始：包含职责边界、20 个 HTTP 接口、身份/权限、版本与 Worker、检索融合、引用下载和端到端验收。安装本包不会自动提供业务 Gateway 服务或升级业务数据库。

```text
业务系统 Session 创建 ──绑定 ≤10 分钟用户断言──> dsh-business-identity
                                                 │
Nomix Harness Agent ──20 个 knowledge_* 工具─────┼──> Knowledge Gateway ──> 服务端 Adapter + SDK ──> RAGFlow
                      Harness 审批/并发/spill     │    ACL/映射/审计/编排
                                                 └──每次调用动态解析
```

业务系统的 Provider Adapter 使用 `@nomix-ai/nomix-ragflow/client` 的 `RagFlowBusinessClient` 直接调用 RAGFlow 原生 API，转换权限范围、资源 ID 和结果；它是业务服务端代码，不是第二个 Gateway 服务。`./types` 提供原生类型，`./errors` 提供 `RagFlowApiError`，根入口也导出 SDK。SDK 只负责原生 HTTP 调用，不计算业务权限，不注册 Agent 工具。配置、调用示例和旧接口迁移见 [服务端 SDK 指南](contracts/SERVER-SDK.md)。

## Harness 组合

以下配置、工具策略及关闭式业务 Schema 描述 Agent/Gateway 路径，不适用于服务端 SDK：

| 边界 | Agent → 业务 Gateway | 服务端 SDK → RAGFlow |
|---|---|---|
| 地址与路由 | `gatewayBaseURL` + `/internal/v1/knowledge/**` | `baseURL` + `/api/v1/**` |
| 凭据 | Harness 解析 `serviceTokenRef` + Session 绑定的用户断言 | `accessToken`：原生 API Key 或每请求解析函数 |
| HTTP 返回与错误 | 关闭式 `data/meta`；`KNOWLEDGE_*` 错误 | 原生 envelope 和 `RagFlowApiError`；不对全部原生 DTO 做运行时校验 |
| 资源与文件 | 业务 ID；fileResourceId 上传、签发下载链接 | 原生 ID；Blob multipart 上传、Response 流式下载 |
| 重试与幂等 | 安全读取最多两次；变更携带 Harness 派生幂等键 | 不自动重试，不承诺原生幂等 |
| 预算 | `requestTimeoutMs`；`artifactMaxBytes` 默认 10 MiB | `timeoutMs`；`maxResponseBytes` 默认 16 MiB，仅约束 JSON |

SDK 的原生方法及限制见 [服务端指南](contracts/SERVER-SDK.md)。两条路径都不替业务系统实现 Gateway 数据库和 Worker。

Bundle 包中的 `packages/dsh-bundle-ragflow-knowledge/cordis.patch.yml` 依次挂载身份端口、Provider 中立运行时、Gateway Provider 和工具 Consumer；后两项默认禁用，部署时分别配置后启用。

## 源码包与发布边界

插件工程由八个实际 npm workspace 组成：

| 包 | 代码职责 |
|---|---|
| `dsh-knowledge` | Service、业务 DTO/错误、生成契约、共享工具校验和结果表示 |
| `dsh-business-identity` | Session 断言绑定、刷新与释放 |
| `dsh-knowledge-gateway` | Gateway Provider、HTTP 传输和关联信息 |
| `dsh-tool-knowledge-read` | 8 个只读工具的业务动作 |
| `dsh-tool-knowledge-write` | 8 个文档维护工具的业务动作 |
| `dsh-tool-knowledge-admin` | 4 个空间管理/删除工具的业务动作 |
| `dsh-knowledge-policy` | 审批决策及证据提示词 |
| `dsh-bundle-ragflow-knowledge` | Agent 工具组合、生命周期及 Cordis patch |

这些是私有源码 workspace，由根工程统一编译并发布为 `@nomix-ai/nomix-ragflow`；不是八个需要分别安装的 npm 发布包。保留原有 npm 锁文件和发布流程，不引入另一套包管理/锁文件。每个 workspace 有自己的入口、依赖和类型检查；依赖边界测试检查所有 TypeScript 导入，拒绝反向依赖、未声明依赖和循环依赖。工具包只依赖知识服务包，不导入 Gateway 或 RAGFlow 客户端。`src/` 包含独立的原生服务端 SDK 和聚合导出，Agent workspace 不得导入该 SDK。

以下仍是对外安装配置，用户不需要手动安装各源码 workspace：

```yaml
- id: business-identity
  name: '@nomix-ai/nomix-ragflow/business-identity'

- id: knowledge-service
  name: '@nomix-ai/nomix-ragflow/service'

- id: knowledge-gateway
  name: '@nomix-ai/nomix-ragflow/gateway-provider'
  disabled: false
  config:
    gatewayBaseURL: https://knowledge-gateway.example.com
    serviceTokenRef: KNOWLEDGE_HARNESS_SERVICE_TOKEN
    requestTimeoutMs: 60000
    artifactMaxBytes: 10485760

- id: knowledge
  name: '@nomix-ai/nomix-ragflow/plugin'
  disabled: false
  config:
    agentToolsets:
      - agentPreset: knowledge-reader
        toolset: read
      - agentPreset: knowledge-maintainer
        toolset: write
      - agentPreset: knowledge-admin
        toolset: admin
    requestTimeoutMs: 60000
    artifactMaxBytes: 10485760
```

以上域名、凭证引用及 Agent preset 名称只是示例，不是内置默认值或业务角色；部署时替换为自身配置的 preset。`agentToolsets` 必须非空，preset 名称必须非空、无首尾空白且不重复；仅匹配 Session header 的 `agentPreset` 才安装工具。知识运行时要求恰好一个 available Provider，否则调用失败，不提供自动路由或故障切换。

`gatewayBaseURL` 是业务 Gateway 的服务根地址，不包含 `/internal/v1/knowledge`；插件追加固定路径。不要填写 RAGFlow 服务地址。Provider 与 Consumer 的超时和 artifact 预算应一致。

Gateway Provider 要求 HTTPS，只有 localhost/127.0.0.1/[::1] 可用 HTTP；允许反向代理路径前缀，不允许 URL 用户名、密码、query 和 fragment。这些是服务端配置校验，不是模型可选参数。

运行环境要求 Node.js `^22.19.0 || >=24.0.0`，依赖固定的 Harness `0.2.9`。Provider 和 Consumer 的 `requestTimeoutMs` 均为整数 1–300000，默认 60000；Consumer 注册的工具超时在此基础上增加 30000 ms 清理余量。`artifactMaxBytes` 均为整数 1–67108864，默认 10485760。Provider 限制完整 HTTP 响应字节数（错误正文还受 65536 bytes 上限约束），Consumer 在 spill 时限制序列化结果字节数；二者不是文件上传大小限制。

业务系统在创建或刷新 Harness Session 时调用 `BusinessIdentityRuntime.bindSession({ sessionId, userAssertion, expiresAtEpochSeconds })`。断言必须在 10 分钟内过期；插件每次工具调用按 Session 动态解析，用户断言不是静态插件凭证，也不缓存角色、门店、部门或文档范围。

绑定到期自动移除，插件卸载时清理全部绑定及定时器；业务系统终止 Session 时应调用绑定返回的释放函数。刷新后的新断言不会被旧释放函数删除。Gateway 请求禁止 HTTP 重定向，避免跨地址传递服务令牌和用户断言。

`bindSession` 校验传入的绑定到期时间并在内存保存不透明断言，不验证签名，也不解析断言内部的过期时间。业务端须传入与签名断言一致的到期时间，在拥有该 Session 的运行时绑定/刷新；Gateway 在请求时验证签名。绑定不持久化，也不自动跨实例同步。

选中的 Agent 同时安装证据提示词：没有可靠知识证据时，不得根据常识伪造企业内部规则。若部署使用 Harness 的 `complete: true` 完整提示词覆盖，它会替换所有附加 section；该完整提示词必须包含 `./plugin` 导出的 `KNOWLEDGE_EVIDENCE_INSTRUCTIONS` 原文。插件在 `llm/stream` 检查选中 Session 实际发往模型的主循环请求，缺少规则时阻止发送，不重新组装或补写提示词；不影响其他 Session 和辅助模型请求。这是配置门禁，不是模型永不产生错误的保证。Provider 与 Consumer 的 requestTimeoutMs 配置值应一致；实际工具超时比该值多 30000 ms 清理余量。

Gateway 请求只携带以下业务身份与关联头：

- `Authorization: Bearer <Harness 服务令牌>`
- `X-User-Assertion`
- `X-Harness-Session-Id`
- `X-Tool-Call-Id`
- `X-Request-Id`
- 变更操作额外携带由 Harness 工具执行身份稳定生成的 `Idempotency-Key`

模型不提供幂等键。幂等键由 `sessionId + rootCallId + toolCallId + toolName` 派生，重放同一次工具执行时保持不变；Gateway 返回的 `operationId` 是不要求 UUID 的不透明业务标识。

## 工具、权限与执行策略

`read` 包含 8 个读取工具；`write` 在 `read` 上增加 8 个维护工具；`admin` 包含全部 20 个工具。Gateway 始终执行最终授权，下面的 Action 是 Gateway 契约要求，不是插件内 ACL 计算。

| 工具 | Gateway Action | Harness 审批 | 并发 |
|---|---|---|---|
| `knowledge_space_list`、`knowledge_space_get` | `SPACE_VIEW` | allow | parallel |
| `knowledge_document_list`、`knowledge_document_get`、`knowledge_source_read` | `DOCUMENT_VIEW` | allow | parallel |
| `knowledge_search` | `KNOWLEDGE_SEARCH` | allow | parallel |
| `knowledge_operation_get` | 资源对应的查看权限 | allow | parallel |
| `knowledge_document_download` | `DOCUMENT_DOWNLOAD` | ask | parallel |
| `knowledge_document_upload` | `DOCUMENT_UPLOAD` | allow | exclusive |
| `knowledge_document_update` | `DOCUMENT_UPDATE` | allow | exclusive |
| `knowledge_document_replace`、`knowledge_document_enable`、`knowledge_document_disable` | `DOCUMENT_UPDATE` | ask | exclusive |
| `knowledge_document_reindex` | `DOCUMENT_REINDEX` | ask | exclusive |
| `knowledge_operation_cancel` | 原操作权限 | ask | exclusive |
| `knowledge_operation_retry` | 原操作权限 + `OPERATION_RETRY` | ask | exclusive |
| `knowledge_space_create` | `SPACE_CREATE` | ask | exclusive |
| `knowledge_space_update` | `SPACE_UPDATE` | ask | exclusive |
| `knowledge_space_delete` | `SPACE_DELETE` | ask | exclusive |
| `knowledge_document_delete` | `DOCUMENT_DELETE` | ask | exclusive |

维护和管理操作都是单资源请求，不再提供批量 action、`items` 数组或旧工具别名。上传只传 `knowledgeSpaceId`、`fileResourceId`、`documentName` 和可选安全业务元数据；插件不读取本地路径、不依赖文件系统、不收发二进制，也不产生 Base64。

表中的 `allow` 表示插件不额外要求人工确认，仍保留 Harness 其他策略的 ask/deny；`ask` 不会覆盖已有拒绝。read 工具组中的下载是签发链接，并非传输文件。

Harness 工具参数统一使用 `{ "input": { ...业务字段 } }`，例如 `knowledge_document_get` 的参数为 `{ "input": { "documentId": "document-1" } }`。此包装不进入 Gateway HTTP body；插件将业务字段映射为各路由的 path/query/body。

Agent Schema 关闭额外字段，拒绝租户/用户冒用参数、ACL 主体、RAGFlow Dataset/Document/Chunk ID 字段、技术版本选择、模型/Pipeline/rerank、阈值/向量权重、TOC/KG、Provider 地址、本地路径、存储键、TTL 和二进制正文。业务 ID 本身是不透明字符串，插件无法单凭字符串识别其 Provider 归属，必须由 Gateway 校验业务映射和授权。允许的文档元数据只有 `category`、`tags`、`versionLabel`、`productCode`。

## 四项明确业务契约

下载只接受 `documentId`，调用 `POST /internal/v1/knowledge/documents/{documentId}:create-download-link`，请求体固定为 `{}`。只下载当前 active version；返回 `documentId`、`versionId`、`fileName`、`mimeType`、`fileSize`、`downloadUrl`、`expiresAt` 和固定为 60 的 `expiresInSeconds`。Agent 不能选版本或 TTL。

空间创建只接受 `code`、`name`、可选 `description`、固定的 `profileCode: enterprise-long-document` 和 `defaultSecurityDomainCode`。空间更新工具必须传 `knowledgeSpaceId`、`expectedVersion`，并至少提供 `name` 或 `description`；空间删除工具必须传 `knowledgeSpaceId`、`expectedVersion`、`reason`。插件把 `knowledgeSpaceId` 放入 HTTP 路径，其他字段放入请求体，没有 cascade、force 或 deleteAll。非空空间或有未完成操作的空间由 Gateway 拒绝。

异步业务操作的自动处理重试由 Gateway Worker 在同一 operation 内执行，最多 5 次；插件不会自动重试任何变更 HTTP 请求。`knowledge_operation_retry` 是维护/管理员显式人工重试，输入 `operationId` 和 `reason`，必须审批；Gateway 校验原操作权限与 `OPERATION_RETRY`，创建带 `parentOperationId` 的子 operation，同一根操作最多人工重试 3 次。超过限制的 Gateway 错误会规范化为 `KNOWLEDGE_CONFLICT`。

人工重试的提交响应只要求 `operationId`、`parentOperationId`、`status`，不是完整 operation 详情。详情可包含 `retryable`、`retryCount`、`lastRetryAt`、`nextRetryAt`。HTTP 层仅对明确可安全重放的 GET 和 search 最多尝试两次，共用一次超时预算，尊重 Gateway 的 `retryable: false`；下载链接签发虽然归类为读取工具，也不会自动重试。

成功或错误响应在正文接收期间断线、超时，均属于传输故障：安全读取只能在剩余预算内重试，预算耗尽后返回 `KNOWLEDGE_PROVIDER_UNAVAILABLE`；调用方取消保持取消语义。完整收到但 JSON 非法或不符合契约才属于协议错误，不重试。变更及下载链接签发在正文中断后也不自动重试。

引用上下文的 `contextBefore`、`contextAfter` 按规范化文档的 Unicode code point 计数，默认各 1000、最大各 5000。返回的 `beforeContent` 最大 5000、`matchedContent` 最大 2500、`afterContent` 最大 5000，总计最大 12500，并包含请求/实际计数、`versionId`、页范围、截断标记与 `EXACT_OFFSET | CHUNK_APPROXIMATE` 定位精度。

## 检索、生命周期与 PageIndex

`knowledge_search` 只接受 `query`、`knowledgeSpaceIds`、`documentIds`、`limit`、`metadataFilter`，其中 `limit` 最大为 8。Gateway 负责 ACL 前后置过滤、混合检索、RRF、去重、合并与排序；单文档最多 4 条，每条正文最多 2500 code points，总正文最多 16000 code points。无证据时必须返回 `NO_AUTHORIZED_RELEVANT_EVIDENCE`。

`documentIds: []` 表示未选定单个文档；命中的页码字段是 `page`，不是引用正文接口的 `pageStart/pageEnd`。空检索业务结果为 `{ "hits": [], "reason": "NO_AUTHORIZED_RELEVANT_EVIDENCE" }`。引用正文的 `chapterPath` 可省略。首次创建尚无可用版本的文档可以返回 `activeVersion: null`。

生命周期彼此独立：

- Space：`CREATING`、`ACTIVE`、`CREATE_FAILED`、`DISABLED`、`DELETING`、`DELETED`、`DELETE_FAILED`
- Document：`CREATING`、`ACTIVE`、`CREATE_FAILED`、`DISABLED`、`DELETING`、`DELETED`
- Version：`CREATED`、`UPLOADING`、`UPLOADED`、`INGESTING`、`READY`、`FAILED`、`CANCELLED`、`RETIRED`、`DELETED`
- Operation：`PENDING`、`RUNNING`、`SUCCEEDED`、`FAILED`、`CANCELLED`

只有 `ACTIVE` 文档的 active version 为 `READY` 时才可检索。PageIndex 章节树、Knowledge Compilation、解析参数和底层检索调优仍由 RAGFlow 与 Gateway 管理，不暴露为 Agent 输入或完整树工具；Agent 只获得有界 `chapterPath` 证据及重新授权后的 citation 正文。

## 正式文档详情、分页与元数据

`knowledge_document_get` 返回 `KnowledgeDocumentDetail`：`spaceId`、`lockVersion`、`searchable`、创建/更新时间，以及可空的 `activeVersion` 和 `candidateVersion`。候选版本包含 `versionNo/changeType/status`、操作 ID/状态、进度来源和时间、错误与可重试标记。未知进度为 `null` 并明确显示“Provider 未提供可靠百分比”，不当作 0%；READY/RETIRED 为 100%。失败或取消候选版本继续展示，成功激活后候选槽位为空。即使详情 spill，摘要仍显示两个版本槽位。

本次正式详情 DTO 只对应 get；列表和同步变更保留各自已定义的摘要 DTO，不把详情字段擅自加入其他接口。业务数据库的两个指针、原子切换、单候选约束和重试复用版本由 Gateway 实现；插件只校验返回投影，不推算候选版本或执行切换。

所有 Agent/Gateway HTTP JSON 响应顶层仅有 `data/meta`。meta 必含 `success/requestId/traceId/timestamp/apiVersion/pagination/error`，版本固定 v1，时间为 UTC。成功时 data 非空、error=null；失败时 data=null、error 含 code/message/retryable/fieldErrors，分页为空。缺字段、裸 DTO 或不一致响应返回 `KNOWLEDGE_GATEWAY_PROTOCOL_ERROR`，不自动兼容。

文档变更把最近读取的 `lockVersion`（或摘要 `version`）原样传入 `expectedVersion`，允许 0；这是文档乐观锁计数，不是技术版本的 `versionNo/versionNumber`。空间变更版本仍从 1 起。冲突后需重新读取；插件不递增计数，也不自动重放变更。

空间/文档列表接受 `page`（从 1 开始）和 `pageSize`（默认 20，范围 1–100），不接受 cursor/limit。HTTP data 为 `{items}`，meta.pagination 为 `page/pageSize/totalItems/totalPages/hasNext`；知识服务投影为 `{items,pagination}`，位于工具内联观察的 `data.result` 或完整 spill JSON 中，不是工具最外层结构。响应必须回显请求的 page/pageSize；totalPages=ceil(totalItems/pageSize)，hasNext=(page<totalPages)。空集合总页数为 0，越界页 items 为空，条数不得超过 pageSize 或剩余总条数；不一致返回协议错误。其他 HTTP 接口 pagination=null。

元数据输入按 NFC、trim 标准化并保留大小写；category/versionLabel/productCode 为 1–64 字符，tags 最多 20 个、每项 1–32 字符，禁止控制字符及标准化后重复标签，序列化上限 4096 UTF-8 字节。更新省略字段表示不变，字符串 null 表示清除，tags=[] 表示清空（null 非法）；上传字符串不接受 null。响应四字段必须始终存在，未设置的字符串用 null，空标签用 []；非 null 字符串必须已经 NFC/trim 标准化且非空，否则插件拒绝响应，不自动清洗或补字段。replace/reindex 不接收 metadata。

metadataFilter 仅允许 category/tagsAny/tagsAll/versionLabel/productCode 数组，每个字段提供 1–20 个无重复标准化值。省略字段表示不约束，显式空数组非法（与 PATCH tags=[] 清空语义不同）。不同字段 AND、数组内 OR、tagsAll 全部匹配；业务匹配和 RAGFlow 投影由 Gateway 执行。未知字段、非法值、超限分别使用 `KNOWLEDGE_METADATA_FIELD_NOT_ALLOWED`、`KNOWLEDGE_METADATA_FILTER_FIELD_NOT_ALLOWED`、`KNOWLEDGE_METADATA_VALUE_INVALID`、`KNOWLEDGE_METADATA_TOO_LARGE`；本地校验不静默删除输入。工具边界先执行业务字段校验，再进入 Harness 关闭式输入 Schema，保留上述专用错误码。

## 输出、错误与契约

Gateway 响应先经过关闭式 OpenAPI 运行时校验，再进入 Agent。大型结构化结果通过 Nomix Harness 0.2.9 `SpillStore.saveText` 保存为 UTF-8 JSON；HTTP 响应读取和 spill 均受 `artifactMaxBytes` 限制。检索和引用的业务上限在 spill 前校验。

序列化业务结果不超过 12000 UTF-8 bytes 时内联，超过时保存完整 JSON。工具观察包含 `status/summary/data/nextActions/artifacts`，不是 HTTP 的 `data/meta`：内联正文在 `data.result`；spill 时 `data.kind=artifact-reference`，完整正文需按 artifact 的 `retrievalHint` 读取，不能把摘要当作完整证据。

插件通用业务异常使用以下错误码：`KNOWLEDGE_UNAUTHENTICATED`、`KNOWLEDGE_FORBIDDEN`、`KNOWLEDGE_NOT_FOUND`、`KNOWLEDGE_CONFLICT`、`KNOWLEDGE_OPERATION_PENDING`、`KNOWLEDGE_PROVIDER_UNAVAILABLE`、`KNOWLEDGE_INVALID_INPUT`，另有上述协议及元数据专用码。Provider 内部字段、资源身份不匹配、封装非法均返回不可重试的 `KNOWLEDGE_GATEWAY_PROTOCOL_ERROR`，不当作临时服务不可用。已知的非空空间、不可重试、人工重试次数超限和上下文范围错误保留固定、安全的业务说明，不转发远端原始消息。Harness 审批及调度拒绝仍使用自身错误协议。

关闭式字段校验阻止 Provider 结构化内部字段；非 2xx HTTP 错误的 `meta.error.message/fieldErrors` 不直接透传。成功 DTO 中的业务文本（包括候选版本 `error.message`）仍会进入结果或摘要，Gateway 必须先提供安全文本及下载链接。插件不对任意正文做秘密识别或脱敏。具体运行时校验与 Gateway 实施要求的边界见 [对齐记录](contracts/ALIGNMENT.md#运行时校验边界)。

`contracts/knowledge-gateway.openapi.json` 是 Agent/Gateway 唯一业务契约源，并生成 Gateway 类型、路由、工具输入/输出 Schema、审批/并发元数据和 capability manifest。业务端 Adapter 另行消费原生 RAGFlow API，不与此契约混用。

发布包通过 `@nomix-ai/nomix-ragflow/knowledge-openapi.json` 提供原始 OpenAPI 3.1。HTTP path/query/header/requestBody 均使用标准字段声明；自定义扩展只表达 Harness 工具与业务策略。详情、分页、错误、PATCH 和过滤均提供完整示例，并独立校验示例符合 Schema。输入名称边界：空间名 128、描述 1000、code 64、安全域 code 100、文档名 255、fileResourceId 128 个 Unicode code points。

方案与回归证据见 [契约对齐记录](contracts/ALIGNMENT.md)。其中区分插件验证和外部业务端到端验收。

```bash
npm run verify
```

该命令检查契约漂移、类型、lint、行为测试、构建、npm tarball 内容、干净消费者导入和 Harness profile 组合。

## 发布流程

打标签前，在本目录先执行 `npm ci`，再执行 `npm run verify`。干净消费者安装不能代替源码工作区锁文件验证。

先推送工作分支，再推送附注标签 `nomix-v<version>`。标签 CI 执行 Linux、Windows、macOS 源码验证，不打包、不发布。全部通过后，才把同一标签对应的提交推送到 `npm-nomix-ragflow`；该分支核对标签、打包审计、验证消费者导入和 Harness 组合，最后将同一份产物带 provenance 发布到 npm。

发布状态：已发布 1.1.1 曾随额外 Gateway 一起移除旧 SDK。1.1.2 恢复 `./client`、`./errors`、`./types`，底层改用原生 API，不恢复多余服务。旧 Gateway DTO、路径和任务语义不是原样恢复，调用方需按 [SDK 迁移指南](contracts/SERVER-SDK.md) 调整。知识插件工具与 Gateway HTTP 契约不变。使用恢复后的 SDK 应安装 1.1.2，不覆盖 1.1.1 标签和 npm 制品。
