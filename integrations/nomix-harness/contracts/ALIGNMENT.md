# 方案对齐与验证边界

本记录区分已实现的插件契约、配置验收和外部业务职责。移除仓库附加的服务端适配层及其客户端；不修改 RAGFlow 原业务或业务系统源码。

业务接入实施入口是随 npm 包发布的 [Gateway 实现与接入指南](GATEWAY-INTEGRATION.md)，HTTP 唯一契约仍为 [knowledge-gateway.openapi.json](knowledge-gateway.openapi.json)。本文记录插件侧验证证据，不代表任一业务系统已经完成适配。

## 本轮确定项

| 方案场景 | 实现 | 独立验证 |
|---|---|---|
| 按空间检索、不指定文档 | 接受 `documentIds: []` | `plan-contract.spec.ts` |
| 检索命中和空证据 | `page`；空结果 `hits/reason` | `plan-contract.spec.ts`、实际 Harness 输出校验 |
| 空间更新、人工重试提交 | 各自响应 DTO，不强制完整详情 | `plan-contract.spec.ts` |
| 引用正文 | `chapterPath` 可选，保留 Unicode 数量限制 | `plan-contract.spec.ts`、client 测试 |
| 首次上传/失败 | `activeVersion` 可空；operation 可读重试状态 | `plan-contract.spec.ts` |
| 身份与传输 | 每次动态解析；拒绝非法头和重定向；共享超时预算 | 真实本地 HTTP `knowledge-transport.spec.ts` |
| 身份释放 | 自动过期、刷新保护、Cordis fiber 卸载清理 | `business-identity.spec.ts` |
| Harness 审批与隔离 | 选中 Agent 范围安装；需要 ask 的调用在拒绝或无审批服务时不执行 | `knowledge-harness.spec.ts`，使用真实 0.2.9 运行时 |
| 无证据不编造 | Agent 系统提示词及无结果观察说明 | `knowledge-harness.spec.ts` |
| OpenAPI | 标准 HTTP 参数/请求体；原始 JSON 随 npm 包导出 | 独立 Ajv 2020-12 校验、生成漂移检查、tarball 检查 |
| 八个源码包 | 实际实现按八个私有 npm workspace 迁移；根工程统一发布 | 每包 typecheck、`workspace-boundaries.spec.ts`、干净 tarball 消费者 |

## 2026-09-05 补充协议已落地

- 正式详情采用 `activeVersion/candidateVersion`，不是 processingVersion；包含 spaceId、lockVersion、searchable、版本 changeType、可靠进度、错误及 operationId。未知进度显示为不可用；失败/取消候选槽位保留，成功激活后为空。插件验证结构及一致性，不实现 Gateway 指针切换。
- 新 data/meta 封装包含 success、requestId、traceId、UTC timestamp、apiVersion=v1、pagination、error。错误位于 meta.error，字段级错误数组不可省略；不接受旧响应。列表使用 page/pageSize，HTTP 分页位于 meta.pagination，工具投影保留 pagination。
- 元数据按上传输入、PATCH 输入和固定输出拆分；包含 NFC/trim、字符/重复/4096 字节检查、清空语义和白名单 metadataFilter。后补正式固定输出覆盖候选版本方案早先的 metadata={} 示例；完整版本字段表优先于省略字段的场景示意。
- `./gateway-provider` 和 `./plugin` 分别配置；Consumer 不导入 HTTP Provider，幂等执行身份归核心契约。四行 Cordis patch 与干净包安装校验覆盖组合。
- `complete: true` 必须包含 `./plugin` 导出的证据规则原文；`llm/stream` 检查选中 Session 的实际主循环请求，缺失即阻止模型调用，不重新组装提示词，不影响其他 Session 或辅助请求。
- 独立新协议测试：`knowledge-revisions.spec.ts`；真实 Harness 组装、输出 Schema、审批：`knowledge-harness.spec.ts`；实际 AgentLoop 与模型发送边界：`knowledge-lifecycle.spec.ts`。

这些测试不证明真实 Gateway 已完成数据库迁移、前后权限过滤、单候选事务或 Worker 操作。那些是业务系统的独立验收项。

## 本轮有限收尾与验收

