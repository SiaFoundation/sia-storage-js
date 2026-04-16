import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { execSync } from 'node:child_process'
import { cpSync, existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { chromium, type Browser, type Page } from 'playwright'

// End-to-end proof that a consumer can `import from 'sia-storage'` in a
// real Vite-built browser bundle: pack, install the tarball, build with
// Vite, serve dist/, and drive headless Chromium. Passes if the smoke
// script signals window.__smoke.ok === true.

const ROOT = join(import.meta.dir, '..', '..')
const FIXTURES = join(import.meta.dir, 'fixtures')

describe('browser integration (Vite + Chromium)', () => {
  let tmpDir: string
  let tarball: string
  let browser: Browser
  let page: Page
  let server: ReturnType<typeof Bun.serve>
  let serverUrl: string

  beforeAll(async () => {
    tarball = join(
      ROOT,
      execSync('npm pack', {
        cwd: ROOT,
        encoding: 'utf-8',
        stdio: ['pipe', 'pipe', 'pipe'],
      }).trim(),
    )

    tmpDir = mkdtempSync(join(tmpdir(), 'sia-browser-'))
    writeFileSync(
      join(tmpDir, 'package.json'),
      JSON.stringify({ name: 'test', version: '1.0.0', type: 'module' }),
    )
    cpSync(join(FIXTURES, 'browser-index.html'), join(tmpDir, 'index.html'))
    cpSync(join(FIXTURES, 'browser-smoke.js'), join(tmpDir, 'main.js'))
    cpSync(join(FIXTURES, 'vite.config.js'), join(tmpDir, 'vite.config.js'))

    execSync(`npm install ${tarball} vite --no-audit --no-fund`, {
      cwd: tmpDir,
      stdio: ['pipe', 'pipe', 'pipe'],
    })
    execSync('npx vite build --logLevel error', {
      cwd: tmpDir,
      stdio: ['pipe', 'pipe', 'pipe'],
    })

    const distDir = join(tmpDir, 'dist')
    server = Bun.serve({
      port: 0,
      async fetch(req) {
        const url = new URL(req.url)
        const pathname = url.pathname === '/' ? '/index.html' : url.pathname
        const file = Bun.file(join(distDir, pathname))
        if (!(await file.exists())) return new Response('404', { status: 404 })
        return new Response(file)
      },
    })
    serverUrl = `http://localhost:${server.port}/`

    browser = await chromium.launch({ headless: true })
    page = await browser.newPage()
  }, 180_000)

  afterAll(async () => {
    if (browser) await browser.close()
    if (server) server.stop()
    if (tmpDir && existsSync(tmpDir)) rmSync(tmpDir, { recursive: true, force: true })
    if (tarball && existsSync(tarball)) rmSync(tarball)
  })

  test('smoke runs in a Vite-built page', async () => {
    await page.goto(serverUrl, { waitUntil: 'domcontentloaded' })
    await page.waitForFunction(
      () =>
        (window as unknown as { __smoke?: { ok: boolean } }).__smoke !==
        undefined,
      { timeout: 20_000 },
    )
    const result = (await page.evaluate(
      () => (window as unknown as { __smoke: { ok: boolean; error?: string } }).__smoke,
    )) as { ok: boolean; error?: string }
    if (!result.ok) throw new Error(`browser smoke failed: ${result.error}`)
    expect(result.ok).toBe(true)
  }, 30_000)
})
