/**
 * Personal-finance Postgres store — integration test (real psql, throwaway DB).
 *
 * WHY THIS EXISTS
 * `personal-finance-postgres-store.ts` owns the `personal_finance` DB — the
 * Postgres Migration Phase D store for personal-finance data — yet it has
 * almost no automated coverage: `financePostgresEnabled()` /
 * `personalFinancePostgresEnabled()` hard-return `false` under vitest (a
 * deliberate guard after the 2026-07-27 incident where test fixtures polluted
 * the real `finance` DB for 2+ days), so `*.test.ts` files can only reach the
 * pure helpers (`snakeRowToCamel`), never a real round-trip.
 *
 * CAVEAT found while writing this (flagged for the in-flight finance cutover):
 * in hermes-workspace-live @ 5ed90523, neither the production read path
 * (readFinanceStoreUncached -> readFinancePostgresNormalized, `finance` DB) nor
 * the production write path (writeFinanceStore non-test ->
 * writeFinancePostgresNormalized, `finance` DB) touches this module. Its only
 * callers — overlaySplitStores() / mirrorIntoSplitStores() — sit behind
 * readFinanceJsonStore() / writeFinanceJsonStore(), which run only in the
 * VITEST / NODE_ENV=test compatibility path (where the enable-guard then
 * disables it). So the `personal_finance` DB looks orphaned in the current
 * tree. This suite still locks down the module's write→read contract so the
 * cutover can re-wire it in — or remove it — against a known-good baseline.
 *
 * This script is NOT a vitest test. It runs under a plain `tsx` process (no
 * VITEST env, no NODE_ENV=test), so the guard lets Postgres through — but it
 * points HERMES_PERSONAL_FINANCE_PG_DATABASE at a throwaway `*_it_<ts>`
 * database that it creates and drops itself, and refuses to run against any
 * name that doesn't match that pattern. It never touches `personal_finance`.
 *
 * RUN:  pnpm test:pg-integration     (or: tsx scripts/personal-finance-pg-integration.ts)
 * Exits non-zero on the first failed assertion, so it works as a CI step
 * wherever a local Postgres 18 instance is reachable.
 */
import { spawnSync } from 'node:child_process'
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'

// ---------------------------------------------------------------------------
// 0. Wire the throwaway database BEFORE importing the store module (it reads
//    HERMES_PERSONAL_FINANCE_PG_DATABASE into a module-level const at import).
// ---------------------------------------------------------------------------
const RUN_ID = `${Date.now()}`
const THROWAWAY_DB = `personal_finance_it_${RUN_ID}`

if (!/^personal_finance_it_\d+$/.test(THROWAWAY_DB)) {
  console.error(`refusing to run against non-throwaway database "${THROWAWAY_DB}"`)
  process.exit(2)
}

process.env.HERMES_PERSONAL_FINANCE_PG_DATABASE = THROWAWAY_DB
// Must not be 'json' or the enable-guard short-circuits.
if (process.env.HERMES_FINANCE_STORE === 'json') delete process.env.HERMES_FINANCE_STORE
// Belt-and-braces: make sure we are not seen as a test runner.
delete process.env.VITEST
if (process.env.NODE_ENV === 'test') delete process.env.NODE_ENV

// Load HERMES_PG_* from ~/.hermes/.env the same way the store module does, so a
// bare `tsx` invocation without an exported env still connects.
loadHermesEnv()

// Redirect HOME to a throwaway dir BEFORE any store import: finance-store.ts
// captures FINANCE_DATA_DIR = <HOME>/.hermes/finance at import time. PG creds
// are already in process.env from loadHermesEnv() above, so the store modules
// no longer need the real ~/.hermes/.env. Section D (readFinanceStore overlay)
// depends on this; the personal-finance PG DB is still the throwaway.
const THROWAWAY_HOME = fs.mkdtempSync(path.join(os.tmpdir(), 'pf-pg-it-home-'))
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
    /* fall through — psql calls will fail loudly below */
  }
}

