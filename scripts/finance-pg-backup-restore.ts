/**
 * Safe Finance Postgres backup/restore drill.
 *
 * Reads the live `finance` database, creates a custom-format dump, restores it
 * into a uniquely named throwaway database, compares every public table's row
 * count, and removes both temporary artifacts. It never writes to `finance`.
 *
 * RUN: pnpm finance:postgres-backup-restore
 */
import { spawnSync } from 'node:child_process'
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'

const LIVE_DB = process.env.HERMES_FINANCE_PG_DATABASE || 'finance'
if (LIVE_DB !== 'finance') {
  console.error(
    `refusing to run backup drill against non-canonical database "${LIVE_DB}"`,
  )
  process.exit(2)
}

const RUN_ID = `${Date.now()}`
const RESTORE_DB = `finance_backup_it_${RUN_ID}`
if (!/^finance_backup_it_\d+$/.test(RESTORE_DB)) {
  console.error(`refusing to use unsafe restore database "${RESTORE_DB}"`)
  process.exit(2)
}

function loadHermesEnv(): void {
  const home = process.env.HERMES_HOME ?? path.join(os.homedir(), '.hermes')
  for (const envPath of [
    path.join(home, '.env'),
    path.join(home, '.hermes.backup', '.env'),
  ]) {
    try {
      for (const line of fs.readFileSync(envPath, 'utf8').split('\n')) {
        const match = line.match(
          /^(HERMES_PG_(?:PASSWORD|HOST|PORT|USER))=(.*)$/,
        )
        if (match && !process.env[match[1]])
          process.env[match[1]] = match[2].trim().replace(/^"|"$/g, '')
      }
    } catch {
      // The connection command below reports missing credentials clearly.
    }
  }
}

loadHermesEnv()

const BIN_DIR = '/home/ubuntu/.pg0/installation/18.1.0/bin'
const bin = (name: string) =>
  process.env[`PG_${name.toUpperCase()}_BIN`] || path.join(BIN_DIR, name)
const host = process.env.HERMES_PG_HOST || '127.0.0.1'
const port = process.env.HERMES_PG_PORT || '5432'
const user = process.env.HERMES_PG_USER || 'hermes_app'
const password = process.env.HERMES_PG_PASSWORD || ''
const env = { ...process.env, PGPASSWORD: password }
const dumpPath =
  fs.mkdtempSync(path.join(os.tmpdir(), 'hermes-finance-backup-')) + '.sql'

function run(command: string, args: string[], label: string): string {
  const result = spawnSync(command, args, { encoding: 'utf8', env })
  const output = `${result.stdout ?? ''}${result.stderr ?? ''}`.trim()
  if (result.status !== 0)
    throw new Error(`${label} failed${output ? `: ${output}` : ''}`)
  return output
}

function psql(database: string, sql: string): string {
  return run(
    bin('psql'),
    [
      '-h',
      host,
      '-p',
      port,
      '-U',
      user,
      '-d',
      database,
      '-At',
      '-v',
      'ON_ERROR_STOP=1',
      '-c',
      sql,
    ],
    `psql ${database}`,
  )
}

function quoteIdentifier(value: string): string {
  if (!/^[a-z_][a-z0-9_]*$/.test(value))
    throw new Error(`unsafe identifier: ${value}`)
  return `"${value}"`
}

function tableCounts(database: string): Map<string, number> {
  const names = psql(
    database,
    "SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' AND table_type = 'BASE TABLE' ORDER BY table_name",
  )
    .split('\n')
    .map((name) => name.trim())
    .filter(Boolean)
  const counts = new Map<string, number>()
  for (const name of names)
    counts.set(
      name,
      Number(
        psql(database, `SELECT count(*) FROM public.${quoteIdentifier(name)}`),
      ),
    )
  return counts
}

let created = false
try {
  if (
    psql(
      'postgres',
      `SELECT 1 FROM pg_database WHERE datname = '${RESTORE_DB}'`,
    ).trim() === '1'
  ) {
    throw new Error(`throwaway database already exists: ${RESTORE_DB}`)
  }

  const before = tableCounts(LIVE_DB)
  run(
    bin('pg_dump'),
    [
      '-h',
      host,
      '-p',
      port,
      '-U',
      user,
      '-d',
      LIVE_DB,
      '--format=plain',
      '--no-owner',
      '--no-privileges',
      '--file',
      dumpPath,
    ],
    'pg_dump',
  )
  const size = fs.statSync(dumpPath).size
  if (size < 512)
    throw new Error(`backup artifact is unexpectedly small (${size} bytes)`)
  // pg_dump 18 can target older servers, but pg_restore cannot suppress this
  // newer session setting. Remove only the generated compatibility line.
  const dump = fs
    .readFileSync(dumpPath, 'utf8')
    .replace(/^SET transaction_timeout = 0;\n/m, '')
  fs.writeFileSync(dumpPath, dump, { mode: 0o600 })

  run(
    bin('createdb'),
    ['-h', host, '-p', port, '-U', user, RESTORE_DB],
    'createdb',
  )
  created = true
  run(
    bin('psql'),
    [
      '-h',
      host,
      '-p',
      port,
      '-U',
      user,
      '-d',
      RESTORE_DB,
      '-v',
      'ON_ERROR_STOP=1',
      '-f',
      dumpPath,
    ],
    'restore',
  )
  const after = tableCounts(RESTORE_DB)
  const mismatches = [...new Set([...before.keys(), ...after.keys()])].filter(
    (name) => before.get(name) !== after.get(name),
  )
  if (mismatches.length > 0)
    throw new Error(
      `row-count mismatch: ${mismatches.map((name) => `${name} live=${before.get(name) ?? 0} restored=${after.get(name) ?? 0}`).join(', ')}`,
    )

  console.log(
    JSON.stringify(
      {
        ok: true,
        liveDatabase: LIVE_DB,
        restoredDatabase: RESTORE_DB,
        backupBytes: size,
        tablesCompared: before.size,
        rowCountsMatch: true,
      },
      null,
      2,
    ),
  )
} finally {
  if (created) {
    try {
      psql(
        'postgres',
        `SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = '${RESTORE_DB}' AND pid <> pg_backend_pid()`,
      )
      run(
        bin('dropdb'),
        ['-h', host, '-p', port, '-U', user, '--if-exists', RESTORE_DB],
        'dropdb',
      )
    } catch (error) {
      console.error(
        `cleanup failed for ${RESTORE_DB}: ${error instanceof Error ? error.message : String(error)}`,
      )
      process.exitCode = 1
    }
  }
  fs.rmSync(dumpPath, { force: true })
}
