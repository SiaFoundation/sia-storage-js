// Streaming through the service worker, in Chromium, Firefox and WebKit. The
// page runs the public stream API and the worker runs the library's real worker
// code, with only the SDK replaced by a stand-in (fixtures/stream/), so no test
// touches the network.

import { afterAll, beforeAll, describe, expect, setDefaultTimeout, test } from 'bun:test'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  type Browser,
  type BrowserContext,
  type BrowserContextOptions,
  chromium,
  firefox,
  type Page,
  webkit,
} from 'playwright'
import type * as Bridge from './fixtures/stream/bridge'

setDefaultTimeout(60_000)

const HUGE_SIZE = 5 * 1024 ** 3 + 123
const FIXTURES = join(import.meta.dir, 'fixtures', 'stream')
const WASM = join(import.meta.dir, '..', '..', 'wasm', 'sia_storage_wasm_bg.wasm')

let browser: Browser
let server: ReturnType<typeof Bun.serve>
let origin: string
let downloads: string

beforeAll(async () => {
  const [bridge, worker] = await Promise.all(
    ['bridge.ts', 'worker.ts'].map((file) =>
      Bun.build({ entrypoints: [join(FIXTURES, file)], target: 'browser' }),
    ),
  )
  if (!bridge!.success || !worker!.success) {
    throw new AggregateError([...bridge!.logs, ...worker!.logs], 'Fixture build failed')
  }
  const bridgeCode = await bridge!.outputs[0]!.text()
  const workerCode = await worker!.outputs[0]!.text()
  const script = (code: string) =>
    new Response(code, {
      headers: { 'Content-Type': 'text/javascript', 'Cache-Control': 'no-store' },
    })
  server = Bun.serve({
    hostname: '127.0.0.1',
    port: 0,
    fetch(request) {
      const path = new URL(request.url).pathname
      if (path === '/bridge.js') return script(bridgeCode)
      if (path === '/sia_storage_wasm_bg.wasm') {
        return new Response(Bun.file(WASM), {
          headers: { 'Content-Type': 'application/wasm' },
        })
      }
      // Served at the root and under /app/, a site served from a sub-path.
      if (path === '/test-worker.js' || path === '/app/test-worker.js') {
        return script(workerCode)
      }
      if (path === '/' || path === '/app/') {
        return new Response('<!doctype html><title>Streaming fixture</title>', {
          headers: { 'Content-Type': 'text/html' },
        })
      }
      return new Response('Not found', { status: 404 })
    },
  })
  origin = `http://127.0.0.1:${server.port}`
  downloads = mkdtempSync(join(tmpdir(), 'sia-stream-downloads-'))
})

afterAll(async () => {
  server?.stop()
  if (downloads) rmSync(downloads, { recursive: true, force: true })
})

async function withPage(
  run: (page: Page, context: BrowserContext) => Promise<void>,
  options: BrowserContextOptions = {},
) {
  const context = await browser.newContext({ acceptDownloads: true, ...options })
  try {
    await run(await context.newPage(), context)
  } finally {
    await context.close()
  }
}

type Kind = 'shared' | 'app'

/**
 * Loads the harness at `path` with the worker served beside it. `wasm` starts
 * the SDK's WebAssembly on the page first.
 */
async function setup(page: Page, path = '/', kind: Kind = 'shared', wasm = false) {
  await page.goto(origin + path)
  return start(page, path, kind, wasm)
}

/** Starts the harness on the page as it is, without navigating. */
function start(page: Page, path = '/', kind: Kind = 'shared', wasm = false) {
  return page.evaluate(
    async ({ workerUrl, kind, wasm }) => {
      const bridge = (await import('/bridge.js' as string)) as typeof Bridge
      window.streamTest = await bridge.setup(workerUrl, kind, { wasm })
      return window.streamTest.ready
    },
    { workerUrl: `${path}test-worker.js`, kind, wasm },
  )
}

async function create(
  page: Page,
  size = HUGE_SIZE,
  name = 'generated.bin',
  options: { wav?: boolean; logged?: boolean } = {},
) {
  const { url, fromPage } = await page.evaluate(
    ({ size, name, options }) => window.streamTest.create(size, name, options),
    { size, name, options },
  )
  expect(fromPage).toBe(false)
  return url
}

const stats = (page: Page) => page.evaluate(() => window.streamTest.stats())
const pageDownloads = (page: Page) =>
  page.evaluate(() => window.streamTest.pageDownloads())
const errors = (page: Page) => page.evaluate(() => window.streamTest.errors)

