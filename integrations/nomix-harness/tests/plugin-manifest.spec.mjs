import { readFileSync, readdirSync } from 'node:fs'
import { evaluatePluginCompatibility } from '@nomix-ai/nomix-harness/plugin/app-boot'
import { describe, expect, it } from 'vitest'
import sharp from 'sharp'
import { assertPluginManifest } from '../scripts/plugin-manifest.mjs'

const root = new URL('../', import.meta.url)
const readResource = path => readFileSync(new URL(path, root))
const manifest = JSON.parse(readResource('package.json'))
const harness = '@nomix-ai/nomix-harness'

describe('Harness plugin distribution requirements', () => {
  it('accepts the source manifest and all localized bundle and subpath resources', async () => {
    await expect(assertPluginManifest(manifest, readResource)).resolves.toBeUndefined()
  })

  it('accepts only the verified host release through the real Harness compatibility gate', () => {
    expect(evaluatePluginCompatibility(manifest, {}, '0.2.12')).toBeUndefined()
    for (const version of ['0.1.0', '0.2.11', '0.2.13', '9.0.0']) {
      expect(evaluatePluginCompatibility(manifest, {}, version)?.requirements).toEqual({ 'engines.nomix': '0.2.12' })
    }
  })

  it.each(['engines', 'peerDependencies', 'devDependencies'])('rejects missing %s', async field => {
    const invalid = structuredClone(manifest)
    delete invalid[field]
    await expect(assertPluginManifest(invalid, readResource)).rejects.toThrow()
  })

  it('rejects the old private-runtime dependency and missing distribution resources', async () => {
    await expect(assertPluginManifest({ ...manifest, dependencies: { [harness]: '0.2.12' } }, readResource)).rejects.toThrow('private Harness')
    await expect(assertPluginManifest({ ...manifest, files: [] }, readResource)).rejects.toThrow('display resources')
    await expect(assertPluginManifest(manifest, path => {
      if (path.endsWith('zh.json')) throw new Error('missing packed locale')
      return readResource(path)
    })).rejects.toThrow('missing packed locale')
  })

  it.each(['', 'plugin/', 'gateway-provider/', 'business-identity/', 'service/'])('rejects missing display exports for %s', async entry => {
    for (const suffix of ['icon', 'locale/*.json']) {
      const invalid = structuredClone(manifest)
      delete invalid.exports[`./${entry}${suffix}`]
      await expect(assertPluginManifest(invalid, readResource)).rejects.toThrow()
    }
  })

  it('rejects empty metadata and invalid or oversized icons', async () => {
    await expect(assertPluginManifest(manifest, path => path.endsWith('.json') ? Buffer.from('{"meta":{"title":"","description":"x"}}') : readResource(path))).rejects.toThrow('Empty')
    for (const icon of [Buffer.from('not an image'), Buffer.alloc(256 * 1024 + 1)]) {
      await expect(assertPluginManifest(manifest, path => path.endsWith('.svg') ? icon : readResource(path))).rejects.toThrow()
    }
  })

  it.each([
    '<svg xmlns="http://www.w3.org/2000/svg"><g></svg>',
    '<svg xmlns="http://www.w3.org/2000/svg" width="0" height="0"></svg>',
    '<svg xmlns="http://www.w3.org/2000/svg" width="100000" height="100000"></svg>',
  ])('rejects malformed or unrasterizable SVG: %s', async svg => {
    await expect(assertPluginManifest(manifest, path => path.endsWith('.svg') ? Buffer.from(svg) : readResource(path))).rejects.toThrow()
  })

  it('rejects a decodable PNG disguised as the exported SVG', async () => {
    const png = await sharp({ create: { width: 1, height: 1, channels: 4, background: '#155e75' } }).png().toBuffer()
    await expect(assertPluginManifest(manifest, path => path.endsWith('.svg') ? png : readResource(path))).rejects.toThrow('SVG format')
  })

  it('shares Harness in every workspace and keeps the lockfile aligned', () => {
    const lock = JSON.parse(readResource('package-lock.json'))
    for (const directory of ['', ...readdirSync(new URL('packages/', root)).map(name => `packages/${name}/`)]) {
      const pkg = JSON.parse(readResource(`${directory}package.json`))
      expect(pkg.dependencies?.[harness]).toBeUndefined()
      expect(pkg.peerDependencies[harness]).toBe('0.2.12')
      expect(pkg.devDependencies[harness]).toBe('0.2.12')
      const locked = lock.packages[directory.replace(/\/$/u, '')]
      expect(locked.peerDependencies[harness]).toBe(pkg.peerDependencies[harness])
      expect(locked.devDependencies[harness]).toBe(pkg.devDependencies[harness])
      expect(locked.dependencies?.[harness]).toBeUndefined()
    }
  })

  it('reads the development Harness pin in the plugin release workflow', () => {
    const workflow = readResource('../../.github/workflows/release-nomix-plugin.yml').toString('utf8')
    expect(workflow).toContain("require('./package.json').devDependencies['$package']")
    expect(workflow).not.toContain("require('./package.json').dependencies['$package']")
  })
})
