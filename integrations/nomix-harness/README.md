# @nomix-ai/nomix-ragflow

Version 1.1.2 provides a Harness knowledge plugin and restores a server-side native RAGFlow SDK, without the extra RAGFlow Gateway service layer.

- `@nomix-ai/nomix-ragflow/gateway-provider` is the separately configurable HTTP provider; replacing its Cordis row leaves tools unchanged.
- `@nomix-ai/nomix-ragflow/plugin` installs enterprise knowledge tools for Nomix Harness Agents and consumes only `KnowledgeService`.
- `@nomix-ai/nomix-ragflow/business-identity` provides the `dsh-business-identity` session-binding port.
- `@nomix-ai/nomix-ragflow/client` exports `RagFlowBusinessClient` for trusted business backends calling native RAGFlow APIs; `./types` and `./errors` expose its types and `RagFlowApiError`. These are not Agent tool entrypoints. See the [server SDK guide](contracts/SERVER-SDK.md).

The plugin never calls RAGFlow directly and does not change RAGFlow parsing, PageIndex, indexing, retrieval, or reranking. Each business system's Knowledge Gateway owns ACLs, business-scope filtering, citation re-authorization, operation orchestration, audit, provider selection, and business-ID-to-RAGFlow-ID mapping.

This is a reusable knowledge plugin, not a customer-specific integration. Any business system can implement the same Knowledge Gateway contract and configure its endpoint, service credential reference, session assertions and Agent presets. The plugin includes no customer allowlist, business-role mapping or customer-specific authorization rules. A configured provider targets one Gateway; separate deployments or isolated Harness contexts supply their own configuration. The model cannot choose or change the Gateway.

Start business-system integration with the packaged [Gateway implementation guide (中文)](contracts/GATEWAY-INTEGRATION.md): ownership, all 20 HTTP endpoints, identity/authorization, version and Worker workflows, retrieval fusion, citations/downloads, and end-to-end acceptance. Installing this package does not create a business Gateway service or migrate its database.

```text
Business system session creation ──bind assertion (≤10 min)──> dsh-business-identity
                                                        │
Nomix Harness Agent ──20 knowledge_* tools───────────────┼──> Knowledge Gateway ──> server Adapter + SDK ──> RAGFlow
                     approval/concurrency/spill          │    ACL/mapping/audit
                                                        └──resolved on every call
```

## Harness composition

The business system's server-side Provider Adapter uses `RagFlowBusinessClient` to call native RAGFlow APIs and maps authorized resources and results. It is application code, not a second Gateway service. The SDK handles native HTTP transport; the business Gateway still owns authorization and business workflows.

The configuration, tool policies and closed business schemas below describe the Agent/Gateway path, not the server SDK:

| Boundary | Agent → business Gateway | Server SDK → RAGFlow |
|---|---|---|
| Address / route | `gatewayBaseURL` + `/internal/v1/knowledge/**` | `baseURL` + `/api/v1/**` |
| Credentials | `serviceTokenRef` resolved through Harness + bound session assertion | `accessToken`, a native API key or per-request supplier |
| HTTP result / errors | Closed `data/meta`; `KNOWLEDGE_*` errors | Native envelope and `RagFlowApiError`; no complete native DTO runtime validation |
| Resources / files | Business IDs; `fileResourceId` upload and download-link issuance | Native IDs; `Blob` multipart upload and streamed `Response` download |
| Retries / idempotency | Safe reads at most two attempts; mutations carry a Harness-derived key | No automatic retries or native idempotency guarantee |
| Budgets | `requestTimeoutMs`; `artifactMaxBytes` defaults to 10 MiB | `timeoutMs`; `maxResponseBytes` defaults to 16 MiB for JSON only |

See the [SDK guide](contracts/SERVER-SDK.md) for native method signatures and limitations. Neither path implements the business Gateway database or Worker.

