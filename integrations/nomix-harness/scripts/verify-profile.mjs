import { execFileSync } from 'node:child_process'
import { mkdtemp, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'

const [input] = process.argv.slice(2)
if (!input) throw new Error('usage: node scripts/verify-profile.mjs <tarball>')
const tarball = resolve(input)
const home = await mkdtemp(join(tmpdir(), 'nomix-ragflow-profile-'))
const packageRoot = fileURLToPath(new URL('..', import.meta.url))
const require = createRequire(join(packageRoot, 'package.json'))
const harnessManifestPath = require.resolve('@nomix-ai/nomix-harness/package.json')
const harnessRoot = dirname(harnessManifestPath)
const harnessManifest = JSON.parse(await readFile(harnessManifestPath, 'utf8'))
const cliEntry = typeof harnessManifest.bin === 'string' ? harnessManifest.bin : harnessManifest.bin?.nomix
if (typeof cliEntry !== 'string') throw new Error('installed Harness package does not expose the nomix CLI')
const cli = resolve(harnessRoot, cliEntry)
const env = { ...process.env, NOMIX_HOME: home }

execFileSync(process.execPath, [cli, 'plugin', '--profile', 'ragflow-audit', 'add', tarball], {
  cwd: packageRoot,
  env,
  stdio: 'inherit',
})

const profileDir = join(home, 'profiles', 'ragflow-audit')
const manifest = JSON.parse(await readFile(join(profileDir, 'package.json'), 'utf8'))
if (manifest.dependencies?.['@nomix-ai/nomix-ragflow'] === undefined) throw new Error('profile dependency was not installed')
if (!manifest.nomix?.profile?.bundles?.includes('@nomix-ai/nomix-ragflow')) throw new Error('installed bundle was not added to the profile layer stack')

const dump = execFileSync(process.execPath, [cli, '--profile', 'ragflow-audit', '--dump-default-config'], {
  cwd: packageRoot,
  env,
  encoding: 'utf8',
})
const rows = dump.split(/\r?\n(?=- id: )/u)
const rowFor = id => rows.find(row => row.split(/\r?\n/u, 1)[0]?.trim() === `- id: ${id}`)
const identityRow = rowFor('business-identity')
const serviceRow = rowFor('knowledge-service')
const compositionRow = rowFor('knowledge')
const providerRow = rowFor('knowledge-gateway')
if (!providerRow || !/name:\s*['"]?@nomix-ai\/nomix-ragflow\/gateway-provider['"]?/.test(providerRow)) throw new Error('composed profile must expose the replaceable Gateway provider row')
if (!/disabled:\s*true/.test(providerRow)) throw new Error('Gateway provider must be disabled until configured')
if (!identityRow) throw new Error('composed profile is missing the business-identity row')
if (!serviceRow) throw new Error('composed profile is missing the knowledge-service row')
if (!compositionRow) throw new Error('composed profile is missing the knowledge row')
if (!/name:\s*['"]?@nomix-ai\/nomix-ragflow\/business-identity['"]?/.test(identityRow)) throw new Error('composed profile does not load the business identity subpath')
if (!/name:\s*['"]?@nomix-ai\/nomix-ragflow\/service['"]?/.test(serviceRow)) throw new Error('composed profile does not load the service subpath')
if (!/name:\s*['"]?@nomix-ai\/nomix-ragflow\/plugin['"]?/.test(compositionRow)) throw new Error('composed profile does not load the plugin subpath')
if (!/disabled:\s*true/.test(compositionRow)) throw new Error('bundle must install disabled until deployment configuration is supplied')

console.log('nomix plugin installed and composed the business Knowledge Gateway bundle')
