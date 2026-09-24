import { readFileSync } from 'node:fs'
import { defineConfig } from 'tsup'

// The prebuilt service worker, dist/sia-storage-sw.js. It builds before
// tsup.config.ts, which embeds it in the Next.js route, and cleans dist/ first.
export default defineConfig({
  entry: { 'sia-storage-sw': 'src/sw.ts' },
  // A classic script, since not every browser runs module service workers.
  format: ['iife'],
  platform: 'browser',
  target: 'es2022',
  clean: true,
  minify: true,
  noExternal: [/.*/],
  outExtension: () => ({ js: '.js' }),
  // The glue's default WebAssembly URL. Never fetched, since the bytes are
  // passed in, but a classic script has no import.meta to read it from.
  define: { 'import.meta.url': 'self.location.href' },
  esbuildPlugins: [
    {
      name: 'sia-storage-wasm',
      setup(build) {
        build.onResolve({ filter: /^virtual:sia-storage-wasm$/ }, () => ({
          path: 'wasm',
          namespace: 'sia-storage-wasm',
        }))
        build.onLoad({ filter: /.*/, namespace: 'sia-storage-wasm' }, () => ({
          contents: readFileSync('wasm/sia_storage_wasm_bg.wasm'),
          loader: 'binary',
        }))
      },
    },
  ],
})
