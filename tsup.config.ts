import { defineConfig } from 'tsup'

export default defineConfig({
  entry: ['src/index.ts', 'src/index.node.ts'],
  format: ['esm'],
  dts: true,
  sourcemap: true,
  clean: true,
  external: ['sia-wasm'],
})
