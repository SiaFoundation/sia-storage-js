import { defineConfig } from 'tsup'

export default defineConfig([
  {
    entry: ['src/index.ts'],
    format: ['esm'],
    dts: true,
    sourcemap: true,
    clean: true,
    // Keep WASM glue external so bundlers route assets through their own pipelines.
    external: [/\.\.\/wasm\/.*/],
  },
  {
    // CJS for static require(); types emitted by scripts/build-node-types.ts to avoid $1 dedup.
    entry: { 'index.node': 'src/index.node.ts' },
    format: ['cjs'],
    dts: false,
    sourcemap: true,
    external: [/sia-storage-.*/],
  },
])
