import type * as Addon from './napi.generated'

let addon: typeof Addon | null = null

export function loadNativeAddon(): typeof Addon {
  if (addon) return addon

  const platform = process.platform
  const arch = process.arch

  try {
    if (platform === 'darwin' && arch === 'arm64') {
      addon = require('@siafoundation/sia-storage-darwin-arm64')
    } else if (platform === 'darwin' && arch === 'x64') {
      addon = require('@siafoundation/sia-storage-darwin-x64')
    } else if (platform === 'linux' && arch === 'x64') {
      addon = require('@siafoundation/sia-storage-linux-x64-gnu')
    } else if (platform === 'linux' && arch === 'arm64') {
      addon = require('@siafoundation/sia-storage-linux-arm64-gnu')
    } else if (platform === 'win32' && arch === 'x64') {
      addon = require('@siafoundation/sia-storage-win32-x64-msvc')
    }
  } catch {}

  if (!addon) {
    throw new Error(
      `@siafoundation/sia-storage: Native addon not found for ${platform}-${arch}. ` +
        `Install @siafoundation/sia-storage-${platform}-${arch} or use the browser/WASM build.`,
    )
  }

  return addon
}
