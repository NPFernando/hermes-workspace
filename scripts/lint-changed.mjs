#!/usr/bin/env node

import { existsSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import path from 'node:path'

const repoRoot = process.cwd()
const sourceExtensions = /\.(?:c|m)?jsx?|tsx?$/

function gitFiles(args) {
  const result = spawnSync('git', args, {
    cwd: repoRoot,
    encoding: 'utf8',
  })
  if (result.status !== 0) return []
  return result.stdout
    .split('\n')
    .map((file) => file.trim())
    .filter(Boolean)
}

function changedFiles() {
  return [
    ...gitFiles(['diff', '--name-only', '--diff-filter=ACMR', 'HEAD']),
    ...gitFiles(['ls-files', '--others', '--exclude-standard']),
  ]
}

const requestedFiles = process.argv.slice(2)
const files = [...new Set(requestedFiles.length ? requestedFiles : changedFiles())]
  .filter((file) => sourceExtensions.test(file))
  .filter((file) => existsSync(path.resolve(repoRoot, file)))

if (files.length === 0) {
  console.log('No changed source files found; focused lint skipped.')
  process.exit(0)
}

const eslintBin = path.join(
  repoRoot,
  'node_modules',
  '.bin',
  process.platform === 'win32' ? 'eslint.cmd' : 'eslint',
)

if (!existsSync(eslintBin)) {
  console.error(`ESLint binary not found at ${eslintBin}`)
  process.exit(1)
}

// These two rules are known repository-wide baseline debt and are tracked by
// the strictness rollout. Keep them visible in the full lint gate while making
// this changed-file check useful for incremental work. No other rules are
// relaxed here.
const result = spawnSync(
  eslintBin,
  [
    '--no-warn-ignored',
    '--rule',
    JSON.stringify({
      '@typescript-eslint/no-unnecessary-condition': 'off',
      'no-control-regex': 'off',
    }),
    ...files,
  ],
  { cwd: repoRoot, stdio: 'inherit' },
)

if (result.error) {
  console.error(result.error.message)
  process.exit(1)
}
process.exit(result.status ?? 1)
