import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { execSync } from 'node:child_process'
import { cpSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'
import {
  cleanup,
  copyFixtures,
  FIXTURES,
  npmInstall,
  packIntoTmp,
  runChromiumSmoke,
  staticServe,
  writePackageJson,
} from './_bundler-helpers'

describe('esbuild bundler integration', () => {
  let tmpDir: string
  let tarball: string
  let teardown: () => Promise<void>
  let result: { ok: boolean; error?: string }

  beforeAll(async () => {
    ;({ tmpDir, tarball } = packIntoTmp('esbuild'))
    writePackageJson(tmpDir)

    const fixtureDir = join(FIXTURES, 'esbuild-app')
    cpSync(join(FIXTURES, 'browser-smoke.js'), join(tmpDir, 'main.js'))

    npmInstall(tmpDir, `${tarball} esbuild`)

    const distDir = join(tmpDir, 'dist')
    mkdirSync(distDir, { recursive: true })
    copyFixtures(fixtureDir, distDir, ['index.html'])

    execSync(
      'npx esbuild main.js --bundle --format=esm --target=esnext --outfile=dist/bundle.js',
      { cwd: tmpDir, stdio: ['pipe', 'pipe', 'pipe'] },
    )

    // esbuild doesn't emit .wasm assets; copy manually like real-world setups.
    cpSync(
      join(tmpDir, 'node_modules/@siafoundation/sia-storage/wasm/sia_storage_wasm_bg.wasm'),
      join(distDir, 'sia_storage_wasm_bg.wasm'),
    )

    const { server, url } = staticServe(distDir)
    const smoke = await runChromiumSmoke(url)
    result = smoke.result
    teardown = cleanup({ browser: smoke.browser, server, tmpDir, tarball })
  }, 180_000)

  afterAll(async () => {
    if (teardown) await teardown()
  })

  test('esbuild-built page runs the SDK end-to-end', () => {
    if (!result.ok) throw new Error(`esbuild smoke failed: ${result.error}`)
    expect(result.ok).toBe(true)
  })
})
