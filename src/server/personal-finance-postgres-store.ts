/**
 * Structured Postgres mirror for personal-finance data, in its own
 * `personal_finance` database — separate from the `finance` database
 * `finance-postgres-store.ts` owns (trading engine state only). Two
 * databases on the same single PG 18.1 instance, split by domain, matching
 * the existing "one database per use" convention
 * (~/.hermes/postgres-credentials.md: hermes/finance/harp/agents/ops).
 *
 * Deliberately a fully self-contained sibling file — does not import from
 * or get imported by finance-postgres-store.ts, which has unrelated live
 * work in progress elsewhere; nothing here should ever require touching
 * that file. Hooked in from personal-finance-store.ts's own
 * writePersonalFinanceStore(), not from finance-store.ts directly.
 *
 * Write-only relative to the running app: the JSON mirror
 * (personal-finance-store.ts) remains the thing the app actually reads
 * back from (via finance-store.ts's overlaySplitStores()). This Postgres
 * copy exists so personal-finance data is queryable as real SQL tables
 * instead of only living inside a JSONB blob — it is not a read path for
 * the app itself, so its own unavailability can never break a read.
 */
import { spawnSync } from 'node:child_process'
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import type { PersonalFinanceSlice } from './personal-finance-store'

const HERMES_HOME =
  process.env.HERMES_HOME ?? process.env.CLAUDE_HOME ?? path.join(os.homedir(), '.hermes')
const PERSONAL_FINANCE_PG_DATABASE = process.env.HERMES_PERSONAL_FINANCE_PG_DATABASE || 'personal_finance'
const PSQL_CANDIDATES = ['/home/ubuntu/.pg0/installation/18.1.0/bin/psql', 'psql']

interface PgConn {
  host: string
  port: string
  user: string
  password: string
}

export interface PersonalFinancePostgresStatus {
  enabled: boolean
  available: boolean
  database: string
  reason?: string
  lastWriteError?: string
}

let schemaReady = false
let lastWriteError: string | null = null

function personalFinancePostgresEnabled(): boolean {
  // Same guard as finance-postgres-store.ts's own financePostgresEnabled():
  // tests isolate the JSON store via a $HOME override, which does nothing
  // for this module's direct Postgres connection — without this, any test
  // calling writePersonalFinanceStore() would silently write to the real
  // production personal_finance database.
  if (process.env.VITEST || process.env.NODE_ENV === 'test') return false
  return process.env.HERMES_FINANCE_STORE !== 'json'
}

function envFileValues(): Record<string, string> {
  const values: Record<string, string> = {}
  try {
    const env = fs.readFileSync(path.join(HERMES_HOME, '.env'), 'utf8')
    for (const line of env.split('\n')) {
      const match = line.match(/^HERMES_PG_(PASSWORD|HOST|PORT|USER)=(.*)$/)
      if (!match) continue
      values[`HERMES_PG_${match[1]}`] = match[2].trim().replace(/^"|"$/g, '')
    }
  } catch {
    return values
  }
  return values
}

function pgConn(): PgConn | null {
  if (!personalFinancePostgresEnabled()) return null
  const file = envFileValues()
  const password = process.env.HERMES_PG_PASSWORD || file.HERMES_PG_PASSWORD
  if (!password) return null
  return {
    host: process.env.HERMES_PG_HOST || file.HERMES_PG_HOST || '127.0.0.1',
    port: process.env.HERMES_PG_PORT || file.HERMES_PG_PORT || '5432',
    user: process.env.HERMES_PG_USER || file.HERMES_PG_USER || 'hermes_app',
    password,
  }
}

function sqlText(value: string): string {
  return `'${value.replace(/'/g, "''")}'`
}

function sqlIdentifier(value: string): string {
  if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(value)) throw new Error(`Unsafe Postgres identifier: ${value}`)
  return `"${value.replace(/"/g, '""')}"`
}