const PSQL =
  process.env.PSQL_BIN ||
  '/home/ubuntu/.pg0/installation/18.1.0/bin/psql'
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
  return {
    ok: res.status === 0,
    out: `${res.stdout ?? ''}${res.stderr ?? ''}`.trim(),
  }
}

// ---------------------------------------------------------------------------
// 1. Tiny assertion harness.
// ---------------------------------------------------------------------------
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

/** Recursively sort object keys so comparison ignores key order (Postgres
 *  jsonb does not preserve insertion order). Arrays keep their order. */
function canon(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canon)
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {}
    for (const key of Object.keys(value as Record<string, unknown>).sort()) {
      out[key] = canon((value as Record<string, unknown>)[key])
    }
    return out
  }
  return value
}

function eq(label: string, actual: unknown, expected: unknown): void {
  const a = JSON.stringify(canon(actual))
  const e = JSON.stringify(canon(expected))
  check(label, a === e, a === e ? undefined : `expected ${e}, got ${a}`)
}

// ---------------------------------------------------------------------------
// 2. Fixture — one representative row per collection, chosen to exercise the
//    snake_case <-> camelCase mapping (multi-word + digit segments), booleans,
//    nulls, nested JSON (settings, pending_ingestions children).
// ---------------------------------------------------------------------------
const TS = '2026-09-07T00:00:00.000Z'
const base = { source: 'pg-integration', createdAt: TS, updatedAt: TS }

