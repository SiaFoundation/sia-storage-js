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
  copyStreamingWorker,
  ENGINES,
  runBrowserSmoke,
  type SmokeResult,
  staticServe,
  writePackageJson,
} from './_bundler-helpers'
import { TS_BUILD } from './_ts-versions'

describe('webpack 5 bundler integration', () => {
  let tmpDir: string
  let tarball: string
  let teardown: () => Promise<void>
  let results: Record<(typeof ENGINES)[number], SmokeResult>

  beforeAll(async () => {
    ;({ tmpDir, tarball } = packIntoTmp('webpack'))
    // webpack expects CommonJS for its config when type: module isn't desired.
    writePackageJson(tmpDir, { type: undefined })

    const fixtureDir = join(FIXTURES, 'webpack-app')
    copyFixtures(fixtureDir, tmpDir, [
      'index.html',
      'webpack.config.cjs',
      'tsconfig.json',
      'typecheck.ts',
    ])
    cpSync(join(FIXTURES, 'browser-smoke.js'), join(tmpDir, 'main.js'))

    npmInstall(tmpDir, `${tarball} webpack webpack-cli html-webpack-plugin typescript@${TS_BUILD}`)
    execSync('npx webpack --config webpack.config.cjs', {
      cwd: tmpDir,
      stdio: ['pipe', 'pipe', 'pipe'],
    })

    copyStreamingWorker(tmpDir, 'dist')

    const { server, url } = staticServe(join(tmpDir, 'dist'))
    const smoke = await runBrowserSmoke(url)
    results = smoke.results
    teardown = cleanup({ browsers: smoke.browsers, server, tmpDir, tarball })
  }, 240_000)

  afterAll(async () => {
    if (teardown) await teardown()
  })

  test.each([...ENGINES])('webpack-built page runs the SDK end-to-end in %s', (engine) => {
    const result = results[engine]
    if (!result.ok) throw new Error(`webpack smoke failed: ${result.error}`)
    expect(result.ok).toBe(true)
  })

  test.each([...ENGINES])('streaming turns on with the worker the CLI copied into dist/ in %s', (engine) => {
    expect(results[engine].streaming).toBe(true)
  })

  // WASM .d.ts must resolve under the "browser" condition for webpack consumers.
  // tsconfig.json + typecheck.ts are checked in at fixtures/webpack-app/.
  test('typecheck: WASM types resolve under the "browser" condition', () => {
    execSync('npx --no -- tsc --noEmit -p tsconfig.json', {
      cwd: tmpDir,
      stdio: ['pipe', 'pipe', 'pipe'],
    })
  })
})
