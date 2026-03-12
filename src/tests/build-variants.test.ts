import { describe, expect, test, beforeAll } from 'bun:test'
import { existsSync, readFileSync } from 'fs'
import { join } from 'path'

const distDir = join(import.meta.dir, '..', '..', 'dist')

// ---------------------------------------------------------------------------
// Build output — both entries are generated
// ---------------------------------------------------------------------------

describe('build output', () => {
  test('browser entry exists', () => {
    expect(existsSync(join(distDir, 'index.js'))).toBe(true)
    expect(existsSync(join(distDir, 'index.d.ts'))).toBe(true)
  })

  test('node entry exists', () => {
    expect(existsSync(join(distDir, 'index.node.js'))).toBe(true)
    expect(existsSync(join(distDir, 'index.node.d.ts'))).toBe(true)
  })

  test('worker files are copied', () => {
    expect(
      existsSync(join(distDir, 'workers', 'slab-download-worker.ts')),
    ).toBe(true)
    expect(
      existsSync(join(distDir, 'workers', 'slab-upload-worker.ts')),
    ).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// Browser entry — verified via declaration file (can't import sia-wasm in bun)
// ---------------------------------------------------------------------------

describe('browser entry (WASM) — static checks', () => {
  let dts: string

  beforeAll(() => {
    dts = readFileSync(join(distDir, 'index.d.ts'), 'utf-8')
  })

  test('declares initSia', () => {
    expect(dts).toContain('declare function initSia')
  })

  test('declares SiaClient class', () => {
    expect(dts).toContain('declare class SiaClient')
  })

  test('declares connect function', () => {
    expect(dts).toContain('declare function connect')
  })

  test('SiaClient has upload and download methods', () => {
    expect(dts).toContain('upload(file:')
    expect(dts).toContain('download(object:')
    expect(dts).toContain('downloadRange(object:')
  })

  test('declares Builder class', () => {
    expect(dts).toContain('declare class Builder')
  })

  test('re-exports WASM SDK types', () => {
    expect(dts).toContain('AppKey')
    expect(dts).toContain('Builder')
    expect(dts).toContain('PinnedObject')
    expect(dts).toContain('generateRecoveryPhrase')
    expect(dts).toContain('validateRecoveryPhrase')
    expect(dts).toContain('setLogLevel')
  })

  test('exports shared utility types', () => {
    expect(dts).toContain('toHex')
    expect(dts).toContain('fromHex')
    expect(dts).toContain('decodeMetadata')
  })

  test('exports progress types', () => {
    expect(dts).toContain('DownloadProgress')
    expect(dts).toContain('DownloadConfig')
    expect(dts).toContain('UploadProgress')
  })

  test('browser JS imports from sia-wasm', () => {
    const js = readFileSync(join(distDir, 'index.js'), 'utf-8')
    expect(js).toContain('from "sia-wasm"')
  })
})

// ---------------------------------------------------------------------------
// Node entry — full dynamic import tests with real NAPI binary
// ---------------------------------------------------------------------------

describe('node entry (NAPI)', () => {
  let mod: any

  beforeAll(async () => {
    mod = await import('../../dist/index.node.js')
  })

  test('exports shared utilities', () => {
    expect(typeof mod.toHex).toBe('function')
    expect(typeof mod.fromHex).toBe('function')
    expect(typeof mod.decodeMetadata).toBe('function')
  })

  test('exports NAPI SDK symbols', () => {
    expect(typeof mod.initSia).toBe('function')
    expect(typeof mod.connect).toBe('function')
    expect(typeof mod.generateRecoveryPhrase).toBe('function')
    expect(typeof mod.validateRecoveryPhrase).toBe('function')
    expect(typeof mod.setLogLevel).toBe('function')
    expect(mod.SiaClient).toBeDefined()
    expect(mod.AppKey).toBeDefined()
    expect(mod.Builder).toBeDefined()
    expect(mod.PinnedObject).toBeDefined()
  })

  test('shared utilities work correctly', () => {
    expect(mod.toHex(new Uint8Array([0xde, 0xad]))).toBe('dead')
    expect(mod.fromHex('beef')).toEqual(new Uint8Array([0xbe, 0xef]))
    expect(
      mod.decodeMetadata(new TextEncoder().encode('{"key":"value"}')),
    ).toEqual({ key: 'value' })
  })
})

// ---------------------------------------------------------------------------
// Node NAPI binary — exercises the real native addon
// ---------------------------------------------------------------------------

describe('node NAPI binary', () => {
  let mod: any

  beforeAll(async () => {
    mod = await import('../../dist/index.node.js')
  })

  test('initSia() succeeds (loads native addon)', async () => {
    await mod.initSia()
  })

  test('generateRecoveryPhrase returns 12 words', () => {
    const phrase = mod.generateRecoveryPhrase()
    const words = phrase.trim().split(/\s+/)
    expect(words.length).toBe(12)
  })

  test('validateRecoveryPhrase accepts valid phrase', () => {
    const phrase = mod.generateRecoveryPhrase()
    expect(() => mod.validateRecoveryPhrase(phrase)).not.toThrow()
  })

  test('validateRecoveryPhrase rejects invalid phrase', () => {
    expect(() => mod.validateRecoveryPhrase('bad phrase here')).toThrow()
  })

  test('AppKey from seed', () => {
    const seed = new Uint8Array(32).fill(1)
    const key = new mod.AppKey(seed)
    expect(typeof key.publicKey()).toBe('string')
    expect(key.publicKey()).toMatch(/^ed25519:/)
  })

  test('AppKey.export() returns full 64-byte keypair', () => {
    const seed = new Uint8Array(32).fill(42)
    const key = new mod.AppKey(seed)
    const exported = key.export()
    expect(exported).toBeInstanceOf(Uint8Array)
    expect(exported.length).toBe(64)
    // First 32 bytes are the seed
    expect(exported.slice(0, 32)).toEqual(seed)
  })

  test('AppKey round-trips through 64-byte export/import', () => {
    const seed = new Uint8Array(32).fill(42)
    const key = new mod.AppKey(seed)
    const exported = key.export()
    const reimported = new mod.AppKey(exported)
    expect(reimported.publicKey()).toBe(key.publicKey())
  })

  test('AppKey.sign() returns 64-byte signature', () => {
    const key = new mod.AppKey(new Uint8Array(32).fill(1))
    const sig = key.sign(new Uint8Array([1, 2, 3]))
    expect(sig).toBeInstanceOf(Uint8Array)
    expect(sig.length).toBe(64)
  })

  test('AppKey.verifySignature() roundtrip', () => {
    const key = new mod.AppKey(new Uint8Array(32).fill(7))
    const msg = new Uint8Array([10, 20, 30])
    const sig = key.sign(msg)
    expect(key.verifySignature(msg, sig)).toBe(true)
    expect(key.verifySignature(new Uint8Array([99]), sig)).toBe(false)
  })

  test('same seed produces same publicKey', () => {
    const seed = new Uint8Array(32).fill(5)
    expect(new mod.AppKey(seed).publicKey()).toBe(
      new mod.AppKey(seed).publicKey(),
    )
  })

  test('different seeds produce different publicKeys', () => {
    const key1 = new mod.AppKey(new Uint8Array(32).fill(1))
    const key2 = new mod.AppKey(new Uint8Array(32).fill(2))
    expect(key1.publicKey()).not.toBe(key2.publicKey())
  })

  test('Builder can be constructed', () => {
    const builder = new mod.Builder('https://indexer.example.com')
    expect(builder).toBeDefined()
    expect(typeof builder.connected).toBe('function')
    expect(typeof builder.requestConnection).toBe('function')
    expect(typeof builder.responseUrl).toBe('function')
    expect(typeof builder.waitForApproval).toBe('function')
    expect(typeof builder.setConnectionResponse).toBe('function')
    expect(typeof builder.register).toBe('function')
  })

  test('Builder.connected() fails gracefully with no server', async () => {
    const builder = new mod.Builder('https://indexer.example.com')
    const key = new mod.AppKey(new Uint8Array(32).fill(99))
    try {
      const result = await builder.connected(key)
      // If we somehow get here, null is acceptable
      expect(result).toBeNull()
    } catch (e: any) {
      // Network error expected — verify it's a connection error, not a crash
      expect(e.message).toBeDefined()
    }
  })

  test('setLogLevel is a no-op that does not throw', () => {
    expect(() => mod.setLogLevel('debug')).not.toThrow()
    expect(() => mod.setLogLevel('error')).not.toThrow()
  })
})

// ---------------------------------------------------------------------------
// API surface parity — checked via declaration files
// ---------------------------------------------------------------------------

describe('API surface parity', () => {
  test('both entries export the same core symbol names', () => {
    const browserDts = readFileSync(join(distDir, 'index.d.ts'), 'utf-8')
    const nodeDts = readFileSync(join(distDir, 'index.node.d.ts'), 'utf-8')

    const requiredSymbols = [
      'SiaClient',
      'connect',
      'initSia',
      'toHex',
      'fromHex',
      'decodeMetadata',
      'AppKey',
      'Builder',
      'PinnedObject',
      'generateRecoveryPhrase',
      'validateRecoveryPhrase',
      'setLogLevel',
      'DownloadProgress',
      'DownloadConfig',
      'UploadProgress',
    ]

    for (const name of requiredSymbols) {
      expect(browserDts).toContain(name)
      expect(nodeDts).toContain(name)
    }
  })
})