function sqlNullableText(value: unknown): string {
  return typeof value === 'string' && value.length > 0 ? sqlText(value) : 'NULL'
}

function sqlNumber(value: unknown, fallback = 0): string {
  const number =
    typeof value === 'number' ? value : typeof value === 'string' && value.trim() !== '' ? Number(value) : fallback
  return Number.isFinite(number) ? String(number) : String(fallback)
}

function sqlNullableNumber(value: unknown): string {
  const number = typeof value === 'number' ? value : typeof value === 'string' && value.trim() !== '' ? Number(value) : Number.NaN
  return Number.isFinite(number) ? String(number) : 'NULL'
}

function sqlBoolean(value: unknown): string {
  return value === true ? 'TRUE' : 'FALSE'
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value))
}

function rows(value: unknown): Array<Record<string, unknown>> {
  return Array.isArray(value) ? value.filter(isRecord) : []
}

function firstText(row: Record<string, unknown>, key: string, fallback = ''): string {
  const value = row[key]
  return typeof value === 'string' ? value : fallback
}

function insertRows(table: string, columns: Array<string>, values: Array<Array<string>>): string {
  if (values.length === 0) return ''
  const columnSql = columns.map(sqlIdentifier).join(', ')
  const valuesSql = values.map((row) => `(${row.join(', ')})`).join(',\n')
  return `INSERT INTO ${sqlIdentifier(table)} (${columnSql}) VALUES\n${valuesSql};`
}

function runPsql(database: string, sql: string): { ok: true; stdout: string } | { ok: false; reason: string } {
  const conn = pgConn()
  if (!conn) return { ok: false, reason: 'Postgres credentials are not configured' }
  for (const psql of PSQL_CANDIDATES) {
    const result = spawnSync(
      psql,
      ['-h', conn.host, '-p', conn.port, '-U', conn.user, '-d', database, '-tA', '-v', 'ON_ERROR_STOP=1', '-f', '-'],
      {
        env: { ...process.env, PGPASSWORD: conn.password },
        encoding: 'utf8',
        input: sql,
        timeout: 20_000,
        maxBuffer: 16 * 1024 * 1024,
      },
    )
    if (result.error && (result.error as NodeJS.ErrnoException).code === 'ENOENT') continue
    const stdout = typeof result.stdout === 'string' ? result.stdout.trim() : ''
    const stderr = typeof result.stderr === 'string' ? result.stderr.trim() : ''
    if (result.status === 0) return { ok: true, stdout }
    return { ok: false, reason: stderr || result.error?.message || `psql exited ${result.status}` }
  }
  return { ok: false, reason: 'psql executable not found' }
}

function ensurePersonalFinanceDatabase(): boolean {
  const exists = runPsql('postgres', `SELECT 1 FROM pg_database WHERE datname = ${sqlText(PERSONAL_FINANCE_PG_DATABASE)};`)
  if (!exists.ok) return false
  if (exists.stdout.trim() === '1') return true
  const created = runPsql('postgres', `CREATE DATABASE ${sqlIdentifier(PERSONAL_FINANCE_PG_DATABASE)};`)
  return created.ok
}

