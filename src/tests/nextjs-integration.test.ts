import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { execSync } from 'node:child_process'
import { cpSync, existsSync, mkdirSync } from 'node:fs'
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
} from './_bundler-helpers'
import { TS_BUILD } from './_ts-versions'

describe('next.js bundler integration (App Router, static export)', () => {
  let tmpDir: string
  let tarball: string
  let teardown: () => Promise<void>
  let results: Record<(typeof ENGINES)[number], SmokeResult>

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

    npmInstall(tmpDir, `${tarball} next react react-dom typescript@${TS_BUILD} @types/node @types/react @types/react-dom`)

    // Next 16 defaults to Turbopack — we test the default since that's
    // what users actually get. The smoke component is dynamic({ssr:false})
    // so the SDK module doesn't get loaded during prerender.
    execSync('npx next build', {
      cwd: tmpDir,
      stdio: ['pipe', 'pipe', 'pipe'],
    })

    const outDir = join(tmpDir, 'out')
    const { server, url } = staticServe(outDir)
    const smoke = await runBrowserSmoke(url)
    results = smoke.results
    teardown = cleanup({ browsers: smoke.browsers, server, tmpDir, tarball })
  }, 360_000)

  afterAll(async () => {
    if (teardown) await teardown()
  })

  test.each([...ENGINES])('Next.js (App Router, static export) runs the SDK end-to-end in %s', (engine) => {
    const result = results[engine]
    if (!result.ok) throw new Error(`Next.js smoke failed: ${result.error}`)
    expect(result.ok).toBe(true)
  })

  test.each([...ENGINES])('streaming turns on with the worker the route handler exports in %s', (engine) => {
    expect(existsSync(join(tmpDir, 'out', 'sia-storage-sw.js'))).toBe(true)
    expect(results[engine].streaming).toBe(true)
  })
})
