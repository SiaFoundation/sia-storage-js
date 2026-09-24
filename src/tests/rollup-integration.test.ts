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
  copyStreamingWorker,
  ENGINES,
  runBrowserSmoke,
  type SmokeResult,
  staticServe,
  writePackageJson,
} from './_bundler-helpers'
import { TS_BUILD } from './_ts-versions'

describe('rollup bundler integration', () => {
  let tmpDir: string
  let tarball: string
  let teardown: () => Promise<void>
  let results: Record<(typeof ENGINES)[number], SmokeResult>

  beforeAll(async () => {
    ;({ tmpDir, tarball } = packIntoTmp('rollup'))
    writePackageJson(tmpDir)

    const fixtureDir = join(FIXTURES, 'rollup-app')
    copyFixtures(fixtureDir, tmpDir, [
      'rollup.config.mjs',
      'tsconfig.json',
      'typecheck.ts',
    ])
    cpSync(join(FIXTURES, 'browser-smoke.js'), join(tmpDir, 'main.js'))

    npmInstall(
      tmpDir,
      `${tarball} rollup @rollup/plugin-node-resolve @rollup/plugin-commonjs typescript@${TS_BUILD}`,
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
      join(tmpDir, 'node_modules/@siafoundation/sia-storage/wasm/sia_storage_wasm_bg.wasm'),
      join(distDir, 'sia_storage_wasm_bg.wasm'),
    )

    copyStreamingWorker(tmpDir, 'dist')

    const { server, url } = staticServe(distDir)
    const smoke = await runBrowserSmoke(url)
    results = smoke.results
    teardown = cleanup({ browsers: smoke.browsers, server, tmpDir, tarball })
  }, 180_000)

  afterAll(async () => {
    if (teardown) await teardown()
  })

  test.each([...ENGINES])('rollup-built page runs the SDK end-to-end in %s', (engine) => {
    const result = results[engine]
    if (!result.ok) throw new Error(`rollup smoke failed: ${result.error}`)
    expect(result.ok).toBe(true)
  })

  test.each([...ENGINES])('streaming turns on with the worker the CLI copied into dist/ in %s', (engine) => {
    expect(results[engine].streaming).toBe(true)
  })

  // WASM .d.ts must resolve under the "browser" condition for rollup consumers.
  // tsconfig.json + typecheck.ts are checked in at fixtures/rollup-app/.
  test('typecheck: WASM types resolve under the "browser" condition', () => {
    execSync('npx --no -- tsc --noEmit -p tsconfig.json', {
      cwd: tmpDir,
      stdio: ['pipe', 'pipe', 'pipe'],
    })
  })
})