| 已验证问题或待明确项 | 落地规则 | 回归证据 |
|---|---|---|
| 重复组装动态提示词可能检查到不同内容 | 只检查实际主循环请求，保留 Harness 原始 Agent/signal | `knowledge-lifecycle.spec.ts` 的动态 complete 提示词、Session 隔离与释放测试 |
| 文档 lockVersion=0 无法写回 | 详情 lockVersion / 摘要 version 原样作为 expectedVersion，允许 0；空间版本仍至少为 1 | 实际读取→更新→冲突测试，以及全部文档变更 Schema 回归 |
| Harness 输入校验抢先吞掉元数据专用错误 | 共享工具边界先执行唯一的业务输入校验，再校验关闭式 Harness Schema | 实际 ToolRuntime 未知字段、空过滤与非法 null 测试 |
| Provider 字段或资源错配误报临时不可用 | 统一为不可重试的 KNOWLEDGE_GATEWAY_PROTOCOL_ERROR | client/transport 回归 |
| 响应正文中断误报协议错误 | 成功/错误正文读取统一处理；断线/超时归传输故障，保留取消语义；仅安全读取可在共享预算内重试一次，变更和链接签发不重试 | `knowledge-transport.spec.ts` 真实 HTTP 断线恢复、次数上限、超时、取消与非法 JSON 对照测试 |
| 分页与空过滤语义未封闭 | 请求页回显、总页数和 hasNext 一致、空/越界页为空、条数上限；filter 数组为 1–20 项，省略表示不约束 | `knowledge-revisions.spec.ts`、`knowledge-lifecycle.spec.ts` |
| 示例必须能直接按正式契约接入 | 完整详情/分页/错误/PATCH/过滤示例 | `knowledge-openapi.spec.ts` 独立 Ajv 校验 |
| 通用插件不绑定特定业务系统 | 通用 KnowledgeGatewayProvider、业务中立 OpenAPI/manifest、可配置地址/凭证/preset | `knowledge-provider.spec.ts` 双业务配置、`workspace-boundaries.spec.ts` 发布源码边界 |

`knowledge-lifecycle.spec.ts` 使用真实 Harness 0.2.9 AgentLoop、ToolRuntime、SystemPrompt、Cordis Context 和插件组合，仅外部 Gateway、模型、凭证存储及 spill 存储使用测试替身。覆盖上传→查询处理状态→激活→检索→引用、替换/重建期间旧版本可读、成功/失败/取消投影、人工重试子操作、审批、稳定幂等键、断言刷新/过期、取消信号和大型 JSON spill。这验证插件消费业务契约的连续调用，不冒充 Gateway 数据库事务或真实 RAGFlow 检索质量验收。

## 包组织与发行决定

八个源码 workspace 已完成，外部发布仍保留 `@nomix-ai/nomix-ragflow` 单制品，不增加八个独立发行包；沿用既有 npm 工作流，不切换方案目录示意中的 pnpm。工具动作只有一份实现，共享注册边界只负责校验、错误转换、结果观察及注册释放。中途注册失败会清理已经安装的工具和提示词。

## 不属于插件实现的职责

真实 ACL 前后过滤、active-version 切换、引用快照与再次授权、Worker 自动重试和人工重试上限、原生 RAGFlow PageIndex/混合检索，均由业务 Gateway/RAGFlow 承担。本地 mock 与框架回归不能替代业务系统和 RAGFlow 的真实业务端到端验收。

## 文档与发行接入检查

- Gateway 指南的 20 行接口表、成功状态与审批策略，以及完整 JSON 响应示例，由 `knowledge-openapi.spec.ts` 对照唯一 OpenAPI 校验。
- npm tarball 审计要求包含该指南、OpenAPI、中英文 README 和本文；业务项目可直接从锁定版本的发布包取得接入依据。
- 业务 Knowledge Gateway 是唯一业务入口；Provider Adapter 使用独立的 `RagFlowBusinessClient` 连接原生 RAGFlow API。本包恢复服务端 SDK，不恢复额外服务端 Gateway、旧 Gateway 协议或部署配置；Agent workspace 不导入 SDK。

## 文档核对依据

本表覆盖中英文 README、Gateway 接入指南和本文涉及的插件行为；源码路径相对于 `integrations/nomix-harness`。测试用于验证相应行为，不代表其余自然语言说明自动获得验证。

