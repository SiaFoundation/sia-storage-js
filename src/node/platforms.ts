/**
 * The npm package that ships the native addon for each platform, keyed by
 * `${process.platform}-${process.arch}`. The Linux and Windows packages name
 * the C library or toolchain their binary was built against, so a package
 * name is not always the platform key with a prefix.
 *
 * scripts/publish.ts publishes these and lists them as the main package's
 * optionalDependencies.
 */
export const NATIVE_PACKAGES: Record<string, string> = {
  'darwin-arm64': '@siafoundation/sia-storage-darwin-arm64',
  'darwin-x64': '@siafoundation/sia-storage-darwin-x64',
  'linux-x64': '@siafoundation/sia-storage-linux-x64-gnu',
  'linux-arm64': '@siafoundation/sia-storage-linux-arm64-gnu',
  'win32-x64': '@siafoundation/sia-storage-win32-x64-msvc',
}
