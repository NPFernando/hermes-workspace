/**
 * Structured Postgres store for personal-finance data, in its own
 * `personal_finance` database — separate from the `finance` database
 * `finance-postgres-store.ts` owns (trading engine state only). Two
 * databases on the same single PG 18.1 instance, split by domain, matching
 * the existing "one database per use" convention
 * (~/.hermes/postgres-credentials.md: hermes/finance/harp/agents/ops).
 *
 * Deliberately a fully self-contained sibling file — does not import from
 * or get imported by finance-postgres-store.ts, which has unrelated live
 * work in progress elsewhere; nothing here should ever require touching
 * that file. Hooked in directly from finance-store.ts's
 * mirrorIntoSplitStores()/overlaySplitStores() (Postgres Migration Phase D)
 * — personal-finance-store.ts's former JSON-mirror write/read functions
 * were retired at that point (kept only as a shared type module now).
 *
 * As of Postgres Migration Phase C/D, this IS the app's live read path for
 * personal-finance data (via readPersonalFinancePostgresStore(), called
 * from finance-store.ts's overlaySplitStores()) — the base
 * ~/.hermes/finance/finance.json file is now only a same-process fallback
 * for when this database is unavailable, not a separate mirror to keep in
 * sync. See docs/personal-finance-os-roadmap.md's "Postgres Migration
 * Project" section for the full phase history.
 */
import { spawnSync } from 'node:child_process'
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import type { PersonalFinanceSlice } from './personal-finance-store'

const HERMES_HOME =
  process.env.HERMES_HOME ??
  process.env.CLAUDE_HOME ??
  path.join(os.homedir(), '.hermes')
const PERSONAL_FINANCE_PG_DATABASE =
  process.env.HERMES_PERSONAL_FINANCE_PG_DATABASE || 'personal_finance'
const PSQL_CANDIDATES = [
  '/home/ubuntu/.pg0/installation/18.1.0/bin/psql',
  'psql',
]

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
  // calling writePersonalFinancePostgresStore() would silently write to the
  // real production personal_finance database.
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
  if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(value))
    throw new Error(`Unsafe Postgres identifier: ${value}`)
  return `"${value.replace(/"/g, '""')}"`
}

function sqlNullableText(value: unknown): string {
  return typeof value === 'string' && value.length > 0 ? sqlText(value) : 'NULL'
}

function sqlJson(value: unknown): string {
  if (value === undefined || value === null) return 'NULL'
  return `${sqlText(JSON.stringify(value))}::jsonb`
}

function sqlNumber(value: unknown, fallback = 0): string {
  const number =
    typeof value === 'number'
      ? value
      : typeof value === 'string' && value.trim() !== ''
        ? Number(value)
        : fallback
  return Number.isFinite(number) ? String(number) : String(fallback)
}

function sqlNullableNumber(value: unknown): string {
  const number =
    typeof value === 'number'
      ? value
      : typeof value === 'string' && value.trim() !== ''
        ? Number(value)
        : Number.NaN
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

function firstText(
  row: Record<string, unknown>,
  key: string,
  fallback = '',
): string {
  const value = row[key]
  return typeof value === 'string' ? value : fallback
}

function insertRows(
  table: string,
  columns: Array<string>,
  values: Array<Array<string>>,
): string {
  if (values.length === 0) return ''
  const columnSql = columns.map(sqlIdentifier).join(', ')
  const valuesSql = values.map((row) => `(${row.join(', ')})`).join(',\n')
  return `INSERT INTO ${sqlIdentifier(table)} (${columnSql}) VALUES\n${valuesSql};`
}

function runPsql(
  database: string,
  sql: string,
): { ok: true; stdout: string } | { ok: false; reason: string } {
  const conn = pgConn()
  if (!conn)
    return { ok: false, reason: 'Postgres credentials are not configured' }
  for (const psql of PSQL_CANDIDATES) {
    const result = spawnSync(
      psql,
      [
        '-h',
        conn.host,
        '-p',
        conn.port,
        '-U',
        conn.user,
        '-d',
        database,
        '-tA',
        '-v',
        'ON_ERROR_STOP=1',
        '-f',
        '-',
      ],
      {
        env: { ...process.env, PGPASSWORD: conn.password },
        encoding: 'utf8',
        input: sql,
        timeout: 20_000,
        maxBuffer: 16 * 1024 * 1024,
      },
    )
    if (
      result.error &&
      (result.error as NodeJS.ErrnoException).code === 'ENOENT'
    )
      continue
    const stdout = typeof result.stdout === 'string' ? result.stdout.trim() : ''
    const stderr = typeof result.stderr === 'string' ? result.stderr.trim() : ''
    if (result.status === 0) return { ok: true, stdout }
    return {
      ok: false,
      reason: stderr || result.error?.message || `psql exited ${result.status}`,
    }
  }
  return { ok: false, reason: 'psql executable not found' }
}

/**
 * Phase B (read path): runs `sql`, wrapped so Postgres itself serializes the
 * result set to JSON (`json_agg`) — avoids ever hand-parsing psql's tabular
 * text output (fragile against embedded delimiters/quotes/nulls), the same
 * trick finance-postgres-store.ts already uses for its own JSONB snapshot.
 * Returns null on any failure; an empty result set returns [].
 */
function selectJson(
  database: string,
  sql: string,
): Array<Record<string, unknown>> | null {
  const result = runPsql(database, `SELECT json_agg(t) FROM (${sql}) t;`)
  if (!result.ok) return null
  if (!result.stdout) return []
  try {
    const parsed: unknown = JSON.parse(result.stdout)
    return Array.isArray(parsed)
      ? (parsed as Array<Record<string, unknown>>)
      : []
  } catch {
    return null
  }
}

/**
 * Converts a Postgres row's snake_case column names back to the camelCase
 * field names the JS shapes use (converted_lkr_amount -> convertedLkrAmount).
 * Does NOT recurse into nested objects/arrays — those are opaque payloads
 * (e.g. investment_accounts.data) that must round-trip untouched, not
 * generic multi-level records to re-key.
 */
export function snakeRowToCamel(
  row: Record<string, unknown>,
): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(row)) {
    const camelKey = key.replace(/_([a-z0-9])/g, (_match, char: string) =>
      char.toUpperCase(),
    )
    out[camelKey] = value
  }
  return out
}

function ensurePersonalFinanceDatabase(): boolean {
  const exists = runPsql(
    'postgres',
    `SELECT 1 FROM pg_database WHERE datname = ${sqlText(PERSONAL_FINANCE_PG_DATABASE)};`,
  )
  if (!exists.ok) return false
  if (exists.stdout.trim() === '1') return true
  const created = runPsql(
    'postgres',
    `CREATE DATABASE ${sqlIdentifier(PERSONAL_FINANCE_PG_DATABASE)};`,
  )
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
  masked_identifier TEXT, platform TEXT, document_ref TEXT,
  source TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL
);
ALTER TABLE finance_accounts ADD COLUMN IF NOT EXISTS opening_balance DOUBLE PRECISION;
ALTER TABLE finance_accounts ADD COLUMN IF NOT EXISTS opening_balance_date TEXT;
ALTER TABLE finance_accounts ADD COLUMN IF NOT EXISTS document_ref TEXT;

CREATE TABLE IF NOT EXISTS income_records (
  id TEXT PRIMARY KEY, date_received TEXT NOT NULL, source_name TEXT NOT NULL, income_type TEXT NOT NULL,
  income_subtype TEXT,
  original_currency TEXT NOT NULL, original_amount DOUBLE PRECISION NOT NULL, exchange_rate_used DOUBLE PRECISION NOT NULL,
  converted_lkr_amount DOUBLE PRECISION NOT NULL, account_id TEXT, taxable BOOLEAN NOT NULL,
  notes TEXT, document_ref TEXT, income_source_id TEXT, tags TEXT, status TEXT,
  stock_holding_id TEXT,
  transaction_type TEXT, transfer_id TEXT, transfer_account_id TEXT,
  source TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL, deleted_at TEXT
);
ALTER TABLE income_records ADD COLUMN IF NOT EXISTS income_source_id TEXT;
ALTER TABLE income_records ADD COLUMN IF NOT EXISTS stock_holding_id TEXT;
ALTER TABLE income_records ADD COLUMN IF NOT EXISTS income_subtype TEXT;
ALTER TABLE income_records ADD COLUMN IF NOT EXISTS tags TEXT;
ALTER TABLE income_records ADD COLUMN IF NOT EXISTS status TEXT;
ALTER TABLE income_records ADD COLUMN IF NOT EXISTS transaction_type TEXT;
ALTER TABLE income_records ADD COLUMN IF NOT EXISTS transfer_id TEXT;
ALTER TABLE income_records ADD COLUMN IF NOT EXISTS transfer_account_id TEXT;
ALTER TABLE income_records ADD COLUMN IF NOT EXISTS deleted_at TEXT;

