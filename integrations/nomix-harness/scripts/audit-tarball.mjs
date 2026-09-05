import { readFile } from 'node:fs/promises'
import { execFileSync } from 'node:child_process'

const [tarball] = process.argv.slice(2)
if (!tarball) throw new Error('usage: node scripts/audit-tarball.mjs <tarball>')
const entries = execFileSync('tar', ['-tf', tarball], { encoding: 'utf8' }).trim().split(/\r?\n/)
const required = [
  'package/package.json',
  'package/LICENSE',
  'package/README.md',
  'package/README.zh.md',
  'package/contracts/ALIGNMENT.md',
  'package/contracts/GATEWAY-INTEGRATION.md',
  'package/packages/dsh-bundle-ragflow-knowledge/cordis.patch.yml',
  'package/contracts/knowledge-gateway.openapi.json',
  'package/lib/src/index.js',
  'package/lib/src/index.d.ts',
  'package/lib/packages/dsh-bundle-ragflow-knowledge/plugin.js',
  'package/lib/packages/dsh-bundle-ragflow-knowledge/plugin.d.ts',
  'package/lib/packages/dsh-knowledge-gateway/provider.js',
  'package/lib/packages/dsh-knowledge-gateway/provider.d.ts',
  'package/lib/packages/dsh-business-identity/business-identity.js',
  'package/lib/packages/dsh-business-identity/business-identity.d.ts',
  'package/lib/packages/dsh-knowledge/knowledge-openapi.generated.js',
  'package/lib/packages/dsh-knowledge/knowledge-openapi.generated.d.ts',
  'package/lib/packages/dsh-knowledge/knowledge-tool-schemas.generated.js',
]
for (const entry of required) if (!entries.includes(entry)) throw new Error(`tarball missing ${entry}`)
for (const entry of entries) {
  if (/(?:\.ts$)/u.test(entry) && !entry.endsWith('.d.ts')) throw new Error(`source included in tarball: ${entry}`)
  if (/\/(tests|node_modules)\//.test(entry) || /(^|\/)\.env($|\.)/.test(entry)) throw new Error(`forbidden tarball entry: ${entry}`)
}
const manifest = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'))
if (manifest.name !== '@nomix-ai/nomix-ragflow' || manifest.private === true) throw new Error('unexpected package identity')
const harnessPackage = '@nomix-ai/nomix-harness'
if (manifest.dependencies?.[harnessPackage] !== '0.2.9') throw new Error('Harness must be pinned to exactly 0.2.9')
const forbiddenExports = ['./knowledge-client', './knowledge-errors', './knowledge-types', './provider', './consumer', './policy', './tools']
for (const path of forbiddenExports) if (manifest.exports?.[path]) throw new Error(`internal plugin layer must not be exported: ${path}`)
for (const field of ['dependencies', 'devDependencies', 'optionalDependencies', 'peerDependencies']) {
  for (const packageName of Object.keys(manifest[field] ?? {})) {
    if (packageName === harnessPackage && field !== 'dependencies') {
      throw new Error(`Harness must be declared once in dependencies, not ${field}`)
    }
    if (packageName.startsWith('@nomix-ai/') && packageName !== harnessPackage) {
      throw new Error(`${packageName} must be imported through the Harness plugin API, not ${field}`)
    }
  }
}
const runtimeText = entries
  .filter(entry => /^package\/lib\/.*\.(?:d\.ts|js)$/u.test(entry))
  .map(entry => execFileSync('tar', ['-xOf', tarball, entry], { encoding: 'utf8' }))
  .join('\n')
const nomixImports = [...runtimeText.matchAll(/(?:from\s+|import\s*\()['"](@nomix-ai\/[^'"]+)['"]/gu)]
  .map(match => match[1])
for (const specifier of new Set(nomixImports)) {
  if (specifier !== `${harnessPackage}/plugin` && !specifier.startsWith(`${harnessPackage}/plugin/`)) {
    throw new Error(`published runtime bypasses the Harness plugin API: ${specifier}`)
  }
}
console.log(`audited ${entries.length} entries in ${tarball}`)
