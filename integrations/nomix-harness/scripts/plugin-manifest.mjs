import assert from 'node:assert/strict'
import sharp from 'sharp'

export async function assertPluginManifest(manifest, readResource) {
  const harness = '@nomix-ai/nomix-harness'
  assert.equal(manifest.engines?.nomix, '0.2.12', 'Declare the verified Harness compatibility range')
  assert.equal(manifest.peerDependencies?.[harness], manifest.engines.nomix, 'Harness must be a shared peer')
  assert.equal(manifest.devDependencies?.[harness], manifest.engines.nomix, 'Harness must be available for development')
  assert.equal(manifest.dependencies?.[harness], undefined, 'Do not install a private Harness runtime dependency')
  assert.equal(manifest.optionalDependencies?.[harness], undefined, 'Harness must not be an optional runtime dependency')
  assert.ok(manifest.files?.includes('resources/'), 'Publish the display resources')
  for (const entry of ['', 'plugin/', 'gateway-provider/', 'business-identity/', 'service/']) {
    const localeExport = manifest.exports?.[`./${entry}locale/*.json`]
    assert.equal(localeExport, `./resources/${entry}locale/*.json`, `Missing locale export for ${entry || 'bundle'}`)
    for (const locale of ['en', 'zh']) {
      const resource = JSON.parse(readResource(localeExport.replace('*', locale)).toString('utf8'))
      for (const key of ['title', 'description']) {
        assert.equal(typeof resource.meta?.[key], 'string', `Missing ${locale} meta.${key}`)
        assert.ok(resource.meta[key].trim(), `Empty ${locale} meta.${key}`)
      }
    }
    assert.equal(manifest.exports?.[`./${entry}icon`], './resources/icon.svg', `Missing icon export for ${entry || 'bundle'}`)
  }
  const icon = readResource('./resources/icon.svg')
  assert.ok(icon.length > 0 && icon.length <= 256 * 1024, 'Icon must be at most 256 KiB')
  const decoder = sharp(icon, { limitInputPixels: 4096 * 4096, failOn: 'warning' })
  assert.equal((await decoder.metadata()).format, 'svg', 'Icon bytes must match the exported SVG format')
  await decoder.png().toBuffer()
}
