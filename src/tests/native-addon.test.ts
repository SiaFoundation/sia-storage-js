import { expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { addonLoadError } from '../node/load'
import { NATIVE_PACKAGES } from '../node/platforms'

test('a failed load names the published package and keeps the reason', () => {
  const cause = new Error('libc.so.6: version GLIBC_2.38 not found')
  const error = addonLoadError('linux-x64', cause)
  expect(error.message).toContain('@siafoundation/sia-storage-linux-x64-gnu')
  expect(error.message).toContain('GLIBC_2.38 not found')
  expect(error.cause).toBe(cause)
})

test('a platform without a published addon points to the browser build', () => {
  const error = addonLoadError('freebsd-x64', undefined)
  expect(error.message).toContain('no native addon is published for freebsd-x64')
  expect(error.message).toContain('browser/WASM build')
  expect(error.cause).toBeUndefined()
})

// The loader names each package in a literal require so bundlers can embed
// it. A package added to the table without one would never load.
test('the loader requires every package in the platform table', () => {
  const source = readFileSync(join(import.meta.dir, '../node/load.ts'), 'utf-8')
  for (const name of Object.values(NATIVE_PACKAGES)) {
    expect(source).toContain(`require('${name}')`)
  }
})
