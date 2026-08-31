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
execFileSync(npm, [...npmArguments, 'install', '--ignore-scripts', '--no-audit', '--no-fund', tarball], { cwd: directory, stdio: 'inherit' })
await writeFile(join(directory, 'consumer.mjs'), `
import * as client from '@nomix-ai/nomix-ragflow'
import { RagFlowBusinessClient } from '@nomix-ai/nomix-ragflow/client'
import { BusinessGatewayError } from '@nomix-ai/nomix-ragflow/errors'
import { capabilityManifest } from '@nomix-ai/nomix-ragflow/manifest'
import * as types from '@nomix-ai/nomix-ragflow/types'
if (typeof client.RagFlowBusinessClient !== 'function' || client.default !== undefined) process.exit(2)
if (typeof RagFlowBusinessClient !== 'function' || typeof BusinessGatewayError !== 'function') process.exit(3)
if (capabilityManifest.standardVersion !== 'v1' || Object.keys(types).length !== 0) process.exit(4)
`)
execFileSync(process.execPath, [join(directory, 'consumer.mjs')], { cwd: directory, stdio: 'inherit' })
await writeFile(join(directory, 'consumer.ts'), `
import { RagFlowBusinessClient, BusinessGatewayError, type Dataset, type GatewayResult } from '@nomix-ai/nomix-ragflow'
import type { BusinessGatewayCapabilityManifest } from '@nomix-ai/nomix-ragflow/manifest'
const client = new RagFlowBusinessClient({ baseURL: 'http://localhost:9380', accessToken: async () => 'test-business-token' })
const values: [Promise<GatewayResult<Dataset[]>>, typeof BusinessGatewayError, BusinessGatewayCapabilityManifest['standardVersion']] = [
  client.datasets.list(),
  BusinessGatewayError,
  'v1',
]
void values
`)
await writeFile(join(directory, 'tsconfig.json'), JSON.stringify({
  compilerOptions: { target: 'ES2023', module: 'NodeNext', moduleResolution: 'NodeNext', strict: true, noEmit: true, skipLibCheck: true },
  include: ['consumer.ts'],
}))
const tsc = new URL('../node_modules/typescript/bin/tsc', import.meta.url)
execFileSync(process.execPath, [fileURLToPath(tsc), '-p', join(directory, 'tsconfig.json')], { cwd: directory, stdio: 'inherit' })
execFileSync(npm, [...npmArguments, 'install', '--ignore-scripts', '--no-audit', '--no-fund', '@nomix-ai/nomix-harness@0.2.5'], { cwd: directory, stdio: 'inherit' })
execFileSync(process.execPath, [fileURLToPath(new URL('./link-harness-kernel.mjs', import.meta.url)), directory], { cwd: directory, stdio: 'inherit' })
await writeFile(join(directory, 'plugin.mjs'), `
import * as plugin from '@nomix-ai/nomix-ragflow/plugin'
import Service, { RagFlowRuntime } from '@nomix-ai/nomix-ragflow/service'
import * as provider from '@nomix-ai/nomix-ragflow/provider'
import * as consumer from '@nomix-ai/nomix-ragflow/consumer'
if (plugin.name !== 'nomix-ragflow' || typeof plugin.apply !== 'function' || plugin.default !== undefined) process.exit(5)
if (Service !== RagFlowRuntime || typeof provider.BusinessGatewayRagFlowProvider !== 'function' || typeof consumer.applyRagFlowConsumer !== 'function') process.exit(10)
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
const runtimeFiles = packageFiles.filter(path => path.startsWith('lib/') || path === 'cordis.patch.yml' || path === 'package.json')
const runtimeText = (await Promise.all(runtimeFiles.map(path => readFile(join(installedRoot, path), 'utf8')))).join('\n')
if (/apiKeyRef|RagFlowClient|RagFlowApiError|RAGFLOW_API_KEY|ragflow-[a-z0-9]{32,}/iu.test(runtimeText)) process.exit(7)
const browserClientFiles = packageFiles.filter(path => /^lib\/client(?:\d+)?\.js$/u.test(path))
const browserClientText = (await Promise.all(browserClientFiles.map(path => readFile(join(installedRoot, path), 'utf8')))).join('\n')
if (/\bnode:/u.test(browserClientText)) process.exit(8)
const publicTypesText = (await Promise.all(['lib/client.d.ts', 'lib/types.d.ts'].map(path => readFile(join(installedRoot, path), 'utf8')))).join('\n')
if (/\bcallSource\b/u.test(publicTypesText)) process.exit(9)
console.log(`generic and Harness consumers imported ${installed.name}@${installed.version}`)
