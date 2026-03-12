#!/usr/bin/env bun
/**
 * Publish @siafoundation/sia and its platform-specific NAPI packages to npm.
 *
 * Usage:
 *   bun run publish              # build, test, publish main + all available platform packages
 *   bun run publish -- --dry-run # do everything except the actual npm publish
 *
 * Requirements:
 *   - NPM_TOKEN in .env (or exported in environment)
 *   - NAPI binary at rust/sia-sdk-rs/indexd_node/indexd_node.<target>.node
 *
 * What it does:
 *   1. Reads version from package.json
 *   2. Builds and tests the package
 *   3. Publishes each platform NAPI package that has a local binary
 *   4. Publishes the main @siafoundation/sia package
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync, cpSync, rmSync } from 'fs'
import { join } from 'path'
import { $ } from 'bun'

const ROOT = join(import.meta.dir, '..')
const NAPI_DIR = join(ROOT, 'rust', 'sia-sdk-rs', 'indexd_node')

// Load .env if present
const envPath = join(ROOT, '.env')
if (existsSync(envPath)) {
  const envContent = readFileSync(envPath, 'utf-8')
  for (const line of envContent.split('\n')) {
    const match = line.match(/^(\w+)=(.*)$/)
    if (match) {
      process.env[match[1]] = match[2]
    }
  }
}

const NPM_TOKEN = process.env.NPM_TOKEN
if (!NPM_TOKEN) {
  console.error('ERROR: NPM_TOKEN not found in .env or environment')
  process.exit(1)
}

const dryRun = process.argv.includes('--dry-run')

const pkg = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf-8'))
const version = pkg.version
console.log(`Publishing @siafoundation/sia@${version}${dryRun ? ' (dry run)' : ''}`)

// Platform packages: suffix → { os, cpu, binary filename }
const PLATFORMS: Record<string, { os: string; cpu: string; file: string }> = {
  'darwin-arm64': { os: 'darwin', cpu: 'arm64', file: 'indexd_node.darwin-arm64.node' },
  'darwin-x64': { os: 'darwin', cpu: 'x64', file: 'indexd_node.darwin-x64.node' },
  'linux-x64-gnu': { os: 'linux', cpu: 'x64', file: 'indexd_node.linux-x64-gnu.node' },
  'linux-arm64-gnu': { os: 'linux', cpu: 'arm64', file: 'indexd_node.linux-arm64-gnu.node' },
  'win32-x64-msvc': { os: 'win32', cpu: 'x64', file: 'indexd_node.win32-x64-msvc.node' },
}

// Write temporary .npmrc for auth
const npmrcPath = join(ROOT, '.npmrc')
writeFileSync(npmrcPath, `//registry.npmjs.org/:_authToken=${NPM_TOKEN}\n`)

try {
  // Step 1: Build and test
  console.log('\n── Building ──')
  await $`bun run build`.cwd(ROOT)

  console.log('\n── Testing ──')
  await $`bun run test`.cwd(ROOT)

  // Step 2: Publish platform packages
  console.log('\n── Platform packages ──')
  for (const [suffix, info] of Object.entries(PLATFORMS)) {
    const binaryPath = join(NAPI_DIR, info.file)
    if (!existsSync(binaryPath)) {
      console.log(`  SKIP @siafoundation/sia-${suffix} (no binary at ${info.file})`)
      continue
    }

    const tmpDir = join(ROOT, '.tmp-publish', `sia-${suffix}`)
    mkdirSync(tmpDir, { recursive: true })

    // Create package.json for the platform package
    const platformPkg = {
      name: `@siafoundation/sia-${suffix}`,
      version,
      os: [info.os],
      cpu: [info.cpu],
      main: 'indexd_node.node',
      files: ['indexd_node.node'],
      license: 'MIT',
      description: `Native NAPI addon for @siafoundation/sia (${suffix})`,
      repository: {
        type: 'git',
        url: 'https://github.com/SiaFoundation/sia-js',
      },
    }
    writeFileSync(join(tmpDir, 'package.json'), JSON.stringify(platformPkg, null, 2) + '\n')
    cpSync(binaryPath, join(tmpDir, 'indexd_node.node'))

    console.log(`  Publishing @siafoundation/sia-${suffix}@${version}...`)
    if (dryRun) {
      console.log(`  DRY RUN: would publish from ${tmpDir}`)
    } else {
      const result = await $`/opt/homebrew/bin/npm publish --access public`.cwd(tmpDir).nothrow()
      if (result.exitCode !== 0) {
        const stderr = result.stderr.toString()
        if (stderr.includes('EPUBLISHCONFLICT') || stderr.includes('cannot publish over')) {
          console.log(`  Already published, skipping.`)
        } else {
          console.error(`  FAILED:`, stderr)
          process.exit(1)
        }
      } else {
        console.log(`  ✓ Published`)
      }
    }
  }

  // Step 3: Sync optionalDependencies versions
  const updatedPkg = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf-8'))
  if (updatedPkg.optionalDependencies) {
    for (const key of Object.keys(updatedPkg.optionalDependencies)) {
      updatedPkg.optionalDependencies[key] = version
    }
    writeFileSync(join(ROOT, 'package.json'), JSON.stringify(updatedPkg, null, 2) + '\n')
  }

  // Step 4: Publish main package
  console.log(`\n── Publishing @siafoundation/sia@${version} ──`)
  if (dryRun) {
    console.log('DRY RUN: would publish main package')
  } else {
    await $`/opt/homebrew/bin/npm publish --access public --ignore-scripts`.cwd(ROOT)
    console.log('✓ Published')
  }

  console.log('\n✓ Done!')
} finally {
  // Cleanup
  rmSync(npmrcPath, { force: true })
  rmSync(join(ROOT, '.tmp-publish'), { recursive: true, force: true })
}