const slice = {
  finance_accounts: [
    {
      ...base,
      id: 'acc-1',
      name: 'Main BOC',
      type: 'bank',
      currency: 'LKR',
      balance: 250_000,
      openingBalance: 200_000,
      openingBalanceDate: '2026-01-01',
      maskedIdentifier: '**** 1234',
      platform: null,
    },
  ],
  income_records: [
    {
      ...base,
      id: 'inc-1',
      dateReceived: '2026-09-01',
      sourceName: 'Salary',
      incomeType: 'Salary',
      originalCurrency: 'LKR',
      originalAmount: 400_000,
      exchangeRateUsed: 1,
      convertedLkrAmount: 400_000,
      accountId: 'acc-1',
      taxable: true,
      notes: null,
      documentRef: null,
      incomeSourceId: 'src-1',
      tags: 'salary,primary',
      status: 'cleared',
    },
  ],
  expense_records: [
    {
      ...base,
      id: 'exp-1',
      date: '2026-09-03',
      vendor: 'Keells',
      category: 'Groceries',
      subcategory: 'Food',
      accountId: 'acc-1',
      currency: 'LKR',
      amount: 8_500,
      convertedLkrAmount: 8_500,
      recurring: false,
      workRelated: false,
      taxDeductiblePossible: false,
      notes: 'weekly shop',
      documentRef: null,
      tags: 'food',
      status: 'pending',
    },
  ],
  budget_categories: [
    { ...base, id: 'bud-1', month: '2026-09', category: 'Groceries', currency: 'LKR', budgetAmount: 40_000 },
  ],
  categories: [
    { ...base, id: 'cat-1', name: 'Groceries', kind: 'expense', color: '#2e7d32', notes: null },
  ],
  subcategories: [
    { ...base, id: 'sub-1', name: 'Food', parentCategory: 'Groceries' },
  ],
  merchants: [
    { ...base, id: 'mer-1', name: 'Keells', defaultCategory: 'Groceries' },
  ],
  tags: [
    { ...base, id: 'tag-1', name: 'food', notes: null },
  ],
  savings_goals: [
    {
      ...base,
      id: 'goal-1',
      name: 'Emergency fund',
      targetAmount: 1_000_000,
      currentAmount: 300_000,
      currency: 'LKR',
      targetDate: '2027-01-01',
      status: 'active',
      goalKind: 'emergency_fund',
      monthlyContribution: 50_000,
      priority: 1,
    },
  ],
  tax_records: [
    {
      ...base,
      id: 'tax-1',
      taxYear: '2025/2026',
      incomeType: 'Salary',
      currency: 'LKR',
      convertedLkrAmount: 400_000,
      exchangeRateSource: 'manual',
      taxPaid: 60_000,
      taxDue: 0,
      requiresConfirmation: true,
    },
  ],
  exchange_rates: [
    { ...base, id: 'fx-1', base: 'LKR', target: 'AUD', rate: 0.005, date: '2026-09-01' },
  ],
  investment_accounts: [
    { ...base, id: 'inv-1', name: 'CSE Broker', platform: 'CSE', data: { note: 'nested blob stays intact', n: 1 } },
  ],
  // Shape per the app's PendingIngestion: parent row + a single `extracted`
  // object (one-to-one child table) and/or a single `extractedContract`
  // object carrying its own `risks[]`.
  pending_ingestions: [
    {
      ...base,
      id: 'pend-1',
      status: 'awaiting_review',
      documentType: 'transaction',
      sourceRef: 'gmail:abc123',
      extracted: {
        kind: 'expense',
        amount: 1_200,
        currency: 'LKR',
        vendorOrSource: 'Uber',
        date: '2026-09-05',
        category: 'Transport',
        confidence: 'medium',
      },
      extractedContract: {
        employerName: 'Acme Corp',
        employmentType: 'employment',
        monthlyIncomeAmount: 400_000,
        currency: 'LKR',
        jobTitle: 'Engineer',
        confidence: 'high',
        risks: [{ severity: 'low', clause: 'Notice period', concern: '1 month' }],
      },
    },
  ],
  income_sources: [
    {
      ...base,
      id: 'src-1',
      name: 'Acme Corp',
      status: 'active',
      currency: 'LKR',
      monthlyIncomeAmount: 400_000,
      jobTitle: 'Engineer',
      employmentType: 'employment',
      expectedPaydayDayOfMonth: 25,
      paySchedule: 'monthly',
      documentRef: null,
    },
  ],
  stock_holdings: [
    { ...base, id: 'sh-1', symbol: 'JKH.N0000', quantity: 100, buyPrice: 180, currency: 'LKR', lastKnownPrice: 200, notes: null },
  ],
  fixed_deposits: [
    { ...base, id: 'fd-1', bankName: 'BOC', principal: 500_000, currency: 'LKR', interestRatePct: 12.5, maturityDate: '2027-03-01', status: 'active', notes: null },
  ],
  loans: [
    { ...base, id: 'loan-1', lender: 'HNB', principal: 3_000_000, currency: 'LKR', interestRatePct: 9.5, termMonths: 240, monthlyPayment: 28_000, status: 'active' },
  ],
  properties: [
    { ...base, id: 'prop-1', name: 'Home', estimatedValueLkr: 25_000_000, linkedLoanId: 'loan-1' },
  ],
  beneficiaries: [
    { ...base, id: 'ben-1', name: 'Spouse', relationship: 'spouse', notes: 'primary' },
  ],
  personalFinanceSettings: {
    emergencyFundTargetMonths: 6,
    savingsRateTargetPct: 25,
    wealthGoalTargetLkr: 50_000_000,
    wealthGoalTargetDate: '2035-01-01',
    financeQaHistory: [{ at: 1_725_600_000, question: 'net worth?', answer: 'LKR 22M' }],
    gmailIngestState: {
      lastSyncedAtSeconds: 1_725_600_000,
      syncHistory: [{ at: 1_725_600_000, found: 3, queued: 2, skippedAlreadyQueued: 1 }],
    },
    categoryCorrections: { keells: 'Groceries', uber: 'Transport' },
  },
} as const