The bundle owns `packages/dsh-bundle-ragflow-knowledge/cordis.patch.yml`, mounting identity, provider-neutral runtime, the Gateway provider and the tool consumer in that order. Provider and consumer are separate disabled rows until configured.

## Source workspaces and distribution

Eight real npm workspaces own the implementation:

| Workspace | Responsibility |
|---|---|
| `dsh-knowledge` | Service, DTOs/errors, generated contracts, shared tool validation and observations |
| `dsh-business-identity` | Session assertion binding, refresh and cleanup |
| `dsh-knowledge-gateway` | Gateway Provider, HTTP transport and correlation |
| `dsh-tool-knowledge-read` | Eight read tool actions |
| `dsh-tool-knowledge-write` | Eight maintenance tool actions |
| `dsh-tool-knowledge-admin` | Four space administration/deletion actions |
| `dsh-knowledge-policy` | Approval decisions and evidence guidance |
| `dsh-bundle-ragflow-knowledge` | Agent composition, lifecycle and Cordis patch |

They are private source workspaces compiled into the existing single distribution, `@nomix-ai/nomix-ragflow`, not eight separately published dependencies. The existing npm lockfile/release workflow remains authoritative; no second package manager or lockfile is introduced. Each workspace declares its entrypoint, dependencies and typecheck. AST-based tests reject undeclared dependencies, cycles and reversed ownership. Tool packages depend only on the knowledge service package, never the Gateway or RAGFlow client. `src/` contains the separate native server SDK and public aggregation exports; Agent workspaces cannot import it.

Deployment still uses the public configuration below, without installing individual source workspaces:

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

The domain, credential reference and Agent preset names above are examples, not built-in defaults or business roles. Deployments must use their own configured presets. `agentToolsets` must be nonempty with unique, nonempty, trimmed preset names; tools are installed only when the Session header's `agentPreset` matches. The knowledge runtime requires exactly one available Provider; otherwise calls fail. It does not provide automatic routing or failover.

`gatewayBaseURL` is the business Gateway service root, without `/internal/v1/knowledge`; the plugin appends that fixed path. It is not a RAGFlow service URL. Align the provider/consumer timeout and artifact budgets.

The Gateway provider requires HTTPS except for HTTP on localhost/127.0.0.1/[::1], permits a reverse-proxy path prefix, and rejects URL credentials, query and fragment. These are provider configuration checks, not model-selectable options.

Node.js `^22.19.0 || >=24.0.0` is required; Harness is pinned to `0.2.9`. Both provider and consumer accept integer `requestTimeoutMs` values from 1 to 300000, defaulting to 60000; the consumer adds 30000 ms of tool cleanup grace. Both accept integer `artifactMaxBytes` values from 1 to 67108864, defaulting to 10485760. The provider bounds the complete HTTP response (error bodies also have a 65536-byte cap); the consumer bounds serialized results when spilling. These are not upload file-size limits.

When the business system creates or refreshes a Harness session, it calls `BusinessIdentityRuntime.bindSession({ sessionId, userAssertion, expiresAtEpochSeconds })`. Assertions must expire within ten minutes. The plugin resolves the current assertion on every tool call; the assertion is not a static plugin credential, and the plugin caches no role, store, department, or document scope.

Bindings expire automatically; plugin disposal clears bindings and timers. Session termination should call the disposer returned by binding. An old disposer cannot remove a refreshed assertion. Gateway HTTP redirects are rejected so credentials cannot follow them.

`bindSession` checks the supplied binding expiry and stores the opaque assertion in memory; it does not verify its signature or read its embedded expiry. The business system must supply a matching expiry, bind/refresh it in the runtime that owns the session, and the Gateway must verify the signed assertion on requests. Bindings are not persisted or synchronized between instances.

