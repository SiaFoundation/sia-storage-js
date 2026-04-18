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

describe('rollup bundler integration', () => {
  let tmpDir: string
  let tarball: string
  let teardown: () => Promise<void>
  let result: { ok: boolean; error?: string }

  beforeAll(async () => {
    ;({ tmpDir, tarball } = packIntoTmp('rollup'))
    writePackageJson(tmpDir)

    const fixtureDir = join(FIXTURES, 'rollup-app')
    copyFixtures(fixtureDir, tmpDir, ['rollup.config.mjs'])
    cpSync(join(FIXTURES, 'browser-smoke.js'), join(tmpDir, 'main.js'))

    npmInstall(
      tmpDir,
      `${tarball} rollup @rollup/plugin-node-resolve @rollup/plugin-commonjs`,
    )
    execSync('npx rollup -c rollup.config.mjs', {
      cwd: tmpDir,
      stdio: ['pipe', 'pipe', 'pipe'],
    })

    const distDir = join(tmpDir, 'dist')
    mkdirSync(distDir, { recursive: true })
    copyFixtures(fixtureDir, distDir, ['index.html'])
    // Copy .wasm manually for parity with esbuild test (alternative: @rollup/plugin-url).
    cpSync(
      join(tmpDir, 'node_modules/sia-storage/wasm/sia_storage_wasm_bg.wasm'),
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

  test('rollup-built page runs the SDK end-to-end', () => {
    if (!result.ok) throw new Error(`rollup smoke failed: ${result.error}`)
    expect(result.ok).toBe(true)
  })
})
