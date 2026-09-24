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

describe('esbuild bundler integration', () => {
  let tmpDir: string
  let tarball: string
  let teardown: () => Promise<void>
  let results: Record<(typeof ENGINES)[number], SmokeResult>

  beforeAll(async () => {
    ;({ tmpDir, tarball } = packIntoTmp('esbuild'))
    writePackageJson(tmpDir)

    const fixtureDir = join(FIXTURES, 'esbuild-app')
    cpSync(join(FIXTURES, 'browser-smoke.js'), join(tmpDir, 'main.js'))
    copyFixtures(fixtureDir, tmpDir, ['tsconfig.json', 'typecheck.ts'])

    npmInstall(tmpDir, `${tarball} esbuild typescript@${TS_BUILD}`)

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

    copyStreamingWorker(tmpDir, 'dist')

    const { server, url } = staticServe(distDir)
    const smoke = await runBrowserSmoke(url)
    results = smoke.results
    teardown = cleanup({ browsers: smoke.browsers, server, tmpDir, tarball })
  }, 180_000)

  afterAll(async () => {
    if (teardown) await teardown()
  })

  test.each([...ENGINES])('esbuild-built page runs the SDK end-to-end in %s', (engine) => {
    const result = results[engine]
    if (!result.ok) throw new Error(`esbuild smoke failed: ${result.error}`)
    expect(result.ok).toBe(true)
  })

  test.each([...ENGINES])('streaming turns on with the worker the CLI copied into dist/ in %s', (engine) => {
    expect(results[engine].streaming).toBe(true)
  })

  // WASM .d.ts must resolve under the "browser" condition for esbuild consumers.
  // tsconfig.json + typecheck.ts are checked in at fixtures/esbuild-app/.
  test('typecheck: WASM types resolve under the "browser" condition', () => {
    execSync('npx --no -- tsc --noEmit -p tsconfig.json', {
      cwd: tmpDir,
      stdio: ['pipe', 'pipe', 'pipe'],
    })
  })
})
