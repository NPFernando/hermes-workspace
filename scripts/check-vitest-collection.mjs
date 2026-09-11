#!/usr/bin/env node

import { spawnSync } from 'node:child_process'
import { resolve } from 'node:path'

const vitestBin = resolve('node_modules/.bin/vitest')
const result = spawnSync(vitestBin, ['list', '--filesOnly', '--json'], {
  encoding: 'utf8',
  stdio: ['ignore', 'pipe', 'pipe'],
  env: {
    ...process.env,
    // Collection should be a quiet, non-watch operation in local and CI use.
    CI: process.env.CI || '1',
  },
})

if (result.error) {
  console.error(`Unable to run Vitest collection: ${result.error.message}`)
  process.exit(1)
}

if (result.status !== 0) {
  process.stderr.write(result.stderr || '')
  process.exit(result.status ?? 1)
}

// Vite plugins may write warnings before Vitest's JSON document. Start at the
// first JSON array instead of assuming stdout contains JSON only.
const jsonMarker = result.stdout.match(/(?:^|\n)(\[\s*(?:\{|\]))/)
const jsonStart = jsonMarker
  ? (jsonMarker.index ?? 0) + (jsonMarker[0].startsWith('\n') ? 1 : 0)
  : -1
if (jsonStart < 0) {
  console.error('Vitest did not return a file collection.')
  process.exit(1)
}

let files
try {
  files = JSON.parse(result.stdout.slice(jsonStart))
} catch (error) {
  console.error(
    `Unable to parse Vitest file collection: ${error instanceof Error ? error.message : String(error)}`,
  )
  process.exit(1)
}

const paths = files
  .map((entry) => (typeof entry?.file === 'string' ? entry.file : ''))
  .filter(Boolean)

const forbidden = paths.filter((file) =>
  /(?:^|[\\/])e2e[\\/]|services[\\/]odysseus[\\/]tests[\\/].*\.mjs$/i.test(
    file,
  ),
)

if (forbidden.length > 0) {
  console.error('Vitest collection includes dedicated non-unit suites:')
  for (const file of forbidden) console.error(`- ${file}`)
  process.exit(1)
}

console.log(`Vitest collection hygiene passed (${paths.length} unit files).`)
