# @nomix-ai/nomix-ragflow

Typed RAGFlow REST client and Nomix Harness plugin. The package connects to an
existing RAGFlow deployment; it does not bundle or start RAGFlow.

## Install

```bash
npm install @nomix-ai/nomix-ragflow
```

The package targets Node.js `^22.19 || >=24` and Nomix Harness `0.2.x`; the
release contract is tested against Harness `0.2.4`.

## TypeScript client

```ts
import { RagFlowClient } from '@nomix-ai/nomix-ragflow'

const ragflow = new RagFlowClient({
  baseURL: 'https://ragflow.example.com',
  apiKey: process.env.RAGFLOW_API_KEY!,
})

const datasets = await ragflow.datasets.list({ page: 1, pageSize: 20 })
const chunks = await ragflow.retrieval.search({
  datasetIds: [datasets[0].id],
  question: 'What changed in the latest release?',
})
```

Every REST method accepts `{ signal }`. Non-zero RAGFlow envelopes and HTTP
failures throw `RagFlowApiError`; credentials are never included in error text.

## Nomix Harness profile

Install the bundle into the profile that owns your Harness configuration:

```bash
nomix plugin --profile my-profile add @nomix-ai/nomix-ragflow
```

The bundle inserts a disabled `ragflow` Cordis row because deployment credentials
cannot be guessed. Enable and configure it in that profile's own
`cordis.patch.yml` (profile patches are applied after bundle patches):

```yaml
- id: ragflow
  disabled: false
  config:
    baseURL: https://ragflow.example.com
    serverName: ragflow
    workspaceRoot: .
    maxFileBytes: 536870912
```

Set `RAGFLOW_API_KEY` in the Harness launch environment. `apiKey` may instead be
set explicitly in the plugin config, but environment injection is preferred.

RAGFlow's MCP endpoint is a separate service and is not inferred from
`baseURL`. Configure it explicitly to enable the three dynamic retrieval tools:

```yaml
- id: ragflow
  disabled: false
  config:
    baseURL: https://ragflow.example.com
    mcpURL: http://ragflow-mcp.internal:9382/mcp
    serverName: ragflow
```

Omit `mcpURL` to load only the eight REST management tools. Cordis replaces a
row's complete `config` object, so repeat the other values you need when
applying a later override.

The MCP bridge publishes RAGFlow's dynamic retrieval, dataset-listing, and
chat-listing tools under Harness-qualified names:
`mcp__ragflow__ragflow_retrieval`, `mcp__ragflow__ragflow_list_datasets`, and
`mcp__ragflow__ragflow_list_chats` when `serverName` is `ragflow`. This plugin
additionally publishes eight action-based management tools for datasets,
documents, transfers, chunks, chats, sessions, agents, and memories.

Delete, bulk delete, `deleteAll`, memory forget, and parse cancellation actions
return a one-time Harness approval request before the REST call. If approval is
unavailable, denied, cancelled, or disabled by policy, the call fails closed.
Direct application calls to `RagFlowClient` do not pass through model approval.

Document transfers accept only paths contained by `workspaceRoot`, reject
symlinks and existing download targets, enforce `maxFileBytes`, and stream bytes
over REST instead of MCP/Base64. A remote filesystem that cannot expose a local
host path reports local transfer as unsupported.

## Exports

The package root and `@nomix-ai/nomix-ragflow/client` export the standalone
REST client without loading Harness internals. The Cordis Loader uses
`@nomix-ai/nomix-ragflow/plugin`, whose named exports are `name`, `inject`,
`Config`, and `apply`; it has no default export.

Licensed under Apache-2.0.

## Release

Create the GitHub Environment `npm-publish`, grant `@nomix-ai` publish access
to this package, and add a fine-grained `NPM_TOKEN` secret with publish and
2FA-bypass permission. A tag such as `nomix-ragflow-v0.1.1` runs the isolated
release workflow; its version must exactly match `package.json`. Existing npm
versions are rejected and publication uses npm provenance.
