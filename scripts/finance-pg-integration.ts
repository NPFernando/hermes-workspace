/**
 * Finance Postgres store — integration test (real psql, throwaway DB).
 *
 * WHY THIS EXISTS
 * `finance-postgres-store.ts` is the sole persistence layer for the finance
 * engine, but `financePostgresEnabled()` hard-returns `false` under vitest (a
 * deliberate guard after the 2026-07-27 incident where test fixtures polluted
 * the real `finance` DB), so `*.test.ts` can only reach the pure helpers — never
 * a real `writeFinancePostgresNormalized` → `readFinancePostgresNormalized`
 * round-trip.
 *
 * This is NOT a vitest test. It runs under a plain `tsx` process (no VITEST,
 * no NODE_ENV=test) so the guard lets Postgres through, but points
 * HERMES_FINANCE_PG_DATABASE at a throwaway `finance_it_<ts>` database it
 * creates and drops itself, refusing any name outside that pattern. It never
 * touches the real `finance` DB.
 *
 * RUN:  pnpm test:pg-integration   (or: tsx scripts/finance-pg-integration.ts)
 * Exits non-zero on the first failed assertion — works as a CI step wherever a
 * local Postgres 18 is reachable.
 */
import { spawnSync } from 'node:child_process'
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'

// --- 0. Wire the throwaway DB BEFORE importing the store module -------------
const RUN_ID = `${Date.now()}`
const THROWAWAY_DB = `finance_it_${RUN_ID}`
if (!/^finance_it_\d+$/.test(THROWAWAY_DB)) {
  console.error(`refusing to run against non-throwaway database "${THROWAWAY_DB}"`)
  process.exit(2)
}
process.env.HERMES_FINANCE_PG_DATABASE = THROWAWAY_DB
if (process.env.HERMES_FINANCE_STORE === 'json') delete process.env.HERMES_FINANCE_STORE
delete process.env.VITEST
if (process.env.NODE_ENV === 'test') delete process.env.NODE_ENV

loadHermesEnv()

// finance-store.ts captures FINANCE_DATA_DIR = <HOME>/.hermes/finance at import.
const THROWAWAY_HOME = fs.mkdtempSync(path.join(os.tmpdir(), 'finance-pg-it-'))
process.env.HOME = THROWAWAY_HOME
process.env.HERMES_HOME = path.join(THROWAWAY_HOME, '.hermes')
fs.mkdirSync(path.join(THROWAWAY_HOME, '.hermes', 'finance'), { recursive: true })

function loadHermesEnv(): void {
  const home =
    process.env.HERMES_HOME ??
    process.env.CLAUDE_HOME ??
    path.join(os.homedir(), '.hermes')
  try {
    const text = fs.readFileSync(path.join(home, '.env'), 'utf8')
    for (const line of text.split('\n')) {
      const m = line.match(/^(HERMES_PG_(?:PASSWORD|HOST|PORT|USER))=(.*)$/)
      if (m && !process.env[m[1]]) {
        process.env[m[1]] = m[2].trim().replace(/^"|"$/g, '')
      }
    }
  } catch {
    /* psql calls fail loudly below */
  }
}

const PSQL = process.env.PSQL_BIN || '/home/ubuntu/.pg0/installation/18.1.0/bin/psql'
const PG_HOST = process.env.HERMES_PG_HOST || '127.0.0.1'
const PG_PORT = process.env.HERMES_PG_PORT || '5432'
const PG_USER = process.env.HERMES_PG_USER || 'hermes_app'
const PG_PASSWORD = process.env.HERMES_PG_PASSWORD || ''

function psql(database: string, sql: string): { ok: boolean; out: string } {
  const res = spawnSync(
    PSQL,
    ['-h', PG_HOST, '-p', PG_PORT, '-U', PG_USER, '-d', database, '-tAc', sql],
    { encoding: 'utf8', env: { ...process.env, PGPASSWORD: PG_PASSWORD } },
  )
  return { ok: res.status === 0, out: `${res.stdout ?? ''}${res.stderr ?? ''}`.trim() }
}

// --- 1. Assertion harness -------------------------------------------------
let passed = 0
const failures: string[] = []
function check(label: string, cond: boolean, detail?: string): void {
  if (cond) {
    passed += 1
    console.log(`  ok   ${label}`)
  } else {
    failures.push(detail ? `${label} — ${detail}` : label)
    console.log(`  FAIL ${label}${detail ? ` — ${detail}` : ''}`)
  }
}
function eq(label: string, actual: unknown, expected: unknown): void {
  const a = JSON.stringify(actual)
  const e = JSON.stringify(expected)
  check(label, a === e, a === e ? undefined : `expected ${e}, got ${a}`)
}

