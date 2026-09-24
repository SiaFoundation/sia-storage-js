// Bundler integration helpers: pack, install, build, serve, and smoke the
// built page in Chromium, Firefox and WebKit.

import { execSync } from 'node:child_process'
import { cpSync, existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { chromium, firefox, webkit, type Browser } from 'playwright'

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

/** Serves the prebuilt streaming worker from `dir`, as the README tells sites without a plugin to. */
export function copyStreamingWorker(cwd: string, dir: string) {
  execSync(`npx --no -- sia-storage-worker ${dir}`, {
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

export type SmokeResult = { ok: boolean; error?: string; streaming?: boolean }

export const ENGINES = ['chromium', 'firefox', 'webkit'] as const
export type Engine = (typeof ENGINES)[number]

/** Loads the built page in each engine and collects what its smoke script reported. */
export async function runBrowserSmoke(
  serverUrl: string,
): Promise<{ browsers: Browser[]; results: Record<Engine, SmokeResult> }> {
  const launchers = { chromium, firefox, webkit }
  const browsers: Browser[] = []
  const results = {} as Record<Engine, SmokeResult>
  for (const engine of ENGINES) {
    const browser = await launchers[engine].launch({ headless: true })
    browsers.push(browser)
    const page = await browser.newPage()
    await page.goto(serverUrl, { waitUntil: 'domcontentloaded' })
    await page.waitForFunction(
      () => (window as unknown as { __smoke?: unknown }).__smoke !== undefined,
      { timeout: 30_000 },
    )
    results[engine] = (await page.evaluate(
      () => (window as unknown as { __smoke: SmokeResult }).__smoke,
    )) as SmokeResult
  }
  return { browsers, results }
}

export function cleanup(opts: {
  browsers?: Browser[]
  server?: ReturnType<typeof Bun.serve>
  tmpDir?: string
  tarball?: string
}) {
  return async () => {
    for (const browser of opts.browsers ?? []) await browser.close()
    if (opts.server) opts.server.stop()
    if (opts.tmpDir && existsSync(opts.tmpDir)) rmSync(opts.tmpDir, { recursive: true, force: true })
    if (opts.tarball && existsSync(opts.tarball)) rmSync(opts.tarball)
  }
}