function ensurePersonalFinancePostgresSchema(): boolean {
  if (schemaReady) return true
  if (!ensurePersonalFinanceDatabase()) return false
  const result = runPsql(
    PERSONAL_FINANCE_PG_DATABASE,
    `
CREATE TABLE IF NOT EXISTS finance_accounts (
  id TEXT PRIMARY KEY, name TEXT NOT NULL, type TEXT NOT NULL, currency TEXT NOT NULL,
  balance DOUBLE PRECISION NOT NULL, opening_balance DOUBLE PRECISION, opening_balance_date TEXT,
  masked_identifier TEXT, platform TEXT,
  source TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL
);
ALTER TABLE finance_accounts ADD COLUMN IF NOT EXISTS opening_balance DOUBLE PRECISION;
ALTER TABLE finance_accounts ADD COLUMN IF NOT EXISTS opening_balance_date TEXT;

CREATE TABLE IF NOT EXISTS income_records (
  id TEXT PRIMARY KEY, date_received TEXT NOT NULL, source_name TEXT NOT NULL, income_type TEXT NOT NULL,
  original_currency TEXT NOT NULL, original_amount DOUBLE PRECISION NOT NULL, exchange_rate_used DOUBLE PRECISION NOT NULL,
  converted_lkr_amount DOUBLE PRECISION NOT NULL, account_id TEXT, taxable BOOLEAN NOT NULL,
  notes TEXT, document_ref TEXT, income_source_id TEXT, tags TEXT, status TEXT, source TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL
);
ALTER TABLE income_records ADD COLUMN IF NOT EXISTS income_source_id TEXT;
ALTER TABLE income_records ADD COLUMN IF NOT EXISTS tags TEXT;
ALTER TABLE income_records ADD COLUMN IF NOT EXISTS status TEXT;

CREATE TABLE IF NOT EXISTS expense_records (
  id TEXT PRIMARY KEY, date TEXT NOT NULL, vendor TEXT NOT NULL, category TEXT NOT NULL, subcategory TEXT,
  account_id TEXT, currency TEXT NOT NULL, amount DOUBLE PRECISION NOT NULL, converted_lkr_amount DOUBLE PRECISION NOT NULL,
  recurring BOOLEAN NOT NULL, work_related BOOLEAN NOT NULL, tax_deductible_possible BOOLEAN NOT NULL,
  notes TEXT, document_ref TEXT, tags TEXT, status TEXT, source TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL
);
ALTER TABLE expense_records ADD COLUMN IF NOT EXISTS tags TEXT;
ALTER TABLE expense_records ADD COLUMN IF NOT EXISTS status TEXT;

CREATE TABLE IF NOT EXISTS budget_categories (
  id TEXT PRIMARY KEY, month TEXT NOT NULL, category TEXT NOT NULL, currency TEXT NOT NULL,
  budget_amount DOUBLE PRECISION NOT NULL, source TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS categories (
  id TEXT PRIMARY KEY, name TEXT NOT NULL, kind TEXT NOT NULL, color TEXT, notes TEXT,
  source TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS subcategories (
  id TEXT PRIMARY KEY, name TEXT NOT NULL, parent_category TEXT NOT NULL,
  source TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS merchants (
  id TEXT PRIMARY KEY, name TEXT NOT NULL, default_category TEXT, notes TEXT,
  source TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS tags (
  id TEXT PRIMARY KEY, name TEXT NOT NULL, notes TEXT,
  source TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS savings_goals (
  id TEXT PRIMARY KEY, name TEXT NOT NULL, target_amount DOUBLE PRECISION NOT NULL, current_amount DOUBLE PRECISION NOT NULL,
  currency TEXT NOT NULL, target_date TEXT, monthly_contribution DOUBLE PRECISION NOT NULL, priority DOUBLE PRECISION NOT NULL,
  linked_account_id TEXT, status TEXT NOT NULL, source TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL
);
ALTER TABLE savings_goals ADD COLUMN IF NOT EXISTS goal_kind TEXT;

CREATE TABLE IF NOT EXISTS tax_records (
  id TEXT PRIMARY KEY, tax_year TEXT NOT NULL, income_type TEXT NOT NULL, amount DOUBLE PRECISION NOT NULL,
  currency TEXT NOT NULL, converted_lkr_amount DOUBLE PRECISION NOT NULL, exchange_rate_source TEXT NOT NULL,
  deduction_category TEXT, estimated_taxable_amount DOUBLE PRECISION NOT NULL, tax_paid DOUBLE PRECISION NOT NULL,
  tax_due DOUBLE PRECISION NOT NULL, requires_confirmation BOOLEAN NOT NULL, notes TEXT, supporting_document TEXT,
  source TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS income_sources (
  id TEXT PRIMARY KEY, employer_name TEXT NOT NULL, employment_type TEXT NOT NULL,
  monthly_income_amount DOUBLE PRECISION, currency TEXT NOT NULL, contract_start_date TEXT, contract_end_date TEXT,
  job_title TEXT, expected_payday_day_of_month INTEGER, pay_schedule TEXT, status TEXT NOT NULL, notes TEXT,
  document_ref TEXT, source TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL
);
ALTER TABLE income_sources ADD COLUMN IF NOT EXISTS job_title TEXT;
ALTER TABLE income_sources ADD COLUMN IF NOT EXISTS document_ref TEXT;
ALTER TABLE income_sources ADD COLUMN IF NOT EXISTS expected_payday_day_of_month INTEGER;
ALTER TABLE income_sources ADD COLUMN IF NOT EXISTS pay_schedule TEXT;

CREATE TABLE IF NOT EXISTS stock_holdings (
  id TEXT PRIMARY KEY, symbol TEXT NOT NULL, company_name TEXT, platform TEXT NOT NULL,
  quantity DOUBLE PRECISION NOT NULL, buy_price DOUBLE PRECISION NOT NULL, buy_date TEXT NOT NULL,
  currency TEXT NOT NULL, last_known_price DOUBLE PRECISION, last_price_updated_at TEXT, price_source TEXT NOT NULL,
  notes TEXT, source TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS fixed_deposits (
  id TEXT PRIMARY KEY, bank_name TEXT NOT NULL, principal DOUBLE PRECISION NOT NULL, currency TEXT NOT NULL,
  interest_rate_pct DOUBLE PRECISION NOT NULL, interest_payout TEXT NOT NULL, start_date TEXT NOT NULL,
  maturity_date TEXT NOT NULL, status TEXT NOT NULL, notes TEXT, source TEXT NOT NULL,
  created_at TEXT NOT NULL, updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS loans (
  id TEXT PRIMARY KEY, lender TEXT NOT NULL, principal DOUBLE PRECISION NOT NULL, current_balance DOUBLE PRECISION NOT NULL,
  currency TEXT NOT NULL, interest_rate_pct DOUBLE PRECISION NOT NULL, monthly_payment DOUBLE PRECISION,
  start_date TEXT NOT NULL, term_months INTEGER, status TEXT NOT NULL, notes TEXT, source TEXT NOT NULL,
  created_at TEXT NOT NULL, updated_at TEXT NOT NULL
);
`,
  )
  if (result.ok) schemaReady = true
  return result.ok
}

