import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { execSync } from 'node:child_process'
import { cpSync } from 'node:fs'
import { join } from 'node:path'
import {
  cleanup,
  copyFixtures,
  FIXTURES,
  npmInstall,
  packIntoTmp,
  ENGINES,
  runBrowserSmoke,
  type SmokeResult,
  writePackageJson,
} from './_bundler-helpers'
import { TS_BUILD } from './_ts-versions'

// ReturnType drops Bun.spawn's literal option types, widening stdout off the
// stream it actually is.
type PipedSubprocess = Bun.Subprocess<'ignore', 'pipe', 'pipe'>

// Covers `vite dev` (the prod build is covered by vite-integration.test.ts).
// Without `optimizeDeps.exclude: ['@siafoundation/sia-storage']`, Vite's deps pre-bundler
// breaks the `new URL(..., import.meta.url)` resolution inside the WASM glue
// and `initSia()` blows up. The fixture's siaStorage() plugin sets that exclude,
// and serves the streaming worker from the dev server.
describe('vite dev bundler integration', () => {
  let tmpDir: string
  let tarball: string
  let devProc: PipedSubprocess | undefined
  let teardown: () => Promise<void>
  let results: Record<(typeof ENGINES)[number], SmokeResult>

  beforeAll(async () => {
    ;({ tmpDir, tarball } = packIntoTmp('vite-dev'))
    writePackageJson(tmpDir)

    const fixtureDir = join(FIXTURES, 'vite-app')
    copyFixtures(fixtureDir, tmpDir, [
      'index.html',
      'vite.config.js',
      'tsconfig.json',
      'typecheck.ts',
    ])
    cpSync(join(FIXTURES, 'browser-smoke.js'), join(tmpDir, 'main.js'))

    npmInstall(tmpDir, `${tarball} vite typescript@${TS_BUILD}`)

    const port = 54173
    devProc = Bun.spawn(['npx', 'vite', '--port', String(port), '--strictPort'], {
      cwd: tmpDir,
      stdout: 'pipe',
      stderr: 'pipe',
    })

    await waitForDevReady(devProc, 30_000)

    const smoke = await runBrowserSmoke(`http://localhost:${port}/`)
    results = smoke.results

    teardown = cleanup({ browsers: smoke.browsers, tmpDir, tarball })
  }, 180_000)

  afterAll(async () => {
    if (devProc) devProc.kill()
    if (teardown) await teardown()
  })

  test.each([...ENGINES])('Vite dev server runs the SDK end-to-end in %s', (engine) => {
    const result = results[engine]
    if (!result.ok) throw new Error(`Vite dev smoke failed: ${result.error}`)
    expect(result.ok).toBe(true)
  })

  test.each([...ENGINES])('streaming turns on with the worker the plugin serves in dev in %s', (engine) => {
    expect(results[engine].streaming).toBe(true)
  })

  // WASM .d.ts must resolve under the "browser" condition for vite consumers.
  // tsconfig.json + typecheck.ts are reused from fixtures/vite-app/.
  test('typecheck: WASM types resolve under the "browser" condition', () => {
    execSync('npx --no -- tsc --noEmit -p tsconfig.json', {
      cwd: tmpDir,
      stdio: ['pipe', 'pipe', 'pipe'],
    })
  })
})

async function waitForDevReady(proc: PipedSubprocess, timeoutMs: number) {
  const deadline = Date.now() + timeoutMs
  const decoder = new TextDecoder()
  const reader = proc.stdout.getReader()
  let buf = ''
  while (Date.now() < deadline) {
    const { value, done } = await reader.read()
    if (done) throw new Error(`vite exited before becoming ready:\n${buf}`)
    buf += decoder.decode(value)
    if (buf.includes('ready in')) {
      // detach the reader so vite's stdout doesn't back up
      reader.releaseLock()
      proc.stdout.pipeTo(new WritableStream({ write() {} })).catch(() => {})
      return
    }
  }
  throw new Error(`vite dev server did not become ready within ${timeoutMs}ms:\n${buf}`)
}
