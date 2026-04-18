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

describe('vite bundler integration', () => {
  let tmpDir: string
  let tarball: string
  let teardown: () => Promise<void>
  let result: { ok: boolean; error?: string }

  beforeAll(async () => {
    ;({ tmpDir, tarball } = packIntoTmp('vite'))
    writePackageJson(tmpDir)

    const fixtureDir = join(FIXTURES, 'vite-app')
    copyFixtures(fixtureDir, tmpDir, ['index.html', 'vite.config.js'])
    cpSync(join(FIXTURES, 'browser-smoke.js'), join(tmpDir, 'main.js'))

    npmInstall(tmpDir, `${tarball} vite`)
    execSync('npx vite build --logLevel error', {
      cwd: tmpDir,
      stdio: ['pipe', 'pipe', 'pipe'],
    })

    const { server, url } = staticServe(join(tmpDir, 'dist'))
    const smoke = await runChromiumSmoke(url)
    result = smoke.result
    teardown = cleanup({ browser: smoke.browser, server, tmpDir, tarball })
  }, 180_000)

  afterAll(async () => {
    if (teardown) await teardown()
  })

  test('Vite-built page runs the SDK end-to-end', () => {
    if (!result.ok) throw new Error(`Vite smoke failed: ${result.error}`)
    expect(result.ok).toBe(true)
  })
})