CREATE TABLE IF NOT EXISTS expense_records (
  id TEXT PRIMARY KEY, date TEXT NOT NULL, vendor TEXT NOT NULL, category TEXT NOT NULL, subcategory TEXT,
  account_id TEXT, currency TEXT NOT NULL, amount DOUBLE PRECISION NOT NULL, exchange_rate_used DOUBLE PRECISION,
  converted_lkr_amount DOUBLE PRECISION NOT NULL,
  recurring BOOLEAN NOT NULL, work_related BOOLEAN NOT NULL, tax_deductible_possible BOOLEAN NOT NULL,
  notes TEXT, document_ref TEXT, tags TEXT, status TEXT,
  transaction_type TEXT, transfer_id TEXT, transfer_account_id TEXT,
  split_group_id TEXT, split_index INTEGER,
  source TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL, deleted_at TEXT
);
ALTER TABLE expense_records ADD COLUMN IF NOT EXISTS tags TEXT;
ALTER TABLE expense_records ADD COLUMN IF NOT EXISTS status TEXT;
ALTER TABLE expense_records ADD COLUMN IF NOT EXISTS transaction_type TEXT;
ALTER TABLE expense_records ADD COLUMN IF NOT EXISTS transfer_id TEXT;
ALTER TABLE expense_records ADD COLUMN IF NOT EXISTS transfer_account_id TEXT;
ALTER TABLE expense_records ADD COLUMN IF NOT EXISTS split_group_id TEXT;
ALTER TABLE expense_records ADD COLUMN IF NOT EXISTS split_index INTEGER;
ALTER TABLE expense_records ADD COLUMN IF NOT EXISTS deleted_at TEXT;
ALTER TABLE expense_records ADD COLUMN IF NOT EXISTS exchange_rate_used DOUBLE PRECISION;

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
  document_ref TEXT, source TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL
);
ALTER TABLE tax_records ADD COLUMN IF NOT EXISTS document_ref TEXT;

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
  last_price_high DOUBLE PRECISION, last_price_low DOUBLE PRECISION, last_price_close DOUBLE PRECISION,
  last_price_volume DOUBLE PRECISION, last_price_turnover DOUBLE PRECISION,
  price_history JSONB NOT NULL DEFAULT '[]'::jsonb,
  notes TEXT, document_ref TEXT, source TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL
);
ALTER TABLE stock_holdings ADD COLUMN IF NOT EXISTS price_history JSONB NOT NULL DEFAULT '[]'::jsonb;
ALTER TABLE stock_holdings ADD COLUMN IF NOT EXISTS last_price_high DOUBLE PRECISION;
ALTER TABLE stock_holdings ADD COLUMN IF NOT EXISTS last_price_low DOUBLE PRECISION;
ALTER TABLE stock_holdings ADD COLUMN IF NOT EXISTS last_price_close DOUBLE PRECISION;
ALTER TABLE stock_holdings ADD COLUMN IF NOT EXISTS last_price_volume DOUBLE PRECISION;
ALTER TABLE stock_holdings ADD COLUMN IF NOT EXISTS last_price_turnover DOUBLE PRECISION;
ALTER TABLE stock_holdings ADD COLUMN IF NOT EXISTS document_ref TEXT;

CREATE TABLE IF NOT EXISTS fixed_deposits (
  id TEXT PRIMARY KEY, bank_name TEXT NOT NULL, principal DOUBLE PRECISION NOT NULL, currency TEXT NOT NULL,
  interest_rate_pct DOUBLE PRECISION NOT NULL, interest_payout TEXT NOT NULL, start_date TEXT NOT NULL,
  interest_received DOUBLE PRECISION, tax_deducted DOUBLE PRECISION,
  payout_account_id TEXT,
  auto_renew BOOLEAN NOT NULL DEFAULT FALSE,
  maturity_date TEXT NOT NULL, status TEXT NOT NULL, notes TEXT, document_ref TEXT, source TEXT NOT NULL,
  created_at TEXT NOT NULL, updated_at TEXT NOT NULL
);
ALTER TABLE fixed_deposits ADD COLUMN IF NOT EXISTS interest_received DOUBLE PRECISION;
ALTER TABLE fixed_deposits ADD COLUMN IF NOT EXISTS tax_deducted DOUBLE PRECISION;
ALTER TABLE fixed_deposits ADD COLUMN IF NOT EXISTS payout_account_id TEXT;
ALTER TABLE fixed_deposits ADD COLUMN IF NOT EXISTS auto_renew BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE fixed_deposits ADD COLUMN IF NOT EXISTS document_ref TEXT;

CREATE TABLE IF NOT EXISTS investment_journal (
  id TEXT PRIMARY KEY, stock_holding_id TEXT, symbol TEXT NOT NULL,
  entry_date TEXT NOT NULL, entry_type TEXT NOT NULL, content TEXT NOT NULL,
  thesis TEXT, invalidation_condition TEXT,
  next_review_date TEXT, source TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL
);
ALTER TABLE investment_journal ADD COLUMN IF NOT EXISTS thesis TEXT;
ALTER TABLE investment_journal ADD COLUMN IF NOT EXISTS invalidation_condition TEXT;

CREATE TABLE IF NOT EXISTS ai_tasks (
  id TEXT PRIMARY KEY, audit_correlation_id TEXT NOT NULL, task_type TEXT NOT NULL, title TEXT NOT NULL,
  status TEXT NOT NULL, risk TEXT NOT NULL, requested_action TEXT NOT NULL,
  input_summary TEXT NOT NULL, result_summary TEXT, error_message TEXT,
  approval_required BOOLEAN NOT NULL DEFAULT FALSE, source TEXT NOT NULL,
  agent_name TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
  started_at TEXT, completed_at TEXT, status_history JSONB NOT NULL DEFAULT '[]'::jsonb
);
ALTER TABLE ai_tasks ADD COLUMN IF NOT EXISTS status_history JSONB NOT NULL DEFAULT '[]'::jsonb;
ALTER TABLE ai_tasks ADD COLUMN IF NOT EXISTS audit_correlation_id TEXT;
UPDATE ai_tasks SET audit_correlation_id = 'ai-task:' || id WHERE audit_correlation_id IS NULL;

CREATE TABLE IF NOT EXISTS net_worth_snapshots (
  id TEXT PRIMARY KEY, snapshot_date TEXT NOT NULL, net_worth_lkr DOUBLE PRECISION NOT NULL,
  cash_lkr DOUBLE PRECISION NOT NULL, debt_lkr DOUBLE PRECISION NOT NULL,
  investments_lkr DOUBLE PRECISION NOT NULL, liquid_net_worth_lkr DOUBLE PRECISION NOT NULL,
  locked_wealth_lkr DOUBLE PRECISION NOT NULL,
  portfolio_positions JSONB NOT NULL DEFAULT '[]'::jsonb,
  source TEXT NOT NULL, created_at TEXT NOT NULL
);
ALTER TABLE net_worth_snapshots ADD COLUMN IF NOT EXISTS portfolio_positions JSONB NOT NULL DEFAULT '[]'::jsonb;

