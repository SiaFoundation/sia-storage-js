// Shared helpers for browser-bundler integration tests.
//
// Each bundler test (Vite, Next.js, webpack, Rollup, esbuild) packs the
// tarball into its own temp dir (avoiding any race when bun test runs
// files in parallel), copies bundler-specific fixtures in, runs the
// bundler's build, serves the output, and drives Chromium against
// browser-smoke.js. Pass criterion: `window.__smoke.ok === true`.

import { execSync } from 'node:child_process'
import { cpSync, existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { chromium, type Browser, type Page } from 'playwright'

export const ROOT = join(import.meta.dir, '..', '..')
export const FIXTURES = join(import.meta.dir, 'fixtures')

export function packIntoTmp(prefix: string): { tmpDir: string; tarball: string } {
  const tmpDir = mkdtempSync(join(tmpdir(), `sia-${prefix}-`))
  const out = execSync(`npm pack --pack-destination "${tmpDir}"`, {
    cwd: ROOT,
    encoding: 'utf-8',
    stdio: ['pipe', 'pipe', 'pipe'],
  }).trim()
  return { tmpDir, tarball: join(tmpDir, out) }
}

export function copyFixtures(srcDir: string, destDir: string, names: string[]) {
  for (const name of names) {
    cpSync(join(srcDir, name), join(destDir, name))
  }
}

export function writePackageJson(dir: string, extra: Record<string, unknown> = {}) {
  writeFileSync(
    join(dir, 'package.json'),
    JSON.stringify({ name: 'test', version: '1.0.0', type: 'module', ...extra }, null, 2),
  )
}

export function npmInstall(cwd: string, args: string) {
  execSync(`npm install ${args} --no-audit --no-fund`, {
    cwd,
    stdio: ['pipe', 'pipe', 'pipe'],
  })
}

export function staticServe(distDir: string): {
  server: ReturnType<typeof Bun.serve>
  url: string
} {
  const server = Bun.serve({
    port: 0,
    async fetch(req) {
      const url = new URL(req.url)
      const pathname = url.pathname === '/' ? '/index.html' : url.pathname
      const file = Bun.file(join(distDir, pathname))
      if (!(await file.exists())) return new Response('404', { status: 404 })
      return new Response(file)
    },
  })
  return { server, url: `http://localhost:${server.port}/` }
}

export async function runChromiumSmoke(
  serverUrl: string,
): Promise<{ browser: Browser; page: Page; result: { ok: boolean; error?: string } }> {
  const browser = await chromium.launch({ headless: true })
  const page = await browser.newPage()
  await page.goto(serverUrl, { waitUntil: 'domcontentloaded' })
  await page.waitForFunction(
    () => (window as unknown as { __smoke?: unknown }).__smoke !== undefined,
    { timeout: 30_000 },
  )
  const result = (await page.evaluate(
    () => (window as unknown as { __smoke: { ok: boolean; error?: string } }).__smoke,
  )) as { ok: boolean; error?: string }
  return { browser, page, result }
}

export function cleanup(opts: {
  browser?: Browser
  server?: ReturnType<typeof Bun.serve>
  tmpDir?: string
  tarball?: string
}) {
  return async () => {
    if (opts.browser) await opts.browser.close()
    if (opts.server) opts.server.stop()
    if (opts.tmpDir && existsSync(opts.tmpDir)) rmSync(opts.tmpDir, { recursive: true, force: true })
    if (opts.tarball && existsSync(opts.tarball)) rmSync(opts.tarball)
  }
}
