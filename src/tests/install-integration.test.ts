import { describe, expect, test, beforeAll, afterAll } from 'bun:test'
import { execSync } from 'child_process'
import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'

const ROOT = join(import.meta.dir, '..', '..')
const PKG_VERSION = JSON.parse(
  readFileSync(join(ROOT, 'package.json'), 'utf-8'),
).version

// ---------------------------------------------------------------------------
// Tarball contents — verify npm pack includes exactly the right files
// ---------------------------------------------------------------------------

describe('tarball contents', () => {
  let files: string[]

  beforeAll(() => {
    const json = execSync('npm pack --dry-run --json', {
      cwd: ROOT,
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'pipe'],
    })
    const [info] = JSON.parse(json)
    files = info.files.map((f: { path: string }) => f.path)
  })

  test('includes browser entry', () => {
    expect(files).toContain('dist/index.js')
    expect(files).toContain('dist/index.d.ts')
  })

  test('includes node entry', () => {
    expect(files).toContain('dist/index.node.js')
    expect(files).toContain('dist/index.node.d.ts')
  })

  test('includes WASM module', () => {
    expect(files).toContain('wasm/sia.js')
    expect(files).toContain('wasm/sia.d.ts')
    expect(files).toContain('wasm/sia_bg.wasm')
  })

  test('includes worker source files', () => {
    expect(files).toContain('src/workers/slab-download-worker.ts')
    expect(files).toContain('src/workers/slab-upload-worker.ts')
  })

  test('excludes source .ts files (except workers)', () => {
    const srcTs = files.filter(
      (f: string) =>
        f.startsWith('src/') && f.endsWith('.ts') && !f.includes('workers/'),
    )
    expect(srcTs).toEqual([])
  })

  test('excludes node_modules, .node binaries, and rust/', () => {
    const excluded = files.filter(
      (f: string) =>
        f.includes('node_modules/') ||
        f.endsWith('.node') ||
        f.startsWith('rust/'),
    )
    expect(excluded).toEqual([])
  })
})

// ---------------------------------------------------------------------------
// Installed package tests — npm pack + install into isolated temp dir
// ---------------------------------------------------------------------------

