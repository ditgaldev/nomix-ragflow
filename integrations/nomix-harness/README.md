# @nomix-ai/nomix-ragflow

Typed client and Nomix Harness plugin for the RAGFlow Business Gateway. Both
entry points call the same public Gateway plane; neither connects to RAGFlow's
original API or accepts a RAGFlow API key.

## Install

```bash
npm install @nomix-ai/nomix-ragflow
```

The package targets Node.js `^22.19 || >=24`. The plugin targets Nomix Harness
`^0.2.9` and imports every runtime capability through the stable Harness
`plugin/*` API.

## TypeScript client

`baseURL` is the dedicated Business Gateway service root and must not contain
`/api/v1`. The client adds that public prefix itself. `accessToken` can be a
string or an asynchronous provider; providers are evaluated for every request,
so token rotation does not require recreating the client.

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
  question: 'What changed in the latest release?',
})
const uploaded = await ragflow.documents.upload('dataset-id', [{
  displayName: 'handbook.pdf',
  body: new Blob([documentBytes], { type: 'application/pdf' }),
}], { idempotencyKey: 'upload-handbook' })
const documentIds = uploaded.map(document => document.id)
await ragflow.pageIndex.build('dataset-id', { documentIds }, { idempotencyKey: 'page-index-handbook' })
// Poll until state is ready, failed, or cancelled; use phase/errorCode to handle failures.
const pageIndexStatus = await ragflow.pageIndex.status('dataset-id', documentIds[0])
const pageIndex = await ragflow.pageIndex.get('dataset-id', documentIds[0])
const routed = await ragflow.pageIndex.search({
  datasetIds: ['dataset-id'],
  documentIds,
  question: 'Where is deployment covered?',
})
console.log(datasets.data, datasets.meta.nextCursor)
console.log(retrieval.data.chunks, retrieval.meta.nextCursor)
console.log(pageIndexStatus, pageIndex.templates, routed.data.navigation, routed.data.chunks)
```

Every request supports `AbortSignal`. Required write operations also require an
`idempotencyKey`. Updates and single-resource deletes require the latest returned
`version` in RequestOptions; the client sends it as `If-Match`. Gateway failures
throw `BusinessGatewayError` with `code`, `status`, `requestId`, `details`,
`retryable`, and optional `retryAfterMs`; timeout and cancellation remain active
until the complete response body has been consumed. The client has no option for
trusted tenant, workspace, subject, action, scope, or arbitrary authorization
headers; those values come exclusively from the verified business token.
Paginated list methods, retrieval, and PageIndex search retain the Gateway `{ data, meta }`
envelope so callers can pass `meta.nextCursor` to the next request.
Success bodies are streamed into a bounded buffer (16 MiB by default, 64 MiB
hard maximum); Gateway error bodies have a separate 64 KiB parsing ceiling.
`RequestOptions.maxResponseBytes` may lower the configured ceiling for one
request, but cannot raise it.

## Nomix Harness plugin

Install the bundle into the profile that owns the Harness configuration:

```bash
nomix plugin --profile my-profile add @nomix-ai/nomix-ragflow
```

The bundle mounts the inert provider-neutral `ragflow-service` definition and
inserts a disabled `ragflow` composition row. Enable the composition in that
profile's `cordis.patch.yml` and explicitly select its Agents:

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
    # Agent file reads are memory-bounded and capped at 64 MiB.
    maxFileBytes: 67108864
    artifactMaxBytes: 10485760
```

Store `RAGFLOW_BUSINESS_ACCESS_TOKEN` in the Harness credential provider. The
integration follows the same Service Definition / Provider / Consumer boundary
as `nomix-crm`: the Provider resolves the reference exactly once from the
calling Agent/session context for each tool operation, then creates an
operation-local `RagFlowBusinessClient`. The next operation observes token
rotation. Credentials are never resolved or cached in the process-global
Consumer context. Provider selection is explicit through `providerId`, or fails
closed unless exactly one available Provider exists.

The Consumer is installed in each selected Agent scope. Root-scoped tools are
not registered. Use `agentPresets` as an allow-list, or set
`attachToAllAgents: true` explicitly; omitting both is a configuration error.
Tool registration, approval listeners, filesystem access, spill ownership, and
cleanup all follow that Agent's lifecycle.

The Harness tool deadline is derived from `requestTimeoutMs` plus a fixed
30-second allowance for Agent credential lookup and bounded artifact handling.
The HTTP request still stops at `requestTimeoutMs`; the extra allowance does not
extend Gateway network access.

The plugin marks requests as `agent` for audit classification only; standalone
clients default to `rest`. That closed marker never affects identity, actions,
workspace, or data scope. REST and Agent calls use the same authorization path.

The eleven tools include `ragflow_discover` plus retrieval, PageIndex, datasets,
documents, transfers, chunks, chats, sessions, agents, and memories. Discovery returns only
a redacted authorization summary (availability, authentication shape, action
count, and scope modes/counts); it never exposes subjects, workspace IDs,
permission references, action names, or raw scope IDs. Every Agent write must
include a caller-stable business `operationId` and requests one-time pre-execute
approval. Retry the same uncertain business intent with the same `operationId`,
even when Harness assigns a new tool call ID; the plugin derives the same
Agent/operation-bound idempotency key. A distinct intent must use a distinct
`operationId`. Approval shows bounded target IDs, artifact path, version, field
names, and intent ID. It is an additional human gate only: the Gateway still
enforces the token's action and resource scope. Read operations are
parallel-safe; writes are scheduled exclusively. Tool outputs use a closed,
discriminated `status`, `summary`, `data`, `nextActions`, and `artifacts`
contract. Small JSON is represented as typed JSON-pointer entries. Larger
results are stored in the Agent/session spill plane and only an artifact
reference is exposed to the model.