// --- 2. Run -------------------------------------------------------------
async function main(): Promise<void> {
  if (!psql('postgres', 'SELECT 1').ok) {
    console.error(`Postgres not reachable via ${PSQL}; skipping.`)
    process.exit(2)
  }
  if (psql('postgres', `SELECT 1 FROM pg_database WHERE datname = '${THROWAWAY_DB}'`).out.trim() === '1') {
    console.error(`throwaway DB ${THROWAWAY_DB} already exists — aborting`)
    process.exit(2)
  }

  const pg = await import('../src/server/finance-postgres-store')
  const store = await import('../src/server/finance-store')

  try {
    console.log(`\n# finance-pg-integration  (db=${THROWAWAY_DB})\n`)

    console.log('A. fresh database')
    eq('readFinancePostgresNormalized() is null before any write', pg.readFinancePostgresNormalized(), null)
    const status0 = pg.financePostgresStatus()
    eq('financePostgresStatus().enabled', status0.enabled, true)
    eq('financePostgresStatus().database is the throwaway', status0.database, THROWAWAY_DB)

    console.log('\nB. write -> read round-trip')
    const db = store.createEmptyFinanceDatabase()
    db.settings.tradingMode = 'testnet_execute' as never
    db.settings.livePerOrderCapUsdt = 25
    db.finance_accounts.push({
      id: 'acc-1',
      name: 'Main',
      type: 'bank',
      currency: 'LKR',
      balance: 1000,
      source: 'finance-pg-it',
      createdAt: '2026-09-07T00:00:00.000Z',
      updatedAt: '2026-09-07T00:00:00.000Z',
    })
    db.income_records.push({
      id: 'inc-1',
      dateReceived: '2026-09-01',
      sourceName: 'Salary',
      incomeType: 'Salary',
      originalCurrency: 'LKR',
      originalAmount: 400_000,
      exchangeRateUsed: 1,
      convertedLkrAmount: 400_000,
      taxable: true,
      source: 'finance-pg-it',
      createdAt: '2026-09-07T00:00:00.000Z',
      updatedAt: '2026-09-07T00:00:00.000Z',
    })
    db.strategy_results.push({ id: 'sr-1', kind: 'demo_trade_log', pnlQuote: 12.5 })
    db.riskState.dailyRealizedLoss = -3

    check('writeFinancePostgresNormalized returned true', pg.writeFinancePostgresNormalized(db) === true)
    const back = pg.readFinancePostgresNormalized()
    check('readFinancePostgresNormalized returns a store', back !== null)
    if (!back) throw new Error('read returned null after a successful write')

    eq('settings.tradingMode round-trips', back.settings.tradingMode, 'testnet_execute')
    eq('settings.livePerOrderCapUsdt round-trips', back.settings.livePerOrderCapUsdt, 25)
    eq('schemaVersion', back.schemaVersion, db.schemaVersion)
    eq('finance_accounts count', back.finance_accounts.length, 1)
    eq('finance_accounts[0].balance', back.finance_accounts[0].balance, 1000)
    eq('income_records[0].convertedLkrAmount', back.income_records[0].convertedLkrAmount, 400_000)
    eq('strategy_results[0].pnlQuote', back.strategy_results[0].pnlQuote, 12.5)
    eq('riskState pseudo-collection round-trips', back.riskState.dailyRealizedLoss, -3)
    eq('untouched collection defaults to []', back.trade_orders, [])

    console.log('\nC. write is replace-not-append')
    pg.writeFinancePostgresNormalized(db)
    eq('second identical write does not duplicate rows', pg.readFinancePostgresNormalized()?.finance_accounts.length, 1)
    const shrunk = store.createEmptyFinanceDatabase()
    shrunk.settings.tradingMode = 'observe_only' as never
    pg.writeFinancePostgresNormalized(shrunk)
    const after = pg.readFinancePostgresNormalized()
    eq('collections cleared on the next write', after?.finance_accounts.length, 0)
    eq('settings replaced on the next write', after?.settings.tradingMode, 'observe_only')

    console.log('\nD. dup-key resilience (strategy_results_pkey class)')
    const dup = store.createEmptyFinanceDatabase()
    dup.strategy_results.push({ id: 'dup', kind: 'a' }, { id: 'dup', kind: 'b' })
    // writeFinancePostgresNormalized DELETEs then bulk-INSERTs; two rows with the
    // same id must not abort the whole transaction silently — the write either
    // succeeds with one row or reports failure via lastWriteError, never both.
    const ok = pg.writeFinancePostgresNormalized(dup)
    check(
      'duplicate ids are handled deterministically',
      ok === false || pg.readFinancePostgresNormalized()?.strategy_results.length === 1,
      `write ok=${ok}, rows=${pg.readFinancePostgresNormalized()?.strategy_results.length}`,
    )
  } finally {
    console.log('\n# teardown')
    psql(
      'postgres',
      `SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = '${THROWAWAY_DB}' AND pid <> pg_backend_pid()`,
    )
    const dropped = psql('postgres', `DROP DATABASE IF EXISTS ${THROWAWAY_DB}`)
    check(`dropped throwaway DB ${THROWAWAY_DB}`, dropped.ok, dropped.out)
    fs.rmSync(THROWAWAY_HOME, { recursive: true, force: true })
  }

  console.log(`\n${passed} passed, ${failures.length} failed`)
  if (failures.length > 0) {
    for (const f of failures) console.log(`  - ${f}`)
    process.exit(1)
  }
}

main().catch((err) => {
  console.error(err)
  psql('postgres', `DROP DATABASE IF EXISTS ${THROWAWAY_DB}`)
  try {
    fs.rmSync(THROWAWAY_HOME, { recursive: true, force: true })
  } catch {
    /* ignore */
  }
  process.exit(1)
})
