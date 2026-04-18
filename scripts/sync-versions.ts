#!/usr/bin/env bun
// After Knope's PrepareRelease bumps `package.json` version, mirror the
// new version into all `optionalDependencies.sia-storage-*` entries so
// the platform packages stay in lockstep.
import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const pkgPath = join(import.meta.dir, '..', 'package.json')
const pkg = JSON.parse(readFileSync(pkgPath, 'utf-8'))

if (pkg.optionalDependencies) {
  for (const key of Object.keys(pkg.optionalDependencies)) {
    pkg.optionalDependencies[key] = pkg.version
  }
  writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + '\n')
  console.log(`Synced optionalDependencies → ${pkg.version}`)
}
