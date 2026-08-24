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
console.log(`audited ${entries.length} entries in ${tarball}`)