| 核对范围 | 实现依据 | 回归依据 |
|---|---|---|
| 发布入口、版本、依赖、四行配置 | `package.json`、`src/manifest.ts`、`packages/dsh-bundle-ragflow-knowledge/cordis.patch.yml` | `exports.spec.ts`、`workspace-boundaries.spec.ts`、`verify-consumer.mjs`、`verify-profile.mjs` |
| 原生服务端 SDK、路由映射及传输 | `src/client.ts`、`src/native-transport.ts`、`src/types.ts`；仓库 `api/apps/restful_apis/*_api.py` | `native-client.spec.ts`、打包入口与消费者检查；未执行真实 RAGFlow 联调，不证明 Provider 部署能力或业务事务 |
| Provider/Consumer 配置、preset 选择、生命周期 | `packages/dsh-knowledge-gateway/provider.ts`、`packages/dsh-bundle-ragflow-knowledge/consumer.ts`、`packages/dsh-knowledge/service.ts` | `knowledge-provider.spec.ts`、`knowledge-lifecycle.spec.ts` |
| Session 绑定、逐次凭据、关联头、幂等 | `packages/dsh-business-identity/business-identity.ts`、`packages/dsh-knowledge/execution-identity.ts`、Provider/Consumer 与 HTTP client | `business-identity.spec.ts`、`knowledge-transport.spec.ts`、`knowledge-lifecycle.spec.ts` |
| 20 个工具、输入映射、审批和并发 | 三个 `packages/dsh-tool-knowledge-*/tools.ts`、`packages/dsh-knowledge/tool.ts`、`harness-contract.ts`、`packages/dsh-knowledge-policy/policy.ts` | `knowledge-tools.spec.ts`、`knowledge-harness.spec.ts`、`knowledge-contracts.spec.ts` |
| HTTP 路由、DTO、元数据、版本投影、分页 | OpenAPI、`packages/dsh-knowledge/knowledge-schema.ts`、`metadata.ts`、`packages/dsh-knowledge-gateway/knowledge-client.ts` | `knowledge-openapi.spec.ts`、`knowledge-revisions.spec.ts`、`plan-contract.spec.ts`、`knowledge-client.spec.ts` |
| 重试、取消、错误转换和大小限制 | HTTP client、`packages/dsh-knowledge/knowledge-errors.ts`、Consumer | `knowledge-transport.spec.ts`、`knowledge-lifecycle.spec.ts` |
| 工具观察、完整 JSON spill、证据规则 | `packages/dsh-knowledge/knowledge-observation.ts`、Consumer、policy | `knowledge-harness.spec.ts`、`knowledge-lifecycle.spec.ts` |
| 发布顺序、包内容与真实 Harness 安装 | 仓库 `.github/workflows/release-nomix-plugin.yml`、`scripts/verify-package.mjs`、`scripts/audit-tarball.mjs` | `npm run verify`；发布分支检查标签及同一制品 |

原生 RAGFlow 入口另行核对 `api/apps/__init__.py` 的路由前缀、`document_api.py` 的上传/配置/解析/停止路由和 `chunk_api.py` 的 retrieval/structure 路由；这些文件未修改。业务 Gateway 的数据库、Worker、ACL 和检索编排不是本仓库插件代码，接入指南描述的是部署方必须实现并验收的要求。

## 运行时校验边界

本节的 HTTP client 指 `KnowledgeGatewayClient`，不是恢复的 `RagFlowBusinessClient`。原生 SDK 使用不同的凭据、envelope、错误和预算，不自动重试；其上传是 Blob/FormData，下载才返回流。详见 [SDK 指南](SERVER-SDK.md)。

- HTTP client 区分 2xx 成功与非 2xx 错误、拒绝重定向，并按对应 DTO 校验正文；它不逐个强制核对 200/201/202，也不验证响应 Content-Type。接入方仍须严格遵守 OpenAPI 的具体成功状态和 JSON 协议，不能把当前客户端接受当作契约合规证明。
- 检索结果校验全局 8 条、单文档 4 条和正文长度，并在返回 query 时核对其与请求一致；不自行裁剪到请求 limit，也不查验返回文档是否属于请求范围或最新 ACL。范围、limit、有效版本、元数据匹配和去重必须由 Gateway 落实。
- 下载校验业务 documentId、DTO、`expiresInSeconds=60` 及 HTTPS（本地回环例外）；不访问下载地址、不核对版本数据库、不验证链接实际到期时间。签发、当前 active version 和到期兑付由 Gateway/文件服务负责。
- 详情校验双版本结构、searchable 公式、版本槽位 ID 不同、进度与错误一致性；不执行数据库原子切换，也不验证真实 Worker 的全部状态迁移。候选保留、成功清空和重试复用是 Gateway 要求，不是插件事务。
- 响应关联 ID 进行结构校验，但不要求 `meta.requestId` 与请求头完全相等；成功响应 meta 用于 Provider debug 关联日志。它不是完整业务审计，也不是 `traceparent` 传播或审批凭证。
- 身份绑定仅校验非空断言与外部传入的到期时间，不验证签名或断言内部 exp；它是当前运行时的内存绑定，不是跨实例身份数据库。断言签发、校验和运行时绑定恢复由业务端负责。
- 本地 `npm run verify` 包含各 workspace 类型检查与打包验收；标签 CI 执行根工程类型检查、契约、lint、测试和构建，不等同于执行完整 verify。Harness profile 安装使用 Harness CLI 自身的包管理流程，发布 CI 为此安装 pnpm；源码工程的锁文件和发布仍使用 npm。

本次 SDK 恢复和文档修正随 `1.1.2` 发布；`1.1.1` 的既有包及标签保持不变。业务端须安装 1.1.2 并完成原生 SDK 适配与独立联调。
