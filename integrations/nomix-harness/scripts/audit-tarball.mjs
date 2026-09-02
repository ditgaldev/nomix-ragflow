import { readFile } from 'node:fs/promises'
import { execFileSync } from 'node:child_process'

const [tarball] = process.argv.slice(2)
if (!tarball) throw new Error('usage: node scripts/audit-tarball.mjs <tarball>')
const entries = execFileSync('tar', ['-tf', tarball], { encoding: 'utf8' }).trim().split(/\r?\n/)
const required = ['package/package.json', 'package/LICENSE', 'package/README.md', 'package/README.zh.md', 'package/cordis.patch.yml', 'package/lib/index.js', 'package/lib/index.d.ts', 'package/lib/plugin.js', 'package/lib/plugin.d.ts']
for (const entry of required) if (!entries.includes(entry)) throw new Error(`tarball missing ${entry}`)
for (const entry of entries) {
  if (/\/(src|tests|node_modules)\//.test(entry) || /(^|\/)\.env($|\.)/.test(entry)) throw new Error(`forbidden tarball entry: ${entry}`)
}
const manifest = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'))
if (manifest.name !== '@nomix-ai/nomix-ragflow' || manifest.private === true) throw new Error('unexpected package identity')
const harnessPackage = '@nomix-ai/nomix-harness'
if (manifest.dependencies?.[harnessPackage] !== '^0.2.9') throw new Error('unexpected Harness dependency range')
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
