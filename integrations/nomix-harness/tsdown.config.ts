import { defineConfig } from 'tsdown'

export default defineConfig({
  entry: ['src/index.ts', 'src/client.ts'],
  format: ['esm'],
  dts: true,
  sourcemap: true,
  clean: true,
  outDir: 'lib',
  outExtensions: () => ({ js: '.js', dts: '.d.ts' }),
  external: [/^@nomix-ai\//],
})
