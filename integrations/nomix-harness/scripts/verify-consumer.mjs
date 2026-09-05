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
import * as client from '@nomix-ai/nomix-ragflow'
import { RagFlowBusinessClient } from '@nomix-ai/nomix-ragflow/client'
import { BusinessGatewayError } from '@nomix-ai/nomix-ragflow/errors'
import { capabilityManifest } from '@nomix-ai/nomix-ragflow/manifest'
import { knowledgeGatewayRoutes } from '@nomix-ai/nomix-ragflow/knowledge-contract'
import knowledgeOpenAPI from '@nomix-ai/nomix-ragflow/knowledge-openapi.json' with { type: 'json' }
import * as types from '@nomix-ai/nomix-ragflow/types'
if (typeof client.RagFlowBusinessClient !== 'function' || client.default !== undefined) process.exit(2)
if (typeof RagFlowBusinessClient !== 'function' || typeof BusinessGatewayError !== 'function') process.exit(3)
if (capabilityManifest.standardVersion !== 'v1' || Object.keys(types).length !== 0) process.exit(4)
if (knowledgeGatewayRoutes.knowledgeSearch.dataSchema !== 'RetrievalResult') process.exit(13)
if (knowledgeOpenAPI.openapi !== '3.1.0' || !knowledgeOpenAPI.paths['/internal/v1/knowledge/search'].post.requestBody) process.exit(15)
`)
execFileSync(process.execPath, [join(directory, 'consumer.mjs')], { cwd: directory, stdio: 'inherit' })
await writeFile(join(directory, 'consumer.ts'), `
import { RagFlowBusinessClient, BusinessGatewayError, type Dataset, type GatewayResult } from '@nomix-ai/nomix-ragflow'
import type { BusinessGatewayCapabilityManifest } from '@nomix-ai/nomix-ragflow/manifest'
import type { RetrievalResult } from '@nomix-ai/nomix-ragflow/knowledge-contract'
const client = new RagFlowBusinessClient({ baseURL: 'http://localhost:9380', accessToken: async () => 'test-business-token' })
const values: [Promise<GatewayResult<Dataset[]>>, typeof BusinessGatewayError, BusinessGatewayCapabilityManifest['standardVersion'], RetrievalResult['traceId']] = [
  client.datasets.list(),
  BusinessGatewayError,
  'v1',
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
if (/apiKeyRef|RagFlowClient|RagFlowApiError|RAGFLOW_API_KEY|ragflow-[a-z0-9]{32,}/iu.test(runtimeText)) process.exit(7)
const pluginRuntimeText = (await Promise.all(packageFiles.filter(path => path.startsWith('lib/packages/') && path.endsWith('.js') && !path.endsWith('/tool-contracts.js')).map(path => readFile(join(installedRoot, path), 'utf8')))).join('\n')
const pluginTypesText = (await Promise.all(['lib/packages/dsh-bundle-ragflow-knowledge/plugin.d.ts', 'lib/packages/dsh-knowledge-gateway/provider.d.ts', 'lib/packages/dsh-bundle-ragflow-knowledge/consumer.d.ts'].map(path => readFile(join(installedRoot, path), 'utf8')))).join('\n')
if (/ragflow_(?:discover|retrieval|page_index|manage|transfer)|knowledge_(?:ingestion_cancel|document_retry)|Buffer\.[^(]*\([^)]*base64|encoding:\s*['"]base64|plugin\/fs|x-root-call-id|traceparent/u.test(pluginRuntimeText)) process.exit(11)
if (/\b(?:baseURL|accessTokenRef|userAssertionRef|workspaceRoot|maxFileBytes|sourcePath)\b/u.test(pluginTypesText)) process.exit(12)
const browserClientFiles = packageFiles.filter(path => /^lib\/src\/client(?:\d+)?\.js$/u.test(path))
const browserClientText = (await Promise.all(browserClientFiles.map(path => readFile(join(installedRoot, path), 'utf8')))).join('\n')
if (/\bnode:/u.test(browserClientText)) process.exit(8)
const publicTypesText = (await Promise.all(['lib/src/client.d.ts', 'lib/src/types.d.ts'].map(path => readFile(join(installedRoot, path), 'utf8')))).join('\n')
if (/\bcallSource\b/u.test(publicTypesText)) process.exit(9)
console.log(`generic and Harness consumers imported ${installed.name}@${installed.version}`)