Selected Agents receive a scoped evidence instruction: never fabricate internal company rules from general knowledge when reliable evidence is absent. A deployment using Harness `complete: true` replaces additive sections and must include the exact `KNOWLEDGE_EVIDENCE_INSTRUCTIONS` exported by `./plugin`. The `llm/stream` guard checks the selected session's actual main-loop request before model dispatch; it neither reassembles nor rewrites the prompt. Other sessions and auxiliary model requests are unaffected. This is a configuration guard, not a guarantee of model correctness. Keep provider and consumer requestTimeoutMs aligned; the consumer adds Harness cleanup grace.

Gateway requests carry only these identity and correlation headers:

- `Authorization: Bearer <Harness service token>`
- `X-User-Assertion`
- `X-Harness-Session-Id`
- `X-Tool-Call-Id`
- `X-Request-Id`
- Mutations additionally carry `Idempotency-Key`, deterministically derived from the Harness tool execution.

The model never supplies an idempotency key. It is derived from `sessionId + rootCallId + toolCallId + toolName` and remains stable when the same tool execution is replayed. Gateway `operationId` values are opaque business identifiers and need not be UUIDs.

## Tools, permissions, and execution policy

The `read` toolset contains eight read tools. `write` adds eight maintenance tools. `admin` contains all 20. The Gateway remains the final authorization authority; Actions below describe its contract and are not ACL calculations inside the plugin.

| Tool | Gateway Action | Harness approval | Concurrency |
|---|---|---|---|
| `knowledge_space_list`, `knowledge_space_get` | `SPACE_VIEW` | allow | parallel |
| `knowledge_document_list`, `knowledge_document_get`, `knowledge_source_read` | `DOCUMENT_VIEW` | allow | parallel |
| `knowledge_search` | `KNOWLEDGE_SEARCH` | allow | parallel |
| `knowledge_operation_get` | corresponding resource-view permission | allow | parallel |
| `knowledge_document_download` | `DOCUMENT_DOWNLOAD` | ask | parallel |
| `knowledge_document_upload` | `DOCUMENT_UPLOAD` | allow | exclusive |
| `knowledge_document_update` | `DOCUMENT_UPDATE` | allow | exclusive |
| `knowledge_document_replace`, `knowledge_document_enable`, `knowledge_document_disable` | `DOCUMENT_UPDATE` | ask | exclusive |
| `knowledge_document_reindex` | `DOCUMENT_REINDEX` | ask | exclusive |
| `knowledge_operation_cancel` | original operation permission | ask | exclusive |
| `knowledge_operation_retry` | original permission + `OPERATION_RETRY` | ask | exclusive |
| `knowledge_space_create` | `SPACE_CREATE` | ask | exclusive |
| `knowledge_space_update` | `SPACE_UPDATE` | ask | exclusive |
| `knowledge_space_delete` | `SPACE_DELETE` | ask | exclusive |
| `knowledge_document_delete` | `DOCUMENT_DELETE` | ask | exclusive |

Maintenance and administration use single-resource requests. Batch actions, `items` arrays, and old tool aliases do not exist. Upload accepts only `knowledgeSpaceId`, `fileResourceId`, `documentName`, and optional safe business metadata. The plugin never reads local paths, depends on a filesystem, transfers binary bodies, or emits Base64.

In the table, `allow` means no additional confirmation imposed by this plugin; other Harness policies may still ask or deny. `ask` never overrides an existing denial. The read-visible download action issues a link rather than transferring a file.

Harness tool arguments always use `{ "input": { ...businessFields } }`, for example `{ "input": { "documentId": "document-1" } }` for `knowledge_document_get`. This wrapper is not a Gateway HTTP body field: the plugin maps business fields into each route's path, query and body.

Agent schemas are closed. They reject user/tenant impersonation parameters, ACL subjects, RAGFlow dataset/document/chunk ID fields, technical version selection, model/Pipeline/rerank controls, thresholds/vector weights, TOC/KG controls, provider addresses, local paths, storage keys, TTL selection, and binary bodies. Business IDs are opaque strings: the plugin cannot identify Provider ownership from a string alone, so the Gateway must validate business mappings and authorization. Allowed document metadata is limited to `category`, `tags`, `versionLabel`, and `productCode`.

