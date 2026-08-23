import { mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const [input] = process.argv.slice(2)
if (!input) throw new Error('usage: node scripts/verify-consumer.mjs <tarball>')
const tarball = resolve(input)
const directory = await mkdtemp(join(tmpdir(), 'nomix-ragflow-consumer-'))
await writeFile(join(directory, 'package.json'), JSON.stringify({ private: true, type: 'module' }))
execFileSync('npm', ['install', '--ignore-scripts', '--no-audit', '--no-fund', tarball], { cwd: directory, stdio: 'inherit' })
await writeFile(join(directory, 'consumer.mjs'), `
import * as plugin from '@nomix-ai/nomix-ragflow'
import { RagFlowClient } from '@nomix-ai/nomix-ragflow/client'
if (plugin.name !== 'nomix-ragflow' || typeof plugin.apply !== 'function' || plugin.default !== undefined) process.exit(2)
if (typeof RagFlowClient !== 'function') process.exit(3)
`)
execFileSync(process.execPath, [join(directory, 'consumer.mjs')], { cwd: directory, stdio: 'inherit' })
await writeFile(join(directory, 'consumer.ts'), `
import { Config, RagFlowClient, apply, inject, name, type Dataset } from '@nomix-ai/nomix-ragflow'
import { RagFlowApiError } from '@nomix-ai/nomix-ragflow/client'
const client = new RagFlowClient({ baseURL: 'http://localhost:9380', apiKey: 'test' })
const values: [string, readonly string[], typeof Config, typeof apply, Promise<Dataset[]>, typeof RagFlowApiError] = [name, inject, Config, apply, client.datasets.list(), RagFlowApiError]
void values
`)
await writeFile(join(directory, 'tsconfig.json'), JSON.stringify({
  compilerOptions: { target: 'ES2023', module: 'NodeNext', moduleResolution: 'NodeNext', strict: true, noEmit: true, skipLibCheck: true },
  include: ['consumer.ts'],
}))
const tsc = new URL('../node_modules/typescript/bin/tsc', import.meta.url)
execFileSync(process.execPath, [fileURLToPath(tsc), '-p', join(directory, 'tsconfig.json')], { cwd: directory, stdio: 'inherit' })
const installed = JSON.parse(await readFile(join(directory, 'node_modules/@nomix-ai/nomix-ragflow/package.json'), 'utf8'))
console.log(`consumer imported ${installed.name}@${installed.version}`)
