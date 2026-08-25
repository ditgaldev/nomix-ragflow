import { mkdtemp, readFile, writeFile } from 'node:fs/promises'
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
import { RagFlowClient } from '@nomix-ai/nomix-ragflow/client'
if (typeof client.RagFlowClient !== 'function' || client.default !== undefined) process.exit(2)
if (typeof RagFlowClient !== 'function') process.exit(3)
`)
execFileSync(process.execPath, [join(directory, 'consumer.mjs')], { cwd: directory, stdio: 'inherit' })
await writeFile(join(directory, 'consumer.ts'), `
import { RagFlowClient, RagFlowApiError, type Dataset } from '@nomix-ai/nomix-ragflow'
const client = new RagFlowClient({ baseURL: 'http://localhost:9380', apiKey: 'test' })
const values: [Promise<Dataset[]>, typeof RagFlowApiError] = [client.datasets.list(), RagFlowApiError]
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
if (plugin.name !== 'nomix-ragflow' || typeof plugin.apply !== 'function' || plugin.default !== undefined) process.exit(4)
`)
execFileSync(process.execPath, [join(directory, 'plugin.mjs')], { cwd: directory, stdio: 'inherit' })
const installed = JSON.parse(await readFile(join(directory, 'node_modules/@nomix-ai/nomix-ragflow/package.json'), 'utf8'))
console.log(`generic and Harness consumers imported ${installed.name}@${installed.version}`)
