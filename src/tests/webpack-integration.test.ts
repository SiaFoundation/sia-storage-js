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
  runChromiumSmoke,
  staticServe,
  writePackageJson,
} from './_bundler-helpers'

describe('webpack 5 bundler integration', () => {
  let tmpDir: string
  let tarball: string
  let teardown: () => Promise<void>
  let result: { ok: boolean; error?: string }

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

    npmInstall(tmpDir, `${tarball} webpack webpack-cli html-webpack-plugin typescript`)
    execSync('npx webpack --config webpack.config.cjs', {
      cwd: tmpDir,
      stdio: ['pipe', 'pipe', 'pipe'],
    })

    const { server, url } = staticServe(join(tmpDir, 'dist'))
    const smoke = await runChromiumSmoke(url)
    result = smoke.result
    teardown = cleanup({ browser: smoke.browser, server, tmpDir, tarball })
  }, 240_000)

  afterAll(async () => {
    if (teardown) await teardown()
  })

  test('webpack-built page runs the SDK end-to-end', () => {
    if (!result.ok) throw new Error(`webpack smoke failed: ${result.error}`)
    expect(result.ok).toBe(true)
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
