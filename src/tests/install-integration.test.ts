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

// Verify the published tarball works end-to-end in Node and Bun.

const ROOT = join(import.meta.dir, '..', '..')
const PKG_VERSION = JSON.parse(
  readFileSync(join(ROOT, 'package.json'), 'utf-8'),
).version
const SMOKE_FIXTURE = join(import.meta.dir, 'fixtures', 'node-smoke.mjs')

describe('installed tarball', () => {
  let tmpDir: string
  let tarball: string

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
    execSync(`npm install ${tarball} --no-optional`, {
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
      `sia-storage-${suffix}`,
      'sia-storage.node',
    )
    if (!existsSync(binarySource)) {
      throw new Error(
        `NAPI binary not found at ${binarySource}. Run "bun run setup-napi-test" first.`,
      )
    }
    const targetDir = join(tmpDir, 'node_modules', `sia-storage-${suffix}`)
    mkdirSync(targetDir, { recursive: true })
    cpSync(binarySource, join(targetDir, 'sia-storage.node'))
    writeFileSync(
      join(targetDir, 'package.json'),
      JSON.stringify({
        name: `sia-storage-${suffix}`,
        version: PKG_VERSION,
        main: 'sia-storage.node',
      }),
    )

    cpSync(SMOKE_FIXTURE, join(tmpDir, 'smoke.mjs'))
  }, 30_000)

  afterAll(() => {
    if (tmpDir && existsSync(tmpDir)) rmSync(tmpDir, { recursive: true, force: true })
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
})