describe('installed package', () => {
  let tmpDir: string
  let pkgRoot: string
  let tarball: string

  function installNapiBinary(installRoot: string) {
    const platform = process.platform
    const arch = process.arch
    let suffix = `${platform}-${arch}`
    if (platform === 'linux') suffix += '-gnu'
    else if (platform === 'win32') suffix += '-msvc'

    const binarySource = join(
      ROOT,
      'node_modules',
      '@siafoundation',
      `sia-${suffix}`,
      'indexd_node.node',
    )
    if (!existsSync(binarySource)) {
      throw new Error(
        `NAPI binary not found at ${binarySource}. Run "bun run setup-napi-test" first.`,
      )
    }

    const targetDir = join(
      installRoot,
      'node_modules',
      '@siafoundation',
      `sia-${suffix}`,
    )
    mkdirSync(targetDir, { recursive: true })
    cpSync(binarySource, join(targetDir, 'indexd_node.node'))
    writeFileSync(
      join(targetDir, 'package.json'),
      JSON.stringify({
        name: `@siafoundation/sia-${suffix}`,
        version: PKG_VERSION,
        main: 'indexd_node.node',
      }),
    )
  }

  const testScript = `
import {
  initSia, toHex, fromHex, decodeMetadata,
  generateRecoveryPhrase, validateRecoveryPhrase,
  AppKey, Builder, SiaClient, connect,
  upload, download, UploadOptions, DownloadOptions, setLogLevel,
} from '@siafoundation/sia'

const checks = {
  initSia: typeof initSia === 'function',
  toHex: typeof toHex === 'function',
  fromHex: typeof fromHex === 'function',
  decodeMetadata: typeof decodeMetadata === 'function',
  generateRecoveryPhrase: typeof generateRecoveryPhrase === 'function',
  validateRecoveryPhrase: typeof validateRecoveryPhrase === 'function',
  AppKey: typeof AppKey === 'function',
  Builder: typeof Builder === 'function',
  SiaClient: typeof SiaClient === 'function',
  connect: typeof connect === 'function',
  upload: typeof upload === 'function',
  download: typeof download === 'function',
  UploadOptions: typeof UploadOptions === 'function',
  DownloadOptions: typeof DownloadOptions === 'function',
  setLogLevel: typeof setLogLevel === 'function',
}

await initSia()
const phrase = generateRecoveryPhrase()
validateRecoveryPhrase(phrase)
const key = new AppKey(new Uint8Array(32).fill(1))

const allPassed = Object.values(checks).every(v => v)
console.log(JSON.stringify({ ok: allPassed, checks }))
`

  beforeAll(() => {
    // Create tarball
    const packOutput = execSync('npm pack', {
      cwd: ROOT,
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'pipe'],
    }).trim()
    tarball = join(ROOT, packOutput)

    // Create isolated temp directory
    tmpDir = mkdtempSync(join(tmpdir(), 'sia-integration-'))

    // Create minimal package.json
    writeFileSync(
      join(tmpDir, 'package.json'),
      JSON.stringify({
        name: 'test-project',
        version: '1.0.0',
        type: 'module',
      }),
    )

    // Install the tarball (skip optional deps — we copy the binary manually)
    execSync(`npm install ${tarball} --no-optional`, {
      cwd: tmpDir,
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'pipe'],
    })

    pkgRoot = join(tmpDir, 'node_modules', '@siafoundation', 'sia')

    // Copy NAPI binary into the installed package's node_modules
    installNapiBinary(tmpDir)
  }, 30_000)

  afterAll(() => {
    if (tmpDir && existsSync(tmpDir)) {
      rmSync(tmpDir, { recursive: true, force: true })
    }
    if (tarball && existsSync(tarball)) {
      rmSync(tarball)
    }
  })

  // -------------------------------------------------------------------------
  // Node.js import — spawn subprocess to verify real import resolution
  // -------------------------------------------------------------------------

  describe('node.js import', () => {
    test('can import and use the package', () => {
      const scriptPath = join(tmpDir, 'test-node.mjs')
      writeFileSync(scriptPath, testScript)

      const result = execSync(`node ${scriptPath}`, {
        cwd: tmpDir,
        encoding: 'utf-8',
        stdio: ['pipe', 'pipe', 'pipe'],
      })

      const output = JSON.parse(result.trim())
      expect(output.ok).toBe(true)
      for (const [, value] of Object.entries(output.checks)) {
        expect(value).toBe(true)
      }
    })
  })

  // -------------------------------------------------------------------------
  // Bun import — same test but via bun runtime
  // -------------------------------------------------------------------------

  describe('bun import', () => {
    test('can import and use the package', () => {
      const scriptPath = join(tmpDir, 'test-bun.mjs')
      writeFileSync(scriptPath, testScript)

      const result = execSync(`bun run ${scriptPath}`, {
        cwd: tmpDir,
        encoding: 'utf-8',
        stdio: ['pipe', 'pipe', 'pipe'],
      })

      const output = JSON.parse(result.trim())
      expect(output.ok).toBe(true)
      for (const [, value] of Object.entries(output.checks)) {
        expect(value).toBe(true)
      }
    })
  })

  // -------------------------------------------------------------------------
  // Browser entry — static analysis (no real browser needed)
  // -------------------------------------------------------------------------

  describe('browser entry (static)', () => {
    test('browser JS imports from sia-wasm, not native addon', () => {
      const js = readFileSync(join(pkgRoot, 'dist', 'index.js'), 'utf-8')
      expect(js).toContain('from "sia-wasm"')
      expect(js).not.toMatch(/require\s*\(/)
    })

    test('WASM files are present in installed package', () => {
      expect(existsSync(join(pkgRoot, 'wasm', 'sia.js'))).toBe(true)
      expect(existsSync(join(pkgRoot, 'wasm', 'sia_bg.wasm'))).toBe(true)
      expect(existsSync(join(pkgRoot, 'wasm', 'sia.d.ts'))).toBe(true)
    })

    test('type declarations contain expected symbols', () => {
      const browserDts = readFileSync(
        join(pkgRoot, 'dist', 'index.d.ts'),
        'utf-8',
      )
      const nodeDts = readFileSync(
        join(pkgRoot, 'dist', 'index.node.d.ts'),
        'utf-8',
      )

      const symbols = [
        'SiaClient',
        'connect',
        'initSia',
        'download',
        'upload',
        'toHex',
        'fromHex',
        'decodeMetadata',
        'AppKey',
        'Builder',
        'UploadOptions',
        'DownloadOptions',
        'generateRecoveryPhrase',
        'validateRecoveryPhrase',
        'setLogLevel',
      ]

      for (const sym of symbols) {
        expect(browserDts).toContain(sym)
        expect(nodeDts).toContain(sym)
      }
    })
  })
})