## Four explicit business contracts

Download accepts only `documentId` and calls `POST /internal/v1/knowledge/documents/{documentId}:create-download-link` with `{}`. It always targets the active version and returns `documentId`, `versionId`, `fileName`, `mimeType`, `fileSize`, `downloadUrl`, `expiresAt`, and `expiresInSeconds: 60`. The Agent cannot select a version or TTL.

Space creation accepts `code`, `name`, optional `description`, fixed `profileCode: enterprise-long-document`, and `defaultSecurityDomainCode`. The space update tool requires `knowledgeSpaceId`, `expectedVersion`, and at least one of `name` or `description`. The space deletion tool requires `knowledgeSpaceId`, `expectedVersion`, and `reason`. The plugin places `knowledgeSpaceId` in the HTTP path and the other fields in the body; cascade, force, and delete-all modes do not exist. The Gateway rejects non-empty spaces and spaces with pending operations.

Automatic retry of asynchronous business work belongs to the Gateway Worker, stays within the same operation, and is capped at five attempts; the plugin never automatically retries a mutation HTTP request. `knowledge_operation_retry` is an explicit maintenance/admin action taking `operationId` and `reason`; it requires approval. The Gateway checks the original permission plus `OPERATION_RETRY`, creates a child operation with `parentOperationId`, and caps manual retries at three per root operation. A limit error is normalized to `KNOWLEDGE_CONFLICT`.

Manual retry acknowledgements require only `operationId`, `parentOperationId`, and `status`, not a full operation record. Operation details may include `retryable`, `retryCount`, `lastRetryAt`, and `nextRetryAt`. Safe GET/search transport failures get at most two attempts under one timeout budget, respecting explicit `retryable: false`. Download-link issuance is not automatically retried, despite being a read-visible tool.

Disconnections or timeouts while receiving either success or error bodies are transport failures: safe reads may retry only within the remaining budget; exhaustion produces `KNOWLEDGE_PROVIDER_UNAVAILABLE`. Caller cancellation remains cancellation. Fully received invalid JSON or contract violations are non-retryable protocol errors. Mutations and download-link issuance are never automatically retried after body interruption either.

Citation `contextBefore` and `contextAfter` count Unicode code points in the normalized document, default to 1000 each, and are capped at 5000 each. Results cap `beforeContent` at 5000, `matchedContent` at 2500, `afterContent` at 5000, and their total at 12500. They include requested/actual counts, `versionId`, page range, truncation, and `EXACT_OFFSET | CHUNK_APPROXIMATE` precision.

## Retrieval, lifecycle, and PageIndex

`knowledge_search` accepts only `query`, `knowledgeSpaceIds`, `documentIds`, `limit`, and `metadataFilter`, with at most eight hits. The Gateway owns ACL pre/post filtering, hybrid retrieval, RRF, deduplication, merge, and ranking. A document contributes at most four hits, each content field is capped at 2500 code points, and total hit content is capped at 16000. Empty evidence requires `NO_AUTHORIZED_RELEVANT_EVIDENCE`.

`documentIds: []` means no individual documents selected. Search hits use `page`, not the citation endpoint's `pageStart/pageEnd`. Empty business results are `{ "hits": [], "reason": "NO_AUTHORIZED_RELEVANT_EVIDENCE" }`. Citation `chapterPath` is optional. Documents without any active version may return `activeVersion: null`.

Lifecycle states are separate:

- Space: `CREATING`, `ACTIVE`, `CREATE_FAILED`, `DISABLED`, `DELETING`, `DELETED`, `DELETE_FAILED`
- Document: `CREATING`, `ACTIVE`, `CREATE_FAILED`, `DISABLED`, `DELETING`, `DELETED`
- Version: `CREATED`, `UPLOADING`, `UPLOADED`, `INGESTING`, `READY`, `FAILED`, `CANCELLED`, `RETIRED`, `DELETED`
- Operation: `PENDING`, `RUNNING`, `SUCCEEDED`, `FAILED`, `CANCELLED`

