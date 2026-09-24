import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { execSync } from 'node:child_process'
import { cpSync, existsSync } from 'node:fs'
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
  staticServe,
  writePackageJson,
} from './_bundler-helpers'
import { TS_BUILD } from './_ts-versions'

describe('vite bundler integration', () => {
  let tmpDir: string
  let tarball: string
  let teardown: () => Promise<void>
  let results: Record<(typeof ENGINES)[number], SmokeResult>

  beforeAll(async () => {
    ;({ tmpDir, tarball } = packIntoTmp('vite'))
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
    execSync('npx vite build --logLevel error', {
      cwd: tmpDir,
      stdio: ['pipe', 'pipe', 'pipe'],
    })

    const { server, url } = staticServe(join(tmpDir, 'dist'))
    const smoke = await runBrowserSmoke(url)
    results = smoke.results
    teardown = cleanup({ browsers: smoke.browsers, server, tmpDir, tarball })
  }, 180_000)

  afterAll(async () => {
    if (teardown) await teardown()
  })

  test.each([...ENGINES])('Vite-built page runs the SDK end-to-end in %s', (engine) => {
    const result = results[engine]
    if (!result.ok) throw new Error(`Vite smoke failed: ${result.error}`)
    expect(result.ok).toBe(true)
  })

  // Structural types keep the plugin free of a Vite dependency, so check they
  // still satisfy Vite's own plugin type.
  test('typecheck: the plugin satisfies Vite\'s PluginOption', async () => {
    await Bun.write(
      join(tmpDir, 'plugin-typecheck.ts'),
      [
        "import type { PluginOption } from 'vite'",
        "import { siaStorage } from '@siafoundation/sia-storage/vite'",
        'const plugin: PluginOption = siaStorage()',
        'void plugin',
      ].join('\n'),
    )
    execSync(
      'npx --no -- tsc --noEmit --strict --skipLibCheck --module esnext --moduleResolution bundler --target es2022 plugin-typecheck.ts',
      { cwd: tmpDir, stdio: ['pipe', 'pipe', 'pipe'] },
    )
  })

  test.each([...ENGINES])('streaming turns on with the worker the plugin emits at the root in %s', (engine) => {
    expect(existsSync(join(tmpDir, 'dist', 'sia-storage-sw.js'))).toBe(true)
    expect(results[engine].streaming).toBe(true)
  })

  // WASM .d.ts must resolve under the "browser" condition for vite consumers.
  // tsconfig.json + typecheck.ts are checked in at fixtures/vite-app/.
  test('typecheck: WASM types resolve under the "browser" condition', () => {
    execSync('npx --no -- tsc --noEmit -p tsconfig.json', {
      cwd: tmpDir,
      stdio: ['pipe', 'pipe', 'pipe'],
    })
  })
})
