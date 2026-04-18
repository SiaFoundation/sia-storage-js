#!/usr/bin/env bun
import { execSync } from 'node:child_process'
import { readFileSync, unlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const lines = readFileSync('CHANGELOG.md', 'utf-8').split('\n')
const start = lines.findIndex((l) => l.startsWith('## '))
if (start === -1) {
  console.log('No changelog entry; skipping PR.')
  process.exit(0)
}
const end = lines.findIndex((l, i) => i > start && l.startsWith('## '))
const version = lines[start]
  .replace(/^## /, '')
  .replace(/\s*\(.*\)/, '')
  .trim()
const body = lines
  .slice(start + 1, end === -1 ? undefined : end)
  .join('\n')
  .trim()

const title = `chore: release ${version}`
const file = join(tmpdir(), 'release-pr-body.md')
writeFileSync(file, body || '_No changelog body._')
try {
  try {
    execSync(
      `gh pr create --base main --title "${title}" --body-file "${file}"`,
      { stdio: 'inherit' },
    )
  } catch {
    execSync(`gh pr edit release --title "${title}" --body-file "${file}"`, {
      stdio: 'inherit',
    })
  }
} finally {
  try {
    unlinkSync(file)
  } catch {}
}
