#!/usr/bin/env bun
/**
 * Publish sia-storage and its platform-specific NAPI packages to npm.
 *
 * Usage:
 *   bun run publish-npm              # build, test, publish everything that has a local binary
 *   bun run publish-npm -- --dry-run # do everything except the actual npm publish
 *   bun run publish-npm -- --ci      # skip build + test (CI already did them)
 *
 * Requirements:
 *   - NPM_TOKEN in env (.env is auto-loaded locally; CI sets it via secrets)
 *   - NAPI binaries at rust/sia-sdk-rs/sia_storage_napi/sia-storage.<target>.node
 *     OR at ./artifacts/napi-<suffix>/sia-storage.*.node (CI layout)
 */

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

const ROOT = join(import.meta.dir, '..')
const NAPI_DIR = join(ROOT, 'rust', 'sia-sdk-rs', 'sia_storage_napi')
const ARTIFACTS_DIR = join(ROOT, 'artifacts')

const dryRun = process.argv.includes('--dry-run')
const ci = process.argv.includes('--ci')

// Load .env locally. CI sets NPM_TOKEN via secrets.
const envPath = join(ROOT, '.env')
if (existsSync(envPath)) {
  const envContent = readFileSync(envPath, 'utf-8')
  for (const line of envContent.split('\n')) {
    const match = line.match(/^(\w+)=(.*)$/)
    if (match) process.env[match[1]] = match[2]
  }
}

const NPM_TOKEN = process.env.NPM_TOKEN
if (!NPM_TOKEN) {
  console.error('ERROR: NPM_TOKEN not found in env or .env')
  process.exit(1)
}

const pkg = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf-8'))
const version = pkg.version
console.log(`Publishing sia-storage@${version}${dryRun ? ' (dry run)' : ''}`)

// suffix → { os, cpu, binary filename }
const PLATFORMS: Record<string, { os: string; cpu: string; file: string }> = {
  'darwin-arm64': { os: 'darwin', cpu: 'arm64', file: 'sia-storage.darwin-arm64.node' },
  'darwin-x64': { os: 'darwin', cpu: 'x64', file: 'sia-storage.darwin-x64.node' },
  'linux-x64-gnu': { os: 'linux', cpu: 'x64', file: 'sia-storage.linux-x64-gnu.node' },
  'linux-arm64-gnu': { os: 'linux', cpu: 'arm64', file: 'sia-storage.linux-arm64-gnu.node' },
  'win32-x64-msvc': { os: 'win32', cpu: 'x64', file: 'sia-storage.win32-x64-msvc.node' },
}

function findBinary(info: { file: string }, suffix: string): string | null {
  // CI layout: artifacts/napi-<suffix>/sia-storage.*.node
  const ciPath = join(ARTIFACTS_DIR, `napi-${suffix}`, info.file)
  if (existsSync(ciPath)) return ciPath
  // Local layout: rust/sia-sdk-rs/sia_storage_napi/sia-storage.<target>.node
  const localPath = join(NAPI_DIR, info.file)
  if (existsSync(localPath)) return localPath
  return null
}

const npmrcPath = join(ROOT, '.npmrc')
writeFileSync(npmrcPath, `//registry.npmjs.org/:_authToken=${NPM_TOKEN}\n`)

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
      console.log(`  SKIP sia-storage-${suffix} (no binary found)`)
      continue
    }

    const tmpDir = join(ROOT, '.tmp-publish', `sia-${suffix}`)
    mkdirSync(tmpDir, { recursive: true })

    const platformPkg = {
      name: `sia-storage-${suffix}`,
      version,
      os: [info.os],
      cpu: [info.cpu],
      main: 'sia-storage.node',
      files: ['sia-storage.node'],
      license: 'MIT',
      description: `Native NAPI addon for sia-storage (${suffix})`,
      repository: {
        type: 'git',
        url: 'https://github.com/SiaFoundation/sia-js',
      },
    }
    writeFileSync(
      join(tmpDir, 'package.json'),
      JSON.stringify(platformPkg, null, 2) + '\n',
    )
    writeFileSync(
      join(tmpDir, '.npmrc'),
      `//registry.npmjs.org/:_authToken=${NPM_TOKEN}\n`,
    )
    cpSync(binaryPath, join(tmpDir, 'sia-storage.node'))

    console.log(`  Publishing sia-storage-${suffix}@${version}...`)
    if (dryRun) {
      console.log(`  DRY RUN: would publish from ${tmpDir}`)
    } else {
      const result = await $`npm publish --access public`.cwd(tmpDir).nothrow()
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

  // Sync optionalDependencies versions
  const updatedPkg = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf-8'))
  if (updatedPkg.optionalDependencies) {
    for (const key of Object.keys(updatedPkg.optionalDependencies)) {
      updatedPkg.optionalDependencies[key] = version
    }
    writeFileSync(
      join(ROOT, 'package.json'),
      JSON.stringify(updatedPkg, null, 2) + '\n',
    )
  }

  console.log(`\n── Publishing sia-storage@${version} ──`)
  if (dryRun) {
    console.log('DRY RUN: would publish main package')
  } else {
    await $`npm publish --access public --ignore-scripts`.cwd(ROOT)
    console.log('✓ Published')
  }

  console.log('\n✓ Done!')
} finally {
  rmSync(npmrcPath, { force: true })
  rmSync(join(ROOT, '.tmp-publish'), { recursive: true, force: true })
}
