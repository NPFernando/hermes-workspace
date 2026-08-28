/**
 * Phase 5 (dual-write step) of the finance/trading backend split. This is a
 * best-effort MIRROR only — the original unified src/server/finance-store.ts
 * JSON file remains the sole source of truth for both reads and recovery
 * throughout this step. Nothing reads from this file yet; it exists so the
 * backfill step (next PR) has something to compare against, and so the
 * eventual read-cutover has a store that's already been running clean for a
 * while.
 *
 * Deliberately a plain sibling module, not importing from finance-store.ts,
 * to avoid a circular import (finance-store.ts's writeFinanceStore() calls
 * into this file after every write).
 *
 * Also fans out to personal-finance-postgres-store.ts's own, separate
 * `personal_finance` Postgres database — best-effort, same as this file's
 * own JSON write; see that module's header for why it's a fully
 * independent sibling rather than touching finance-postgres-store.ts.
 */
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import { writePersonalFinancePostgresStore } from './personal-finance-postgres-store'

const DATA_DIR = path.join(os.homedir(), '.hermes', 'finance')
const DATA_PATH = path.join(DATA_DIR, 'personal-finance.json')

export interface PersonalFinanceSlice {
  finance_accounts: Array<Record<string, unknown>>
  income_records: Array<Record<string, unknown>>
  expense_records: Array<Record<string, unknown>>
  budget_categories: Array<Record<string, unknown>>
  /** Optional: absent on a mirror file written before PF-109 shipped. */
  categories?: Array<Record<string, unknown>>
  savings_goals: Array<Record<string, unknown>>
  tax_records: Array<Record<string, unknown>>
  exchange_rates: Array<Record<string, unknown>>
  investment_accounts: Array<Record<string, unknown>>
  pending_ingestions: Array<Record<string, unknown>>
  income_sources: Array<Record<string, unknown>>
  stock_holdings: Array<Record<string, unknown>>
  fixed_deposits: Array<Record<string, unknown>>
}

/**
 * Best-effort mirror write. Must never throw back into the caller — every
 * caller of writeFinanceStore() includes trading-engine cron cycles, and a
 * failure here (disk full, permissions) must not interrupt a real trade
 * write to the store that actually matters right now.
 */
export function writePersonalFinanceStore(slice: PersonalFinanceSlice): void {
  try {
    fs.mkdirSync(DATA_DIR, { recursive: true, mode: 0o700 })
    const payload = {
      schemaVersion: 1,
      updatedAt: new Date().toISOString(),
      ...slice,
    }
    fs.writeFileSync(DATA_PATH, JSON.stringify(payload), { mode: 0o600 })
  } catch (err) {
    console.error('personal-finance-store: mirror write failed', err)
  }
  try {
    writePersonalFinancePostgresStore(slice)
  } catch (err) {
    console.error('personal-finance-store: Postgres mirror write failed', err)
  }
}

export function readPersonalFinanceStore(): (PersonalFinanceSlice & { schemaVersion: number; updatedAt: string }) | null {
  try {
    const raw = fs.readFileSync(DATA_PATH, 'utf-8')
    return JSON.parse(raw)
  } catch {
    return null
  }
}
