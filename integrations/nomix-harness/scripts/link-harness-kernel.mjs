import { lstat, mkdir, readFile, realpath, symlink } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'

const packageRoot = resolve(process.argv[2] ?? fileURLToPath(new URL('..', import.meta.url)))
const require = createRequire(join(packageRoot, 'package.json'))
const harnessManifest = require.resolve('@nomix-ai/nomix-harness/package.json')
const harnessRoot = dirname(harnessManifest)
const kernelRoot = join(harnessRoot, 'dist', 'kernel')
const manifest = JSON.parse(await readFile(join(kernelRoot, 'manifest.json'), 'utf8'))

for (const [packageName, relativeTarget] of Object.entries(manifest)) {
  if (typeof relativeTarget !== 'string' || !packageName.startsWith('@nomix-ai/')) {
    throw new Error(`invalid Harness kernel manifest entry: ${packageName}`)
  }
  const target = resolve(kernelRoot, relativeTarget)
  const destination = join(packageRoot, 'node_modules', ...packageName.split('/'))
  await mkdir(dirname(destination), { recursive: true })
  const existing = await lstat(destination).catch(error => {
    if (error.code === 'ENOENT') return undefined
    throw error
  })
  if (existing !== undefined) {
    const [actual, expected] = await Promise.all([realpath(destination), realpath(target)])
    if (actual !== expected) throw new Error(`${packageName} already resolves outside the installed Harness kernel: ${actual}`)
    continue
  }
  await symlink(target, destination, process.platform === 'win32' ? 'junction' : 'dir')
}

console.log(`linked ${Object.keys(manifest).length} Harness kernel packages for ${packageRoot}`)
