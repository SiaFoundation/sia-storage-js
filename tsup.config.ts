import { defineConfig } from 'tsup'

export default defineConfig([
  // Browser entry (ESM + inline types)
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
  // Node/Bun entry runtime (CJS so require() stays as plain require,
  // which lets bundlers like bun build --compile statically resolve
  // and embed the native .node addon files)
  {
    entry: ['src/index.node.ts'],
    format: ['cjs'],
    dts: false,
    sourcemap: true,
    external: [/sia-storage-.*/],
  },
  // Node/Bun entry types (generated via a DTS-only ESM pass to get
  // fully inlined declarations — tsup's CJS DTS output produces
  // broken re-exports to source paths that don't ship in the package)
  {
    entry: { 'index.node': 'src/index.node.ts' },
    format: ['esm'],
    dts: { only: true },
  },
])
