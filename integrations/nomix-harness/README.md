# @nomix-ai/nomix-ragflow

Typed RAGFlow REST client and Nomix Harness plugin. The package connects to an
existing RAGFlow deployment; it does not bundle or start RAGFlow.

## Install

```bash
npm install @nomix-ai/nomix-ragflow
```

The package targets Node.js `^22.19 || >=24`. The plugin entry targets Nomix
Harness `^0.2.5` and resolves Cordis, Schemastery, and other plugin-runtime
modules from the Harness embedded kernel instead of installing private copies.

## TypeScript client

```ts
import { RagFlowClient } from '@nomix-ai/nomix-ragflow'

const ragflow = new RagFlowClient({
  baseURL: 'https://ragflow.example.com',
  apiKey: process.env.RAGFLOW_API_KEY!,
})

const datasets = await ragflow.datasets.list({ page: 1, pageSize: 20 })
const result = await ragflow.retrieval.search({
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
    apiKeyRef: RAGFLOW_API_KEY
    workspaceRoot: .
    maxFileBytes: 536870912
```

Store `RAGFLOW_API_KEY` through the Harness credential provider. The plugin
resolves `apiKeyRef` for every REST request, so credential rotation takes effect
without restarting the plugin and the secret never enters Cordis configuration.

The plugin connects directly to RAGFlow's REST API. It publishes
`ragflow_retrieval` plus eight action-based management tools for datasets,
documents, transfers, chunks, chats, sessions, agents, and memories. Retrieval
searches selected datasets or, when `datasetIds` is omitted, all datasets
accessible to the configured key. Cordis replaces a row's complete `config`
object, so repeat the other values you need when applying a later override.

Delete, bulk delete, `deleteAll`, memory forget, and parse cancellation actions
return a one-time Harness approval request before the REST call. If approval is
unavailable, denied, cancelled, or disabled by policy, the call fails closed.
Direct application calls to `RagFlowClient` do not pass through model approval.

Document uploads accept only paths contained by `workspaceRoot`, reject
symlinks, enforce `maxFileBytes`, and read bytes through the Harness filesystem
policy before sending them over REST. Download-to-workspace is intentionally not
exposed until Harness provides a sandbox-aware binary write capability.

## Exports

The package root and `@nomix-ai/nomix-ragflow/client` export the standalone
REST client without requiring Harness. The Cordis Loader uses
`@nomix-ai/nomix-ragflow/plugin`, whose named exports are `name`, `inject`,
`Config`, and `apply`; it has no default export. This plugin entry must run
inside Harness so its external `@nomix-ai/*` imports resolve from the embedded
kernel.

Licensed under Apache-2.0.

## Release

Create the GitHub Environment `npm-publish`, grant `@nomix-ai` publish access
to this package, and add a fine-grained `NPM_TOKEN` secret with publish and
2FA-bypass permission. Push the release commit to `npm-nomix-ragflow`; the
workflow reads the version from `package.json`, verifies Linux, Windows, and
macOS, and then publishes the Linux artifact. Pull requests and `nomix-v*`
tags run the same verification without publishing. Existing npm versions are
rejected and publication uses npm provenance.