function financeAccountRows(rowsIn: Array<Record<string, unknown>>): Array<Array<string>> {
  return rowsIn.map((row) => [
    sqlText(firstText(row, 'id')),
    sqlText(firstText(row, 'name')),
    sqlText(firstText(row, 'type')),
    sqlText(firstText(row, 'currency')),
    sqlNumber(row.balance),
    sqlNullableNumber(row.openingBalance),
    sqlNullableText(row.openingBalanceDate),
    sqlNullableText(row.maskedIdentifier),
    sqlNullableText(row.platform),
    sqlText(firstText(row, 'source', 'manual')),
    sqlText(firstText(row, 'createdAt')),
    sqlText(firstText(row, 'updatedAt')),
  ])
}

function incomeRecordRows(rowsIn: Array<Record<string, unknown>>): Array<Array<string>> {
  return rowsIn.map((row) => [
    sqlText(firstText(row, 'id')),
    sqlText(firstText(row, 'dateReceived')),
    sqlText(firstText(row, 'sourceName')),
    sqlText(firstText(row, 'incomeType')),
    sqlText(firstText(row, 'originalCurrency')),
    sqlNumber(row.originalAmount),
    sqlNumber(row.exchangeRateUsed, 1),
    sqlNumber(row.convertedLkrAmount),
    sqlNullableText(row.accountId),
    sqlBoolean(row.taxable),
    sqlNullableText(row.notes),
    sqlNullableText(row.documentRef),
    sqlNullableText(row.incomeSourceId),
    sqlNullableText(row.tags),
    sqlNullableText(row.status),
    sqlText(firstText(row, 'source', 'manual')),
    sqlText(firstText(row, 'createdAt')),
    sqlText(firstText(row, 'updatedAt')),
  ])
}

