/**
 * Repeatable, non-destructive disaster-recovery exercise coordinator.
 *
 * The default is plan-only. Use --run to execute the local Finance restore
 * drill. Set HERMES_DR_RUN_OFFSITE=1 to include the encrypted off-site
 * round-trip check; that path fails closed when its credentials are absent.
 * No production database is restored into or modified by this exercise.
 */
import { execFileSync } from 'node:child_process'
import { mkdirSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

const run = process.argv.includes('--run')
const offsite = process.env.HERMES_DR_RUN_OFFSITE === '1'
const timestamp = new Date().toISOString()

type StepResult = {
  name: string
  status: 'planned' | 'passed' | 'failed' | 'skipped'
  output?: unknown
  detail?: string
}

const results: Array<StepResult> = [
  {
    name: 'finance-local-restore',
    status: run ? 'planned' : 'planned',
    detail:
      'Create a temporary PostgreSQL dump and restore database, compare public-table row counts, then remove both temporary artifacts.',
  },
  {
    name: 'finance-offsite-round-trip',
    status: offsite ? 'planned' : 'skipped',
    detail: offsite
      ? 'Upload an encrypted Finance envelope, download the same object, and verify authentication, digest, schema, and record counts.'
      : 'Set HERMES_DR_RUN_OFFSITE=1 to include the off-site round-trip; no remote access is attempted by default.',
  },
]

function runStep(index: number, script: string): void {
  try {
    const output = execFileSync('pnpm', ['exec', 'tsx', script], {
      cwd: process.cwd(),
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
      timeout: 10 * 60 * 1000,
    })
    let parsed: unknown = output.trim()
    try {
      parsed = JSON.parse(output)
    } catch {
      // Preserve only a short non-secret diagnostic if the child emits text.
      parsed = output.trim().slice(-1000)
    }
    results[index] = { ...results[index], status: 'passed', output: parsed }
  } catch (error) {
    results[index] = {
      ...results[index],
      status: 'failed',
      detail: error instanceof Error ? error.message.slice(0, 1000) : String(error),
    }
  }
}

if (run) {
  runStep(0, 'scripts/finance-pg-backup-restore.ts')
  if (offsite) runStep(1, 'scripts/finance-offsite-backup.ts')
}

const report = {
  exercise: 'hermes-disaster-recovery',
  generatedAt: timestamp,
  mode: run ? 'run' : 'plan',
  nonDestructive: true,
  results,
  ok: !run || results.every((step) => step.status === 'passed' || step.status === 'skipped'),
}

if (run) {
  const evidenceDir =
    process.env.HERMES_DR_EVIDENCE_DIR || join(homedir(), '.hermes-data', 'dr-exercises')
  mkdirSync(evidenceDir, { recursive: true, mode: 0o700 })
  const evidencePath = join(
    evidenceDir,
    `exercise-${timestamp.replace(/[-:.TZ]/g, '')}.json`,
  )
  writeFileSync(evidencePath, `${JSON.stringify(report, null, 2)}\n`, {
    mode: 0o600,
  })
  console.log(JSON.stringify({ ...report, evidencePath }, null, 2))
} else {
  console.log(JSON.stringify(report, null, 2))
}

if (run && !report.ok) process.exitCode = 1
