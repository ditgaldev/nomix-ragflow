import { defineConfig } from 'tsdown'

export default defineConfig({
  entry: ['src/index.ts', 'src/client.ts', 'src/plugin.ts'],
  format: ['esm'],
  dts: true,
  sourcemap: true,
  clean: true,
  hash: false,
  outDir: 'lib',
  outExtensions: () => ({ js: '.js', dts: '.d.ts' }),
  external: [/^@nomix-ai\//],
})
