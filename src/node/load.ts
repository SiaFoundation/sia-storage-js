import { createRequire } from 'module'

const nativeRequire = createRequire(import.meta.url)

let addon: any = null

/**
 * Load the platform-specific native addon (.node binary).
 * Looks for the binary in an optional dependency package named
 * `@siafoundation/sia-{platform}-{arch}`.
 */
export function loadNativeAddon(): any {
  if (addon) return addon

  const platform = process.platform
  const arch = process.arch

  // Map Node.js platform/arch to package names
  // e.g. darwin + arm64 → @siafoundation/sia-darwin-arm64
  //      linux + x64    → @siafoundation/sia-linux-x64-gnu
  //      win32 + x64    → @siafoundation/sia-win32-x64-msvc
  let suffix = `${platform}-${arch}`
  if (platform === 'linux') {
    suffix = `${platform}-${arch}-gnu`
  } else if (platform === 'win32') {
    suffix = `${platform}-${arch}-msvc`
  }

  const pkg = `@siafoundation/sia-${suffix}`

  try {
    addon = nativeRequire(pkg)
  } catch {
    throw new Error(
      `@siafoundation/sia: Native addon not found for ${platform}-${arch}. ` +
        `Install ${pkg} or use the browser/WASM build.`,
    )
  }

  return addon
}
