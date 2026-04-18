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
} from './_bundler-helpers'

describe('next.js bundler integration (App Router, static export)', () => {
  let tmpDir: string
  let tarball: string
  let teardown: () => Promise<void>
  let result: { ok: boolean; error?: string }

  beforeAll(async () => {
    ;({ tmpDir, tarball } = packIntoTmp('nextjs'))
    cpSync(
      join(FIXTURES, 'nextjs-app'),
      tmpDir,
      { recursive: true },
    )
    // package.json must exist; copy a minimal one alongside the fixtures.
    Bun.write(
      join(tmpDir, 'package.json'),
      JSON.stringify(
        {
          name: 'test',
          version: '1.0.0',
          private: true,
          scripts: { build: 'next build' },
        },
        null,
        2,
      ),
    )

    npmInstall(tmpDir, `${tarball} next react react-dom typescript @types/node @types/react @types/react-dom`)

    // Next 16 defaults to Turbopack — we test the default since that's
    // what users actually get. The smoke component is dynamic({ssr:false})
    // so the SDK module doesn't get loaded during prerender.
    execSync('npx next build', {
      cwd: tmpDir,
      stdio: ['pipe', 'pipe', 'pipe'],
    })

    const outDir = join(tmpDir, 'out')
    const { server, url } = staticServe(outDir)
    const smoke = await runChromiumSmoke(url)
    result = smoke.result
    teardown = cleanup({ browser: smoke.browser, server, tmpDir, tarball })
  }, 360_000)

  afterAll(async () => {
    if (teardown) await teardown()
  })

  test('Next.js (App Router, static export) runs the SDK end-to-end', () => {
    if (!result.ok) throw new Error(`Next.js smoke failed: ${result.error}`)
    expect(result.ok).toBe(true)
  })
})
