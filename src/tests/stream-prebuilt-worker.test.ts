// The prebuilt dist/sia-storage-sw.js, with its inlined WebAssembly and the
// real SharedSdk, against a fake indexer. Run after `bun run build`.
//
// The fake indexer knows no objects and no app keys, so each stream request
// ends in its 404. That error reaching the page proves the worker loaded the
// WebAssembly and reached the indexer through the real SDK, for a SharedSdk
// and for an app Sdk.

import { afterAll, beforeAll, expect, setDefaultTimeout, test } from 'bun:test'
import { join } from 'node:path'
import { chromium, firefox, webkit } from 'playwright'

setDefaultTimeout(60_000)

const ROOT = join(import.meta.dir, '..', '..')
const DIST = join(ROOT, 'dist')
const OBJECT_ID = '00'.repeat(32)

let site: ReturnType<typeof Bun.serve>
let indexer: ReturnType<typeof Bun.serve>
const indexerPaths: string[] = []

beforeAll(async () => {
  const cors = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': '*',
    'Access-Control-Allow-Methods': '*',
  }
  indexer = Bun.serve({
    hostname: '127.0.0.1',
    port: 0,
    fetch(request) {
      if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors })
      const { pathname } = new URL(request.url)
      indexerPaths.push(pathname)
      if (pathname === '/shared/hosts') return Response.json([], { headers: cors })
      return new Response(`the fake indexer has no ${pathname}`, { status: 404, headers: cors })
    },
  })
  site = Bun.serve({
    hostname: '127.0.0.1',
    port: 0,
    async fetch(request) {
      const { pathname } = new URL(request.url)
      if (pathname === '/') {
        return new Response('<!doctype html><title>Prebuilt worker</title>', {
          headers: { 'Content-Type': 'text/html' },
        })
      }
      // dist/index.js imports its WebAssembly glue from ../wasm/.
      const file = pathname.startsWith('/wasm/')
        ? Bun.file(join(ROOT, pathname))
        : Bun.file(join(DIST, pathname.replace(/^\/(dist\/)?/, '')))
      if (!(await file.exists())) return new Response('Not found', { status: 404 })
      return new Response(file, { headers: { 'Content-Type': 'text/javascript' } })
    },
  })
})

afterAll(async () => {
  site?.stop()
  indexer?.stop()
})

test.each([
  ['chromium', chromium],
  ['firefox', firefox],
  ['webkit', webkit],
] as const)('%s: the prebuilt worker loads its WebAssembly and reaches the indexer', async (_, engine) => {
  indexerPaths.length = 0
  const browser = await engine.launch()
  const context = await browser.newContext()
  try {
    const page = await context.newPage()
    await page.goto(`http://127.0.0.1:${site.port}/`)
    const result = await page.evaluate(
      async ({ indexerUrl, objectId }) => {
        const { enableStreaming, openStreams } = await import('/dist/index.js' as string)
        const ready = await enableStreaming()
        const sdk = {}
        const object = { id: () => objectId, size: () => 100 }
        const streams = openStreams(sdk, { indexerUrl, seed: 'ab'.repeat(32) })
        const failure = new Promise<string>((resolve) =>
          streams.url(object, { name: 'missing.bin', onError: resolve }).then(
            ({ url }: { url: string }) => fetch(url).catch(() => {}),
          ),
        )
        return {
          ready,
          worker: navigator.serviceWorker.controller?.scriptURL,
          message: await failure,
        }
      },
      { indexerUrl: `http://127.0.0.1:${indexer.port}`, objectId: OBJECT_ID },
    )
    expect(result.ready).toBe(true)
    expect(result.worker).toEndWith('/sia-storage-sw.js')
    expect(indexerPaths).toContain('/shared/hosts')
    expect(indexerPaths.some((path) => path.includes(OBJECT_ID))).toBe(true)
    expect(result.message).toContain('the fake indexer has no')
  } finally {
    await browser.close()
  }
})

test.each([
  ['chromium', chromium],
  ['firefox', firefox],
  ['webkit', webkit],
] as const)('%s: the prebuilt worker connects an app Sdk with its app key', async (_, engine) => {
  indexerPaths.length = 0
  const browser = await engine.launch()
  try {
    const page = await browser.newPage()
    await page.goto(`http://127.0.0.1:${site.port}/`)
    const message = await page.evaluate(
      async ({ indexerUrl, objectId }) => {
        const { openStreams } = await import('/dist/index.js' as string)
        const sdk = { appKey: () => ({ export: () => new Uint8Array(32).fill(7) }) }
        const object = { id: () => objectId, size: () => 100, seal: () => ({}) }
        const appMeta = {
          appId: '0'.repeat(64),
          name: 'Prebuilt worker',
          description: 'Tests',
          serviceUrl: 'https://example.test',
        }
        const streams = openStreams(sdk, { indexerUrl, appMeta })
        return new Promise<string>((resolve) =>
          streams.url(object, { name: 'app.bin', onError: resolve }).then(
            ({ url }: { url: string }) => fetch(url).catch(() => {}),
          ),
        )
      },
      { indexerUrl: `http://127.0.0.1:${indexer.port}`, objectId: OBJECT_ID },
    )
    // The fake indexer knows no app keys, so connecting fails once the SDK
    // checks the key with it.
    expect(indexerPaths).toContain('/auth/check')
    expect(message).toContain('the fake indexer has no /auth/check')
  } finally {
    await browser.close()
  }
})