/** Reads until `done` holds, or throws with the last value after `timeout`. */
async function until<T>(
  read: () => Promise<T>,
  done: (value: T) => boolean,
  timeout = 15_000,
) {
  const deadline = Date.now() + timeout
  let value = await read()
  while (!done(value)) {
    if (Date.now() > deadline) {
      throw new Error(`Timed out waiting, last value ${JSON.stringify(value)}`)
    }
    await Bun.sleep(100)
    value = await read()
  }
  return value
}

const readAll = (page: Page, url: string) =>
  page.evaluate(
    async (url) =>
      Array.from(new Uint8Array(await (await fetch(url)).arrayBuffer())),
    url,
  )

// The fixture SDK's default chunk, and what it reports one shard read for.
const CHUNK = 64 * 1024

const tracked = (page: Page) => page.evaluate(() => window.streamTest.tracked())

/** A URL whose status, progress and shard callbacks record into `tracked`. */
const createTracked = (page: Page, size: number) =>
  page.evaluate(
    async (size) => (await window.streamTest.create(size, 'tracked.bin', { tracked: true })).url,
    size,
  )

/** Reads the whole URL and returns how long it took, in milliseconds. */
async function timedRead(page: Page, url: string, size: number) {
  const { length, ms } = await page.evaluate(async (url) => {
    const start = performance.now()
    const bytes = await (await fetch(url)).arrayBuffer()
    return { length: bytes.byteLength, ms: performance.now() - start }
  }, url)
  expect(length).toBe(size)
  return ms
}

const pattern = (length: number, offset = 0) =>
  Array.from({ length }, (_, i) => (offset + i) % 251)

async function clickToSave(
  page: Page,
  size: number,
  name: string,
  { tracked = false } = {},
) {
  await page.evaluate(
    ({ size, name, tracked }) => {
      const button = document.createElement('button')
      button.textContent = 'Save'
      button.onclick = () => void window.streamTest.save(size, name, { tracked })
      document.body.append(button)
    },
    { size, name, tracked },
  )
  await page.getByRole('button').click()
}

const ENGINES = [
  ['chromium', chromium],
  ['firefox', firefox],
  ['webkit', webkit],
] as const