CREATE TABLE IF NOT EXISTS loans (
  id TEXT PRIMARY KEY, lender TEXT NOT NULL, principal DOUBLE PRECISION NOT NULL, current_balance DOUBLE PRECISION NOT NULL,
  currency TEXT NOT NULL, interest_rate_pct DOUBLE PRECISION NOT NULL, monthly_payment DOUBLE PRECISION,
  start_date TEXT NOT NULL, term_months INTEGER, status TEXT NOT NULL, notes TEXT, source TEXT NOT NULL,
  created_at TEXT NOT NULL, updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS properties (
  id TEXT PRIMARY KEY, description TEXT NOT NULL, property_type TEXT NOT NULL, purchase_price DOUBLE PRECISION NOT NULL,
  current_value DOUBLE PRECISION NOT NULL, currency TEXT NOT NULL, purchase_date TEXT NOT NULL, notes TEXT,
  source TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL
);
ALTER TABLE properties ADD COLUMN IF NOT EXISTS linked_loan_id TEXT;

CREATE TABLE IF NOT EXISTS beneficiaries (
  id TEXT PRIMARY KEY, name TEXT NOT NULL, relationship TEXT NOT NULL, note TEXT, source TEXT NOT NULL,
  created_at TEXT NOT NULL, updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS insurance_policies (
  id TEXT PRIMARY KEY, provider TEXT NOT NULL, policy_number TEXT, policy_type TEXT NOT NULL,
  insured_item TEXT NOT NULL, premium_amount DOUBLE PRECISION, premium_frequency TEXT,
  coverage_amount DOUBLE PRECISION, currency TEXT NOT NULL, start_date TEXT NOT NULL,
  end_date TEXT, status TEXT NOT NULL, notes TEXT, document_ref TEXT,
  source TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL
);

-- Postgres-migration Phase A: previously-unmirrored collections + the
-- personal-finance-owned subset of FinanceSettings, split into real
-- relational tables instead of loose JSON columns.

CREATE TABLE IF NOT EXISTS pending_ingestions (
  id TEXT PRIMARY KEY, status TEXT NOT NULL, source TEXT NOT NULL, document_type TEXT NOT NULL, document_class TEXT,
  source_ref TEXT NOT NULL, checksum_sha256 TEXT, password_hint TEXT, raw_preview_image_path TEXT, error TEXT,
  created_at TEXT NOT NULL, updated_at TEXT NOT NULL
);
ALTER TABLE pending_ingestions ADD COLUMN IF NOT EXISTS checksum_sha256 TEXT;
ALTER TABLE pending_ingestions ADD COLUMN IF NOT EXISTS document_class TEXT;

CREATE TABLE IF NOT EXISTS pending_ingestion_extracted_transactions (
  pending_ingestion_id TEXT PRIMARY KEY REFERENCES pending_ingestions(id) ON DELETE CASCADE,
  kind TEXT NOT NULL, amount DOUBLE PRECISION NOT NULL, currency TEXT NOT NULL,
  vendor_or_source TEXT NOT NULL, date TEXT NOT NULL, category TEXT, confidence TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS pending_ingestion_extracted_contracts (
  pending_ingestion_id TEXT PRIMARY KEY REFERENCES pending_ingestions(id) ON DELETE CASCADE,
  employer_name TEXT NOT NULL, employment_type TEXT NOT NULL, monthly_income_amount DOUBLE PRECISION,
  currency TEXT NOT NULL, contract_start_date TEXT, contract_end_date TEXT, job_title TEXT,
  payday_day_of_month INTEGER, pay_schedule TEXT, confidence TEXT NOT NULL, risk_summary TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS pending_ingestion_salary_slips (
  pending_ingestion_id TEXT PRIMARY KEY REFERENCES pending_ingestions(id) ON DELETE CASCADE,
  employer_name TEXT NOT NULL, employee_name TEXT, pay_period TEXT, payment_date TEXT,
  gross_amount DOUBLE PRECISION, deductions DOUBLE PRECISION, net_amount DOUBLE PRECISION NOT NULL,
  currency TEXT NOT NULL, confidence TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS pending_ingestion_contract_notes (
  pending_ingestion_id TEXT PRIMARY KEY REFERENCES pending_ingestions(id) ON DELETE CASCADE,
  symbol TEXT NOT NULL, company_name TEXT, side TEXT NOT NULL, quantity DOUBLE PRECISION NOT NULL,
  price DOUBLE PRECISION NOT NULL, gross_amount DOUBLE PRECISION, fees DOUBLE PRECISION,
  currency TEXT NOT NULL, broker TEXT, trade_date TEXT, settlement_date TEXT, confidence TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS pending_ingestion_fd_certificates (
  pending_ingestion_id TEXT PRIMARY KEY REFERENCES pending_ingestions(id) ON DELETE CASCADE,
  bank_name TEXT NOT NULL, certificate_number TEXT, principal DOUBLE PRECISION NOT NULL,
  currency TEXT NOT NULL, interest_rate_pct DOUBLE PRECISION NOT NULL, interest_payout TEXT NOT NULL,
  start_date TEXT, maturity_date TEXT, auto_renew BOOLEAN, confidence TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS pending_ingestion_contract_risks (
  id SERIAL PRIMARY KEY, pending_ingestion_id TEXT NOT NULL REFERENCES pending_ingestions(id) ON DELETE CASCADE,
  severity TEXT NOT NULL, clause TEXT NOT NULL, concern TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS exchange_rates (
  id TEXT PRIMARY KEY, base_currency TEXT NOT NULL, target_currency TEXT NOT NULL, date TEXT NOT NULL,
  rate DOUBLE PRECISION NOT NULL,
  UNIQUE (base_currency, target_currency, date)
);
ALTER TABLE exchange_rates ADD COLUMN IF NOT EXISTS source TEXT NOT NULL DEFAULT 'manual';
ALTER TABLE exchange_rates ADD COLUMN IF NOT EXISTS observed_at TEXT NOT NULL DEFAULT '';

-- Kept generic (no CRUD path or defined shape exists anywhere in the app
-- for this collection today, confirmed via research) rather than inventing
-- speculative columns for an unused feature.
CREATE TABLE IF NOT EXISTS investment_accounts (
  id TEXT PRIMARY KEY, data JSONB NOT NULL DEFAULT '{}'::jsonb,
  source TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS personal_finance_settings (
  id TEXT PRIMARY KEY DEFAULT 'default', base_currency TEXT,
  emergency_fund_target_months DOUBLE PRECISION,
  savings_rate_target_pct DOUBLE PRECISION, wealth_goal_target_lkr DOUBLE PRECISION, wealth_goal_target_date TEXT,
  alerts_enabled BOOLEAN, quiet_mode_enabled BOOLEAN, budget_alert_threshold_pct DOUBLE PRECISION,
  minimum_cash_reserve_lkr DOUBLE PRECISION, financial_rules JSONB, budget_templates JSONB, goal_completion_events JSONB, salary_history JSONB
);
ALTER TABLE personal_finance_settings ADD COLUMN IF NOT EXISTS alerts_enabled BOOLEAN;
ALTER TABLE personal_finance_settings ADD COLUMN IF NOT EXISTS quiet_mode_enabled BOOLEAN;
ALTER TABLE personal_finance_settings ADD COLUMN IF NOT EXISTS base_currency TEXT;
ALTER TABLE personal_finance_settings ADD COLUMN IF NOT EXISTS budget_alert_threshold_pct DOUBLE PRECISION;
ALTER TABLE personal_finance_settings ADD COLUMN IF NOT EXISTS minimum_cash_reserve_lkr DOUBLE PRECISION;
ALTER TABLE personal_finance_settings ADD COLUMN IF NOT EXISTS financial_rules JSONB;
ALTER TABLE personal_finance_settings ADD COLUMN IF NOT EXISTS budget_templates JSONB;
ALTER TABLE personal_finance_settings ADD COLUMN IF NOT EXISTS goal_completion_events JSONB;
ALTER TABLE personal_finance_settings ADD COLUMN IF NOT EXISTS proactive_insights_enabled BOOLEAN;
ALTER TABLE personal_finance_settings ADD COLUMN IF NOT EXISTS salary_history JSONB;

CREATE TABLE IF NOT EXISTS finance_qa_history (
  id SERIAL PRIMARY KEY, asked_at BIGINT NOT NULL, question TEXT NOT NULL, answer TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS gmail_ingest_state (
  id TEXT PRIMARY KEY DEFAULT 'default', last_synced_at_seconds BIGINT
);

CREATE TABLE IF NOT EXISTS gmail_sync_history (
  id SERIAL PRIMARY KEY, synced_at BIGINT NOT NULL, found INTEGER NOT NULL, queued INTEGER NOT NULL,
  skipped_already_queued INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS category_correction_hints (
  vendor TEXT PRIMARY KEY, category TEXT NOT NULL
);
`,
  )
  if (result.ok) schemaReady = true
  return result.ok
}

function financeAccountRows(
  rowsIn: Array<Record<string, unknown>>,
): Array<Array<string>> {
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
    sqlNullableText(row.documentRef),
    sqlText(firstText(row, 'source', 'manual')),
    sqlText(firstText(row, 'createdAt')),
    sqlText(firstText(row, 'updatedAt')),
  ])
}

function incomeRecordRows(
  rowsIn: Array<Record<string, unknown>>,
): Array<Array<string>> {
  return rowsIn.map((row) => [
    sqlText(firstText(row, 'id')),
    sqlText(firstText(row, 'dateReceived')),
    sqlText(firstText(row, 'sourceName')),
    sqlText(firstText(row, 'incomeType')),
    sqlNullableText(row.incomeSubtype),
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
    sqlNullableText(row.stockHoldingId),
    sqlNullableText(row.transactionType),
    sqlNullableText(row.transferId),
    sqlNullableText(row.transferAccountId),
    sqlText(firstText(row, 'source', 'manual')),
    sqlText(firstText(row, 'createdAt')),
    sqlText(firstText(row, 'updatedAt')),
    sqlNullableText(row.deletedAt),
  ])
}

function expenseRecordRows(
  rowsIn: Array<Record<string, unknown>>,
): Array<Array<string>> {
  return rowsIn.map((row) => [
    sqlText(firstText(row, 'id')),
    sqlText(firstText(row, 'date')),
    sqlText(firstText(row, 'vendor')),
    sqlText(firstText(row, 'category')),
    sqlNullableText(row.subcategory),
    sqlNullableText(row.accountId),
    sqlText(firstText(row, 'currency')),
    sqlNumber(row.amount),
    sqlNullableNumber(row.exchangeRateUsed),
    sqlNumber(row.convertedLkrAmount),
    sqlBoolean(row.recurring),
    sqlBoolean(row.workRelated),
    sqlBoolean(row.taxDeductiblePossible),
    sqlNullableText(row.notes),
    sqlNullableText(row.documentRef),
    sqlNullableText(row.tags),
    sqlNullableText(row.status),
    sqlNullableText(row.transactionType),
    sqlNullableText(row.transferId),
    sqlNullableText(row.transferAccountId),
    sqlNullableText(row.splitGroupId),
    row.splitIndex === undefined || row.splitIndex === null
      ? 'NULL'
      : String(Number(row.splitIndex)),
    sqlText(firstText(row, 'source', 'manual')),
    sqlText(firstText(row, 'createdAt')),
    sqlText(firstText(row, 'updatedAt')),
    sqlNullableText(row.deletedAt),
  ])
}

function budgetCategoryRows(
  rowsIn: Array<Record<string, unknown>>,
): Array<Array<string>> {
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

function categoryRows(
  rowsIn: Array<Record<string, unknown>>,
): Array<Array<string>> {
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

function subcategoryRows(
  rowsIn: Array<Record<string, unknown>>,
): Array<Array<string>> {
  return rowsIn.map((row) => [
    sqlText(firstText(row, 'id')),
    sqlText(firstText(row, 'name')),
    sqlText(firstText(row, 'parentCategory', 'Other')),
    sqlText(firstText(row, 'source', 'manual')),
    sqlText(firstText(row, 'createdAt')),
    sqlText(firstText(row, 'updatedAt')),
  ])
}

function merchantRows(
  rowsIn: Array<Record<string, unknown>>,
): Array<Array<string>> {
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

function savingsGoalRows(
  rowsIn: Array<Record<string, unknown>>,
): Array<Array<string>> {
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

function taxRecordRows(
  rowsIn: Array<Record<string, unknown>>,
): Array<Array<string>> {
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
    sqlNullableText(row.documentRef),
    sqlText(firstText(row, 'source', 'manual')),
    sqlText(firstText(row, 'createdAt')),
    sqlText(firstText(row, 'updatedAt')),
  ])
}

function incomeSourceRows(
  rowsIn: Array<Record<string, unknown>>,
): Array<Array<string>> {
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

function stockHoldingRows(
  rowsIn: Array<Record<string, unknown>>,
): Array<Array<string>> {
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
    sqlNullableNumber(row.lastPriceHigh),
    sqlNullableNumber(row.lastPriceLow),
    sqlNullableNumber(row.lastPriceClose),
    sqlNullableNumber(row.lastPriceVolume),
    sqlNullableNumber(row.lastPriceTurnover),
    sqlJson(row.priceHistory ?? []),
    sqlNullableText(row.notes),
    sqlNullableText(row.documentRef),
    sqlText(firstText(row, 'source', 'manual')),
    sqlText(firstText(row, 'createdAt')),
    sqlText(firstText(row, 'updatedAt')),
  ])
}

function fixedDepositRows(
  rowsIn: Array<Record<string, unknown>>,
): Array<Array<string>> {
  return rowsIn.map((row) => [
    sqlText(firstText(row, 'id')),
    sqlText(firstText(row, 'bankName')),
    sqlNumber(row.principal),
    sqlText(firstText(row, 'currency')),
    sqlNumber(row.interestRatePct),
    sqlText(firstText(row, 'interestPayout', 'at_maturity')),
    sqlNullableNumber(row.interestReceived),
    sqlNullableNumber(row.taxDeducted),
    sqlNullableText(row.payoutAccountId),
    sqlBoolean(row.autoRenew),
    sqlText(firstText(row, 'startDate')),
    sqlText(firstText(row, 'maturityDate')),
    sqlText(firstText(row, 'status', 'active')),
    sqlNullableText(row.notes),
    sqlNullableText(row.documentRef),
    sqlText(firstText(row, 'source', 'manual')),
    sqlText(firstText(row, 'createdAt')),
    sqlText(firstText(row, 'updatedAt')),
  ])
}

function investmentJournalRows(
  rowsIn: Array<Record<string, unknown>>,
): Array<Array<string>> {
  return rowsIn.map((row) => [
    sqlText(firstText(row, 'id')),
    sqlNullableText(row.stockHoldingId),
    sqlText(firstText(row, 'symbol', 'Portfolio')),
    sqlText(firstText(row, 'entryDate')),
    sqlText(firstText(row, 'entryType', 'note')),
    sqlText(firstText(row, 'content')),
    sqlNullableText(row.thesis),
    sqlNullableText(row.invalidationCondition),
    sqlNullableText(row.nextReviewDate),
    sqlText(firstText(row, 'source', 'manual')),
    sqlText(firstText(row, 'createdAt')),
    sqlText(firstText(row, 'updatedAt')),
  ])
}

function aiTaskRows(
  rowsIn: Array<Record<string, unknown>>,
): Array<Array<string>> {
  return rowsIn.map((row) => [
    sqlText(firstText(row, 'id')),
    sqlText(firstText(row, 'auditCorrelationId', `ai-task:${firstText(row, 'id')}`)),
    sqlText(firstText(row, 'taskType', 'finance_assist')),
    sqlText(firstText(row, 'title', 'Finance AI task')),
    sqlText(firstText(row, 'status', 'queued')),
    sqlText(firstText(row, 'risk', 'low')),
    sqlText(firstText(row, 'requestedAction', 'review')),
    sqlText(firstText(row, 'inputSummary')),
    sqlNullableText(row.resultSummary),
    sqlNullableText(row.errorMessage),
    sqlBoolean(row.approvalRequired),
    sqlText(firstText(row, 'source', 'finance-agent')),
    sqlNullableText(row.agentName),
    sqlText(firstText(row, 'createdAt')),
    sqlText(firstText(row, 'updatedAt')),
    sqlNullableText(row.startedAt),
    sqlNullableText(row.completedAt),
    sqlJson(row.statusHistory ?? []),
  ])
}

function netWorthSnapshotRows(
  rowsIn: Array<Record<string, unknown>>,
): Array<Array<string>> {
  return rowsIn.map((row) => [
    sqlText(firstText(row, 'id')),
    sqlText(firstText(row, 'snapshotDate')),
    sqlNumber(row.netWorthLkr),
    sqlNumber(row.cashLkr),
    sqlNumber(row.debtLkr),
    sqlNumber(row.investmentsLkr),
    sqlNumber(row.liquidNetWorthLkr),
    sqlNumber(row.lockedWealthLkr),
    sqlJson(row.portfolioPositions ?? []),
    sqlText(firstText(row, 'source', 'manual')),
    sqlText(firstText(row, 'createdAt')),
  ])
}

function loanRows(
  rowsIn: Array<Record<string, unknown>>,
): Array<Array<string>> {
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

function propertyRows(
  rowsIn: Array<Record<string, unknown>>,
): Array<Array<string>> {
  return rowsIn.map((row) => [
    sqlText(firstText(row, 'id')),
    sqlText(firstText(row, 'description')),
    sqlText(firstText(row, 'propertyType', 'residential')),
    sqlNumber(row.purchasePrice),
    sqlNumber(row.currentValue),
    sqlText(firstText(row, 'currency')),
    sqlText(firstText(row, 'purchaseDate')),
    sqlNullableText(row.notes),
    sqlText(firstText(row, 'source', 'manual')),
    sqlText(firstText(row, 'createdAt')),
    sqlText(firstText(row, 'updatedAt')),
    sqlNullableText(row.linkedLoanId),
  ])
}

function beneficiaryRows(
  rowsIn: Array<Record<string, unknown>>,
): Array<Array<string>> {
  return rowsIn.map((row) => [
    sqlText(firstText(row, 'id')),
    sqlText(firstText(row, 'name')),
    sqlText(firstText(row, 'relationship')),
    sqlNullableText(row.note),
    sqlText(firstText(row, 'source', 'manual')),
    sqlText(firstText(row, 'createdAt')),
    sqlText(firstText(row, 'updatedAt')),
  ])
}

function insurancePolicyRows(
  rowsIn: Array<Record<string, unknown>>,
): Array<Array<string>> {
  return rowsIn.map((row) => [
    sqlText(firstText(row, 'id')),
    sqlText(firstText(row, 'provider')),
    sqlNullableText(row.policyNumber),
    sqlText(firstText(row, 'policyType', 'Other')),
    sqlText(firstText(row, 'insuredItem')),
    sqlNullableNumber(row.premiumAmount),
    sqlNullableText(row.premiumFrequency),
    sqlNullableNumber(row.coverageAmount),
    sqlText(firstText(row, 'currency', 'LKR')),
    sqlText(firstText(row, 'startDate')),
    sqlNullableText(row.endDate),
    sqlText(firstText(row, 'status', 'active')),
    sqlNullableText(row.notes),
    sqlNullableText(row.documentRef),
    sqlText(firstText(row, 'source', 'manual')),
    sqlText(firstText(row, 'createdAt')),
    sqlText(firstText(row, 'updatedAt')),
  ])
}

function pendingIngestionRows(
  rowsIn: Array<Record<string, unknown>>,
): Array<Array<string>> {
  return rowsIn.map((row) => [
    sqlText(firstText(row, 'id')),
    sqlText(firstText(row, 'status', 'awaiting_review')),
    sqlText(firstText(row, 'source', 'upload')),
    sqlText(firstText(row, 'documentType', 'transaction')),
    sqlNullableText(row.documentClass),
    sqlText(firstText(row, 'sourceRef')),
    sqlNullableText(row.checksumSha256),
    sqlNullableText(row.passwordHint),
    sqlNullableText(row.rawPreviewImagePath),
    sqlNullableText(row.error),
    sqlText(firstText(row, 'createdAt')),
    sqlText(firstText(row, 'updatedAt')),
  ])
}

function pendingIngestionExtractedTransactionRows(
  rowsIn: Array<Record<string, unknown>>,
): Array<Array<string>> {
  const out: Array<Array<string>> = []
  for (const row of rowsIn) {
    const extracted = row.extracted
    if (!isRecord(extracted)) continue
    out.push([
      sqlText(firstText(row, 'id')),
      sqlText(firstText(extracted, 'kind', 'expense')),
      sqlNumber(extracted.amount),
      sqlText(firstText(extracted, 'currency', 'LKR')),
      sqlText(firstText(extracted, 'vendorOrSource', 'Unknown')),
      sqlText(firstText(extracted, 'date')),
      sqlNullableText(extracted.category),
      sqlText(firstText(extracted, 'confidence', 'low')),
    ])
  }
  return out
}

function pendingIngestionExtractedContractRows(
  rowsIn: Array<Record<string, unknown>>,
): Array<Array<string>> {
  const out: Array<Array<string>> = []
  for (const row of rowsIn) {
    const contract = row.extractedContract
    if (!isRecord(contract)) continue
    out.push([
      sqlText(firstText(row, 'id')),
      sqlText(firstText(contract, 'employerName', 'Unknown')),
      sqlText(firstText(contract, 'employmentType', 'other')),
      sqlNullableNumber(contract.monthlyIncomeAmount),
      sqlText(firstText(contract, 'currency', 'LKR')),
      sqlNullableText(contract.contractStartDate),
      sqlNullableText(contract.contractEndDate),
      sqlNullableText(contract.jobTitle),
      sqlNullableNumber(contract.paydayDayOfMonth),
      sqlNullableText(contract.paySchedule),
      sqlText(firstText(contract, 'confidence', 'low')),
      sqlText(firstText(contract, 'riskSummary')),
    ])
  }
  return out
}

function pendingIngestionSalarySlipRows(
  rowsIn: Array<Record<string, unknown>>,
): Array<Array<string>> {
  const out: Array<Array<string>> = []
  for (const row of rowsIn) {
    const salarySlip = row.extractedSalarySlip
    if (!isRecord(salarySlip)) continue
    out.push([
      sqlText(firstText(row, 'id')),
      sqlText(firstText(salarySlip, 'employerName', 'Unknown employer')),
      sqlNullableText(salarySlip.employeeName),
      sqlNullableText(salarySlip.payPeriod),
      sqlNullableText(salarySlip.paymentDate),
      sqlNullableNumber(salarySlip.grossAmount),
      sqlNullableNumber(salarySlip.deductions),
      sqlNumber(salarySlip.netAmount),
      sqlText(firstText(salarySlip, 'currency', 'LKR')),
      sqlText(firstText(salarySlip, 'confidence', 'low')),
    ])
  }
  return out
}

function pendingIngestionContractNoteRows(
  rowsIn: Array<Record<string, unknown>>,
): Array<Array<string>> {
  const out: Array<Array<string>> = []
  for (const row of rowsIn) {
    const note = row.extractedContractNote
    if (!isRecord(note)) continue
    out.push([
      sqlText(firstText(row, 'id')),
      sqlText(firstText(note, 'symbol')),
      sqlNullableText(note.companyName),
      sqlText(firstText(note, 'side', 'buy')),
      sqlNumber(note.quantity),
      sqlNumber(note.price),
      sqlNullableNumber(note.grossAmount),
      sqlNullableNumber(note.fees),
      sqlText(firstText(note, 'currency', 'LKR')),
      sqlNullableText(note.broker),
      sqlNullableText(note.tradeDate),
      sqlNullableText(note.settlementDate),
      sqlText(firstText(note, 'confidence', 'low')),
    ])
  }
  return out
}

function pendingIngestionFdCertificateRows(
  rowsIn: Array<Record<string, unknown>>,
): Array<Array<string>> {
  const out: Array<Array<string>> = []
  for (const row of rowsIn) {
    const certificate = row.extractedFdCertificate
    if (!isRecord(certificate)) continue
    out.push([
      sqlText(firstText(row, 'id')),
      sqlText(firstText(certificate, 'bankName', 'Unknown bank')),
      sqlNullableText(certificate.certificateNumber),
      sqlNumber(certificate.principal),
      sqlText(firstText(certificate, 'currency', 'LKR')),
      sqlNumber(certificate.interestRatePct),
      sqlText(firstText(certificate, 'interestPayout', 'at_maturity')),
      sqlNullableText(certificate.startDate),
      sqlNullableText(certificate.maturityDate),
      certificate.autoRenew === true
        ? 'TRUE'
        : certificate.autoRenew === false
          ? 'FALSE'
          : 'NULL',
      sqlText(firstText(certificate, 'confidence', 'low')),
    ])
  }
  return out
}

function pendingIngestionContractRiskRows(
  rowsIn: Array<Record<string, unknown>>,
): Array<Array<string>> {
  const out: Array<Array<string>> = []
  for (const row of rowsIn) {
    const contract = row.extractedContract
    if (!isRecord(contract)) continue
    const pendingId = firstText(row, 'id')
    const risks = Array.isArray(contract.risks) ? contract.risks : []
    for (const risk of risks) {
      if (!isRecord(risk)) continue
      out.push([
        sqlText(pendingId),
        sqlText(firstText(risk, 'severity', 'low')),
        sqlText(firstText(risk, 'clause')),
        sqlText(firstText(risk, 'concern')),
      ])
    }
  }
  return out
}

function exchangeRateRows(
  rowsIn: Array<Record<string, unknown>>,
): Array<Array<string>> {
  return rowsIn.map((row, index) => [
    sqlText(firstText(row, 'id') || `rate-${index}`),
    sqlText(firstText(row, 'base')),
    sqlText(firstText(row, 'target')),
    sqlText(firstText(row, 'date')),
    sqlNumber(row.rate),
    sqlText(firstText(row, 'source') || 'manual'),
    sqlText(firstText(row, 'observedAt') || firstText(row, 'updatedAt') || firstText(row, 'date')),
  ])
}

/** Kept generic — no CRUD path or defined shape exists anywhere in the app for this collection today. */
function investmentAccountRows(
  rowsIn: Array<Record<string, unknown>>,
): Array<Array<string>> {
  return rowsIn.map((row, index) => [
    sqlText(firstText(row, 'id') || `investment-account-${index}`),
    sqlText(JSON.stringify(row)),
    sqlText(firstText(row, 'source', 'manual')),
    sqlText(firstText(row, 'createdAt', new Date().toISOString())),
    sqlText(firstText(row, 'updatedAt', new Date().toISOString())),
  ])
}

function personalFinanceSettingsRows(
  settings: PersonalFinanceSlice['personalFinanceSettings'],
): Array<Array<string>> {
  if (!settings) return []
  return [
    [
      sqlText('default'),
      sqlNullableText(settings.baseCurrency),
      settings.alertsEnabled === undefined ? 'NULL' : settings.alertsEnabled ? 'TRUE' : 'FALSE',
      settings.quietModeEnabled === undefined ? 'NULL' : settings.quietModeEnabled ? 'TRUE' : 'FALSE',
      sqlNullableNumber(settings.emergencyFundTargetMonths),
      sqlNullableNumber(settings.savingsRateTargetPct),
      sqlNullableNumber(settings.wealthGoalTargetLkr),
      sqlNullableText(settings.wealthGoalTargetDate),
      sqlNullableNumber(settings.budgetAlertThresholdPct),
      sqlNullableNumber(settings.minimumCashReserveLkr),
      sqlJson(settings.financialRules),
      sqlJson(settings.budgetTemplates),
      sqlJson(settings.goalCompletionEvents),
      settings.proactiveInsightsEnabled === undefined ? 'NULL' : settings.proactiveInsightsEnabled ? 'TRUE' : 'FALSE',
      sqlJson(settings.salaryHistory),
    ],
  ]
}

function financeQaHistoryRows(
  entries: Array<{ at: number; question: string; answer: string }> | undefined,
): Array<Array<string>> {
  return (entries ?? []).map((entry) => [
    sqlNumber(entry.at),
    sqlText(entry.question),
    sqlText(entry.answer),
  ])
}

function gmailIngestStateRows(
  state: { lastSyncedAtSeconds?: number } | undefined,
): Array<Array<string>> {
  if (!state) return []
  return [[sqlText('default'), sqlNullableNumber(state.lastSyncedAtSeconds)]]
}

function gmailSyncHistoryRows(
  entries:
    | Array<{
        at: number
        found: number
        queued: number
        skippedAlreadyQueued: number
      }>
    | undefined,
): Array<Array<string>> {
  return (entries ?? []).map((entry) => [
    sqlNumber(entry.at),
    sqlNumber(entry.found),
    sqlNumber(entry.queued),
    sqlNumber(entry.skippedAlreadyQueued),
  ])
}

function categoryCorrectionRows(
  hints: Record<string, string> | undefined,
): Array<Array<string>> {
  return Object.entries(hints ?? {}).map(([vendor, category]) => [
    sqlText(vendor),
    sqlText(category),
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
DELETE FROM ai_tasks;
DELETE FROM investment_journal;
DELETE FROM net_worth_snapshots;
DELETE FROM loans;
DELETE FROM properties;
DELETE FROM beneficiaries;
DELETE FROM insurance_policies;
DELETE FROM pending_ingestion_contract_risks;
DELETE FROM pending_ingestion_salary_slips;
DELETE FROM pending_ingestion_contract_notes;
DELETE FROM pending_ingestion_fd_certificates;
DELETE FROM pending_ingestion_extracted_contracts;
DELETE FROM pending_ingestion_extracted_transactions;
DELETE FROM pending_ingestions;
DELETE FROM exchange_rates;
DELETE FROM investment_accounts;
DELETE FROM personal_finance_settings;
DELETE FROM finance_qa_history;
DELETE FROM gmail_sync_history;
DELETE FROM gmail_ingest_state;
DELETE FROM category_correction_hints;

${insertRows(
  'finance_accounts',
  [
    'id',
    'name',
    'type',
    'currency',
    'balance',
    'opening_balance',
    'opening_balance_date',
    'masked_identifier',
    'platform',
    'document_ref',
    'source',
    'created_at',
    'updated_at',
  ],
  financeAccountRows(rows(slice.finance_accounts)),
)}

${insertRows(
  'income_records',
  [
    'id',
    'date_received',
    'source_name',
    'income_type',
    'income_subtype',
    'original_currency',
    'original_amount',
    'exchange_rate_used',
    'converted_lkr_amount',
    'account_id',
    'taxable',
    'notes',
    'document_ref',
    'income_source_id',
    'tags',
    'status',
    'stock_holding_id',
    'transaction_type',
    'transfer_id',
    'transfer_account_id',
    'source',
    'created_at',
    'updated_at',
    'deleted_at',
  ],
  incomeRecordRows(rows(slice.income_records)),
)}

${insertRows(
  'expense_records',
  [
    'id',
    'date',
    'vendor',
    'category',
    'subcategory',
    'account_id',
    'currency',
    'amount',
    'exchange_rate_used',
    'converted_lkr_amount',
    'recurring',
    'work_related',
    'tax_deductible_possible',
    'notes',
    'document_ref',
    'tags',
    'status',
    'transaction_type',
    'transfer_id',
    'transfer_account_id',
    'split_group_id',
    'split_index',
    'source',
    'created_at',
    'updated_at',
    'deleted_at',
  ],
  expenseRecordRows(rows(slice.expense_records)),
)}

${insertRows(
  'budget_categories',
  [
    'id',
    'month',
    'category',
    'currency',
    'budget_amount',
    'source',
    'created_at',
    'updated_at',
  ],
  budgetCategoryRows(rows(slice.budget_categories)),
)}

${insertRows(
  'categories',
  [
    'id',
    'name',
    'kind',
    'color',
    'notes',
    'source',
    'created_at',
    'updated_at',
  ],
  categoryRows(rows(slice.categories)),
)}

${insertRows(
  'subcategories',
  ['id', 'name', 'parent_category', 'source', 'created_at', 'updated_at'],
  subcategoryRows(rows(slice.subcategories)),
)}

${insertRows(
  'merchants',
  [
    'id',
    'name',
    'default_category',
    'notes',
    'source',
    'created_at',
    'updated_at',
  ],
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
    'id',
    'name',
    'target_amount',
    'current_amount',
    'currency',
    'target_date',
    'monthly_contribution',
    'priority',
    'linked_account_id',
    'status',
    'source',
    'created_at',
    'updated_at',
    'goal_kind',
  ],
  savingsGoalRows(rows(slice.savings_goals)),
)}

${insertRows(
  'tax_records',
  [
    'id',
    'tax_year',
    'income_type',
    'amount',
    'currency',
    'converted_lkr_amount',
    'exchange_rate_source',
    'deduction_category',
    'estimated_taxable_amount',
    'tax_paid',
    'tax_due',
    'requires_confirmation',
    'notes',
    'supporting_document',
    'document_ref',
    'source',
    'created_at',
    'updated_at',
  ],
  taxRecordRows(rows(slice.tax_records)),
)}

${insertRows(
  'income_sources',
  [
    'id',
    'employer_name',
    'employment_type',
    'monthly_income_amount',
    'currency',
    'contract_start_date',
    'contract_end_date',
    'job_title',
    'expected_payday_day_of_month',
    'pay_schedule',
    'status',
    'notes',
    'document_ref',
    'source',
    'created_at',
    'updated_at',
  ],
  incomeSourceRows(rows(slice.income_sources)),
)}

${insertRows(
  'stock_holdings',
  [
    'id',
    'symbol',
    'company_name',
    'platform',
    'quantity',
    'buy_price',
    'buy_date',
    'currency',
    'last_known_price',
    'last_price_updated_at',
    'price_source',
    'last_price_high',
    'last_price_low',
    'last_price_close',
    'last_price_volume',
    'last_price_turnover',
    'price_history',
    'notes',
    'document_ref',
    'source',
    'created_at',
    'updated_at',
  ],
  stockHoldingRows(rows(slice.stock_holdings)),
)}

${insertRows(
  'fixed_deposits',
  [
    'id',
    'bank_name',
    'principal',
    'currency',
    'interest_rate_pct',
    'interest_payout',
    'interest_received',
    'tax_deducted',
    'payout_account_id',
    'auto_renew',
    'start_date',
    'maturity_date',
    'status',
    'notes',
    'document_ref',
    'source',
    'created_at',
    'updated_at',
  ],
  fixedDepositRows(rows(slice.fixed_deposits)),
)}

${insertRows(
  'ai_tasks',
  [
    'id',
    'audit_correlation_id',
    'task_type',
    'title',
    'status',
    'risk',
    'requested_action',
    'input_summary',
    'result_summary',
    'error_message',
    'approval_required',
    'source',
    'agent_name',
    'created_at',
    'updated_at',
    'started_at',
    'completed_at',
    'status_history',
  ],
  aiTaskRows(rows(slice.ai_tasks ?? [])),
)}

${insertRows(
  'investment_journal',
  [
    'id',
    'stock_holding_id',
    'symbol',
    'entry_date',
    'entry_type',
    'content',
    'thesis',
    'invalidation_condition',
    'next_review_date',
    'source',
    'created_at',
    'updated_at',
  ],
  investmentJournalRows(rows(slice.investment_journal ?? [])),
)}

${insertRows(
  'net_worth_snapshots',
  [
    'id',
    'snapshot_date',
    'net_worth_lkr',
    'cash_lkr',
    'debt_lkr',
    'investments_lkr',
    'liquid_net_worth_lkr',
    'locked_wealth_lkr',
    'portfolio_positions',
    'source',
    'created_at',
  ],
  netWorthSnapshotRows(rows(slice.net_worth_snapshots ?? [])),
)}

${insertRows(
  'loans',
  [
    'id',
    'lender',
    'principal',
    'current_balance',
    'currency',
    'interest_rate_pct',
    'monthly_payment',
    'start_date',
    'term_months',
    'status',
    'notes',
    'source',
    'created_at',
    'updated_at',
  ],
  loanRows(rows(slice.loans)),
)}

${insertRows(
  'properties',
  [
    'id',
    'description',
    'property_type',
    'purchase_price',
    'current_value',
    'currency',
    'purchase_date',
    'notes',
    'source',
    'created_at',
    'updated_at',
    'linked_loan_id',
  ],
  propertyRows(rows(slice.properties)),
)}

${insertRows(
  'beneficiaries',
  ['id', 'name', 'relationship', 'note', 'source', 'created_at', 'updated_at'],
  beneficiaryRows(rows(slice.beneficiaries)),
)}

${insertRows(
  'insurance_policies',
  ['id', 'provider', 'policy_number', 'policy_type', 'insured_item', 'premium_amount', 'premium_frequency', 'coverage_amount', 'currency', 'start_date', 'end_date', 'status', 'notes', 'document_ref', 'source', 'created_at', 'updated_at'],
  insurancePolicyRows(rows(slice.insurance_policies)),
)}

${insertRows(
  'pending_ingestions',
  [
    'id',
    'status',
    'source',
    'document_type',
    'document_class',
    'source_ref',
    'checksum_sha256',
    'password_hint',
    'raw_preview_image_path',
    'error',
    'created_at',
    'updated_at',
  ],
  pendingIngestionRows(rows(slice.pending_ingestions)),
)}

${insertRows(
  'pending_ingestion_extracted_transactions',
  [
    'pending_ingestion_id',
    'kind',
    'amount',
    'currency',
    'vendor_or_source',
    'date',
    'category',
    'confidence',
  ],
  pendingIngestionExtractedTransactionRows(rows(slice.pending_ingestions)),
)}

${insertRows(
  'pending_ingestion_extracted_contracts',
  [
    'pending_ingestion_id',
    'employer_name',
    'employment_type',
    'monthly_income_amount',
    'currency',
    'contract_start_date',
    'contract_end_date',
    'job_title',
    'payday_day_of_month',
    'pay_schedule',
    'confidence',
    'risk_summary',
  ],
  pendingIngestionExtractedContractRows(rows(slice.pending_ingestions)),
)}

${insertRows(
  'pending_ingestion_salary_slips',
  [
    'pending_ingestion_id',
    'employer_name',
    'employee_name',
    'pay_period',
    'payment_date',
    'gross_amount',
    'deductions',
    'net_amount',
    'currency',
    'confidence',
  ],
  pendingIngestionSalarySlipRows(rows(slice.pending_ingestions)),
)}

${insertRows(
  'pending_ingestion_contract_notes',
  [
    'pending_ingestion_id',
    'symbol',
    'company_name',
    'side',
    'quantity',
    'price',
    'gross_amount',
    'fees',
    'currency',
    'broker',
    'trade_date',
    'settlement_date',
    'confidence',
  ],
  pendingIngestionContractNoteRows(rows(slice.pending_ingestions)),
)}

${insertRows(
  'pending_ingestion_fd_certificates',
  [
    'pending_ingestion_id',
    'bank_name',
    'certificate_number',
    'principal',
    'currency',
    'interest_rate_pct',
    'interest_payout',
    'start_date',
    'maturity_date',
    'auto_renew',
    'confidence',
  ],
  pendingIngestionFdCertificateRows(rows(slice.pending_ingestions)),
)}

${insertRows(
  'pending_ingestion_contract_risks',
  ['pending_ingestion_id', 'severity', 'clause', 'concern'],
  pendingIngestionContractRiskRows(rows(slice.pending_ingestions)),
)}

${insertRows(
  'exchange_rates',
  ['id', 'base_currency', 'target_currency', 'date', 'rate', 'source', 'observed_at'],
  exchangeRateRows(rows(slice.exchange_rates)),
)}

${insertRows(
  'investment_accounts',
  ['id', 'data', 'source', 'created_at', 'updated_at'],
  investmentAccountRows(rows(slice.investment_accounts)),
)}

${insertRows(
  'personal_finance_settings',
  [
    'id',
    'base_currency',
    'alerts_enabled',
    'quiet_mode_enabled',
    'emergency_fund_target_months',
    'savings_rate_target_pct',
    'wealth_goal_target_lkr',
    'wealth_goal_target_date',
    'budget_alert_threshold_pct',
    'minimum_cash_reserve_lkr',
    'financial_rules',
    'budget_templates',
    'goal_completion_events',
    'proactive_insights_enabled',
    'salary_history',
  ],
  personalFinanceSettingsRows(slice.personalFinanceSettings),
)}

${insertRows(
  'finance_qa_history',
  ['asked_at', 'question', 'answer'],
  financeQaHistoryRows(slice.personalFinanceSettings?.financeQaHistory),
)}

${insertRows(
  'gmail_ingest_state',
  ['id', 'last_synced_at_seconds'],
  gmailIngestStateRows(slice.personalFinanceSettings?.gmailIngestState),
)}

${insertRows(
  'gmail_sync_history',
  ['synced_at', 'found', 'queued', 'skipped_already_queued'],
  gmailSyncHistoryRows(
    slice.personalFinanceSettings?.gmailIngestState?.syncHistory,
  ),
)}

${insertRows(
  'category_correction_hints',
  ['vendor', 'category'],
  categoryCorrectionRows(slice.personalFinanceSettings?.categoryCorrections),
)}
`
}

/**
 * Best-effort — must never throw back into the caller. Called directly from
 * finance-store.ts's mirrorIntoSplitStores() (Postgres Migration Phase D) —
 * this is now the app's primary write path for personal-finance data, not
 * a secondary mirror alongside a JSON write.
 */
export function writePersonalFinancePostgresStore(
  slice: PersonalFinanceSlice,
): boolean {
  if (!ensurePersonalFinancePostgresSchema()) return false
  const result = runPsql(
    PERSONAL_FINANCE_PG_DATABASE,
    `BEGIN;\n${personalFinanceMirrorSql(slice)}\nCOMMIT;`,
  )
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

const FLAT_TABLES = [
  'finance_accounts',
  'income_records',
  'expense_records',
  'budget_categories',
  'categories',
  'subcategories',
  'merchants',
  'tags',
  'savings_goals',
  'tax_records',
  'income_sources',
  'stock_holdings',
  'fixed_deposits',
  'ai_tasks',
  'investment_journal',
  'net_worth_snapshots',
  'loans',
  'properties',
  'beneficiaries',
  'insurance_policies',
] as const

function selectTableRows(
  database: string,
  table: string,
): Array<Record<string, unknown>> | null {
  const result = selectJson(
    database,
    `SELECT * FROM ${sqlIdentifier(table)} ORDER BY created_at`,
  )
  if (result === null) return null
  return result.map(snakeRowToCamel)
}

function readExchangeRates(
  database: string,
): Array<Record<string, unknown>> | null {
  const rowsOut = selectJson(
    database,
    'SELECT * FROM exchange_rates ORDER BY date',
  )
  if (rowsOut === null) return null
  return rowsOut.map((row) => {
    const camel = snakeRowToCamel(row)
    const { baseCurrency, targetCurrency, ...rest } = camel
    return { ...rest, base: baseCurrency, target: targetCurrency }
  })
}

/** Unpacks the generic JSONB blob back into a flat record — the inverse of investmentAccountRows(). */
function readInvestmentAccounts(
  database: string,
): Array<Record<string, unknown>> | null {
  const rowsOut = selectJson(
    database,
    'SELECT * FROM investment_accounts ORDER BY created_at',
  )
  if (rowsOut === null) return null
  return rowsOut.map((row) => {
    const camel = snakeRowToCamel(row)
    const data = isRecord(camel.data) ? camel.data : {}
    return {
      ...data,
      id: camel.id,
      source: camel.source,
      createdAt: camel.createdAt,
      updatedAt: camel.updatedAt,
    }
  })
}

function readPendingIngestions(
  database: string,
): Array<Record<string, unknown>> | null {
  const parents = selectJson(
    database,
    'SELECT * FROM pending_ingestions ORDER BY created_at',
  )
  const transactions = selectJson(
    database,
    'SELECT * FROM pending_ingestion_extracted_transactions',
  )
  const contracts = selectJson(
    database,
    'SELECT * FROM pending_ingestion_extracted_contracts',
  )
  const salarySlips = selectJson(
    database,
    'SELECT * FROM pending_ingestion_salary_slips',
  )
  const contractNotes = selectJson(
    database,
    'SELECT * FROM pending_ingestion_contract_notes',
  )
  const fdCertificates = selectJson(
    database,
    'SELECT * FROM pending_ingestion_fd_certificates',
  )
  const risks = selectJson(
    database,
    'SELECT * FROM pending_ingestion_contract_risks',
  )
  if (
    parents === null ||
    transactions === null ||
    contracts === null ||
    salarySlips === null ||
    contractNotes === null ||
    fdCertificates === null ||
    risks === null
  )
    return null

  const transactionById = new Map(
    transactions.map((row) => [row.pending_ingestion_id, snakeRowToCamel(row)]),
  )
  const contractById = new Map(
    contracts.map((row) => [row.pending_ingestion_id, snakeRowToCamel(row)]),
  )
  const salarySlipById = new Map(
    salarySlips.map((row) => [row.pending_ingestion_id, snakeRowToCamel(row)]),
  )
  const contractNoteById = new Map(
    contractNotes.map((row) => [row.pending_ingestion_id, snakeRowToCamel(row)]),
  )
  const fdCertificateById = new Map(
    fdCertificates.map((row) => [row.pending_ingestion_id, snakeRowToCamel(row)]),
  )
  const risksByContractId = new Map<unknown, Array<Record<string, unknown>>>()
  for (const risk of risks) {
    const key = risk.pending_ingestion_id
    const list = risksByContractId.get(key) ?? []
    list.push(snakeRowToCamel(risk))
    risksByContractId.set(key, list)
  }

  return parents.map((row) => {
    const camel = snakeRowToCamel(row)
    const extracted = transactionById.get(row.id)
    if (extracted) {
      const { pendingIngestionId, ...rest } = extracted
      camel.extracted = rest
    }
    const contract = contractById.get(row.id)
    if (contract) {
      const { pendingIngestionId, ...rest } = contract
      camel.extractedContract = {
        ...rest,
        risks: risksByContractId.get(row.id) ?? [],
      }
    }
    const salarySlip = salarySlipById.get(row.id)
    if (salarySlip) {
      const { pendingIngestionId, ...rest } = salarySlip
      camel.extractedSalarySlip = rest
    }
    const contractNote = contractNoteById.get(row.id)
    if (contractNote) {
      const { pendingIngestionId, ...rest } = contractNote
      camel.extractedContractNote = rest
    }
    const fdCertificate = fdCertificateById.get(row.id)
    if (fdCertificate) {
      const { pendingIngestionId, ...rest } = fdCertificate
      camel.extractedFdCertificate = rest
    }
    return camel
  })
}

function readPersonalFinanceSettings(
  database: string,
): PersonalFinanceSlice['personalFinanceSettings'] | null {
  const settingsRows = selectJson(
    database,
    'SELECT * FROM personal_finance_settings',
  )
  const qaHistoryRows = selectJson(
    database,
    'SELECT * FROM finance_qa_history ORDER BY asked_at',
  )
  const gmailStateRows = selectJson(
    database,
    'SELECT * FROM gmail_ingest_state',
  )
  const syncHistoryRows = selectJson(
    database,
    'SELECT * FROM gmail_sync_history ORDER BY synced_at',
  )
  const correctionRows = selectJson(
    database,
    'SELECT * FROM category_correction_hints',
  )
  if (
    settingsRows === null ||
    qaHistoryRows === null ||
    gmailStateRows === null ||
    syncHistoryRows === null ||
    correctionRows === null
  ) {
    return null
  }

  const settings = settingsRows[0] ? snakeRowToCamel(settingsRows[0]) : {}
  const gmailState = gmailStateRows[0] ? snakeRowToCamel(gmailStateRows[0]) : {}
  const categoryCorrections: Record<string, string> = {}
  for (const row of correctionRows) {
    if (typeof row.vendor === 'string' && typeof row.category === 'string') {
      categoryCorrections[row.vendor] = row.category
    }
  }

  return {
    baseCurrency: settings.baseCurrency as string | undefined,
    alertsEnabled: settings.alertsEnabled as boolean | undefined,
    quietModeEnabled: settings.quietModeEnabled as boolean | undefined,
    emergencyFundTargetMonths: settings.emergencyFundTargetMonths as
      | number
      | undefined,
    savingsRateTargetPct: settings.savingsRateTargetPct as number | undefined,
    budgetAlertThresholdPct: settings.budgetAlertThresholdPct as number | undefined,
    minimumCashReserveLkr: settings.minimumCashReserveLkr as number | undefined,
    financialRules: isRecord(settings.financialRules)
      ? settings.financialRules
      : undefined,
    budgetTemplates: Array.isArray(settings.budgetTemplates)
      ? (settings.budgetTemplates as Array<Record<string, unknown>>)
      : undefined,
    goalCompletionEvents: Array.isArray(settings.goalCompletionEvents)
      ? (settings.goalCompletionEvents as Array<Record<string, unknown>>)
      : undefined,
    wealthGoalTargetLkr: settings.wealthGoalTargetLkr as number | undefined,
    wealthGoalTargetDate: settings.wealthGoalTargetDate as string | undefined,
    proactiveInsightsEnabled: settings.proactiveInsightsEnabled as boolean | undefined,
    salaryHistory: Array.isArray(settings.salaryHistory)
      ? (settings.salaryHistory as Array<Record<string, unknown>>)
      : undefined,
    financeQaHistory: qaHistoryRows.map((row) => {
      const camel = snakeRowToCamel(row)
      return {
        at: camel.askedAt as number,
        question: camel.question as string,
        answer: camel.answer as string,
      }
    }),
    gmailIngestState: {
      lastSyncedAtSeconds: gmailState.lastSyncedAtSeconds as number | undefined,
      syncHistory: syncHistoryRows.map((row) => {
        const camel = snakeRowToCamel(row)
        return {
          at: camel.syncedAt as number,
          found: camel.found as number,
          queued: camel.queued as number,
          skippedAlreadyQueued: camel.skippedAlreadyQueued as number,
        }
      }),
    },
    categoryCorrections,
  }
}

/**
 * Phase B: reconstructs the full PersonalFinanceSlice shape from the real
 * `personal_finance` Postgres tables. NOT currently called from any live
 * read path — finance-store.ts's overlaySplitStores() still reads from the
 * JSON split store exclusively. Exists so this read path can be built and
 * verified (live round-trip: write via the existing mirror, read back here,
 * diff) in complete isolation before Phase C ever wires it into a real read.
 * Returns null if the database is unavailable or any query fails — never a
 * partially-correct result.
 */
export function readPersonalFinancePostgresStore(): PersonalFinanceSlice | null {
  if (!pgConn()) return null
  if (!ensurePersonalFinancePostgresSchema()) return null
  const database = PERSONAL_FINANCE_PG_DATABASE

  const flat: Record<string, Array<Record<string, unknown>>> = {}
  for (const table of FLAT_TABLES) {
    const result = selectTableRows(database, table)
    if (result === null) return null
    flat[table] = result
  }

  const exchangeRates = readExchangeRates(database)
  const investmentAccounts = readInvestmentAccounts(database)
  const pendingIngestions = readPendingIngestions(database)
  const personalFinanceSettings = readPersonalFinanceSettings(database)
  if (
    exchangeRates === null ||
    investmentAccounts === null ||
    pendingIngestions === null
  )
    return null

  return {
    finance_accounts: flat.finance_accounts,
    income_records: flat.income_records,
    expense_records: flat.expense_records,
    budget_categories: flat.budget_categories,
    categories: flat.categories,
    subcategories: flat.subcategories,
    merchants: flat.merchants,
    tags: flat.tags,
    savings_goals: flat.savings_goals,
    tax_records: flat.tax_records,
    exchange_rates: exchangeRates,
    investment_accounts: investmentAccounts,
    pending_ingestions: pendingIngestions,
    income_sources: flat.income_sources,
    stock_holdings: flat.stock_holdings,
    fixed_deposits: flat.fixed_deposits,
    ai_tasks: flat.ai_tasks,
    investment_journal: flat.investment_journal,
    net_worth_snapshots: flat.net_worth_snapshots,
    loans: flat.loans,
    properties: flat.properties,
    beneficiaries: flat.beneficiaries,
    insurance_policies: flat.insurance_policies,
    personalFinanceSettings: personalFinanceSettings ?? undefined,
  }
}