Only an `ACTIVE` document whose active version is `READY` is searchable. RAGFlow and the Gateway retain ownership of the PageIndex tree, Knowledge Compilation, parsing settings, and low-level retrieval tuning. The Agent receives only bounded `chapterPath` evidence and re-authorized citation content; there is no complete-tree tool.

## Formal document detail, pagination, and metadata

`knowledge_document_get` returns `KnowledgeDocumentDetail`: `spaceId/lockVersion/searchable`, timestamps, and nullable `activeVersion/candidateVersion`. Version details include versionNo, changeType, state, operation identity/state, progress/source/timestamps, error and retryability. Unknown progress is null, never an estimated zero; READY/RETIRED use 100. Both slots are rendered, including in a spilled detail summary. Explicit pointers, single-candidate enforcement, atomic activation and retries retaining the candidate version are Gateway responsibilities. The formal detail applies to get; lists and synchronous mutations retain their distinct summary DTOs.

Agent-facing Gateway HTTP JSON responses have exactly `data/meta`; native SDK responses do not use this envelope. Required meta fields: success, requestId, traceId, timestamp (UTC), apiVersion (v1), pagination, error. Success requires non-null data and null error; failure requires null data, null pagination and error containing code/message/retryable/fieldErrors. Invalid envelopes produce `KNOWLEDGE_GATEWAY_PROTOCOL_ERROR`, without bare-DTO or alias fallback.

Document mutations pass the last observed `lockVersion` (or summary `version`) unchanged as `expectedVersion`, including zero. It is the document optimistic-lock counter, not the technical version's `versionNo` or `versionNumber`. Space mutation versions remain at least one. Conflicts require re-reading the resource; the plugin does not increment the counter or replay the mutation automatically.

Space/document lists take page (1-based) and pageSize (default 20, range 1–100), not cursor/limit. HTTP data is `{items}`; meta.pagination contains page/pageSize/totalItems/totalPages/hasNext. The service projects this as `{items,pagination}`, stored in the tool observation's inline `data.result` or complete spill JSON, not at the tool's outermost level. Responses must echo the requested page/pageSize; totalPages is ceil(totalItems/pageSize), and hasNext is page < totalPages. An empty collection has zero total pages; an out-of-range page has no items. Item count cannot exceed pageSize or the remaining total. Inconsistencies are protocol errors. Non-list HTTP pagination is null.

Metadata input strings are NFC-normalized and trimmed, preserving case. category/versionLabel/productCode are 1–64 code points; at most 20 unique tags, each 1–32 code points. Control characters and normalized duplicates are rejected; metadata JSON is bounded to 4096 UTF-8 bytes. PATCH omission means unchanged, null clears strings, [] clears tags (tags:null is invalid). Upload strings cannot be null. Output must include all four fields, using null for absent strings and [] for absent tags. Non-null strings must already be NFC-normalized, trimmed and nonempty; the plugin rejects invalid output rather than cleaning it or supplying missing fields. Replace/reindex do not accept metadata.

metadataFilter permits only category/tagsAny/tagsAll/versionLabel/productCode arrays, each with 1–20 distinct normalized values. Omit a filter field for no constraint; a present empty array is invalid (unlike PATCH tags:[]). Fields use AND, arrays OR, except tagsAll requires all values. Matching and Provider projection remain Gateway-owned. Validation codes are `KNOWLEDGE_METADATA_FIELD_NOT_ALLOWED`, `KNOWLEDGE_METADATA_FILTER_FIELD_NOT_ALLOWED`, `KNOWLEDGE_METADATA_VALUE_INVALID`, and `KNOWLEDGE_METADATA_TOO_LARGE`; unknown fields are never silently dropped. Tool-boundary business validation preserves these dedicated codes before the closed Harness input schema runs.

## Output, errors, and contract source

