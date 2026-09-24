/**
 * A Vite plugin that serves the streaming worker at the site's root, where it
 * can control every page, in `vite dev` and in the build. It also excludes the
 * SDK from dependency pre-bundling, which breaks its WebAssembly URL.
 *
 *   import { siaStorage } from '@siafoundation/sia-storage/vite'
 *   export default defineConfig({ plugins: [siaStorage()] })
 */
import { readFileSync } from 'node:fs'

const WORKER_FILE = 'sia-storage-sw.js'

// The parts of Vite's plugin API used here, so the package needs no Vite types
// and works with any Vite version that has them.
type Middleware = (
  request: { url?: string },
  response: { setHeader(name: string, value: string): void; end(body: Uint8Array): void },
  next: () => void,
) => void
type Server = {
  config: { base: string }
  middlewares: { use(middleware: Middleware): void }
}
type Config = { build: { ssr?: boolean | string } }
type BuildContext = {
  emitFile(file: { type: 'asset'; fileName: string; source: Uint8Array }): string
}

export function siaStorage() {
  const source = () =>
    readFileSync(new URL(`./${WORKER_FILE}`, import.meta.url))
  let serverBuild = false
  return {
    name: 'sia-storage',
    config: () => ({
      optimizeDeps: { exclude: ['@siafoundation/sia-storage'] },
    }),
    configResolved(config: Config) {
      serverBuild = Boolean(config.build.ssr)
    },
    configureServer(server: Server) {
      server.middlewares.use((request, response, next) => {
        const path = request.url?.split('?')[0]
        if (path !== `${server.config.base}${WORKER_FILE}`) return next()
        response.setHeader('Content-Type', 'text/javascript')
        response.setHeader('Cache-Control', 'no-cache')
        response.end(source())
      })
    },
    generateBundle(this: BuildContext) {
      if (serverBuild) return
      this.emitFile({ type: 'asset', fileName: WORKER_FILE, source: source() })
    },
  }
}
