#!/usr/bin/env bun
// Publish @siafoundation/sia-storage and the 5 platform-specific NAPI packages to npm.
// Auth via OIDC trusted publisher (no token); attaches build provenance.
//
//   bun run publish-npm           # local: build + test + publish
//   bun run publish-npm -- --ci   # CI: skip build/test (already done)
//   bun run publish-npm -- --dry-run

import { $ } from 'bun'
import {
  cpSync,
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { join } from 'node:path'

import { NATIVE_PACKAGES } from '../src/node/platforms'

const ROOT = join(import.meta.dir, '..')
const NAPI_DIR = join(ROOT, 'rust', 'sia-sdk-rs', 'sia_storage_napi')
const ARTIFACTS_DIR = join(ROOT, 'artifacts')

const dryRun = process.argv.includes('--dry-run')
const ci = process.argv.includes('--ci')

const PKG_PATH = join(ROOT, 'package.json')
const pkgSource = readFileSync(PKG_PATH, 'utf-8')
const pkg = JSON.parse(pkgSource)
const version = pkg.version
console.log(
  `Publishing @siafoundation/sia-storage@${version}${dryRun ? ' (dry run)' : ''}`,
)

const PLATFORMS: Record<string, { os: string; cpu: string; file: string }> = {
  'darwin-arm64': { os: 'darwin', cpu: 'arm64', file: 'sia-storage.darwin-arm64.node' },
  'darwin-x64': { os: 'darwin', cpu: 'x64', file: 'sia-storage.darwin-x64.node' },
  'linux-x64-gnu': { os: 'linux', cpu: 'x64', file: 'sia-storage.linux-x64-gnu.node' },
  'linux-arm64-gnu': { os: 'linux', cpu: 'arm64', file: 'sia-storage.linux-arm64-gnu.node' },
  'win32-x64-msvc': { os: 'win32', cpu: 'x64', file: 'sia-storage.win32-x64-msvc.node' },
}

// Every package published below must be one the loader requires, or the main
// package would depend on a platform package it never loads.
for (const suffix of Object.keys(PLATFORMS)) {
  const name = `@siafoundation/sia-storage-${suffix}`
  if (!Object.values(NATIVE_PACKAGES).includes(name)) {
    console.error(`${name} is not in src/node/platforms.ts`)
    process.exit(1)
  }
}

function findBinary(info: { file: string }, suffix: string): string | null {
  const ciPath = join(ARTIFACTS_DIR, `napi-${suffix}`, info.file)
  if (existsSync(ciPath)) return ciPath
  const localPath = join(NAPI_DIR, info.file)
  if (existsSync(localPath)) return localPath
  return null
}

try {
  if (!ci) {
    console.log('\n── Building ──')
    await $`bun run build`.cwd(ROOT)
    console.log('\n── Testing ──')
    await $`bun run test`.cwd(ROOT)
  }

  console.log('\n── Platform packages ──')
  for (const [suffix, info] of Object.entries(PLATFORMS)) {
    const binaryPath = findBinary(info, suffix)
    if (!binaryPath) {
      console.log(`  SKIP @siafoundation/sia-storage-${suffix} (no binary found)`)
      continue
    }

    const tmpDir = join(ROOT, '.tmp-publish', `sia-${suffix}`)
    mkdirSync(tmpDir, { recursive: true })

    const platformPkg = {
      name: `@siafoundation/sia-storage-${suffix}`,
      version,
      os: [info.os],
      cpu: [info.cpu],
      main: 'sia-storage.node',
      files: ['sia-storage.node'],
      license: 'MIT',
      description: `Native NAPI addon for @siafoundation/sia-storage (${suffix})`,
      repository: {
        type: 'git',
        url: 'https://github.com/SiaFoundation/sia-storage-js',
      },
    }
    writeFileSync(
      join(tmpDir, 'package.json'),
      JSON.stringify(platformPkg, null, 2) + '\n',
    )
    cpSync(binaryPath, join(tmpDir, 'sia-storage.node'))

    console.log(`  Publishing @siafoundation/sia-storage-${suffix}@${version}...`)
    if (dryRun) {
      console.log(`  DRY RUN: would publish from ${tmpDir}`)
    } else {
      const result = await $`npm publish --access public --provenance`
        .cwd(tmpDir)
        .nothrow()
      if (result.exitCode !== 0) {
        const stderr = result.stderr.toString()
        if (
          stderr.includes('EPUBLISHCONFLICT') ||
          stderr.includes('cannot publish over')
        ) {
          console.log('  Already published, skipping.')
        } else {
          console.error('  FAILED:', stderr)
          process.exit(1)
        }
      } else {
        console.log('  ✓ Published')
      }
    }
  }

  // The platform packages are optionalDependencies of the published package
  // only. Listed in package.json itself, a release would bump them to a
  // version not yet on npm, leaving bun.lock behind on every release. The
  // file is restored in `finally`.
  const optionalDependencies = Object.fromEntries(
    Object.values(NATIVE_PACKAGES).map((name) => [name, version]),
  )
  writeFileSync(
    PKG_PATH,
    JSON.stringify({ ...pkg, optionalDependencies }, null, 2) + '\n',
  )

  console.log(`\n── Publishing @siafoundation/sia-storage@${version} ──`)
  if (dryRun) {
    // Read back from disk, which is what npm publish would read, and printed
    // on one line for src/tests/publish-manifest.test.ts.
    const written = JSON.parse(readFileSync(PKG_PATH, 'utf-8'))
    console.log(
      `DRY RUN: optionalDependencies ${JSON.stringify(written.optionalDependencies ?? null)}`,
    )
  } else {
    await $`npm publish --access public --provenance --ignore-scripts`.cwd(ROOT)
    console.log('✓ Published')
  }

  console.log('\n✓ Done!')
} finally {
  writeFileSync(PKG_PATH, pkgSource)
  rmSync(join(ROOT, '.tmp-publish'), { recursive: true, force: true })
}