function expenseRecordRows(rowsIn: Array<Record<string, unknown>>): Array<Array<string>> {
  return rowsIn.map((row) => [
    sqlText(firstText(row, 'id')),
    sqlText(firstText(row, 'date')),
    sqlText(firstText(row, 'vendor')),
    sqlText(firstText(row, 'category')),
    sqlNullableText(row.subcategory),
    sqlNullableText(row.accountId),
    sqlText(firstText(row, 'currency')),
    sqlNumber(row.amount),
    sqlNumber(row.convertedLkrAmount),
    sqlBoolean(row.recurring),
    sqlBoolean(row.workRelated),
    sqlBoolean(row.taxDeductiblePossible),
    sqlNullableText(row.notes),
    sqlNullableText(row.documentRef),
    sqlNullableText(row.tags),
    sqlNullableText(row.status),
    sqlText(firstText(row, 'source', 'manual')),
    sqlText(firstText(row, 'createdAt')),
    sqlText(firstText(row, 'updatedAt')),
  ])
}

function budgetCategoryRows(rowsIn: Array<Record<string, unknown>>): Array<Array<string>> {
  return rowsIn.map((row) => [
    sqlText(firstText(row, 'id')),
    sqlText(firstText(row, 'month')),
    sqlText(firstText(row, 'category')),
    sqlText(firstText(row, 'currency')),
    sqlNumber(row.budgetAmount),
    sqlText(firstText(row, 'source', 'manual')),
    sqlText(firstText(row, 'createdAt')),
    sqlText(firstText(row, 'updatedAt')),
  ])
}

function categoryRows(rowsIn: Array<Record<string, unknown>>): Array<Array<string>> {
  return rowsIn.map((row) => [
    sqlText(firstText(row, 'id')),
    sqlText(firstText(row, 'name')),
    sqlText(firstText(row, 'kind', 'both')),
    sqlNullableText(row.color),
    sqlNullableText(row.notes),
    sqlText(firstText(row, 'source', 'manual')),
    sqlText(firstText(row, 'createdAt')),
    sqlText(firstText(row, 'updatedAt')),
  ])
}

function subcategoryRows(rowsIn: Array<Record<string, unknown>>): Array<Array<string>> {
  return rowsIn.map((row) => [
    sqlText(firstText(row, 'id')),
    sqlText(firstText(row, 'name')),
    sqlText(firstText(row, 'parentCategory', 'Other')),
    sqlText(firstText(row, 'source', 'manual')),
    sqlText(firstText(row, 'createdAt')),
    sqlText(firstText(row, 'updatedAt')),
  ])
}

function merchantRows(rowsIn: Array<Record<string, unknown>>): Array<Array<string>> {
  return rowsIn.map((row) => [
    sqlText(firstText(row, 'id')),
    sqlText(firstText(row, 'name')),
    sqlNullableText(row.defaultCategory),
    sqlNullableText(row.notes),
    sqlText(firstText(row, 'source', 'manual')),
    sqlText(firstText(row, 'createdAt')),
    sqlText(firstText(row, 'updatedAt')),
  ])
}

function tagRows(rowsIn: Array<Record<string, unknown>>): Array<Array<string>> {
  return rowsIn.map((row) => [
    sqlText(firstText(row, 'id')),
    sqlText(firstText(row, 'name')),
    sqlNullableText(row.notes),
    sqlText(firstText(row, 'source', 'manual')),
    sqlText(firstText(row, 'createdAt')),
    sqlText(firstText(row, 'updatedAt')),
  ])
}