Gateway responses pass closed OpenAPI runtime validation before reaching an Agent. Large structured results are stored as UTF-8 JSON through Nomix Harness 0.2.9 `SpillStore.saveText`; both HTTP reads and spill writes are capped by `artifactMaxBytes`. Search and citation business limits are checked before spilling.

Serialized business results of at most 12000 UTF-8 bytes are inline; larger results are saved as complete JSON. Tool observations contain `status/summary/data/nextActions/artifacts`, not the HTTP `data/meta` envelope. Inline content is in `data.result`; spilled results use `data.kind=artifact-reference` and must be read using the artifact's `retrievalHint`. A summary is not complete evidence.

General plugin business errors use `KNOWLEDGE_UNAUTHENTICATED`, `KNOWLEDGE_FORBIDDEN`, `KNOWLEDGE_NOT_FOUND`, `KNOWLEDGE_CONFLICT`, `KNOWLEDGE_OPERATION_PENDING`, `KNOWLEDGE_PROVIDER_UNAVAILABLE`, and `KNOWLEDGE_INVALID_INPUT`, alongside the protocol and metadata codes above. Provider-internal response fields, mismatched resource identities and invalid envelopes produce non-retryable `KNOWLEDGE_GATEWAY_PROTOCOL_ERROR`, not a transient outage. Known non-empty-space, retryability, manual-retry-limit and context-range failures retain fixed safe explanations, never remote messages. Harness approval and scheduling rejections retain the framework's own protocol.

Closed schemas reject provider-internal structured fields; non-2xx HTTP errors do not directly forward `meta.error.message/fieldErrors`. Business text in successful DTOs, including candidate-version `error.message`, can still appear in results or summaries. The Gateway must supply safe text and download links; the plugin does not detect or redact arbitrary secrets in document text. See the [runtime validation boundaries](contracts/ALIGNMENT.md#运行时校验边界) for the distinction between plugin checks and Gateway requirements.

`contracts/knowledge-gateway.openapi.json` is the only Agent/Gateway business contract source. It generates Gateway types, routes, tool input/output schemas, approval/concurrency metadata, and the capability manifest. The business Adapter consumes native RAGFlow APIs separately; their protocol is not the Agent/Gateway contract.

The package exports the original OpenAPI 3.1 document at `@nomix-ai/nomix-ragflow/knowledge-openapi.json`. HTTP path/query/header/requestBody declarations use standard OpenAPI fields; extensions describe Harness tools and business policy. Complete detail, pagination, error, PATCH and filter examples are independently validated against their schemas. Unicode code-point limits: space name 128, description 1000, code 64, security-domain code 100, document name 255, fileResourceId 128.

See [contract alignment evidence and outstanding items](contracts/ALIGNMENT.md). Plugin contract tests do not replace real Gateway/RAGFlow end-to-end acceptance.

```bash
npm run verify
```

This checks contract drift, type safety, lint, behavioral tests, build output, npm tarball contents, clean consumer imports, and Harness profile composition.

## Release workflow

Before tagging, run `npm ci` from this directory, followed by `npm run verify`. A clean consumer install does not validate the source workspace lockfile.

Push the working branch first, then push the annotated `nomix-v<version>` tag. Tag CI verifies the source on Linux, Windows and macOS; it does not pack or publish. Only after all tag checks pass, push the same tagged commit to `npm-nomix-ragflow`. That branch verifies the tag, packs and audits the artifact, checks consumer imports and Harness composition, then publishes that exact artifact to npm with provenance.

Release status: published 1.1.1 removed the old SDK along with the extra Gateway. Version 1.1.2 restores `./client`, `./errors`, and `./types` against native APIs, without restoring that service. It is not a drop-in restoration of old Gateway DTOs or routes: follow the [SDK migration guide](contracts/SERVER-SDK.md). Knowledge tools and their Gateway HTTP contract remain unchanged. Use 1.1.2 for the restored SDK; do not overwrite the 1.1.1 tag or artifact.
