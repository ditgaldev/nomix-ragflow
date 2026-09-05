import { mkdtemp, readFile, readdir, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const [input] = process.argv.slice(2)
if (!input) throw new Error('usage: node scripts/verify-consumer.mjs <tarball>')
const tarball = resolve(input)
const directory = await mkdtemp(join(tmpdir(), 'nomix-ragflow-consumer-'))
const npm = process.platform === 'win32' ? process.execPath : 'npm'
const npmArguments = process.platform === 'win32'
  ? [process.env.npm_execpath ?? join(dirname(process.execPath), 'node_modules', 'npm', 'bin', 'npm-cli.js')]
  : []
await writeFile(join(directory, 'package.json'), JSON.stringify({ private: true, type: 'module' }))
execFileSync(npm, [...npmArguments, 'install', '--no-audit', '--no-fund', tarball], { cwd: directory, stdio: 'inherit' })
await writeFile(join(directory, 'consumer.mjs'), `
import * as root from '@nomix-ai/nomix-ragflow'
import { knowledgeGatewayCapabilityManifest } from '@nomix-ai/nomix-ragflow/manifest'
import { knowledgeGatewayRoutes } from '@nomix-ai/nomix-ragflow/knowledge-contract'
import knowledgeOpenAPI from '@nomix-ai/nomix-ragflow/knowledge-openapi.json' with { type: 'json' }
if (root.knowledgeGatewayCapabilityManifest !== knowledgeGatewayCapabilityManifest || root.default !== undefined) process.exit(2)
if (knowledgeGatewayCapabilityManifest.standardVersion !== 'v1') process.exit(4)
const { RagFlowBusinessClient } = await import('@nomix-ai/nomix-ragflow/client')
const { RagFlowApiError } = await import('@nomix-ai/nomix-ragflow/errors')
await import('@nomix-ai/nomix-ragflow/types')
if (root.RagFlowBusinessClient !== RagFlowBusinessClient || root.RagFlowApiError !== RagFlowApiError) process.exit(3)
new RagFlowBusinessClient({ baseURL: 'https://ragflow.example.com', accessToken: 'synthetic-key' })
if (knowledgeGatewayRoutes.knowledgeSearch.dataSchema !== 'RetrievalResult') process.exit(13)
if (knowledgeOpenAPI.openapi !== '3.1.0' || !knowledgeOpenAPI.paths['/internal/v1/knowledge/search'].post.requestBody) process.exit(15)
`)
execFileSync(process.execPath, [join(directory, 'consumer.mjs')], { cwd: directory, stdio: 'inherit' })
await writeFile(join(directory, 'consumer.ts'), `
import { knowledgeGatewayCapabilityManifest } from '@nomix-ai/nomix-ragflow'
import type { KnowledgeGatewayCapabilityManifest } from '@nomix-ai/nomix-ragflow/manifest'
import type { RetrievalResult } from '@nomix-ai/nomix-ragflow/knowledge-contract'
import { RagFlowBusinessClient } from '@nomix-ai/nomix-ragflow/client'
import type { RetrieveRequest, RagFlowResult } from '@nomix-ai/nomix-ragflow/types'
const client = new RagFlowBusinessClient({ baseURL: 'https://ragflow.example.com', accessToken: 'synthetic-key' })
const search = (input: RetrieveRequest): Promise<RagFlowResult<unknown>> => client.retrieval.search(input)
void search
const values: [KnowledgeGatewayCapabilityManifest['standardVersion'], RetrievalResult['traceId']] = [
  knowledgeGatewayCapabilityManifest.standardVersion,
  'trace-1',
]
void values
`)
await writeFile(join(directory, 'tsconfig.json'), JSON.stringify({
  compilerOptions: { target: 'ES2023', module: 'NodeNext', moduleResolution: 'NodeNext', strict: true, noEmit: true, skipLibCheck: true },
  include: ['consumer.ts'],
}))
const tsc = new URL('../node_modules/typescript/bin/tsc', import.meta.url)
execFileSync(process.execPath, [fileURLToPath(tsc), '-p', join(directory, 'tsconfig.json')], { cwd: directory, stdio: 'inherit' })
await writeFile(join(directory, 'plugin.mjs'), `
import * as plugin from '@nomix-ai/nomix-ragflow/plugin'
import * as provider from '@nomix-ai/nomix-ragflow/gateway-provider'
import BusinessIdentity, { BusinessIdentityRuntime } from '@nomix-ai/nomix-ragflow/business-identity'
import Service, { KnowledgeRuntime } from '@nomix-ai/nomix-ragflow/service'
if (plugin.name !== 'nomix-ragflow' || typeof plugin.apply !== 'function' || plugin.default !== undefined) process.exit(5)
if (Service !== KnowledgeRuntime) process.exit(10)
if (BusinessIdentity !== BusinessIdentityRuntime) process.exit(14)
if (typeof provider.apply !== 'function' || !provider.Config || !plugin.KNOWLEDGE_EVIDENCE_INSTRUCTIONS) process.exit(15)
if (typeof provider.KnowledgeGatewayProvider !== 'function' || provider.name !== 'nomix-knowledge-gateway-provider') process.exit(16)
`)
execFileSync(process.execPath, [join(directory, 'plugin.mjs')], { cwd: directory, stdio: 'inherit' })
const installed = JSON.parse(await readFile(join(directory, 'node_modules/@nomix-ai/nomix-ragflow/package.json'), 'utf8'))
const installedRoot = join(directory, 'node_modules/@nomix-ai/nomix-ragflow')
const packageFiles = []
async function walk(path, prefix = '') {
  for (const entry of await readdir(path, { withFileTypes: true })) {
    const relativePath = join(prefix, entry.name)
    if (entry.isDirectory()) await walk(join(path, entry.name), relativePath)
    else packageFiles.push(relativePath.replaceAll('\\', '/'))
  }
}
await walk(installedRoot)
if (packageFiles.some(path => path.endsWith('.env') || path.endsWith('.py') || path.includes('server-only'))) process.exit(6)
const runtimeFiles = packageFiles.filter(path => path.startsWith('lib/') || path === 'packages/dsh-bundle-ragflow-knowledge/cordis.patch.yml' || path === 'package.json')
const runtimeText = (await Promise.all(runtimeFiles.map(path => readFile(join(installedRoot, path), 'utf8')))).join('\n')
if (/apiKeyRef|BusinessGatewayError|ragflow-[a-z0-9]{32,}/iu.test(runtimeText)) process.exit(7)
const pluginRuntimeText = (await Promise.all(packageFiles.filter(path => path.startsWith('lib/packages/') && path.endsWith('.js') && !path.endsWith('/tool-contracts.js')).map(path => readFile(join(installedRoot, path), 'utf8')))).join('\n')
const pluginTypesText = (await Promise.all(['lib/packages/dsh-bundle-ragflow-knowledge/plugin.d.ts', 'lib/packages/dsh-knowledge-gateway/provider.d.ts', 'lib/packages/dsh-bundle-ragflow-knowledge/consumer.d.ts'].map(path => readFile(join(installedRoot, path), 'utf8')))).join('\n')
if (/RagFlowBusinessClient|RagFlowApiError|RAGFLOW_API_KEY|native-transport/u.test(pluginRuntimeText)) process.exit(7)
if (/ragflow_(?:discover|retrieval|page_index|manage|transfer)|knowledge_(?:ingestion_cancel|document_retry)|Buffer\.[^(]*\([^)]*base64|encoding:\s*['"]base64|plugin\/fs|x-root-call-id|traceparent/u.test(pluginRuntimeText)) process.exit(11)
if (/\b(?:baseURL|accessTokenRef|userAssertionRef|workspaceRoot|maxFileBytes|sourcePath)\b/u.test(pluginTypesText)) process.exit(12)
if (packageFiles.some(path => /^lib\/src\/(?:openapi\.generated|capabilities\.generated)\./u.test(path))) process.exit(8)
console.log(`generic and Harness consumers imported ${installed.name}@${installed.version}`)
