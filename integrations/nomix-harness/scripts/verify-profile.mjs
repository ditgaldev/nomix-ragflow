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
const harnessRoot = dirname(require.resolve('@nomix-ai/nomix-harness/package.json'))
const cli = join(harnessRoot, 'dist', 'cli', 'bin.js')
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
const rowStart = dump.indexOf('- id: ragflow')
if (rowStart < 0) throw new Error('composed profile is missing the ragflow row')
const nextRow = dump.indexOf('\n- id:', rowStart + 1)
const row = dump.slice(rowStart, nextRow < 0 ? undefined : nextRow)
if (!/name:\s*['"]?@nomix-ai\/nomix-ragflow\/plugin['"]?/.test(row)) throw new Error('composed profile does not load the plugin subpath')
if (!/disabled:\s*true/.test(row)) throw new Error('bundle must install disabled until deployment configuration is supplied')

console.log('nomix plugin installed and composed the RAGFlow bundle')
