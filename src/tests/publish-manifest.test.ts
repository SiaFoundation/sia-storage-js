// scripts/publish.ts adds the platform packages to package.json only while it
// publishes the main package. If that step broke, the release would install
// with no native addon for any Node user, and nothing else runs the script
// before a release. This runs its dry run, which takes the same path up to
// the npm publish call.
import { expect, test } from 'bun:test'
import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { NATIVE_PACKAGES } from '../node/platforms'

const ROOT = join(import.meta.dir, '..', '..')
const PKG_PATH = join(ROOT, 'package.json')

test('the published package lists every platform package at the release version, and package.json is left untouched', () => {
  const before = readFileSync(PKG_PATH, 'utf-8')
  const { version } = JSON.parse(before)

  const output = execFileSync(
    'bun',
    ['scripts/publish.ts', '--ci', '--dry-run'],
    { cwd: ROOT, encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'] },
  )

  const line = output
    .split('\n')
    .find((l) => l.startsWith('DRY RUN: optionalDependencies '))
  expect(line).toBeDefined()
  const added = JSON.parse(
    line!.slice('DRY RUN: optionalDependencies '.length),
  )
  expect(added).toEqual(
    Object.fromEntries(
      Object.values(NATIVE_PACKAGES).map((name) => [name, version]),
    ),
  )
  expect(Object.keys(added)).toHaveLength(5)

  expect(readFileSync(PKG_PATH, 'utf-8')).toBe(before)
  expect(JSON.parse(before).optionalDependencies).toBeUndefined()
})