function savingsGoalRows(rowsIn: Array<Record<string, unknown>>): Array<Array<string>> {
  return rowsIn.map((row) => [
    sqlText(firstText(row, 'id')),
    sqlText(firstText(row, 'name')),
    sqlNumber(row.targetAmount),
    sqlNumber(row.currentAmount),
    sqlText(firstText(row, 'currency')),
    sqlNullableText(row.targetDate),
    sqlNumber(row.monthlyContribution),
    sqlNumber(row.priority, 3),
    sqlNullableText(row.linkedAccountId),
    sqlText(firstText(row, 'status', 'active')),
    sqlText(firstText(row, 'source', 'manual')),
    sqlText(firstText(row, 'createdAt')),
    sqlText(firstText(row, 'updatedAt')),
    sqlNullableText(row.goalKind),
  ])
}

function taxRecordRows(rowsIn: Array<Record<string, unknown>>): Array<Array<string>> {
  return rowsIn.map((row) => [
    sqlText(firstText(row, 'id')),
    sqlText(firstText(row, 'taxYear')),
    sqlText(firstText(row, 'incomeType')),
    sqlNumber(row.amount),
    sqlText(firstText(row, 'currency')),
    sqlNumber(row.convertedLkrAmount),
    sqlText(firstText(row, 'exchangeRateSource', 'manual')),
    sqlNullableText(row.deductionCategory),
    sqlNumber(row.estimatedTaxableAmount),
    sqlNumber(row.taxPaid),
    sqlNumber(row.taxDue),
    sqlBoolean(row.requiresConfirmation),
    sqlNullableText(row.notes),
    sqlNullableText(row.supportingDocument),
    sqlText(firstText(row, 'source', 'manual')),
    sqlText(firstText(row, 'createdAt')),
    sqlText(firstText(row, 'updatedAt')),
  ])
}

function incomeSourceRows(rowsIn: Array<Record<string, unknown>>): Array<Array<string>> {
  return rowsIn.map((row) => [
    sqlText(firstText(row, 'id')),
    sqlText(firstText(row, 'employerName')),
    sqlText(firstText(row, 'employmentType', 'other')),
    sqlNullableNumber(row.monthlyIncomeAmount),
    sqlText(firstText(row, 'currency')),
    sqlNullableText(row.contractStartDate),
    sqlNullableText(row.contractEndDate),
    sqlNullableText(row.jobTitle),
    sqlNullableNumber(row.expectedPaydayDayOfMonth),
    sqlNullableText(row.paySchedule),
    sqlText(firstText(row, 'status', 'active')),
    sqlNullableText(row.notes),
    sqlNullableText(row.documentRef),
    sqlText(firstText(row, 'source', 'manual')),
    sqlText(firstText(row, 'createdAt')),
    sqlText(firstText(row, 'updatedAt')),
  ])
}

function stockHoldingRows(rowsIn: Array<Record<string, unknown>>): Array<Array<string>> {
  return rowsIn.map((row) => [
    sqlText(firstText(row, 'id')),
    sqlText(firstText(row, 'symbol')),
    sqlNullableText(row.companyName),
    sqlText(firstText(row, 'platform')),
    sqlNumber(row.quantity),
    sqlNumber(row.buyPrice),
    sqlText(firstText(row, 'buyDate')),
    sqlText(firstText(row, 'currency')),
    sqlNullableNumber(row.lastKnownPrice),
    sqlNullableText(row.lastPriceUpdatedAt),
    sqlText(firstText(row, 'priceSource', 'manual')),
    sqlNullableText(row.notes),
    sqlText(firstText(row, 'source', 'manual')),
    sqlText(firstText(row, 'createdAt')),
    sqlText(firstText(row, 'updatedAt')),
  ])
}