for (const [browserName, engine] of ENGINES) {
  describe(browserName, () => {
    beforeAll(async () => {
      browser = await engine.launch()
    })

    afterAll(async () => {
      await browser?.close()
    })

    test('first visit gains worker control without reload or page downloads', () =>
      withPage(async (page) => {
        let navigations = 0
        page.on('framenavigated', (frame) => {
          if (frame === page.mainFrame()) navigations++
        })
        expect(await setup(page)).toBe(true)
        expect(
          await page.evaluate(() => navigator.serviceWorker.controller?.scriptURL),
        ).toContain('/test-worker.js')
        expect(navigations).toBe(1)
        const url = await create(page, 17)
        expect(url).toContain('/__sia_stream__/')
        expect(url).not.toContain('ab'.repeat(32))
        expect(await readAll(page, url)).toEqual(pattern(17))
        expect((await stats(page)).connections).toBe(1)
        expect(await pageDownloads(page)).toBe(0)
      }))

    test('suffix, open and seek ranges read only the requested bytes above 4 GB', () =>
      withPage(async (page) => {
        expect(await setup(page)).toBe(true)
        const url = await create(page)
        const ranges = [
          { header: 'bytes=-19', offset: HUGE_SIZE - 19, length: 19 },
          { header: `bytes=${HUGE_SIZE - 31}-`, offset: HUGE_SIZE - 31, length: 31 },
          { header: 'bytes=4294967313-4294967376', offset: 4294967313, length: 64 },
          { header: 'bytes=7-23', offset: 7, length: 17 },
        ]
        for (const range of ranges) {
          const result = await page.evaluate(
            async ({ url, header }) => {
              const response = await fetch(url, { headers: { Range: header } })
              return {
                status: response.status,
                range: response.headers.get('content-range'),
                length: response.headers.get('content-length'),
                accepts: response.headers.get('accept-ranges'),
                bytes: Array.from(new Uint8Array(await response.arrayBuffer())),
              }
            },
            { url, header: range.header },
          )
          expect(result).toEqual({
            status: 206,
            range: `bytes ${range.offset}-${range.offset + range.length - 1}/${HUGE_SIZE}`,
            length: String(range.length),
            accepts: 'bytes',
            bytes: pattern(range.length, range.offset),
          })
        }
        expect((await stats(page)).calls).toEqual(
          ranges.map(({ offset, length }) => ({ offset, length })),
        )
        expect((await stats(page)).connections).toBe(1)
        expect(await pageDownloads(page)).toBe(0)
      }))

    test('HEAD and unsatisfiable ranges never start an SDK download', () =>
      withPage(async (page) => {
        expect(await setup(page)).toBe(true)
        const url = await create(page)
        const result = await page.evaluate(
          async ({ url, size }) => {
            const head = await fetch(url, { method: 'HEAD' })
            const invalid = await fetch(url, { headers: { Range: `bytes=${size}-` } })
            return {
              head: head.status,
              length: head.headers.get('content-length'),
              headBytes: (await head.arrayBuffer()).byteLength,
              invalid: invalid.status,
              range: invalid.headers.get('content-range'),
            }
          },
          { url, size: HUGE_SIZE },
        )
        expect(result).toEqual({
          head: 200,
          length: String(HUGE_SIZE),
          headBytes: 0,
          invalid: 416,
          range: `bytes */${HUGE_SIZE}`,
        })
        expect((await stats(page)).calls).toEqual([])
      }))

    test('SDK failures reach onError with credentials and URLs redacted', () =>
      withPage(async (page) => {
        expect(await setup(page)).toBe(true)
        await page.evaluate(() =>
          window.streamTest.configure({
            failure: `Host unavailable https://example.test/#share=${'ab'.repeat(32)}`,
          }),
        )
        const url = await create(page, 100)
        await page.evaluate(async (url) => {
          await fetch(url).then((response) => response.arrayBuffer()).catch(() => {})
        }, url)
        expect(await until(() => errors(page), (value) => value.length > 0)).toEqual([
          'Host unavailable [URL redacted]',
        ])
      }))

    test('without onError, a failure is logged once with the file name and no credentials', () =>
      withPage(async (page) => {
        const logged: string[] = []
        page.on('console', (message) => {
          if (message.type() === 'error') logged.push(message.text())
        })
        expect(await setup(page)).toBe(true)
        await page.evaluate(() =>
          window.streamTest.configure({ failure: `seed=${'ab'.repeat(32)} failed` }),
        )
        const url = await create(page, 100, 'failed.mp4', { logged: true })
        await page.evaluate(async (url) => {
          await fetch(url).then((response) => response.arrayBuffer()).catch(() => {})
        }, url)
        const lines = await until(
          async () => logged.filter((line) => line.startsWith('[Sia stream]')),
          (value) => value.length > 0,
        )
        expect(lines).toHaveLength(1)
        expect(lines[0]).toContain('failed.mp4')
        expect(lines[0]).not.toContain('ab'.repeat(32))
        expect(await errors(page)).toEqual([])
      }))

    test('an SDK reader failure rejects the response body and reaches the page', () =>
      withPage(async (page) => {
        expect(await setup(page)).toBe(true)
        await page.evaluate(() => window.streamTest.configure({ failAfter: 64 * 1024 }))
        const url = await create(page, 3 * 64 * 1024)
        const failed = await page.evaluate(
          (url) =>
            fetch(url)
              .then((response) => response.arrayBuffer())
              .then(() => false)
              .catch(() => true),
          url,
        )
        expect(failed).toBe(true)
        expect(await until(() => errors(page), (value) => value.length > 0)).toEqual([
          'Host disconnected during download',
        ])
      }))

    test('a URL with event callbacks goes connecting, downloading, idle, with every byte and each chunk read', () =>
      withPage(async (page) => {
        expect(await setup(page)).toBe(true)
        const chunks = 40
        const size = chunks * CHUNK
        const url = await createTracked(page, size)
        const elapsed = await timedRead(page, url, size)
        const first = await until(() => tracked(page), (value) => value.statuses.length === 3)
        expect(first.statuses).toEqual(['connecting', 'downloading', 'idle'])
        expect(first.progress.at(-1)).toBe(size)
        expect(first.hosts).toHaveLength(chunks)
        // Bytes collect for 100 ms, so there are no more progress calls than
        // 100 ms windows in the read, plus the one sent when it ends.
        expect(first.progress.length).toBeLessThanOrEqual(Math.ceil(elapsed / 100) + 1)

        // A second read of the same URL cycles again, and its bytes add to the total.
        await timedRead(page, url, size)
        const second = await until(() => tracked(page), (value) => value.statuses.length === 6)
        expect(second.statuses).toEqual([
          'connecting', 'downloading', 'idle', 'connecting', 'downloading', 'idle',
        ])
        expect(second.progress.at(-1)).toBe(2 * size)
        expect(second.hosts).toHaveLength(2 * chunks)
        expect(await pageDownloads(page)).toBe(0)
      }))

    test('two reads in flight at once on one URL report one cycle', () =>
      withPage(async (page) => {
        expect(await setup(page)).toBe(true)
        await page.evaluate(() => window.streamTest.configure({ chunkDelay: 20 }))
        const size = 10 * CHUNK
        const url = await createTracked(page, size)
        await page.evaluate(
          (url) =>
            Promise.all([
              fetch(url).then((response) => response.arrayBuffer()),
              fetch(url, { headers: { Range: 'bytes=0-65535' } }).then((response) =>
                response.arrayBuffer(),
              ),
            ]),
          url,
        )
        const result = await until(() => tracked(page), (value) => value.statuses.at(-1) === 'idle')
        expect(result.statuses).toEqual(['connecting', 'downloading', 'idle'])
        expect(result.progress.at(-1)).toBe(size + CHUNK)
      }))

    test('a HEAD request reports no status or progress', () =>
      withPage(async (page) => {
        expect(await setup(page)).toBe(true)
        const url = await createTracked(page, 3 * CHUNK)
        expect(
          await page.evaluate(async (url) => (await fetch(url, { method: 'HEAD' })).status, url),
        ).toBe(200)
        await Bun.sleep(300)
        expect(await tracked(page)).toEqual({ statuses: [], progress: [], hosts: [] })
        expect((await stats(page)).calls).toEqual([])
      }))

    test('a read that fails ends idle and reports why', () =>
      withPage(async (page) => {
        expect(await setup(page)).toBe(true)
        await page.evaluate((failAfter) => window.streamTest.configure({ failAfter }), CHUNK)
        const url = await createTracked(page, 3 * CHUNK)
        const failed = await page.evaluate(
          (url) =>
            fetch(url)
              .then((response) => response.arrayBuffer())
              .then(() => false)
              .catch(() => true),
          url,
        )
        expect(failed).toBe(true)
        const result = await until(() => tracked(page), (value) => value.statuses.at(-1) === 'idle')
        expect(result.statuses).toEqual(['connecting', 'downloading', 'idle'])
        expect(await until(() => errors(page), (value) => value.length > 0)).toEqual([
          'Host disconnected during download',
        ])
      }))

    test('releasing a URL partway through a read stops all of its reports', () =>
      withPage(async (page) => {
        expect(await setup(page)).toBe(true)
        await page.evaluate(() => window.streamTest.configure({ chunkDelay: 50 }))
        const url = await createTracked(page, 40 * CHUNK)
        await page.evaluate((url) => {
          void fetch(url)
            .then((response) => response.arrayBuffer())
            .catch(() => {})
        }, url)
        await until(() => tracked(page), (value) => value.progress.length > 0)
        await page.evaluate(() => window.streamTest.releaseOne())
        const atRelease = await tracked(page)
        await Bun.sleep(600)
        const later = await tracked(page)
        expect(later.statuses).toHaveLength(atRelease.statuses.length)
        expect(later.progress).toHaveLength(atRelease.progress.length)
        expect(later.hosts).toHaveLength(atRelease.hosts.length)
        expect(atRelease.progress.at(-1)!).toBeLessThan(40 * CHUNK)
      }))

    test('a callback that throws does not stop the stream or the other callbacks', () =>
      withPage(async (page) => {
        expect(await setup(page)).toBe(true)
        const size = 5 * CHUNK
        const url = await page.evaluate(
          async (size) =>
            (await window.streamTest.create(size, 'tracked.bin', { tracked: true, throwing: true }))
              .url,
          size,
        )
        await timedRead(page, url, size)
        const result = await until(() => tracked(page), (value) => value.statuses.at(-1) === 'idle')
        expect(result.statuses).toEqual(['connecting', 'downloading', 'idle'])
        expect(result.progress.at(-1)).toBe(size)
        expect(result.hosts).toHaveLength(5)
      }))

    test('a streamed download reports the cycle and ends at the file size', () =>
      withPage(async (page) => {
        expect(await setup(page)).toBe(true)
        const size = 3 * CHUNK + 17
        const downloaded = page.waitForEvent('download')
        await clickToSave(page, size, 'tracked.bin', { tracked: true })
        const download = await downloaded
        await download.saveAs(join(downloads, 'tracked.bin'))
        const result = await until(() => tracked(page), (value) => value.statuses.at(-1) === 'idle')
        expect(result.statuses).toEqual(['connecting', 'downloading', 'idle'])
        expect(result.progress.at(-1)).toBe(size)
        expect(await pageDownloads(page)).toBe(0)
      }))

    test('a zero-byte file goes connecting then idle without an SDK download', () =>
      withPage(async (page) => {
        expect(await setup(page)).toBe(true)
        const url = await createTracked(page, 0)
        expect(await readAll(page, url)).toEqual([])
        const result = await until(() => tracked(page), (value) => value.statuses.at(-1) === 'idle')
        expect(result).toEqual({ statuses: ['connecting', 'idle'], progress: [], hosts: [] })
        expect((await stats(page)).calls).toEqual([])
      }))

    test('a URL with only onStatus gets no progress or shard messages, and the SDK is not asked for shards', () =>
      withPage(async (page) => {
        expect(await setup(page)).toBe(true)
        const size = 5 * CHUNK
        const url = await page.evaluate(
          async (size) =>
            (await window.streamTest.create(size, 'status.bin', { tracked: true, statusOnly: true }))
              .url,
          size,
        )
        await timedRead(page, url, size)
        const result = await until(() => tracked(page), (value) => value.statuses.at(-1) === 'idle')
        expect(result.statuses).toEqual(['connecting', 'downloading', 'idle'])
        expect(await page.evaluate(() => window.streamTest.progressMessages())).toBe(0)
        expect((await stats(page)).shardListeners).toBe(0)
      }))

    test('a URL without event callbacks gets no event messages, and the SDK is not asked for shards', () =>
      withPage(async (page) => {
        expect(await setup(page)).toBe(true)
        const url = await create(page, 300_000)
        expect((await readAll(page, url)).length).toBe(300_000)
        await Bun.sleep(300)
        expect(await page.evaluate(() => window.streamTest.eventMessages())).toBe(0)
        expect((await stats(page)).shardListeners).toBe(0)
      }))

    test('large SDK chunks keep every response byte', () =>
      withPage(async (page) => {
        expect(await setup(page)).toBe(true)
        await page.evaluate(() => window.streamTest.configure({ chunkSize: 2 * 1024 ** 2 }))
        const size = 3 * 1024 ** 2 + 17
        const url = await create(page, size)
        const result = await page.evaluate(async (url) => {
          const bytes = new Uint8Array(await (await fetch(url)).arrayBuffer())
          return { length: bytes.length, correct: bytes.every((byte, i) => byte === i % 251) }
        }, url)
        expect(result).toEqual({ length: size, correct: true })
      }))

    test('a download goes to the browser with every byte, and no picker or Blob', () =>
      withPage(async (page) => {
        expect(await setup(page)).toBe(true)
        const size = 3 * 64 * 1024 + 17
        const name = 'résumé sample.bin'
        await page.evaluate(() => {
          window.showSaveFilePicker = () => {
            throw new Error('Unexpected save picker')
          }
          URL.createObjectURL = () => {
            throw new Error('Unexpected Blob download')
          }
        })
        const downloaded = page.waitForEvent('download')
        await clickToSave(page, size, name)
        const download = await downloaded
        expect(download.suggestedFilename().normalize()).toBe(name.normalize())
        const path = join(downloads, 'saved.bin')
        await download.saveAs(path)
        expect(await download.failure()).toBeNull()
        expect([...readFileSync(path)]).toEqual(pattern(size))
        expect((await stats(page)).calls).toEqual([{ offset: 0, length: size }])
        expect(await pageDownloads(page)).toBe(0)
      }))

    test('a download the worker cannot start keeps the page and reports why', () =>
      withPage(async (page) => {
        expect(await setup(page)).toBe(true)
        await page.evaluate(() => window.streamTest.configure({ failure: 'Host unavailable' }))
        let started = 0
        page.on('download', () => started++)
        await clickToSave(page, 100, 'failed.bin')
        expect(await until(() => errors(page), (value) => value.length > 0)).toEqual([
          'Host unavailable',
        ])
        expect(new URL(page.url()).pathname).toBe('/')
        expect(started).toBe(0)
      }))

    // WebKit headless does not reliably deliver the fixture worker's messages
    // after an abort.
    test.skipIf(browserName === 'webkit')(
      'aborting a multi-GB fetch cancels its SDK reader',
      () =>
      withPage(async (page) => {
        expect(await setup(page)).toBe(true)
        const url = await create(page)
        await page.evaluate(async (url) => {
          const h = window.streamTest
          h.abort = new AbortController()
          const response = await fetch(url, { signal: h.abort.signal })
          h.reader = response.body!.getReader()
          await h.reader.read()
        }, url)
        await Bun.sleep(1000)
        const { produced } = await stats(page)
        expect(produced).toBeGreaterThan(0)
        // Only Chromium carries backpressure through fetch. The others read ahead.
        if (browserName === 'chromium') expect(produced).toBeLessThan(16 * 1024 ** 2)
        await page.evaluate(() => window.streamTest.abort!.abort())
        await until(async () => (await stats(page)).cancelled, (value) => value === 1)
        expect(await errors(page)).toEqual([])
      }))

    test('audio plays and seeks past what it buffered through ranged reads', () =>
      withPage(async (page) => {
        expect(await setup(page)).toBe(true)
        await page.evaluate(async () => {
          const audio = document.createElement('audio')
          audio.preload = 'metadata'
          const { url } = await window.streamTest.create(44 + 600 * 48_000 * 4, 'silence.wav', {
            wav: true,
          })
          audio.src = url
          document.body.append(audio)
        })
        const audio = page.locator('audio')
        const read = <T,>(fn: (el: HTMLAudioElement) => T) =>
          audio.evaluate(fn as (el: HTMLElement) => T)
        await until(() => read((el) => el.duration), (value) => value === 600)
        await read((el) => el.play())
        await until(() => read((el) => el.currentTime), (value) => value > 0)
        expect(
          await read((el) => (el.buffered.length ? el.buffered.end(el.buffered.length - 1) : 0)),
        ).toBeLessThan(550)
        await read((el) => {
          el.currentTime = 550
        })
        await until(() => read((el) => el.currentTime), (value) => value > 550)
        expect(await read((el) => ({ error: el.error?.message, paused: el.paused }))).toEqual({
          error: undefined,
          paused: false,
        })
        expect((await stats(page)).calls.some(({ offset }) => offset > 540 * 48_000 * 4)).toBe(true)
      }))

    // WebKit headless does not reliably deliver the fixture worker's messages
    // after a release.
    test.skipIf(browserName === 'webkit')(
      'closing a share cancels its readers, frees the worker SDK and ends its URLs',
      () =>
      withPage(async (page) => {
        expect(await setup(page)).toBe(true)
        const first = await create(page)
        const second = await create(page)
        await page.evaluate(async (url) => {
          const response = await fetch(url)
          window.streamTest.reader = response.body!.getReader()
          await window.streamTest.reader.read()
          window.streamTest.close()
        }, first)
        await until(async () => (await stats(page)).cancelled, (value) => value === 1)
        await until(async () => (await stats(page)).freed, (value) => value === 1)
        const statuses = await page.evaluate(
          (urls) => Promise.all(urls.map(async (url) => (await fetch(url)).status)),
          [first, second],
        )
        expect(statuses.every((status) => status >= 400)).toBe(true)
        expect((await stats(page)).calls).toHaveLength(1)
      }))

    test('releasing one URL keeps another URL from the same share working', () =>
      withPage(async (page) => {
        expect(await setup(page)).toBe(true)
        const retained = await create(page, 17)
        const released = await create(page, 23)
        await page.evaluate(() => window.streamTest.releaseOne())
        const gone = await page.evaluate(async (url) => (await fetch(url)).status, released)
        expect(gone).toBeGreaterThanOrEqual(400)
        expect(await readAll(page, retained)).toEqual(pattern(17))
      }))

    test('closing one handle on an SDK keeps another handle\'s URLs working', () =>
      withPage(async (page) => {
        expect(await setup(page)).toBe(true)
        const kept = await create(page, 17)
        const closed = await page.evaluate((size) => window.streamTest.closeAnother(size), 23)
        const gone = await page.evaluate(async (url) => (await fetch(url)).status, closed)
        expect(gone).toBeGreaterThanOrEqual(400)
        expect(await readAll(page, kept)).toEqual(pattern(17))
      }))

    test('releasing the last URL keeps the worker SDK for the next file', () =>
      withPage(async (page) => {
        expect(await setup(page)).toBe(true)
        expect(await readAll(page, await create(page, 17))).toEqual(pattern(17))
        await page.evaluate(() => window.streamTest.releaseOne())
        expect(await readAll(page, await create(page, 23))).toEqual(pattern(23))
        expect(await stats(page)).toMatchObject({ connections: 1, freed: 0 })
      }))

    test('a shared file reaches the worker sealed, so the worker looks nothing up', () =>
      withPage(async (page) => {
        expect(await setup(page, '/', 'shared', true)).toBe(true)
        expect(await readAll(page, await create(page, 17))).toEqual(pattern(17))
        expect(await readAll(page, await create(page, 23))).toEqual(pattern(23))
        expect(await stats(page)).toMatchObject({ sealKeys: 1, lookups: 0 })
      }))

    test('without the SDK running on the page, the worker looks a shared file up', () =>
      withPage(async (page) => {
        expect(await setup(page)).toBe(true)
        expect(await readAll(page, await create(page, 17))).toEqual(pattern(17))
        expect(await stats(page)).toMatchObject({ sealKeys: 0, lookups: 1 })
      }))

    test('a failed connection is retried by the next request', () =>
      withPage(async (page) => {
        expect(await setup(page)).toBe(true)
        await page.evaluate(() => window.streamTest.configure({ failConnects: 1 }))
        const url = await create(page, 17)
        const status = () => page.evaluate(async (url) => (await fetch(url)).status, url)
        expect(await status()).toBe(502)
        expect(await status()).toBe(200)
        expect((await stats(page)).connections).toBe(2)
      }))

    // Stopping a service worker needs Chromium's DevTools protocol.
    test.skipIf(browserName !== 'chromium')(
      'after a worker restart, the same URL recovers its file from the page',
      () =>
      withPage(async (page, context) => {
        expect(await setup(page)).toBe(true)
        const url = await create(page, 17)
        expect(await readAll(page, url)).toEqual(pattern(17))
        const session = await context.newCDPSession(page)
        await session.send('ServiceWorker.enable')
        await session.send('ServiceWorker.stopAllWorkers')
        expect(await readAll(page, url)).toEqual(pattern(17))
        // A fresh worker's counts prove it restarted rather than kept its SDK.
        expect((await stats(page)).calls).toHaveLength(1)
        expect(await pageDownloads(page)).toBe(0)
        await session.detach()
      }))

    test('a site served from a sub-path streams, and downloads, under the worker scope', () =>
      withPage(async (page) => {
        expect(await setup(page, '/app/')).toBe(true)
        const url = await create(page, 17)
        expect(new URL(url, origin).pathname.startsWith('/app/__sia_stream__/')).toBe(true)
        expect(await readAll(page, url)).toEqual(pattern(17))
        const downloaded = page.waitForEvent('download')
        await clickToSave(page, 100, 'nested.bin')
        const download = await downloaded
        const path = join(downloads, 'nested.bin')
        await download.saveAs(path)
        expect([...readFileSync(path)]).toEqual(pattern(100))
      }))

    // A cache-bypassing reload needs Chromium's DevTools protocol.
    test.skipIf(browserName !== 'chromium')(
      'a hard reload falls back to the page at once instead of waiting',
      () =>
      withPage(async (page, context) => {
        expect(await setup(page)).toBe(true)
        const session = await context.newCDPSession(page)
        const reloaded = page.waitForEvent('load')
        await session.send('Page.reload', { ignoreCache: true })
        await reloaded
        expect(await page.evaluate(() => navigator.serviceWorker.controller)).toBeNull()
        const started = Date.now()
        expect(await start(page)).toBe(false)
        expect(Date.now() - started).toBeLessThan(2000)
        await session.detach()
      }))

    test('an app Sdk streams ranges through a worker connected with its app key', () =>
      withPage(async (page) => {
        expect(await setup(page, '/', 'app')).toBe(true)
        const url = await create(page)
        const result = await page.evaluate(async (url) => {
          const response = await fetch(url, {
            headers: { Range: 'bytes=4294967313-4294967376' },
          })
          return {
            status: response.status,
            bytes: Array.from(new Uint8Array(await response.arrayBuffer())),
          }
        }, url)
        expect(result).toEqual({ status: 206, bytes: pattern(64, 4294967313) })
        expect((await stats(page)).kinds).toEqual(['app'])
        expect(await pageDownloads(page)).toBe(0)
      }))

    test('closing an app Sdk\'s streams frees their copy of its app key', () =>
      withPage(async (page) => {
        expect(await setup(page, '/', 'app')).toBe(true)
        await create(page)
        expect(await page.evaluate(() => window.streamTest.keysFreed())).toBe(0)
        await page.evaluate(() => window.streamTest.close())
        expect(await page.evaluate(() => window.streamTest.keysFreed())).toBe(1)
      }))

    test('an app Sdk download goes to the browser with every byte', () =>
      withPage(async (page) => {
        expect(await setup(page, '/', 'app')).toBe(true)
        const size = 3 * 64 * 1024 + 17
        const downloaded = page.waitForEvent('download')
        await clickToSave(page, size, 'app.bin')
        const download = await downloaded
        const path = join(downloads, `app-${browserName}.bin`)
        await download.saveAs(path)
        expect([...readFileSync(path)]).toEqual(pattern(size))
        expect(await pageDownloads(page)).toBe(0)
      }))

    // Stopping a service worker needs Chromium's DevTools protocol.
    test.skipIf(browserName !== 'chromium')(
      'after a worker restart, an app Sdk URL recovers its file from the page',
      () =>
        withPage(async (page, context) => {
          expect(await setup(page, '/', 'app')).toBe(true)
          const url = await create(page, 17)
          expect(await readAll(page, url)).toEqual(pattern(17))
          const session = await context.newCDPSession(page)
          await session.send('ServiceWorker.enable')
          await session.send('ServiceWorker.stopAllWorkers')
          expect(await readAll(page, url)).toEqual(pattern(17))
          expect((await stats(page)).kinds).toEqual(['app'])
          await session.detach()
        }),
    )

    test('openStreams names the credentials each kind of SDK needs', () =>
      withPage(async (page) => {
        await setup(page)
        const messages = await page.evaluate(async () => {
          const bridge = (await import('/bridge.js' as string)) as typeof Bridge
          const appMeta = { appId: '0'.repeat(64), name: 'a', description: 'b', serviceUrl: 'c' }
          return [
            bridge.openError('app', { indexerUrl: 'x', seed: 'y' }),
            bridge.openError('app', { indexerUrl: 'x', appMeta: {} }),
            bridge.openError('shared', { indexerUrl: 'x', appMeta }),
            bridge.openError('shared', undefined),
            bridge.openError('shared', { indexerUrl: 'x', seed: 'y' }) ?? 'ok',
            bridge.openError('app', { indexerUrl: 'x', appMeta }) ?? 'ok',
          ]
        })
        expect(messages).toEqual([
          'openStreams(Sdk) needs { indexerUrl, appMeta }.',
          'openStreams(Sdk) needs { indexerUrl, appMeta }.',
          'openStreams(SharedSdk) needs { indexerUrl, seed }.',
          'openStreams(SharedSdk) needs { indexerUrl, seed }.',
          'ok',
          'ok',
        ])
      }))

    test('with service workers blocked, the page reads objects itself', () =>
      withPage(
        async (page) => {
          expect(await setup(page)).toBe(false)
          const picker = await page.evaluate(async () => {
            let opened = false
            Object.defineProperty(window, 'showSaveFilePicker', {
              configurable: true,
              value: () => {
                opened = true
                return Promise.reject(new DOMException('Cancelled', 'AbortError'))
              },
            })
            const saving = window.streamTest.save(100, 'cancelled.bin')
            const synchronous = opened
            return { synchronous, saved: await saving }
          })
          expect(picker).toEqual({ synchronous: true, saved: 'cancelled' })
          expect(await pageDownloads(page)).toBe(0)

          // The stand-in page SDK throws at once until the fallback is allowed,
          // as a freed SDK would. The read still ends at idle.
          const failed = await page.evaluate(() =>
            window.streamTest
              .create(100, 'failed.bin', { tracked: true })
              .then(() => false)
              .catch(() => true),
          )
          expect(failed).toBe(true)
          expect(await tracked(page)).toEqual({
            statuses: ['connecting', 'idle'],
            progress: [],
            hosts: [],
          })

          await page.evaluate(() => window.streamTest.allowFallback())
          const file = await page.evaluate(() =>
            window.streamTest.create(100, 'tracked.bin', { tracked: true }),
          )
          expect(file.fromPage).toBe(true)
          expect(file.url.startsWith('blob:')).toBe(true)
          expect(await readAll(page, file.url)).toEqual(pattern(100))
          // Read in the page, the same callbacks report the download.
          expect(await tracked(page)).toEqual({
            statuses: ['connecting', 'downloading', 'idle'],
            progress: [100],
            hosts: [],
          })

          await page.evaluate(() =>
            Object.defineProperty(window, 'showSaveFilePicker', { value: undefined }),
          )
          const downloaded = page.waitForEvent('download')
          await clickToSave(page, 100, 'fallback.bin')
          const download = await downloaded
          expect(download.suggestedFilename()).toBe('fallback.bin')
          const path = join(downloads, 'fallback.bin')
          await download.saveAs(path)
          expect([...readFileSync(path)]).toEqual(pattern(100))
          // The failed start, the preview and the save.
          expect(await pageDownloads(page)).toBe(3)
        },
        { serviceWorkers: 'block' },
      ))
  })
}

declare global {
  interface Window {
    showSaveFilePicker?: unknown
  }
}
