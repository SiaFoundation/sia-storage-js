import { defineConfig } from 'tsup'

export default defineConfig([
  // Browser entry (ESM + inline types).
  {
    entry: ['src/index.ts'],
    format: ['esm'],
    dts: true,
    sourcemap: true,
    clean: true,
    // Keep the WASM glue as an external import so consuming bundlers
    // (Vite, Next.js, webpack) route the .wasm asset through their own
    // pipelines. tsup emits the import statement unchanged.
    external: [/\.\.\/wasm\/.*/],
  },
  // Node/Bun entry runtime (CJS so static require() stays inline for
  // bundlers like bun build --compile that embed the matching .node
  // file). Types for this entry are emitted by scripts/build-node-types.ts
  // straight from the napi-rs generated d.ts — bundling them through
  // tsup would dedupe class names with $1 suffixes.
  {
    entry: { 'index.node': 'src/index.node.ts' },
    format: ['cjs'],
    dts: false,
    sourcemap: true,
    external: [/sia-storage-.*/],
  },
])