function fixedDepositRows(rowsIn: Array<Record<string, unknown>>): Array<Array<string>> {
  return rowsIn.map((row) => [
    sqlText(firstText(row, 'id')),
    sqlText(firstText(row, 'bankName')),
    sqlNumber(row.principal),
    sqlText(firstText(row, 'currency')),
    sqlNumber(row.interestRatePct),
    sqlText(firstText(row, 'interestPayout', 'at_maturity')),
    sqlText(firstText(row, 'startDate')),
    sqlText(firstText(row, 'maturityDate')),
    sqlText(firstText(row, 'status', 'active')),
    sqlNullableText(row.notes),
    sqlText(firstText(row, 'source', 'manual')),
    sqlText(firstText(row, 'createdAt')),
    sqlText(firstText(row, 'updatedAt')),
  ])
}

function loanRows(rowsIn: Array<Record<string, unknown>>): Array<Array<string>> {
  return rowsIn.map((row) => [
    sqlText(firstText(row, 'id')),
    sqlText(firstText(row, 'lender')),
    sqlNumber(row.principal),
    sqlNumber(row.currentBalance),
    sqlText(firstText(row, 'currency')),
    sqlNumber(row.interestRatePct),
    sqlNullableNumber(row.monthlyPayment),
    sqlText(firstText(row, 'startDate')),
    sqlNullableNumber(row.termMonths),
    sqlText(firstText(row, 'status', 'active')),
    sqlNullableText(row.notes),
    sqlText(firstText(row, 'source', 'manual')),
    sqlText(firstText(row, 'createdAt')),
    sqlText(firstText(row, 'updatedAt')),
  ])
}

function personalFinanceMirrorSql(slice: PersonalFinanceSlice): string {
  return `
DELETE FROM finance_accounts;
DELETE FROM income_records;
DELETE FROM expense_records;
DELETE FROM budget_categories;
DELETE FROM categories;
DELETE FROM subcategories;
DELETE FROM merchants;
DELETE FROM tags;
DELETE FROM savings_goals;
DELETE FROM tax_records;
DELETE FROM income_sources;
DELETE FROM stock_holdings;
DELETE FROM fixed_deposits;
DELETE FROM loans;

${insertRows(
  'finance_accounts',
  [
    'id', 'name', 'type', 'currency', 'balance', 'opening_balance', 'opening_balance_date',
    'masked_identifier', 'platform', 'source', 'created_at', 'updated_at',
  ],
  financeAccountRows(rows(slice.finance_accounts)),
)}

${insertRows(
  'income_records',
  [
    'id', 'date_received', 'source_name', 'income_type', 'original_currency', 'original_amount',
    'exchange_rate_used', 'converted_lkr_amount', 'account_id', 'taxable', 'notes', 'document_ref',
    'income_source_id', 'tags', 'status', 'source', 'created_at', 'updated_at',
  ],
  incomeRecordRows(rows(slice.income_records)),
)}

${insertRows(
  'expense_records',
  [
    'id', 'date', 'vendor', 'category', 'subcategory', 'account_id', 'currency', 'amount',
    'converted_lkr_amount', 'recurring', 'work_related', 'tax_deductible_possible', 'notes',
    'document_ref', 'tags', 'status', 'source', 'created_at', 'updated_at',
  ],
  expenseRecordRows(rows(slice.expense_records)),
)}

${insertRows(
  'budget_categories',
  ['id', 'month', 'category', 'currency', 'budget_amount', 'source', 'created_at', 'updated_at'],
  budgetCategoryRows(rows(slice.budget_categories)),
)}

${insertRows(
  'categories',
  ['id', 'name', 'kind', 'color', 'notes', 'source', 'created_at', 'updated_at'],
  categoryRows(rows(slice.categories)),
)}

${insertRows(
  'subcategories',
  ['id', 'name', 'parent_category', 'source', 'created_at', 'updated_at'],
  subcategoryRows(rows(slice.subcategories)),
)}

${insertRows(
  'merchants',
  ['id', 'name', 'default_category', 'notes', 'source', 'created_at', 'updated_at'],
  merchantRows(rows(slice.merchants)),
)}

${insertRows(
  'tags',
  ['id', 'name', 'notes', 'source', 'created_at', 'updated_at'],
  tagRows(rows(slice.tags)),
)}

${insertRows(
  'savings_goals',
  [
    'id', 'name', 'target_amount', 'current_amount', 'currency', 'target_date', 'monthly_contribution',
    'priority', 'linked_account_id', 'status', 'source', 'created_at', 'updated_at', 'goal_kind',
  ],
  savingsGoalRows(rows(slice.savings_goals)),
)}

${insertRows(
  'tax_records',
  [
    'id', 'tax_year', 'income_type', 'amount', 'currency', 'converted_lkr_amount', 'exchange_rate_source',
    'deduction_category', 'estimated_taxable_amount', 'tax_paid', 'tax_due', 'requires_confirmation',
    'notes', 'supporting_document', 'source', 'created_at', 'updated_at',
  ],
  taxRecordRows(rows(slice.tax_records)),
)}

${insertRows(
  'income_sources',
  [
    'id', 'employer_name', 'employment_type', 'monthly_income_amount', 'currency', 'contract_start_date',
    'contract_end_date', 'job_title', 'expected_payday_day_of_month', 'pay_schedule', 'status', 'notes',
    'document_ref', 'source', 'created_at', 'updated_at',
  ],
  incomeSourceRows(rows(slice.income_sources)),
)}

${insertRows(
  'stock_holdings',
  [
    'id', 'symbol', 'company_name', 'platform', 'quantity', 'buy_price', 'buy_date', 'currency',
    'last_known_price', 'last_price_updated_at', 'price_source', 'notes', 'source', 'created_at', 'updated_at',
  ],
  stockHoldingRows(rows(slice.stock_holdings)),
)}

${insertRows(
  'fixed_deposits',
  [
    'id', 'bank_name', 'principal', 'currency', 'interest_rate_pct', 'interest_payout', 'start_date',
    'maturity_date', 'status', 'notes', 'source', 'created_at', 'updated_at',
  ],
  fixedDepositRows(rows(slice.fixed_deposits)),
)}

${insertRows(
  'loans',
  [
    'id', 'lender', 'principal', 'current_balance', 'currency', 'interest_rate_pct', 'monthly_payment',
    'start_date', 'term_months', 'status', 'notes', 'source', 'created_at', 'updated_at',
  ],
  loanRows(rows(slice.loans)),
)}
`
}