RAGFlow's retrieval-time table-of-contents enhancement remains available through
`ragflow_retrieval` with `tocEnhance: true`; it starts from ordinary chunk matches and
adds directory context. The separate `ragflow_page_index` tool works with compiled
PageIndex artifacts and covers their post-upload build, readiness, explicit tree access,
and chapter-first retrieval loop. The complete upload-to-build workflow needs upload and
read grants; `build` itself requires `compilation:write`, `dataset:read`, `document:read`,
`document:update`, and `document:parse`. Upload with `ragflow_transfer_documents.upload` and retain the returned document
IDs, then call `build` with an `operationId`. It reuses an existing single-PageIndex
file-scope group, or creates a normal RAGFlow group from the built-in `page_index` template,
preserves existing groups,
binds the documents, and starts parsing. `build` is an approved, idempotent write. Poll
the read-only `status` action until `state` is `ready` (`pageIndexAvailable` is then true),
or reaches the terminal `failed`/`cancelled` state. Status is projected from RAGFlow's native
document run/progress fields and compiled PageIndex artifact; `phase`, `errorCode`, and
`errorMessage` provide a bounded interpretation without introducing a second worker state model.
`get` returns all compiled PageIndex template trees for the document; `search` accepts one to 20 explicit dataset IDs
and one to 20 explicit document IDs, tries exact/BM25 node matching first and the document embedding model as fallback,
walks ancestor paths,
and returns the navigation trace and linked chunks. Missing trees or unmatched nodes
produce an empty result and never silently fall back to ordinary retrieval.

Agent operation bindings and all-write approval are derived from the canonical
capability manifest. Harness metadata also declares Agent/provider selection,
credential resolution, discovery redaction, idempotency ownership, timeout
composition, output shape, and artifact limits; it is descriptive and grants no
permission. Public request/query/path and operation-specific response types are
generated from the Gateway OpenAPI contract. Responses are validated against
the selected operation before the Client returns them; no list-wrapper or
invoke-field guessing remains. `npm run contracts:check` prevents npm/server drift.

Uploads are read only through the owning Agent's filesystem Provider. Their
`workspaceRoot` is relative to the session cwd; path traversal, final-component
symlinks, symlink escape, and `maxFileBytes` violations are rejected. Agent
deletes accept one explicit ID and its current version. REST/Client batch
operations require explicit bounded ID lists; there is no implicit `deleteAll`.

Harness does not currently expose a workspace-safe binary streaming reader, so
Agent uploads materialize the file in memory. The plugin default and hard ceiling
are both 64 MiB, and the upload path avoids an extra full-size `Uint8Array` copy
before constructing the `Blob`. Use the business REST upload path for larger
files and raise the Gateway file, complete-request, and proxy budgets together;
the plugin never bypasses Harness fs to read a host path directly.

Authorized downloads never convert a Harness path into a host Node path. They
are persisted with session ownership in the Harness spill plane. Harness 0.2.9
exposes a text-only SpillStore, so the raw binary limit is computed before
download as `floor(artifactMaxBytes / 4) * 3`; the encoded artifact cannot exceed
`artifactMaxBytes`. Binary
downloads use an honest `.base64` text artifact fallback carrying the original
name, media type, size, and digest. Base64 content is never embedded in the
model-visible tool result. A future native binary artifact Provider can replace
this fallback without changing the Gateway Client or tool contract.

## Exports

- Package root: client, types, errors, and manifest.
- `./client`: standalone `RagFlowBusinessClient`.
- `./plugin`: Harness lifecycle entry (`name`, `inject`, `Config`, `apply`).
- `./types`: shared public types.
- `./errors`: `BusinessGatewayError`.
- `./manifest`: the canonical Business Gateway capability snapshot.
- `./service`: inert provider-neutral `RagFlowRuntime` capability seam.
- `./provider`: Business Gateway endpoint and Agent credential binding.
- `./consumer`: Agent-scoped tools, approvals, fs, and artifact integration.

## Breaking migration from 0.x

Version 1 removes `RagFlowClient`, `RagFlowApiError`, `apiKey`, `apiKeyRef`,
`apiVersion`, original-API paths, and direct-connect fallback. Replace the old
RAGFlow service URL with the dedicated Gateway service root and replace the raw
API key with a business access token (or credential reference). There is no
compatibility mode.

The full server deployment, permission, action, scope, audit, and network-boundary
guide lives in the RAGFlow repository's Business Gateway documentation.

Licensed under Apache-2.0.

## Release

Release in two explicit stages:

1. Push the development branch and the `nomix-v<version>` tag. The tag workflow
   uses the lockfile to run the Gateway contract check, typecheck, lint, tests, and build on every
   supported platform. It does not create a package or publish to npm.
2. After every tag check passes, push the same verified commit to the
   `npm-nomix-ragflow` branch. That branch run creates and audits the tarball,
   verifies installation in an independent consumer and Harness profile, then
   publishes that exact artifact to npm with provenance.

The tag and `npm-nomix-ragflow` branch must resolve to the same commit. Create the
GitHub Environment `npm-publish`, grant `@nomix-ai` publish access, and add a
fine-grained `NPM_TOKEN` with publish and 2FA-bypass permission. Never push the
publishing branch before the tag checks pass.
