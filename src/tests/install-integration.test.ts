import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { execSync } from 'node:child_process'
import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { TS_BUILD, TS_NATIVE } from './_ts-versions'

// Verify the published tarball works end-to-end in Node and Bun.

const ROOT = join(import.meta.dir, '..', '..')
const PKG_VERSION = JSON.parse(
  readFileSync(join(ROOT, 'package.json'), 'utf-8'),
).version
const FIXTURES = join(import.meta.dir, 'fixtures')
const SMOKE_FIXTURE = join(FIXTURES, 'node-smoke.mjs')

// Each fixture exercises one TypeScript resolution mode against the installed
// tarball and asserts the exports pick the correct .d.ts:
//   node-app, bun-app - bundler mode + customConditions, NAPI types
//   nodenext-app      - nodenext resolution, NAPI types via the "node" condition
//   default-app       - no customConditions, falls through to exports "default"
//   vite-app          - customConditions ["browser"], WASM types
const RESOLUTION_FIXTURES = [
  'node-app',
  'bun-app',
  'nodenext-app',
  'default-app',
  'vite-app',
]

function typecheckFixture(
  appName: string,
  projectDir: string,
  tscCommand: string,
) {
  const appDir = join(FIXTURES, appName)
  const tsconfigName = `tsconfig.${appName.replace('-app', '')}.json`
  cpSync(join(appDir, 'typecheck.ts'), join(projectDir, 'typecheck.ts'))
  cpSync(join(appDir, 'tsconfig.json'), join(projectDir, tsconfigName))
  execSync(`${tscCommand} --noEmit -p ${tsconfigName}`, {
    cwd: projectDir,
    stdio: ['pipe', 'pipe', 'pipe'],
  })
}

describe('installed tarball', () => {
  let tmpDir: string
  let tarball: string
  let tsNativeDir: string

  beforeAll(() => {
    const packOutput = execSync('npm pack', {
      cwd: ROOT,
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'pipe'],
    }).trim()
    tarball = join(ROOT, packOutput)

    tmpDir = mkdtempSync(join(tmpdir(), 'sia-integration-'))
    writeFileSync(
      join(tmpDir, 'package.json'),
      JSON.stringify({ name: 'test', version: '1.0.0', type: 'module' }),
    )
    // --no-optional: the platform package is staged from this build below, so
    // npm must not fetch the published one.
    execSync(`npm install ${tarball} typescript@${TS_BUILD} --no-optional`, {
      cwd: tmpDir,
      stdio: ['pipe', 'pipe', 'pipe'],
    })

    // Stage the platform NAPI binary the local/CI build produced.
    const platform = process.platform
    const arch = process.arch
    let suffix = `${platform}-${arch}`
    if (platform === 'linux') suffix += '-gnu'
    else if (platform === 'win32') suffix += '-msvc'
    const binarySource = join(
      ROOT,
      'node_modules',
      '@siafoundation',
      `sia-storage-${suffix}`,
      'sia-storage.node',
    )
    if (!existsSync(binarySource)) {
      throw new Error(
        `NAPI binary not found at ${binarySource}. Run "bun run setup-napi-test" first.`,
      )
    }
    const targetDir = join(
      tmpDir,
      'node_modules',
      '@siafoundation',
      `sia-storage-${suffix}`,
    )
    mkdirSync(targetDir, { recursive: true })
    cpSync(binarySource, join(targetDir, 'sia-storage.node'))
    writeFileSync(
      join(targetDir, 'package.json'),
      JSON.stringify({
        name: `@siafoundation/sia-storage-${suffix}`,
        version: PKG_VERSION,
        main: 'sia-storage.node',
      }),
    )

    cpSync(SMOKE_FIXTURE, join(tmpDir, 'smoke.mjs'))

    // Its own project: typescript@7 ships its compiler binary as an optional
    // dependency, which the install above skips.
    tsNativeDir = mkdtempSync(join(tmpdir(), 'sia-ts-native-'))
    writeFileSync(
      join(tsNativeDir, 'package.json'),
      JSON.stringify({ name: 'ts-native', version: '1.0.0' }),
    )
    execSync(`npm install typescript@${TS_NATIVE}`, {
      cwd: tsNativeDir,
      stdio: ['pipe', 'pipe', 'pipe'],
    })
  }, 60_000)

  afterAll(() => {
    if (tmpDir && existsSync(tmpDir)) rmSync(tmpDir, { recursive: true, force: true })
    if (tsNativeDir && existsSync(tsNativeDir))
      rmSync(tsNativeDir, { recursive: true, force: true })
    if (tarball && existsSync(tarball)) rmSync(tarball)
  })

  test('pack output includes the files consumers need', () => {
    const json = execSync('npm pack --dry-run --json', {
      cwd: ROOT,
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'pipe'],
    })
    const [info] = JSON.parse(json)
    const files = info.files.map((f: { path: string }) => f.path)
    expect(files).toContain('dist/index.js')
    expect(files).toContain('dist/index.node.cjs')
    expect(files).toContain('wasm/sia_storage_wasm.js')
    expect(files).toContain('wasm/sia_storage_wasm_bg.wasm')
  })

  test('runs under node', () => {
    execSync('node smoke.mjs', { cwd: tmpDir, stdio: ['pipe', 'pipe', 'pipe'] })
  })

  test('runs under bun', () => {
    execSync('bun run smoke.mjs', {
      cwd: tmpDir,
      stdio: ['pipe', 'pipe', 'pipe'],
    })
  })

  test.each(RESOLUTION_FIXTURES)(`typecheck %s on typescript ${TS_BUILD}`, (appName) => {
    typecheckFixture(appName, tmpDir, 'npx --no -- tsc')
  })

  // The native compiler is what `npm install typescript` now resolves to. It
  // cannot build this package, but it has to resolve the published types.
  test.each(RESOLUTION_FIXTURES)(`typecheck %s on typescript ${TS_NATIVE}`, (appName) => {
    const tsc = join(tsNativeDir, 'node_modules', '.bin', 'tsc')
    typecheckFixture(appName, tmpDir, `"${tsc}"`)
  })
})
