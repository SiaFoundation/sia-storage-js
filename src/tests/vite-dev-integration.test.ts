import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { cpSync } from 'node:fs'
import { join } from 'node:path'
import {
  cleanup,
  copyFixtures,
  FIXTURES,
  npmInstall,
  packIntoTmp,
  runChromiumSmoke,
  writePackageJson,
} from './_bundler-helpers'

// Covers `vite dev` (the prod build is covered by vite-integration.test.ts).
// Without `optimizeDeps.exclude: ['@siafoundation/sia-storage']`, Vite's deps pre-bundler
// breaks the `new URL(..., import.meta.url)` resolution inside the WASM glue
// and `initSia()` blows up. The fixture's vite.config.js sets that exclude.
describe('vite dev bundler integration', () => {
  let tmpDir: string
  let tarball: string
  let devProc: ReturnType<typeof Bun.spawn> | undefined
  let teardown: () => Promise<void>
  let result: { ok: boolean; error?: string }

  beforeAll(async () => {
    ;({ tmpDir, tarball } = packIntoTmp('vite-dev'))
    writePackageJson(tmpDir)

    const fixtureDir = join(FIXTURES, 'vite-app')
    copyFixtures(fixtureDir, tmpDir, ['index.html', 'vite.config.js'])
    cpSync(join(FIXTURES, 'browser-smoke.js'), join(tmpDir, 'main.js'))

    npmInstall(tmpDir, `${tarball} vite`)

    const port = 54173
    devProc = Bun.spawn(['npx', 'vite', '--port', String(port), '--strictPort'], {
      cwd: tmpDir,
      stdout: 'pipe',
      stderr: 'pipe',
    })

    await waitForDevReady(devProc, 30_000)

    const smoke = await runChromiumSmoke(`http://localhost:${port}/`)
    result = smoke.result

    teardown = cleanup({ browser: smoke.browser, tmpDir, tarball })
  }, 180_000)

  afterAll(async () => {
    if (devProc) devProc.kill()
    if (teardown) await teardown()
  })

  test('Vite dev server runs the SDK end-to-end', () => {
    if (!result.ok) throw new Error(`Vite dev smoke failed: ${result.error}`)
    expect(result.ok).toBe(true)
  })
})

async function waitForDevReady(proc: ReturnType<typeof Bun.spawn>, timeoutMs: number) {
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
