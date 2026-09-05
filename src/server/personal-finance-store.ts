/**
 * Shared type for the personal-finance domain slice of FinanceDatabase,
 * used by personal-finance-postgres-store.ts's read/write functions.
 *
 * Historically (Phase 5 of the finance/trading backend split) this file
 * also wrote a JSON mirror of this slice to ~/.hermes/finance/
 * personal-finance.json, used as an intermediate dual-write step before
 * the Postgres cutover. Postgres Migration Phase D retired that JSON
 * mirror — the file was frozen (renamed to
 * personal-finance.json.frozen-phaseD-20260902) as a rollback-only
 * snapshot and nothing writes to it anymore; finance-store.ts's
 * mirrorIntoSplitStores() now calls writePersonalFinancePostgresStore()
 * directly. See docs/personal-finance-os-roadmap.md's "Postgres Migration
 * Project" section for the full history.
 */
export interface PersonalFinanceSlice {
  finance_accounts: Array<Record<string, unknown>>
  income_records: Array<Record<string, unknown>>
  expense_records: Array<Record<string, unknown>>
  budget_categories: Array<Record<string, unknown>>
  /** Optional: absent on a mirror file written before PF-109 shipped. */
  categories?: Array<Record<string, unknown>>
  /** Optional: absent on a mirror file written before PF-110 shipped. */
  subcategories?: Array<Record<string, unknown>>
  /** Optional: absent on a mirror file written before PF-111 shipped. */
  merchants?: Array<Record<string, unknown>>
  /** Optional: absent on a mirror file written before PF-112 shipped. */
  tags?: Array<Record<string, unknown>>
  savings_goals: Array<Record<string, unknown>>
  tax_records: Array<Record<string, unknown>>
  exchange_rates: Array<Record<string, unknown>>
  investment_accounts: Array<Record<string, unknown>>
  pending_ingestions: Array<Record<string, unknown>>
  income_sources: Array<Record<string, unknown>>
  stock_holdings: Array<Record<string, unknown>>
  fixed_deposits: Array<Record<string, unknown>>
  /** Optional: absent on a mirror file written before Phase 40 (Loan Tracking) shipped. */
  loans?: Array<Record<string, unknown>>
  /** Optional: absent on a mirror file written before Phase 40 (Property Tracking) shipped. */
  properties?: Array<Record<string, unknown>>
  /** Optional: absent on a mirror file written before WEALTH-108 (Estate/Beneficiary Notes) shipped. */
  beneficiaries?: Array<Record<string, unknown>>
  /**
   * Postgres-migration Phase A: the personal-finance-owned subset of the
   * shared FinanceSettings bag, split out so it can get real Postgres
   * tables of its own — the trading-shared remainder of FinanceSettings
   * (tradingMode, liveTradingEnabled, demoTrading* config, etc.) is
   * deliberately NOT part of this slice; it stays exactly where it is
   * today (finance-postgres-store.ts's whole-snapshot mirror), untouched.
   * Optional: absent on a mirror file written before this shipped.
   */
  personalFinanceSettings?: {
    emergencyFundTargetMonths?: number
    savingsRateTargetPct?: number
    wealthGoalTargetLkr?: number
    wealthGoalTargetDate?: string
    financeQaHistory?: Array<{ at: number; question: string; answer: string }>
    gmailIngestState?: {
      lastSyncedAtSeconds?: number
      syncHistory?: Array<{
        at: number
        found: number
        queued: number
        skippedAlreadyQueued: number
      }>
    }
    categoryCorrections?: Record<string, string>
  }
}
