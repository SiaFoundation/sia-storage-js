import { readFileSync } from 'node:fs'
import { defineConfig } from 'tsup'

export default defineConfig([
  {
    entry: ['src/index.ts', 'src/stream-worker.ts'],
    format: ['esm'],
    dts: true,
    sourcemap: true,
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
  {
    // Build tools that serve the prebuilt worker, which tsup.worker.config.ts
    // has already written to dist/.
    entry: ['src/vite.ts', 'src/next.ts'],
    format: ['esm'],
    platform: 'node',
    dts: true,
    esbuildPlugins: [
      {
        name: 'sia-storage-sw',
        setup(build) {
          build.onResolve({ filter: /^virtual:sia-storage-sw$/ }, () => ({
            path: 'sw',
            namespace: 'sia-storage-sw',
          }))
          build.onLoad({ filter: /.*/, namespace: 'sia-storage-sw' }, () => ({
            contents: readFileSync('dist/sia-storage-sw.js', 'utf-8'),
            loader: 'text',
          }))
        },
      },
    ],
  },
  {
    entry: ['src/cli.ts'],
    format: ['esm'],
    platform: 'node',
    banner: { js: '#!/usr/bin/env node' },
  },
])