// ---------------------------------------------------------------------------
// 3. Run.
// ---------------------------------------------------------------------------
async function main(): Promise<void> {
  // Pre-flight: Postgres reachable, and the throwaway DB does not already exist.
  const ping = psql('postgres', 'SELECT 1')
  if (!ping.ok) {
    console.error(`Postgres not reachable via ${PSQL} (${ping.out}); skipping.`)
    process.exit(2)
  }
  const pre = psql('postgres', `SELECT 1 FROM pg_database WHERE datname = '${THROWAWAY_DB}'`)
  if (pre.out.trim() === '1') {
    console.error(`throwaway DB ${THROWAWAY_DB} already exists — aborting`)
    process.exit(2)
  }

  const store = await import('../src/server/personal-finance-postgres-store')

  try {
    console.log(`\n# personal-finance-pg-integration  (db=${THROWAWAY_DB})\n`)

    // --- A. fresh/empty DB reads gracefully -------------------------------
    console.log('A. fresh database')
    const empty = store.readPersonalFinancePostgresStore()
    check('read before any write does not throw and returns a slice', empty !== null)
    if (empty) {
      eq('empty slice: finance_accounts is []', empty.finance_accounts, [])
      eq('empty slice: income_records is []', empty.income_records, [])
    }
    const status0 = store.personalFinancePostgresStatus()
    eq('status.enabled on throwaway DB', status0.enabled, true)
    eq('status.available on throwaway DB', status0.available, true)
    eq('status.database is the throwaway name', status0.database, THROWAWAY_DB)

    // --- B. write -> read round-trip ------------------------------------
    console.log('\nB. write -> read round-trip')
    const wrote = store.writePersonalFinancePostgresStore(slice as never)
    check('writePersonalFinancePostgresStore returned true', wrote === true, store.personalFinancePostgresStatus().lastWriteError)
    const back = store.readPersonalFinancePostgresStore()
    check('read after write returns a slice', back !== null)
    if (!back) throw new Error('read returned null after a successful write')

    // Flat collections: row counts + the mapping-sensitive fields.
    eq('finance_accounts count', back.finance_accounts.length, 1)
    eq('account.openingBalanceDate mapped', back.finance_accounts[0].openingBalanceDate, '2026-01-01')
    eq('account.maskedIdentifier mapped', back.finance_accounts[0].maskedIdentifier, '**** 1234')
    eq('account.platform null preserved', back.finance_accounts[0].platform, null)
    eq('account.balance numeric preserved', back.finance_accounts[0].balance, 250_000)

    eq('income.convertedLkrAmount mapped', back.income_records[0].convertedLkrAmount, 400_000)
    eq('income.incomeSourceId mapped', back.income_records[0].incomeSourceId, 'src-1')
    eq('income.tags delimited field preserved', back.income_records[0].tags, 'salary,primary')
    eq('income.status preserved', back.income_records[0].status, 'cleared')
    eq('income.taxable boolean preserved', back.income_records[0].taxable, true)

    eq('expense.taxDeductiblePossible mapped', back.expense_records[0].taxDeductiblePossible, false)
    eq('expense.status pending preserved', back.expense_records[0].status, 'pending')

    eq('budget.budgetAmount mapped', back.budget_categories[0].budgetAmount, 40_000)
    eq('savings_goal.goalKind mapped', back.savings_goals?.[0]?.goalKind, 'emergency_fund')
    eq('savings_goal.monthlyContribution mapped', back.savings_goals?.[0]?.monthlyContribution, 50_000)
    eq('tax.convertedLkrAmount mapped', back.tax_records[0].convertedLkrAmount, 400_000)
    eq('tax.exchangeRateSource mapped', back.tax_records[0].exchangeRateSource, 'manual')
    eq('income_source.expectedPaydayDayOfMonth mapped', back.income_sources[0].expectedPaydayDayOfMonth, 25)
    eq('income_source.jobTitle mapped', back.income_sources[0].jobTitle, 'Engineer')
    eq('fixed_deposit.interestRatePct mapped', back.fixed_deposits[0].interestRatePct, 12.5)
    eq('loan.termMonths mapped', back.loans?.[0]?.termMonths, 240)
    eq('property.linkedLoanId mapped', back.properties?.[0]?.linkedLoanId, 'loan-1')
    eq('beneficiary.relationship preserved', back.beneficiaries?.[0]?.relationship, 'spouse')

    // Custom readers: exchange_rates, investment_accounts (nested blob),
    // pending_ingestions (+ children), settings.
    eq('exchange_rates round-trip', back.exchange_rates[0]?.rate, 0.005)
    eq(
      'investment_accounts nested data blob intact',
      back.investment_accounts[0]?.data,
      { note: 'nested blob stays intact', n: 1 },
    )
    eq('pending_ingestions count', back.pending_ingestions.length, 1)
    eq('pending_ingestion.status', back.pending_ingestions[0]?.status, 'awaiting_review')
    eq('pending_ingestion.documentType mapped', back.pending_ingestions[0]?.documentType, 'transaction')
    eq(
      'pending_ingestion child `extracted` transaction round-trips',
      (back.pending_ingestions[0]?.extracted as { amount?: number })?.amount,
      1_200,
    )
    eq(
      'pending_ingestion child `extracted.vendorOrSource` mapped',
      (back.pending_ingestions[0]?.extracted as { vendorOrSource?: string })?.vendorOrSource,
      'Uber',
    )
    eq(
      'pending_ingestion `extractedContract` + nested risks round-trip',
      (
        (back.pending_ingestions[0]?.extractedContract as { risks?: unknown[] })
          ?.risks ?? []
      ).length,
      1,
    )
    eq('settings.emergencyFundTargetMonths', back.personalFinanceSettings?.emergencyFundTargetMonths, 6)
    eq(
      'settings.categoryCorrections map preserved',
      back.personalFinanceSettings?.categoryCorrections,
      { keells: 'Groceries', uber: 'Transport' },
    )
    eq(
      'settings.financeQaHistory preserved',
      back.personalFinanceSettings?.financeQaHistory?.[0]?.answer,
      'LKR 22M',
    )
    eq(
      'settings.gmailIngestState.syncHistory preserved',
      back.personalFinanceSettings?.gmailIngestState?.syncHistory?.[0]?.queued,
      2,
    )

    // --- C. replace semantics -----------------------------------------
    console.log('\nC. mirror is replace-not-append')
    store.writePersonalFinancePostgresStore(slice as never)
    const twice = store.readPersonalFinancePostgresStore()
    eq('second identical write does not duplicate rows', twice?.finance_accounts.length, 1)

    const mutated = {
      ...slice,
      finance_accounts: [{ ...slice.finance_accounts[0], balance: 999_999 }],
      income_records: [], // drop the only income row
    }
    store.writePersonalFinancePostgresStore(mutated as never)
    const after = store.readPersonalFinancePostgresStore()
    eq('mutated balance reflected', after?.finance_accounts[0].balance, 999_999)
    eq('removed income row is gone (replace, not merge)', after?.income_records.length, 0)

    // NOTE — no readFinanceStore()/overlaySplitStores() merge coverage here,
    // by design: see the CAVEAT in the file header. In this tree that merge
    // path is unreachable in production, so there is nothing live to assert
    // against until the finance cutover re-wires (or removes) this module.

    // --- D. resilience: a missing table degrades to null, never throws ---
    console.log('\nD. missing-table resilience')
    psql(THROWAWAY_DB, 'DROP TABLE beneficiaries')
    let threw = false
    let degraded: unknown = 'unset'
    try {
      degraded = store.readPersonalFinancePostgresStore()
    } catch {
      threw = true
    }
    check('read with a dropped table does not throw', threw === false)
    eq('read with a dropped table returns null (safe fallback)', degraded, null)
  } finally {
    // --- teardown ---------------------------------------------------------
    console.log('\n# teardown')
    // Terminate our own idle connections, then drop.
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
  // Best-effort teardown on an unexpected throw.
  psql('postgres', `DROP DATABASE IF EXISTS ${THROWAWAY_DB}`)
  try {
    fs.rmSync(THROWAWAY_HOME, { recursive: true, force: true })
  } catch {
    /* ignore */
  }
  process.exit(1)
})
