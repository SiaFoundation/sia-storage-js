import type * as Addon from './napi.generated'
import { NATIVE_PACKAGES } from './platforms'

let addon: typeof Addon | null = null

export function loadNativeAddon(): typeof Addon {
  if (addon) return addon

  const target = `${process.platform}-${process.arch}`
  let cause: unknown

  // One literal require per package, rather than require(NATIVE_PACKAGES[...]),
  // so bundlers, including `bun build --compile`, can find and embed the addon.
  try {
    if (target === 'darwin-arm64') {
      addon = require('@siafoundation/sia-storage-darwin-arm64')
    } else if (target === 'darwin-x64') {
      addon = require('@siafoundation/sia-storage-darwin-x64')
    } else if (target === 'linux-x64') {
      addon = require('@siafoundation/sia-storage-linux-x64-gnu')
    } else if (target === 'linux-arm64') {
      addon = require('@siafoundation/sia-storage-linux-arm64-gnu')
    } else if (target === 'win32-x64') {
      addon = require('@siafoundation/sia-storage-win32-x64-msvc')
    }
  } catch (error) {
    cause = error
  }

  if (!addon) throw addonLoadError(target, cause)
  return addon
}

/**
 * Why the addon could not load. A missing package and a binary that fails to
 * load read differently, so the require error is kept as the cause and its
 * message is part of this one.
 */
export function addonLoadError(target: string, cause: unknown): Error {
  const packageName = NATIVE_PACKAGES[target]
  if (!packageName) {
    return new Error(
      `@siafoundation/sia-storage: no native addon is published for ${target}. ` +
        'Use the browser/WASM build.',
    )
  }
  const reason = cause instanceof Error ? cause.message : String(cause)
  return new Error(
    `@siafoundation/sia-storage: could not load the native addon for ${target} ` +
      `from ${packageName}: ${reason}`,
    { cause },
  )
}