/**
 * Best-effort — must never throw back into the caller. Called from
 * personal-finance-store.ts's writePersonalFinanceStore() alongside its
 * own JSON-file write, which stays the thing the app actually reads back.
 */
export function writePersonalFinancePostgresStore(slice: PersonalFinanceSlice): boolean {
  if (!ensurePersonalFinancePostgresSchema()) return false
  const result = runPsql(PERSONAL_FINANCE_PG_DATABASE, `BEGIN;\n${personalFinanceMirrorSql(slice)}\nCOMMIT;`)
  lastWriteError = result.ok ? null : result.reason
  return result.ok
}

export function personalFinancePostgresStatus(): PersonalFinancePostgresStatus {
  if (!personalFinancePostgresEnabled()) {
    return {
      enabled: false,
      available: false,
      database: PERSONAL_FINANCE_PG_DATABASE,
      reason: 'disabled by HERMES_FINANCE_STORE=json',
    }
  }
  if (!pgConn()) {
    return {
      enabled: true,
      available: false,
      database: PERSONAL_FINANCE_PG_DATABASE,
      reason: 'Postgres credentials are not configured',
    }
  }
  if (!ensurePersonalFinancePostgresSchema()) {
    return {
      enabled: true,
      available: false,
      database: PERSONAL_FINANCE_PG_DATABASE,
      reason: 'personal_finance schema is not reachable',
    }
  }
  return {
    enabled: true,
    available: true,
    database: PERSONAL_FINANCE_PG_DATABASE,
    lastWriteError: lastWriteError ?? undefined,
  }
}
