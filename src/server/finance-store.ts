import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import { createHash, randomUUID } from 'node:crypto'
import {
  appendFinanceAuditPostgres,
  financePostgresStatus,
  readFinancePostgresNormalized,
  writeFinancePostgresNormalized,
} from './finance-postgres-store'
import {
  getCachedCategoryPreferences,
  proposeCategoryPreference,
} from './harp-memory-client'
import { decryptSecret, encryptSecret } from './secret-crypto'
import type { ConnectivityBreakerState } from './connectivity-breaker'

export const FINANCE_SCHEMA_VERSION = 1
// Still used for the audit-log recovery buffer and ingestion uploads. Honours
// a HOME override so isolated tests never touch the real ~/.hermes/finance.
export const FINANCE_DATA_DIR = path.join(
  process.env.HOME || os.homedir(),
  '.hermes',
  'finance',
)
/** Recovery buffer for audit entries that could not reach Postgres (see appendAuditLog). */
export const FINANCE_AUDIT_PATH = path.join(FINANCE_DATA_DIR, 'audit.jsonl')
/** Original documents/photos from both ingestion paths (upload, Gmail attachments) — referenced by pending_ingestions.sourceRef. */
export const FINANCE_INGESTION_UPLOAD_DIR = path.join(
  FINANCE_DATA_DIR,
  'ingestion-uploads',
)

export const SUPPORTED_CURRENCIES = ['LKR', 'AUD', 'USD'] as const
export const TRADING_MODES = [
  'observe_only',
  'paper_trade',
  'testnet_execute',
  'live_recommend_only',
  'live_manual_approval',
  'live_auto_trade',
  'live_monitored',
] as const
export const DECISIONS = [
  'BUY_NOW',
  'PLAN_BUY_LATER',
  'HOLD',
  'SELL_NOW',
  'PLAN_SELL_LATER',
  'REDUCE_POSITION',
  'CANCEL_ORDER',
  'AVOID',
  'BLOCKED',
] as const

// Helper functions for date boundaries
function startOfDay(date: Date = new Date()): string {
  const d = new Date(date)
  d.setHours(0, 0, 0, 0)
  return d.toISOString()
}

function startOfWeek(date: Date = new Date()): string {
  const d = new Date(date)
  const day = d.getDay() // 0 Sunday, 1 Monday, ...
  const diff = d.getDate() - day + (day === 0 ? -6 : 1) // adjust to Monday
  d.setDate(diff)
  d.setHours(0, 0, 0, 0)
  return d.toISOString()
}

export type CurrencyCode = (typeof SUPPORTED_CURRENCIES)[number] | string
export type TradingMode = (typeof TRADING_MODES)[number]
export type TradingDecision = (typeof DECISIONS)[number]
export type RiskLevel = 'low_risk' | 'medium_risk' | 'high_risk' | 'blocked'
export type GoalStatus =
  | 'active'
  | 'completed'
  | 'paused'
  | 'cancelled'
  | 'behind_schedule'
  | 'ahead_of_schedule'
export type PlanStatus =
  | 'draft'
  | 'waiting_for_condition'
  | 'ready_for_approval'
  | 'approved'
  | 'executed'
  | 'cancelled'
  | 'expired'
  | 'failed'
  | 'blocked'

export type FinanceAccount = {
  id: string
  name: string
  type:
    | 'bank'
    | 'cash'
    | 'card'
    | 'crypto_wallet'
    | 'broker'
    | 'foreign_currency'
    | 'loan'
    | 'other'
  currency: CurrencyCode
  balance: number
  /** Balance recorded when the user started tracking this account, distinct from the live `balance` above. */
  openingBalance?: number
  openingBalanceDate?: string
  /**
   * When true (and an `openingBalance` is set), this account's contribution
   * to net worth / cash / card-debt uses the ledger-derived balance
   * (openingBalance + tagged income − expenses + transfer legs) instead of
   * the manually-entered `balance`. Falls back to `balance` when the ledger
   * figure can't be computed. Default (absent/false) = manual balance.
   */
  deriveBalanceFromLedger?: boolean
  maskedIdentifier?: string
  platform?: string
  source: string
  createdAt: string
  updatedAt: string
}

export type IncomeRecord = {
  id: string
  dateReceived: string
  sourceName: string
  incomeType: string
  originalCurrency: CurrencyCode
  originalAmount: number
  exchangeRateUsed: number
  convertedLkrAmount: number
  accountId?: string
  taxable: boolean
  notes?: string
  documentRef?: string
  /** Links this logged payment back to the job (IncomeSource) it came from, when known. */
  incomeSourceId?: string
  /** Comma-separated free text — matches the Tag catalogue (PF-112) by name, no FK. */
  tags?: string
  /** Reconciliation status (PF-113). Defaults to 'cleared' to match prior implicit behavior. */
  status?: 'pending' | 'cleared' | 'reconciled'
  source: string
  createdAt: string
  updatedAt: string
}

/**
 * PF review item 2: one expense line split across several categories (e.g. a
 * supermarket receipt that's part Groceries, part Household). Additive and
 * optional — an expense with no `splits` behaves exactly as before. `amount`
 * is in the record's `currency`; the parts must sum to the record `amount`
 * (enforced on write). Category-level aggregations attribute each part its
 * pro-rata share of `convertedLkrAmount`; record-level totals are untouched.
 */
export type ExpenseSplit = {
  category: string
  subcategory?: string
  amount: number
  notes?: string
}

export type ExpenseRecord = {
  id: string
  date: string
  vendor: string
  category: string
  subcategory?: string
  splits?: Array<ExpenseSplit>
  accountId?: string
  currency: CurrencyCode
  amount: number
  convertedLkrAmount: number
  recurring: boolean
  workRelated: boolean
  taxDeductiblePossible: boolean
  notes?: string
  documentRef?: string
  /** Comma-separated free text — matches the Tag catalogue (PF-112) by name, no FK. */
  tags?: string
  /** Reconciliation status (PF-113). Defaults to 'cleared' to match prior implicit behavior. */
  status?: 'pending' | 'cleared' | 'reconciled'
  source: string
  createdAt: string
  updatedAt: string
}

/**
 * PF review item 12 (unified-ledger, first slice): an account-to-account move.
 * Modelling it as its own kind — rather than a paired fake income + fake
 * expense — keeps it out of `financeSummary`'s income/expense/savings totals,
 * which it should never affect. Amount is informational; per-account balances
 * remain manually maintained (roadmap ADR-001 — no derived ledger yet).
 */
export type Transfer = {
  id: string
  date: string
  fromAccountId?: string
  toAccountId?: string
  amount: number
  currency: CurrencyCode
  convertedLkrAmount: number
  notes?: string
  source: string
  createdAt: string
  updatedAt: string
}

/**
 * A planned future income or expense. LKR-denominated (v1). It is NOT part
 * of any total until it is posted — "Post now" (or a future auto-post)
 * turns it into a real income/expense record and flips `status` to
 * 'posted'. Shown in "Coming up" while pending.
 */
export type ScheduledTransaction = {
  id: string
  dueDate: string
  kind: 'income' | 'expense'
  counterparty: string
  category: string
  amount: number
  accountId?: string
  notes?: string
  status: 'pending' | 'posted' | 'cancelled'
  postedRecordId?: string
  source: string
  createdAt: string
  updatedAt: string
}

/**
 * A daily point-in-time snapshot of net worth (and its main components), all
 * LKR-denominated like every other stored figure. Written by the
 * `snapshot_net_worth` action / the nightly cron; upserted by `date` so at
 * most one row per calendar day. Drives the net-worth history chart.
 */
export type NetWorthSnapshot = {
  id: string
  date: string
  netWorthLkr: number
  cashLkr: number
  investmentsLkr: number
  debtLkr: number
  source: string
  createdAt: string
  updatedAt: string
}

/** Read-only unified view over income_records + expense_records + transfers for a single combined transaction list/UI. Storage stays split; this is computed on read, never persisted. */
export type UnifiedTransaction = {
  id: string
  kind: 'income' | 'expense' | 'transfer'
  date: string
  counterparty: string
  category: string
  accountId?: string
  // transfer-only: the two legs, so a transfer row can be edited in place.
  fromAccountId?: string
  toAccountId?: string
  currency: CurrencyCode
  amount: number
  convertedLkrAmount: number
  notes?: string
  documentRef?: string
  recurring?: boolean
  taxable?: boolean
  incomeSourceId?: string
  subcategory?: string
  splits?: Array<ExpenseSplit>
  tags?: string
  status?: 'pending' | 'cleared' | 'reconciled'
  source: string
  createdAt: string
  updatedAt: string
}

export type BudgetCategory = {
  id: string
  month: string
  category: string
  currency: CurrencyCode
  budgetAmount: number
  /** When true, copyBudgetsToMonth() adds last month's positive leftover (budget - actual) on top of the copied amount. Default/undefined behaves as false — budgets stay static until explicitly copied. */
  rolloverEnabled?: boolean
  source: string
  createdAt: string
  updatedAt: string
}

/**
 * Real category entity (PF-109) alongside the free-text `category`/`incomeType`
 * strings on ExpenseRecord/IncomeRecord/BudgetCategory, which remain the
 * source of truth for the budget-vs-actual join (getBudgetVsActual). This is
 * additive: a management catalogue, not a foreign key on existing records.
 */
export type Category = {
  id: string
  name: string
  kind: 'income' | 'expense' | 'both'
  color?: string
  notes?: string
  source: string
  createdAt: string
  updatedAt: string
}

/**
 * Real subcategory entity (PF-110), scoped to a parent category by name —
 * same additive pattern as Category (PF-109): a management catalogue over
 * the existing free-text ExpenseRecord.subcategory field, not a foreign key.
 */
export type Subcategory = {
  id: string
  name: string
  parentCategory: string
  source: string
  createdAt: string
  updatedAt: string
}

/**
 * Real merchant entity (PF-111), scoped alongside the free-text
 * ExpenseRecord.vendor field — same additive pattern as Category/Subcategory:
 * a management catalogue, not a foreign key. `defaultCategory` (also free
 * text) powers a UI convenience (auto-fill category when a known merchant is
 * entered), never a hard link.
 */
export type Merchant = {
  id: string
  name: string
  defaultCategory?: string
  /**
   * PF splits: a remembered percentage split for this vendor (e.g. a
   * supermarket that's usually 60% Groceries / 40% Household). When the
   * vendor is typed on an expense, the split editor pre-fills these parts
   * scaled to the entered amount. Percentages should sum to ~100.
   */
  defaultSplits?: Array<{ category: string; percent: number }>
  notes?: string
  source: string
  createdAt: string
  updatedAt: string
}

/**
 * Real tag entity (PF-112), matched by name against the comma-separated
 * ExpenseRecord.tags/IncomeRecord.tags free-text fields — same additive
 * pattern as Category/Subcategory/Merchant, but many-to-many rather than
 * one-per-record.
 */
export type Tag = {
  id: string
  name: string
  notes?: string
  source: string
  createdAt: string
  updatedAt: string
}

export type SavingsGoal = {
  id: string
  name: string
  targetAmount: number
  currentAmount: number
  currency: CurrencyCode
  targetDate?: string
  monthlyContribution: number
  priority: number
  linkedAccountId?: string
  status: GoalStatus
  /** PF-1007: distinguishes a sinking fund (saving for a specific planned future expense) from an open-ended goal. */
  goalKind?: 'general' | 'sinking'
  source: string
  createdAt: string
  updatedAt: string
}

export type TaxRecord = {
  id: string
  taxYear: string
  incomeType: string
  amount: number
  currency: CurrencyCode
  convertedLkrAmount: number
  exchangeRateSource: string
  deductionCategory?: string
  estimatedTaxableAmount: number
  taxPaid: number
  taxDue: number
  requiresConfirmation: boolean
  notes?: string
  supportingDocument?: string
  source: string
  createdAt: string
  updatedAt: string
}

/** A "job" — an employment/income source, separate from one-off IncomeRecord entries. */
export type IncomeSource = {
  id: string
  employerName: string
  employmentType: 'full_time' | 'contract' | 'freelance' | 'other'
  /** Omit for irregular/freelance income — not every job pays a fixed monthly amount. */
  monthlyIncomeAmount?: number
  currency: CurrencyCode
  contractStartDate?: string
  contractEndDate?: string
  jobTitle?: string
  /** Fixed day of month (1-31) pay is expected, when known — drives the payday reminder badge. */
  expectedPaydayDayOfMonth?: number
  /** Free-text pay timing that doesn't reduce to a fixed day, e.g. "Last business day of each month". Informational only. */
  paySchedule?: string
  status: 'active' | 'ended'
  notes?: string
  /** Path to the original uploaded contract/offer letter, when created via that intake path. */
  documentRef?: string
  source: string
  createdAt: string
  updatedAt: string
}

export type StockHolding = {
  id: string
  symbol: string
  companyName?: string
  platform: string
  quantity: number
  buyPrice: number
  buyDate: string
  currency: CurrencyCode
  /** Cached from the CSE fetch, or manually entered when the fetch fails. */
  lastKnownPrice?: number
  lastPriceUpdatedAt?: string
  priceSource: 'cse_api' | 'manual'
  notes?: string
  source: string
  createdAt: string
  updatedAt: string
}

export type FixedDeposit = {
  id: string
  bankName: string
  principal: number
  currency: CurrencyCode
  interestRatePct: number
  interestPayout: 'monthly' | 'quarterly' | 'annually' | 'at_maturity'
  startDate: string
  maturityDate: string
  status: 'active' | 'matured' | 'withdrawn'
  notes?: string
  source: string
  createdAt: string
  updatedAt: string
}

/** Phase 40 (WEALTH-100/101): unlike FixedDeposit's principal, currentBalance decreases as the loan is paid down. */
export type Loan = {
  id: string
  lender: string
  principal: number
  currentBalance: number
  currency: CurrencyCode
  interestRatePct: number
  monthlyPayment?: number
  startDate: string
  termMonths?: number
  status: 'active' | 'paid_off' | 'defaulted'
  notes?: string
  source: string
  createdAt: string
  updatedAt: string
}

/** Phase 40 (WEALTH-102/103): currentValue is manually updated, like Loan.currentBalance — no valuation API. */
export type Property = {
  id: string
  description: string
  propertyType: 'residential' | 'land' | 'commercial' | 'other'
  purchasePrice: number
  currentValue: number
  currency: CurrencyCode
  purchaseDate: string
  notes?: string
  /** Informational only (PF-1004 precedent) — does not affect debtBase/propertyValueBase/netWorthBase, each already counted once independently. */
  linkedLoanId?: string
  source: string
  createdAt: string
  updatedAt: string
}

/** WEALTH-108: purely informational — no legal/binding weight, no percentage-split math, zero involvement in financeSummary(). */
export type Beneficiary = {
  id: string
  name: string
  relationship: string
  note?: string
  source: string
  createdAt: string
  updatedAt: string
}

/**
 * A record awaiting AI extraction and/or human review before it becomes a
 * real income/expense record — the "AI proposes, human confirms" queue for
 * the Gmail-sync and document/camera-upload ingestion paths. Deliberately
 * separate from addFinanceRecord()'s `kind` union (income/expense/etc.)
 * since a pending ingestion isn't a real finance record yet.
 */
export type PendingIngestionStatus =
  | 'awaiting_password'
  | 'awaiting_review'
  | 'confirmed'
  | 'rejected'

export type ExtractedTransaction = {
  kind: 'income' | 'expense'
  amount: number
  currency: string
  vendorOrSource: string
  date: string
  category?: string
  confidence: 'high' | 'medium' | 'low'
}

/** A specific clause an AI contract review flagged as unusual or one-sided for the employee. */
export type ContractRisk = {
  severity: 'high' | 'medium' | 'low'
  clause: string
  concern: string
}

export type ExtractedContract = {
  employerName: string
  employmentType: 'full_time' | 'contract' | 'freelance' | 'other'
  monthlyIncomeAmount?: number
  currency: string
  contractStartDate?: string
  contractEndDate?: string
  jobTitle?: string
  /** Only set when the contract states a clear fixed day (e.g. "salary paid on the 5th"). */
  paydayDayOfMonth?: number
  /** Free-text pay timing when it doesn't reduce to a fixed day (e.g. "last business day"). */
  paySchedule?: string
  confidence: 'high' | 'medium' | 'low'
  /** Plain-English 2-3 sentence overview of how favorable/unfavorable the contract looks. */
  riskSummary: string
  risks: Array<ContractRisk>
}

export type PendingIngestion = {
  id: string
  status: PendingIngestionStatus
  source: 'gmail' | 'upload'
  /** Defaults to 'transaction' — 'contract' drives a different extracted shape and confirm path. */
  documentType: 'transaction' | 'contract'
  sourceRef: string
  passwordHint?: string
  /** Set when the Gmail sender matched a registered gmailIngest.knownSenders entry — lets the UI show "Example Bank" instead of a raw grep hint. */
  matchedSenderId?: string
  matchedSenderLabel?: string
  extracted?: ExtractedTransaction
  extractedContract?: ExtractedContract
  rawPreviewImagePath?: string
  error?: string
  createdAt: string
  updatedAt: string
}

/**
 * A biller/bank the user has explicitly registered so Gmail sync can (a)
 * broaden its search beyond generic keywords and (b) auto-unlock a matching
 * encrypted PDF attachment instead of just surfacing a grepped hint.
 * `encryptedPassword` (see secret-crypto.ts) is the only real secret this
 * app stores at rest, by explicit user request — it never appears in an API
 * response; list_known_senders reports `hasPassword` instead.
 */
export type KnownSender = {
  id: string
  label: string
  /** At least one of matchDomain/matchAddress should be set; both may match a given From header. */
  matchDomain?: string
  matchAddress?: string
  /** Human-readable, non-secret description of how the password is derived (e.g. "date of birth, DDMMYYYY") — shown when no password is stored or auto-unlock fails. */
  passwordScheme?: string
  /** Links to finance_accounts[].id when this sender's statements belong to one specific account. */
  accountId?: string
  encryptedPassword?: string
  createdAt: string
  updatedAt: string
}

export type AssetRecord = {
  id: string
  platform: 'binance' | 'ibkr' | 'manual' | string
  symbol: string
  assetType: 'crypto' | 'stock' | 'etf' | 'forex' | 'index' | 'other'
  exchange?: string
  currency: CurrencyCode
  verified: boolean
  blockedReason?: string
  source: string
  createdAt: string
  updatedAt: string
}

export type MarketPrice = {
  id: string
  platform: string
  symbol: string
  price: number
  bid?: number
  ask?: number
  spread?: number
  volume?: number
  currency: CurrencyCode
  observedAt: string
  source: string
  createdAt: string
  updatedAt: string
}

export type NewsItem = {
  id: string
  sourceName: string
  sourceUrl: string
  publishDate?: string
  relatedSymbol: string
  summary: string
  sentiment: 'positive' | 'neutral' | 'negative' | 'mixed' | 'unknown'
  riskImpact: RiskLevel
  confidenceScore: number
  changedDecision: boolean
  source: string
  createdAt: string
  updatedAt: string
}

export type RiskScore = {
  id: string
  platform: string
  symbol: string
  riskLevel: RiskLevel
  riskScore: number
  confidenceScore: number
  blockers: Array<string>
  inputs: Record<string, unknown>
  formulaVersion?: string
  inputRefs?: Array<string>
  observedAt?: string
  expiresAt?: string
  source: string
  createdAt: string
  updatedAt: string
}

/** A provenance-preserving stored research observation; never an execution input. */
export type SentimentScore = {
  id: string
  symbol: string
  kind: 'fear_greed' | 'long_short' | 'news_composite'
  score: number
  label: 'positive' | 'neutral' | 'negative' | 'mixed' | 'unknown'
  confidenceScore: number
  freshness: number
  inputRefs: Array<string>
  formulaVersion: string
  observedAt: string
  expiresAt: string
  source: string
  createdAt: string
  updatedAt: string
}

export type IntelligenceRecord = {
  id: string
  symbol: string
  sentimentScoreId: string
  riskScoreId: string
  inputRefs: Array<string>
  formulaVersion: string
  observedAt: string
  expiresAt: string
  source: string
  createdAt: string
  updatedAt: string
}

export type TradingPlan = {
  id: string
  platform: 'binance' | 'ibkr' | 'manual' | string
  symbol: string
  assetType: string
  decision: TradingDecision
  reason: string
  riskLevel: RiskLevel
  riskScore: number
  confidenceScore: number
  suggestedEntryPrice?: number
  suggestedExitPrice?: number
  stopLoss?: number
  takeProfit?: number
  positionSize?: number
  expectedHoldingPeriod?: string
  maximumAcceptableLoss?: number
  dataUsed: Array<string>
  newsReviewed: Array<string>
  expectedOutcome?: string
  alternativeOption?: string
  finalRecommendation: string
  status: PlanStatus
  userApprovalStatus: 'not_required' | 'pending' | 'approved' | 'rejected'
  executionStatus:
    | 'not_executable'
    | 'blocked'
    | 'pending'
    | 'executed'
    | 'failed'
  actualOutcome?: string
  profitLoss?: number
  strategyUsed?: string
  agentNotes?: string
  source: string
  createdAt: string
  updatedAt: string
}

export type TradeOrder = {
  id: string
  planId: string
  platform: 'binance' | 'ibkr' | 'manual' | string
  symbol: string
  side: 'buy' | 'sell'
  quantity: number
  orderType: 'market' | 'limit' | 'stop_limit'
  price?: number
  filledQuantity?: number
  averageFillPrice?: number
  fee?: number
  feeCurrency?: CurrencyCode
  status: 'pending' | 'open' | 'closed' | 'cancelled' | 'rejected'
  brokerOrderId?: string
  source: string
  createdAt: string
  updatedAt: string
}

export type TradeExecution = {
  id: string
  orderId: string
  planId: string
  platform: 'binance' | 'ibkr' | 'manual' | string
  symbol: string
  side: 'buy' | 'sell'
  quantity: number
  price: number
  fees: number
  executedAt: string
  source: string
  createdAt: string
  updatedAt: string
}

export type VirtualAccount = {
  id: string
  platform: 'binance' | 'ibkr' | 'manual' | string
  currency: CurrencyCode
  balance: number
  initialBalance: number
  lockedAmount: number
  totalTrades: number
  winningTrades: number
  totalPnl: number
  totalCost: number
  totalQuantity: number
  totalPnlPercentage: number
  availableBalance?: number
  marginUsed?: number
  unrealizedPnl?: number
  realizedPnl?: number
  maskedIdentifier?: string
  source: string
  createdAt: string
  updatedAt: string
}

export type TradingSignal = {
  id: string
  symbol: string
  action: 'buy' | 'sell' | 'hold'
  strength: number // 0-100
  confidence: number // 0-100
  priceTarget: number
  stopLoss: number
  takeProfit?: number
  suggestedEntryPrice?: number
  suggestedExitPrice?: number
  positionSize?: number
  riskScore?: number
  riskLevel?: RiskLevel
  reasoning: string
  indicators: Record<string, number>
  timestamp: string
  source: string
}

export type RiskState = {
  dailyRealizedLoss: number // accumulated realized loss (>=0)
  dailyUnrealizedLoss: number // accumulated unrealized loss (>=0)
  weeklyRealizedLoss: number
  weeklyUnrealizedLoss: number
  dailyBreached: boolean
  weeklyBreached: boolean
  lastResetDay: string // ISO date string of start of day
  lastResetWeek: string // ISO date string of start of week (Monday)
}

export type FinanceSettings = {
  /** PF-201: the reporting currency all aggregate `*Lkr` figures are expressed
   * in. Storage stays LKR-denominated; this is display/reporting only.
   * Defaults to 'LKR'. */
  baseCurrency: CurrencyCode
  reportingCurrencies: Array<CurrencyCode>
  /** PF-201: percentage markup applied by `refresh_exchange_rates` on top of
   * the fetched mid-market rate, to approximate the user's actual bank
   * transfer rate (the cost of *buying* the foreign currency). The reverse
   * leg is written as the exact reciprocal so display round-trips stay
   * stable. Defaults to 0 (pure mid-market). */
  exchangeRateSpreadPct?: number
  tradingMode: TradingMode
  liveTradingEnabled: boolean
  emergencyKillSwitch: boolean
  monitoringActive: boolean // for live_monitored mode
  autonomousTradingEnabled: boolean // for live_auto_trade mode
  primaryTradingProvider: 'binance'
  ibkrStatus: 'future_feature'
  executionAccount: 'paper' | 'binance_testnet' | 'binance_live'
  paperShadowEnabled: boolean
  livePerOrderCapUsdt: number
  liveBinanceApprovedAt?: string | null
  liveBinanceApprovalId?: string | null
  /**
   * Per-engine tunable config blobs, each resolved against its own engine's
   * defaults at read time (resolveGridEngineConfig, EngineConfig in
   * demo-trading-engine.ts, etc.) — loosely typed here rather than importing
   * each engine's config type, since those engines already import from this
   * file (finance-store.ts is a low-level module; importing back from them
   * would be circular). Application code already reads/writes these through
   * an `as Record<string, unknown>` cast — this just gives that same shape
   * a name so tests can construct/type them without their own casts.
   */
  demoTrading?: Record<string, unknown>
  demoTradingGrid?: Record<string, unknown>
  demoTradingLlm?: Record<string, unknown>
  demoTradingRebalance?: Record<string, unknown>
  autoRefinement?: Record<string, unknown>
  /** Gates non-critical (info/warning) Telegram delivery in alerts.ts. Off by default — critical alerts always send regardless. */
  alertsEnabled?: boolean
  /** PF-303: user-set emergency fund target, in months of average expenses. Unset/0 means no target configured yet. */
  emergencyFundTargetMonths?: number
  /** PF-304: user-set savings rate target, as a percentage. Unset/0 means no target configured yet. */
  savingsRateTargetPct?: number
  /** WEALTH-107: user-set long-term net worth target. Unset/0 means no target configured yet. */
  wealthGoalTargetLkr?: number
  /** WEALTH-107: optional target date for wealthGoalTargetLkr — a target date without an amount is meaningless, so this is only read when wealthGoalTargetLkr is set. */
  wealthGoalTargetDate?: string
  /** AI-202: capped (last 10) recent-activity list for the Finance Analyst — same "bounded log" convention as AI-506's gmailIngest.syncHistory. */
  financeQaHistory?: Array<{ at: number; question: string; answer: string }>
  strategyDecayDetection?: Record<string, unknown>
  /** Per-strategy validated backtest baselines, keyed by strategyId. See strategy-decay.ts. */
  strategyBaselines?: Record<string, unknown>
  /**
   * Staged live-trading readiness state (versioned gate snapshot + a
   * time-bounded, fingerprinted approval record). Owned exclusively by
   * trading-readiness.ts — loosely typed here for the same reason as
   * `demoTrading` etc above (that module already imports from this one).
   */
  liveReadiness?: Record<string, unknown>
  /**
   * Bounded paper/sandbox validation-run state (active + history), one
   * active run per stage ('paper' | 'sandbox'). Owned exclusively by
   * validation-run.ts — loosely typed here for the same reason as
   * `demoTrading`/`liveReadiness` above (that module already imports from
   * this one).
   */
  validationRuns?: Record<string, unknown>
}

export type FinanceDatabase = {
  schemaVersion: number
  createdAt: string
  updatedAt: string
  settings: FinanceSettings
  finance_accounts: Array<FinanceAccount>
  income_records: Array<IncomeRecord>
  expense_records: Array<ExpenseRecord>
  transfers: Array<Transfer>
  net_worth_snapshots: Array<NetWorthSnapshot>
  scheduled_transactions: Array<ScheduledTransaction>
  budget_categories: Array<BudgetCategory>
  categories: Array<Category>
  subcategories: Array<Subcategory>
  merchants: Array<Merchant>
  tags: Array<Tag>
  savings_goals: Array<SavingsGoal>
  tax_records: Array<TaxRecord>
  pending_ingestions: Array<PendingIngestion>
  income_sources: Array<IncomeSource>
  stock_holdings: Array<StockHolding>
  fixed_deposits: Array<FixedDeposit>
  loans: Array<Loan>
  properties: Array<Property>
  beneficiaries: Array<Beneficiary>
  exchange_rates: Array<Record<string, unknown>>
  investment_accounts: Array<Record<string, unknown>>
  trading_platforms: Array<Record<string, unknown>>
  api_connections: Array<Record<string, unknown>>
  assets: Array<AssetRecord>
  market_prices: Array<MarketPrice>
  historical_candles: Array<Record<string, unknown>>
  news_items: Array<NewsItem>
  sentiment_scores: Array<SentimentScore>
  risk_scores: Array<RiskScore>
  intelligence_records: Array<IntelligenceRecord>
  trading_plans: Array<TradingPlan>
  trade_orders: Array<TradeOrder>
  trade_executions: Array<TradeExecution>
  virtual_accounts: Array<VirtualAccount>
  portfolio_positions: Array<Record<string, unknown>>
  account_balances: Array<Record<string, unknown>>
  strategy_results: Array<Record<string, unknown>>
  prediction_results: Array<Record<string, unknown>>
  agent_memory: Array<Record<string, unknown>>
  audit_logs: Array<Record<string, unknown>>
  error_logs: Array<Record<string, unknown>>
  trading_signals: Array<TradingSignal>
  riskState: RiskState
  connectivityBreaker: ConnectivityBreakerState
}

/**
 * Postgres is the sole finance persistence layer, so storage health is now a
 * plain reachability signal — there is no second store to drift against.
 * - `healthy`             — Postgres reachable, finance data present.
 * - `postgres_unavailable` — Postgres enabled but unreachable / no data yet.
 * - `json_primary`        — Postgres disabled (HERMES_FINANCE_STORE=json) or a
 *                           dev / in-memory backend is active.
 */
export type FinanceStorageHealthStatus =
  | 'healthy'
  | 'postgres_unavailable'
  | 'json_primary'

export type FinanceStorageHealth = {
  status: FinanceStorageHealthStatus
  warnings: Array<string>
  postgresUpdatedAt: string | null
  rowCounts: {
    postgres: Record<string, number>
  }
}

type AddPayload = Record<string, unknown>

function nowIso(): string {
  return new Date().toISOString()
}

function defaultSettings(): FinanceSettings {
  return {
    baseCurrency: 'LKR',
    reportingCurrencies: ['LKR', 'AUD', 'USD'],
    tradingMode: 'observe_only',
    liveTradingEnabled: false,
    emergencyKillSwitch: true,
    monitoringActive: false,
    autonomousTradingEnabled: false,
    primaryTradingProvider: 'binance',
    ibkrStatus: 'future_feature',
    executionAccount: 'paper',
    paperShadowEnabled: true,
    livePerOrderCapUsdt: 10,
    liveBinanceApprovedAt: null,
    liveBinanceApprovalId: null,
  }
}

export function createEmptyFinanceDatabase(): FinanceDatabase {
  const createdAt = nowIso()
  return {
    schemaVersion: FINANCE_SCHEMA_VERSION,
    createdAt,
    updatedAt: createdAt,
    settings: defaultSettings(),
    finance_accounts: [],
    income_records: [],
    expense_records: [],
    transfers: [],
    net_worth_snapshots: [],
    scheduled_transactions: [],
    budget_categories: [],
    categories: [],
    subcategories: [],
    merchants: [],
    tags: [],
    savings_goals: [],
    tax_records: [],
    pending_ingestions: [],
    income_sources: [],
    stock_holdings: [],
    fixed_deposits: [],
    loans: [],
    properties: [],
    beneficiaries: [],
    exchange_rates: [],
    investment_accounts: [],
    trading_platforms: [
      {
        id: 'binance',
        name: 'Binance',
        mode: 'observe_only',
        source: 'system',
        createdAt,
        updatedAt: createdAt,
      },
      {
        id: 'ibkr',
        name: 'Interactive Brokers',
        mode: 'future_feature',
        source: 'system',
        createdAt,
        updatedAt: createdAt,
      },
    ],
    api_connections: [],
    assets: [],
    market_prices: [],
    historical_candles: [],
    news_items: [],
    sentiment_scores: [],
    risk_scores: [],
    intelligence_records: [],
    trading_plans: [],
    trade_orders: [],
    trade_executions: [],
    virtual_accounts: [],
    portfolio_positions: [],
    account_balances: [],
    strategy_results: [],
    prediction_results: [],
    agent_memory: [],
    audit_logs: [],
    error_logs: [],
    trading_signals: [],
    riskState: {
      dailyRealizedLoss: 0,
      dailyUnrealizedLoss: 0,
      weeklyRealizedLoss: 0,
      weeklyUnrealizedLoss: 0,
      dailyBreached: false,
      weeklyBreached: false,
      lastResetDay: startOfDay(),
      lastResetWeek: startOfWeek(),
    },
    connectivityBreaker: {
      consecutiveCredentialFailures: 0,
      firstFailureAt: null,
      tripped: false,
      trippedAt: null,
      trippedReason: null,
    },
  }
}

export function ensureFinanceStore(): FinanceDatabase {
  fs.mkdirSync(FINANCE_DATA_DIR, { recursive: true, mode: 0o700 })
  return readFinanceStore()
}

/** How long a `readFinanceStore()` result may be reused before re-reading
 * from disk/Postgres. `readFinanceStore()` is expensive — it parses a
 * multi-MB JSON file, queries Postgres, and (in the normal case) writes
 * back to both stores on every single call — and a single dashboard
 * request (e.g. /api/trading/summary) calls it 5-7+ times (once per
 * engine's state function). A short cache collapses those into one real
 * read per request/burst instead of duplicating the full read+write cycle
 * every time. Kept intentionally short so writes from other requests are
 * never invisible for more than a moment, and invalidated immediately by
 * writeFinanceStore() below so callers always see their own writes. */
const FINANCE_STORE_CACHE_TTL_MS = 1500
let financeStoreCache: { db: FinanceDatabase; atMs: number } | null = null

export function readFinanceStore(): FinanceDatabase {
  if (
    financeStoreCache &&
    Date.now() - financeStoreCache.atMs < FINANCE_STORE_CACHE_TTL_MS
  ) {
    return financeStoreCache.db
  }
  const db = readFinanceStoreUncached()
  financeStoreCache = { db, atMs: Date.now() }
  return db
}

function readFinanceStoreUncached(): FinanceDatabase {
  return financeBackend.read()
}

const STORAGE_HEALTH_COLLECTIONS = [
  'finance_accounts',
  'income_records',
  'expense_records',
  'savings_goals',
  'tax_records',
  'market_prices',
  'historical_candles',
  'trading_plans',
  'trade_orders',
  'trade_executions',
  'strategy_results',
] as const

export function financeCollectionCounts(
  db: FinanceDatabase | null,
): Record<string, number> {
  const counts: Record<string, number> = {}
  for (const key of STORAGE_HEALTH_COLLECTIONS) {
    const value = db?.[key]
    counts[key] = Array.isArray(value) ? value.length : 0
  }
  return counts
}

export function buildFinanceStorageHealth(input: {
  postgresDb: FinanceDatabase | null
  postgres: {
    enabled: boolean
    available: boolean
    snapshotAvailable: boolean
    reason?: string
    lastWriteError?: string
  }
}): FinanceStorageHealth {
  const warnings: Array<string> = []
  let status: FinanceStorageHealthStatus = 'healthy'

  if (!input.postgres.enabled) {
    status = 'json_primary'
    warnings.push(
      'Postgres persistence is disabled (dev / in-memory backend).',
    )
  } else if (
    !input.postgres.available ||
    !input.postgres.snapshotAvailable ||
    !input.postgresDb
  ) {
    status = 'postgres_unavailable'
    warnings.push(
      input.postgres.reason
        ? `Postgres finance store unavailable: ${input.postgres.reason}.`
        : 'Postgres finance store unavailable.',
    )
  }
  if (input.postgres.lastWriteError) {
    warnings.push(
      `Last Postgres write failed: ${input.postgres.lastWriteError}.`,
    )
  }

  return {
    status,
    warnings,
    postgresUpdatedAt: input.postgresDb?.updatedAt ?? null,
    rowCounts: {
      postgres: financeCollectionCounts(input.postgresDb),
    },
  }
}

function migrateFinanceStore(db: FinanceDatabase): FinanceDatabase {
  const baseline = createEmptyFinanceDatabase()
  return {
    ...baseline,
    ...db,
    settings: { ...baseline.settings, ...db.settings },
    schemaVersion: FINANCE_SCHEMA_VERSION,
  }
}

/**
 * Persistence backend seam for `readFinanceStore` / `writeFinanceStore`.
 *
 * Production: the `finance` Postgres normalized store
 * (`readFinancePostgresNormalized` / `writeFinancePostgresNormalized`) — the
 * only place finance data is ever saved.
 *
 * Under vitest / `NODE_ENV=test`: an in-process store held on `globalThis` so
 * it survives `vi.resetModules()` and is shared by every `finance-store`
 * module instance in a run (many suites pin this module via `vi.importActual`
 * and reset it by writing through the store in `beforeEach` — the old
 * tmp-`HOME` `finance.json` gave them that persistence; the global slot
 * replaces it). No filesystem, no real database — upholds the 2026-07-27
 * anti-pollution guard by construction. A suite wanting hard isolation still
 * calls `__setFinanceBackend(__inMemoryFinanceBackend(seed))`.
 */
export interface FinanceStoreBackend {
  read: () => FinanceDatabase
  write: (db: FinanceDatabase) => void
}

const postgresFinanceBackend: FinanceStoreBackend = {
  read() {
    const db = readFinancePostgresNormalized()
    if (!db) {
      throw new Error(
        'Finance PostgreSQL store is unavailable; refusing to continue without persistence.',
      )
    }
    return migrateFinanceStore(db)
  },
  write(db) {
    if (!writeFinancePostgresNormalized(db)) {
      throw new Error(
        'Finance PostgreSQL store is unavailable; write was not persisted.',
      )
    }
  },
}

const FINANCE_TEST_STORE_KEY = '__hermesFinanceTestStore__'

const globalTestFinanceBackend: FinanceStoreBackend = {
  read() {
    const g = globalThis as Record<string, unknown>
    let db = g[FINANCE_TEST_STORE_KEY] as FinanceDatabase | undefined
    if (!db) {
      db = migrateFinanceStore(createEmptyFinanceDatabase())
      g[FINANCE_TEST_STORE_KEY] = db
    }
    return migrateFinanceStore(db)
  },
  write(db) {
    // Some readiness checks (e.g. emergencyStopReadinessGate) stat
    // FINANCE_DATA_DIR for writability; the old JSON backend created it on
    // every write, so keep doing that even though nothing is written to disk.
    try {
      fs.mkdirSync(FINANCE_DATA_DIR, { recursive: true, mode: 0o700 })
    } catch {
      /* best-effort — tests that don't set HOME still work */
    }
    ;(globalThis as Record<string, unknown>)[FINANCE_TEST_STORE_KEY] =
      migrateFinanceStore(db)
  },
}

/** Test-only: wipe the shared global finance store back to empty. */
export function __resetFinanceTestStore(): void {
  delete (globalThis as Record<string, unknown>)[FINANCE_TEST_STORE_KEY]
  financeStoreCache = null
}

function defaultFinanceBackend(): FinanceStoreBackend {
  return process.env.VITEST || process.env.NODE_ENV === 'test'
    ? globalTestFinanceBackend
    : postgresFinanceBackend
}

let financeBackend: FinanceStoreBackend = defaultFinanceBackend()

/** Test-only: swap the persistence backend and drop the read cache. */
export function __setFinanceBackend(backend: FinanceStoreBackend): void {
  financeBackend = backend
  financeStoreCache = null
}

/** Test-only: restore the environment default backend. */
export function __resetFinanceBackend(): void {
  financeBackend = defaultFinanceBackend()
  financeStoreCache = null
}

/**
 * Test-only: a pure in-memory backend seeded from `initial` (or an empty DB).
 * Holds one migrated `FinanceDatabase` in a closure; every read/write is a
 * deep-ish copy via `migrateFinanceStore` so callers can't mutate the store
 * through a returned reference.
 */
export function __inMemoryFinanceBackend(
  initial?: FinanceDatabase,
): FinanceStoreBackend {
  let current = migrateFinanceStore(initial ?? createEmptyFinanceDatabase())
  return {
    read: () => migrateFinanceStore(current),
    write: (db) => {
      current = migrateFinanceStore(db)
    },
  }
}

export function writeFinanceStore(db: FinanceDatabase): void {
  const updated = { ...db, updatedAt: nowIso() }
  financeBackend.write(updated)
  // Invalidate (rather than repopulate) the read cache: `updated` here is
  // the raw pre-overlay object, not the merged result readFinanceStore()
  // normally returns. Invalidating just means the next read pays the full
  // uncached cost once, rare next to the read-heavy dashboard access pattern.
  financeStoreCache = null
}

export function setNonLiveExecutionMode(
  mode: 'observe_only' | 'paper_trade' | 'testnet_execute',
): FinanceDatabase {
  const db = readFinanceStore()
  const validationRuns = (db.settings as Record<string, unknown>)
    .validationRuns
  const activeRuns =
    validationRuns && typeof validationRuns === 'object'
      ? (validationRuns as { active?: Array<{ stage?: string }> }).active ?? []
      : []
  const expectedStage =
    mode === 'paper_trade'
      ? 'paper'
      : mode === 'testnet_execute'
        ? 'sandbox'
        : null
  if (
    expectedStage &&
    activeRuns.some((run) => run.stage && run.stage !== expectedStage)
  ) {
    throw new Error(
      `Cannot switch to ${mode} while a validation run for another stage is active.`,
    )
  }
  db.settings.tradingMode = mode
  db.settings.executionAccount =
    mode === 'testnet_execute' ? 'binance_testnet' : 'paper'
  db.settings.liveTradingEnabled = false
  writeFinanceStore(db)
  appendAuditLog('non_live_execution_mode_changed', {
    tradingMode: mode,
    executionAccount: db.settings.executionAccount,
  })
  return db
}

/**
 * Postgres `audit_logs` is the system of record. The local
 * `~/.hermes/finance/audit.jsonl` is a best-effort **recovery buffer** —
 * written only when the Postgres insert did not land, so a later run (or the
 * `finance-pg-sync` cron) can replay it. Neither write can suppress the other,
 * and neither may ever throw back into a finance mutation or trading cycle.
 */
export function appendAuditLog(
  action: string,
  details: Record<string, unknown>,
): void {
  const entry = {
    id: randomUUID(),
    action,
    details: maskSensitive(details) as Record<string, unknown>,
    source: 'hermes-finance',
    createdAt: nowIso(),
  }

  let pgOk = false
  try {
    pgOk = appendFinanceAuditPostgres(entry)
  } catch {
    pgOk = false
  }

  if (!pgOk) {
    try {
      fs.mkdirSync(FINANCE_DATA_DIR, { recursive: true, mode: 0o700 })
      fs.appendFileSync(FINANCE_AUDIT_PATH, `${JSON.stringify(entry)}\n`, {
        mode: 0o600,
      })
    } catch {
      // Buffer write failed too — the entry is lost. Swallowed on purpose so
      // audit-log I/O can never crash the caller.
    }
  }
}

export function financeStorageStatus() {
  const pg = financePostgresStatus()
  const postgresDb = readFinancePostgresNormalized()
  const health = buildFinanceStorageHealth({
    postgresDb,
    postgres: {
      ...pg,
      snapshotAvailable: postgresDb !== null,
    },
  })
  return {
    active: postgresDb ? ('postgres' as const) : ('unavailable' as const),
    auditPath: FINANCE_AUDIT_PATH,
    postgres: pg,
    health,
  }
}

export function financeStorageAlerts(health: FinanceStorageHealth): Array<{
  level: 'info' | 'warning' | 'critical'
  title: string
  detail: string
}> {
  if (health.warnings.length === 0) return []
  return [
    {
      level: health.status === 'postgres_unavailable' ? 'critical' : 'warning',
      title: 'Finance storage unhealthy',
      detail: health.warnings.join(' '),
    },
  ]
}

/**
 * Idempotently persists externally fetched, read-only research records.
 * News is intentionally isolated from trading plans and execution state.
 */
export function storeFinanceNewsItems(items: Array<NewsItem>): number {
  if (items.length === 0) return 0
  const db = ensureFinanceStore()
  const existingIds = new Set(db.news_items.map((item) => item.id))
  const newItems = items.filter((item) => !existingIds.has(item.id))
  if (newItems.length === 0) return 0
  db.news_items.push(...newItems)
  writeFinanceStore(db)
  appendAuditLog('news_items_ingested', {
    count: newItems.length,
    symbols: Array.from(new Set(newItems.map((item) => item.relatedSymbol))),
    source: 'google-news-rss',
  })
  return newItems.length
}

/**
 * Stores derived research in dedicated intelligence collections only. This does
 * not create plans/orders, mutate settings, or append an execution audit entry.
 */
export function storeIntelligenceRecords(input: {
  sentiment: SentimentScore
  risk: RiskScore
}): {
  sentiment: SentimentScore
  risk: RiskScore
  intelligence: IntelligenceRecord
  stored: boolean
} {
  const db = ensureFinanceStore()
  const fingerprint = [
    input.sentiment.symbol,
    input.sentiment.formulaVersion,
    input.sentiment.observedAt,
    ...input.sentiment.inputRefs.slice().sort(),
  ].join('\n')
  const id = `intelligence:${createHash('sha256').update(fingerprint).digest('hex').slice(0, 24)}`
  const existing = db.intelligence_records.find((record) => record.id === id)
  if (existing) {
    const sentiment =
      db.sentiment_scores.find(
        (score) => score.id === existing.sentimentScoreId,
      ) ?? input.sentiment
    const risk =
      db.risk_scores.find((score) => score.id === existing.riskScoreId) ??
      input.risk
    return { sentiment, risk, intelligence: existing, stored: false }
  }
  const intelligence: IntelligenceRecord = {
    id,
    symbol: input.sentiment.symbol,
    sentimentScoreId: input.sentiment.id,
    riskScoreId: input.risk.id,
    inputRefs: input.sentiment.inputRefs.slice().sort(),
    formulaVersion: input.sentiment.formulaVersion,
    observedAt: input.sentiment.observedAt,
    expiresAt: input.sentiment.expiresAt,
    source: 'finance-intelligence',
    createdAt: input.sentiment.createdAt,
    updatedAt: input.sentiment.updatedAt,
  }
  db.sentiment_scores.push(input.sentiment)
  db.risk_scores.push(input.risk)
  db.intelligence_records.push(intelligence)
  writeFinanceStore(db)
  return {
    sentiment: input.sentiment,
    risk: input.risk,
    intelligence,
    stored: true,
  }
}

export function addFinanceRecord(
  kind: string,
  payload: AddPayload,
): FinanceDatabase {
  const db = ensureFinanceStore()
  const createdAt = nowIso()
  const base = {
    id: typeof payload.id === 'string' ? payload.id : randomUUID(),
    source: typeof payload.source === 'string' ? payload.source : 'manual',
    createdAt,
    updatedAt: createdAt,
  }

  if (kind === 'income') {
    db.income_records.push({
      ...base,
      dateReceived: stringField(
        payload,
        'dateReceived',
        createdAt.slice(0, 10),
      ),
      sourceName: stringField(payload, 'sourceName', 'Unspecified income'),
      incomeType: stringField(payload, 'incomeType', 'Other income'),
      originalCurrency: stringField(payload, 'originalCurrency', 'LKR'),
      originalAmount: numberField(payload, 'originalAmount', 0),
      exchangeRateUsed: numberField(payload, 'exchangeRateUsed', 1),
      convertedLkrAmount: numberField(
        payload,
        'convertedLkrAmount',
        numberField(payload, 'originalAmount', 0),
      ),
      accountId: optionalString(payload, 'accountId'),
      taxable: booleanField(payload, 'taxable', true),
      notes: optionalString(payload, 'notes'),
      documentRef: optionalString(payload, 'documentRef'),
      incomeSourceId: optionalString(payload, 'incomeSourceId'),
      tags: optionalString(payload, 'tags'),
      status: reconciliationStatus(payload.status),
    })
  } else if (kind === 'expense') {
    const expenseAmount = numberField(payload, 'amount', 0)
    const expenseSplits = parseExpenseSplits(payload)
    assertValidExpenseSplits(expenseSplits, expenseAmount)
    db.expense_records.push({
      ...base,
      date: stringField(payload, 'date', createdAt.slice(0, 10)),
      vendor: stringField(payload, 'vendor', 'Unspecified vendor'),
      category: stringField(payload, 'category', 'Other'),
      subcategory: optionalString(payload, 'subcategory'),
      ...(expenseSplits ? { splits: expenseSplits } : {}),
      accountId: optionalString(payload, 'accountId'),
      currency: stringField(payload, 'currency', 'LKR'),
      amount: expenseAmount,
      convertedLkrAmount: numberField(
        payload,
        'convertedLkrAmount',
        expenseAmount,
      ),
      recurring: booleanField(payload, 'recurring', false),
      workRelated: booleanField(payload, 'workRelated', false),
      taxDeductiblePossible: booleanField(
        payload,
        'taxDeductiblePossible',
        false,
      ),
      notes: optionalString(payload, 'notes'),
      documentRef: optionalString(payload, 'documentRef'),
      tags: optionalString(payload, 'tags'),
      status: reconciliationStatus(payload.status),
    })
  } else if (kind === 'account') {
    db.finance_accounts.push({
      ...base,
      name: stringField(payload, 'name', 'Account'),
      type: accountType(payload.type),
      currency: stringField(payload, 'currency', 'LKR'),
      balance: numberField(payload, 'balance', 0),
      openingBalance: optionalNumber(payload, 'openingBalance'),
      openingBalanceDate: optionalString(payload, 'openingBalanceDate'),
      deriveBalanceFromLedger:
        payload.deriveBalanceFromLedger === true ? true : undefined,
      maskedIdentifier: optionalString(payload, 'maskedIdentifier'),
      platform: optionalString(payload, 'platform'),
    })
  } else if (kind === 'goal') {
    db.savings_goals.push({
      ...base,
      name: stringField(payload, 'name', 'Savings goal'),
      targetAmount: numberField(payload, 'targetAmount', 0),
      currentAmount: numberField(payload, 'currentAmount', 0),
      currency: stringField(payload, 'currency', 'LKR'),
      targetDate: optionalString(payload, 'targetDate'),
      monthlyContribution: numberField(payload, 'monthlyContribution', 0),
      priority: numberField(payload, 'priority', 3),
      linkedAccountId: optionalString(payload, 'linkedAccountId'),
      status: goalStatus(payload.status),
      goalKind: goalKindField(payload.goalKind),
    })
  } else if (kind === 'tax') {
    db.tax_records.push({
      ...base,
      taxYear: stringField(
        payload,
        'taxYear',
        new Date().getFullYear().toString(),
      ),
      incomeType: stringField(payload, 'incomeType', 'Other income'),
      amount: numberField(payload, 'amount', 0),
      currency: stringField(payload, 'currency', 'LKR'),
      convertedLkrAmount: numberField(
        payload,
        'convertedLkrAmount',
        numberField(payload, 'amount', 0),
      ),
      exchangeRateSource: stringField(payload, 'exchangeRateSource', 'manual'),
      deductionCategory: optionalString(payload, 'deductionCategory'),
      estimatedTaxableAmount: numberField(payload, 'estimatedTaxableAmount', 0),
      taxPaid: numberField(payload, 'taxPaid', 0),
      taxDue: numberField(payload, 'taxDue', 0),
      requiresConfirmation: booleanField(payload, 'requiresConfirmation', true),
      notes: optionalString(payload, 'notes'),
      supportingDocument: optionalString(payload, 'supportingDocument'),
    })
  } else if (kind === 'budget_category') {
    db.budget_categories.push({
      ...base,
      month: stringField(payload, 'month', nowIso().slice(0, 7)),
      category: stringField(payload, 'category', 'Other'),
      currency: stringField(payload, 'currency', 'LKR'),
      budgetAmount: numberField(payload, 'budgetAmount', 0),
      rolloverEnabled: booleanField(payload, 'rolloverEnabled', false) || undefined,
    })
  } else if (kind === 'category') {
    db.categories.push({
      ...base,
      name: stringField(payload, 'name', 'Untitled'),
      kind: categoryKind(payload.kind),
      color: optionalString(payload, 'color'),
      notes: optionalString(payload, 'notes'),
    })
  } else if (kind === 'subcategory_entry') {
    db.subcategories.push({
      ...base,
      name: stringField(payload, 'name', 'Untitled'),
      parentCategory: stringField(payload, 'parentCategory', 'Other'),
    })
  } else if (kind === 'merchant') {
    const merchantSplits = parseMerchantDefaultSplits(payload)
    db.merchants.push({
      ...base,
      name: stringField(payload, 'name', 'Untitled'),
      defaultCategory: optionalString(payload, 'defaultCategory'),
      ...(merchantSplits ? { defaultSplits: merchantSplits } : {}),
      notes: optionalString(payload, 'notes'),
    })
  } else if (kind === 'tag') {
    db.tags.push({
      ...base,
      name: stringField(payload, 'name', 'Untitled'),
      notes: optionalString(payload, 'notes'),
    })
  } else if (kind === 'income_source') {
    db.income_sources.push({
      ...base,
      employerName: stringField(payload, 'employerName', 'Employer'),
      employmentType: employmentTypeField(payload.employmentType),
      monthlyIncomeAmount: optionalNumber(payload, 'monthlyIncomeAmount'),
      currency: stringField(payload, 'currency', 'LKR'),
      contractStartDate: optionalString(payload, 'contractStartDate'),
      contractEndDate: optionalString(payload, 'contractEndDate'),
      jobTitle: optionalString(payload, 'jobTitle'),
      expectedPaydayDayOfMonth: optionalNumber(
        payload,
        'expectedPaydayDayOfMonth',
      ),
      paySchedule: optionalString(payload, 'paySchedule'),
      status: payload.status === 'ended' ? 'ended' : 'active',
      notes: optionalString(payload, 'notes'),
      documentRef: optionalString(payload, 'documentRef'),
    })
  } else if (kind === 'stock_holding') {
    db.stock_holdings.push({
      ...base,
      symbol: stringField(payload, 'symbol', 'UNKNOWN'),
      companyName: optionalString(payload, 'companyName'),
      platform: stringField(payload, 'platform', 'Unknown'),
      quantity: numberField(payload, 'quantity', 0),
      buyPrice: numberField(payload, 'buyPrice', 0),
      buyDate: stringField(payload, 'buyDate', createdAt.slice(0, 10)),
      currency: stringField(payload, 'currency', 'LKR'),
      lastKnownPrice: optionalNumber(payload, 'lastKnownPrice'),
      lastPriceUpdatedAt: optionalString(payload, 'lastPriceUpdatedAt'),
      priceSource: payload.priceSource === 'cse_api' ? 'cse_api' : 'manual',
      notes: optionalString(payload, 'notes'),
    })
  } else if (kind === 'fixed_deposit') {
    db.fixed_deposits.push({
      ...base,
      bankName: stringField(payload, 'bankName', 'Bank'),
      principal: numberField(payload, 'principal', 0),
      currency: stringField(payload, 'currency', 'LKR'),
      interestRatePct: numberField(payload, 'interestRatePct', 0),
      interestPayout: interestPayoutField(payload.interestPayout),
      startDate: stringField(payload, 'startDate', createdAt.slice(0, 10)),
      maturityDate: stringField(
        payload,
        'maturityDate',
        createdAt.slice(0, 10),
      ),
      status: fixedDepositStatusField(payload.status),
      notes: optionalString(payload, 'notes'),
    })
  } else if (kind === 'loan') {
    db.loans.push({
      ...base,
      lender: stringField(payload, 'lender', 'Lender'),
      principal: numberField(payload, 'principal', 0),
      currentBalance: numberField(payload, 'currentBalance', 0),
      currency: stringField(payload, 'currency', 'LKR'),
      interestRatePct: numberField(payload, 'interestRatePct', 0),
      monthlyPayment: optionalNumber(payload, 'monthlyPayment'),
      startDate: stringField(payload, 'startDate', createdAt.slice(0, 10)),
      termMonths: optionalNumber(payload, 'termMonths'),
      status: loanStatusField(payload.status),
      notes: optionalString(payload, 'notes'),
    })
  } else if (kind === 'property') {
    db.properties.push({
      ...base,
      description: stringField(payload, 'description', 'Property'),
      propertyType: propertyTypeField(payload.propertyType),
      purchasePrice: numberField(payload, 'purchasePrice', 0),
      currentValue: numberField(payload, 'currentValue', 0),
      currency: stringField(payload, 'currency', 'LKR'),
      purchaseDate: stringField(
        payload,
        'purchaseDate',
        createdAt.slice(0, 10),
      ),
      notes: optionalString(payload, 'notes'),
      linkedLoanId: optionalString(payload, 'linkedLoanId'),
    })
  } else if (kind === 'beneficiary') {
    db.beneficiaries.push({
      ...base,
      name: stringField(payload, 'name', 'Beneficiary'),
      relationship: stringField(payload, 'relationship', ''),
      note: optionalString(payload, 'note'),
    })
  } else if (kind === 'transfer') {
    const amount = numberField(payload, 'amount', 0)
    const currency = stringField(payload, 'currency', 'LKR')
    db.transfers.push({
      ...base,
      date: stringField(payload, 'date', createdAt.slice(0, 10)),
      fromAccountId: optionalString(payload, 'fromAccountId'),
      toAccountId: optionalString(payload, 'toAccountId'),
      amount,
      currency,
      // Convert-on-write: derive the LKR figure from the FX table rather
      // than trust the client, which posts the raw amount as
      // `convertedLkrAmount`. Same shape as `set_wealth_goal`. Falls back
      // to the raw amount when no rate is on file (matches financeSummary).
      convertedLkrAmount: amountToLkr(db, amount, currency),
      notes: optionalString(payload, 'notes'),
    })
  } else if (kind === 'scheduled_transaction') {
    db.scheduled_transactions.push({
      ...base,
      dueDate: stringField(payload, 'dueDate', createdAt.slice(0, 10)),
      kind: payload.kind === 'income' ? 'income' : 'expense',
      counterparty: stringField(payload, 'counterparty', 'Unspecified'),
      category: stringField(payload, 'category', 'Other'),
      amount: numberField(payload, 'amount', 0),
      accountId: optionalString(payload, 'accountId'),
      notes: optionalString(payload, 'notes'),
      status: 'pending',
    })
  } else if (kind === 'trading_plan') {
    db.trading_plans.push(createTradingPlan(payload, base))
  } else if (kind === 'virtual_account') {
    db.virtual_accounts.push(createVirtualAccount(payload, base))
  } else if (kind === 'trade_order') {
    db.trade_orders.push(createTradeOrder(payload, base))
  } else if (kind === 'trade_execution') {
    db.trade_executions.push(createTradeExecution(payload, base))
  } else if (kind === 'trading_signal') {
    db.trading_signals.push(createTradingSignal(payload, base))
  } else {
    throw new Error(`Unsupported finance record kind: ${kind}`)
  }

  writeFinanceStore(db)
  appendAuditLog(`record_added:${kind}`, { id: base.id, kind })
  return db
}

export function updateFinanceRecord(
  kind: string,
  id: string,
  payload: AddPayload,
): FinanceDatabase {
  const db = ensureFinanceStore()
  let updated = false
  if (kind === 'income') {
    const index = db.income_records.findIndex((r) => r.id === id)
    if (index !== -1) {
      db.income_records[index] = {
        ...db.income_records[index],
        ...payload,
        updatedAt: nowIso(),
      }
      updated = true
    }
  } else if (kind === 'expense') {
    const index = db.expense_records.findIndex((r) => r.id === id)
    if (index !== -1) {
      const merged = {
        ...db.expense_records[index],
        ...payload,
        updatedAt: nowIso(),
      }
      // `splits` needs parse + validation, and an explicit `null`/`[]` clears
      // it. Only touch it when the caller actually sent the key.
      if ('splits' in payload) {
        const parsed = parseExpenseSplits(payload)
        assertValidExpenseSplits(parsed, merged.amount)
        if (parsed) merged.splits = parsed
        else delete merged.splits
      }
      db.expense_records[index] = merged
      updated = true
    }
  } else if (kind === 'account') {
    const index = db.finance_accounts.findIndex((r) => r.id === id)
    if (index !== -1) {
      db.finance_accounts[index] = {
        ...db.finance_accounts[index],
        ...payload,
        updatedAt: nowIso(),
      }
      updated = true
    }
  } else if (kind === 'goal') {
    const index = db.savings_goals.findIndex((r) => r.id === id)
    if (index !== -1) {
      db.savings_goals[index] = {
        ...db.savings_goals[index],
        ...payload,
        updatedAt: nowIso(),
      }
      updated = true
    }
  } else if (kind === 'tax') {
    const index = db.tax_records.findIndex((r) => r.id === id)
    if (index !== -1) {
      db.tax_records[index] = {
        ...db.tax_records[index],
        ...payload,
        updatedAt: nowIso(),
      }
      updated = true
    }
  } else if (kind === 'budget_category') {
    const index = db.budget_categories.findIndex((r) => r.id === id)
    if (index !== -1) {
      db.budget_categories[index] = {
        ...db.budget_categories[index],
        ...payload,
        updatedAt: nowIso(),
      }
      updated = true
    }
  } else if (kind === 'category') {
    const index = db.categories.findIndex((r) => r.id === id)
    if (index !== -1) {
      db.categories[index] = {
        ...db.categories[index],
        ...payload,
        updatedAt: nowIso(),
      }
      updated = true
    }
  } else if (kind === 'subcategory_entry') {
    const index = db.subcategories.findIndex((r) => r.id === id)
    if (index !== -1) {
      db.subcategories[index] = {
        ...db.subcategories[index],
        ...payload,
        updatedAt: nowIso(),
      }
      updated = true
    }
  } else if (kind === 'merchant') {
    const index = db.merchants.findIndex((r) => r.id === id)
    if (index !== -1) {
      const merged = {
        ...db.merchants[index],
        ...payload,
        updatedAt: nowIso(),
      }
      if ('defaultSplits' in payload) {
        const parsed = parseMerchantDefaultSplits(payload)
        if (parsed) merged.defaultSplits = parsed
        else delete merged.defaultSplits
      }
      db.merchants[index] = merged
      updated = true
    }
  } else if (kind === 'tag') {
    const index = db.tags.findIndex((r) => r.id === id)
    if (index !== -1) {
      db.tags[index] = { ...db.tags[index], ...payload, updatedAt: nowIso() }
      updated = true
    }
  } else if (kind === 'income_source') {
    const index = db.income_sources.findIndex((r) => r.id === id)
    if (index !== -1) {
      db.income_sources[index] = {
        ...db.income_sources[index],
        ...payload,
        updatedAt: nowIso(),
      }
      updated = true
    }
  } else if (kind === 'stock_holding') {
    const index = db.stock_holdings.findIndex((r) => r.id === id)
    if (index !== -1) {
      db.stock_holdings[index] = {
        ...db.stock_holdings[index],
        ...payload,
        updatedAt: nowIso(),
      }
      updated = true
    }
  } else if (kind === 'fixed_deposit') {
    const index = db.fixed_deposits.findIndex((r) => r.id === id)
    if (index !== -1) {
      db.fixed_deposits[index] = {
        ...db.fixed_deposits[index],
        ...payload,
        updatedAt: nowIso(),
      }
      updated = true
    }
  } else if (kind === 'loan') {
    const index = db.loans.findIndex((r) => r.id === id)
    if (index !== -1) {
      db.loans[index] = { ...db.loans[index], ...payload, updatedAt: nowIso() }
      updated = true
    }
  } else if (kind === 'property') {
    const index = db.properties.findIndex((r) => r.id === id)
    if (index !== -1) {
      db.properties[index] = {
        ...db.properties[index],
        ...payload,
        updatedAt: nowIso(),
      }
      updated = true
    }
  } else if (kind === 'beneficiary') {
    const index = db.beneficiaries.findIndex((r) => r.id === id)
    if (index !== -1) {
      db.beneficiaries[index] = {
        ...db.beneficiaries[index],
        ...payload,
        updatedAt: nowIso(),
      }
      updated = true
    }
  } else if (kind === 'transfer') {
    const index = db.transfers.findIndex((r) => r.id === id)
    if (index !== -1) {
      const merged = { ...db.transfers[index], ...payload }
      db.transfers[index] = {
        ...merged,
        // `convertedLkrAmount` is derived, never trusted from the client —
        // recompute from the merged amount/currency on every update.
        convertedLkrAmount: amountToLkr(db, merged.amount, merged.currency),
        updatedAt: nowIso(),
      }
      updated = true
    }
  } else if (kind === 'scheduled_transaction') {
    const index = db.scheduled_transactions.findIndex((r) => r.id === id)
    if (index !== -1) {
      db.scheduled_transactions[index] = {
        ...db.scheduled_transactions[index],
        ...payload,
        updatedAt: nowIso(),
      }
      updated = true
    }
  } else {
    throw new Error(`Unsupported finance record kind for update: ${kind}`)
  }

  if (!updated) {
    throw new Error(`Record not found for kind ${kind} and id ${id}`)
  }

  writeFinanceStore(db)
  appendAuditLog(`record_updated:${kind}`, { id, kind })
  return db
}

/**
 * Throws when the id isn't found (matching updateFinanceRecord's own
 * not-found convention) rather than silently no-op'ing. A prior "idempotent,
 * silent no-op" version of this function let the UI's delete button close
 * its confirm dialog with no error even when nothing was actually deleted —
 * indistinguishable from success. Also throws for a genuinely unsupported
 * kind.
 */
export function deleteFinanceRecord(kind: string, id: string): FinanceDatabase {
  const db = ensureFinanceStore()
  let removed = false

  if (kind === 'income') {
    const before = db.income_records.length
    db.income_records = db.income_records.filter((r) => r.id !== id)
    removed = db.income_records.length !== before
  } else if (kind === 'expense') {
    const before = db.expense_records.length
    db.expense_records = db.expense_records.filter((r) => r.id !== id)
    removed = db.expense_records.length !== before
  } else if (kind === 'account') {
    const before = db.finance_accounts.length
    db.finance_accounts = db.finance_accounts.filter((r) => r.id !== id)
    removed = db.finance_accounts.length !== before
  } else if (kind === 'goal') {
    const before = db.savings_goals.length
    db.savings_goals = db.savings_goals.filter((r) => r.id !== id)
    removed = db.savings_goals.length !== before
  } else if (kind === 'tax') {
    const before = db.tax_records.length
    db.tax_records = db.tax_records.filter((r) => r.id !== id)
    removed = db.tax_records.length !== before
  } else if (kind === 'budget_category') {
    const before = db.budget_categories.length
    db.budget_categories = db.budget_categories.filter((r) => r.id !== id)
    removed = db.budget_categories.length !== before
  } else if (kind === 'category') {
    const before = db.categories.length
    db.categories = db.categories.filter((r) => r.id !== id)
    removed = db.categories.length !== before
  } else if (kind === 'subcategory_entry') {
    const before = db.subcategories.length
    db.subcategories = db.subcategories.filter((r) => r.id !== id)
    removed = db.subcategories.length !== before
  } else if (kind === 'merchant') {
    const before = db.merchants.length
    db.merchants = db.merchants.filter((r) => r.id !== id)
    removed = db.merchants.length !== before
  } else if (kind === 'tag') {
    const before = db.tags.length
    db.tags = db.tags.filter((r) => r.id !== id)
    removed = db.tags.length !== before
  } else if (kind === 'income_source') {
    const before = db.income_sources.length
    db.income_sources = db.income_sources.filter((r) => r.id !== id)
    removed = db.income_sources.length !== before
  } else if (kind === 'stock_holding') {
    const before = db.stock_holdings.length
    db.stock_holdings = db.stock_holdings.filter((r) => r.id !== id)
    removed = db.stock_holdings.length !== before
  } else if (kind === 'fixed_deposit') {
    const before = db.fixed_deposits.length
    db.fixed_deposits = db.fixed_deposits.filter((r) => r.id !== id)
    removed = db.fixed_deposits.length !== before
  } else if (kind === 'loan') {
    const before = db.loans.length
    db.loans = db.loans.filter((r) => r.id !== id)
    removed = db.loans.length !== before
  } else if (kind === 'property') {
    const before = db.properties.length
    db.properties = db.properties.filter((r) => r.id !== id)
    removed = db.properties.length !== before
  } else if (kind === 'beneficiary') {
    const before = db.beneficiaries.length
    db.beneficiaries = db.beneficiaries.filter((r) => r.id !== id)
    removed = db.beneficiaries.length !== before
  } else if (kind === 'transfer') {
    const before = db.transfers.length
    db.transfers = db.transfers.filter((r) => r.id !== id)
    removed = db.transfers.length !== before
  } else if (kind === 'scheduled_transaction') {
    const before = db.scheduled_transactions.length
    db.scheduled_transactions = db.scheduled_transactions.filter(
      (r) => r.id !== id,
    )
    removed = db.scheduled_transactions.length !== before
  } else {
    throw new Error(`Unsupported finance record kind for delete: ${kind}`)
  }

  if (!removed) {
    throw new Error(`Record not found for kind ${kind} and id ${id}`)
  }

  writeFinanceStore(db)
  appendAuditLog(`record_deleted:${kind}`, { id, kind })
  return db
}

export type DuplicateMatch = {
  id: string
  date: string
  amount: number
  vendorOrSource: string
}

/**
 * Same-day, same-vendor(case-insensitive), ~same-amount (within 1%) match
 * against existing records — used by confirm_pending_ingestion to warn
 * before silently double-counting an email/upload that was already
 * confirmed once (e.g. the same bill arriving via both Gmail and a manual
 * upload). Read-only; callers decide whether to still create the record.
 */
export function findPossibleDuplicate(
  kind: 'income' | 'expense',
  vendorOrSource: string,
  date: string,
  amount: number,
): DuplicateMatch | null {
  if (!vendorOrSource.trim() || !date || !Number.isFinite(amount)) return null
  const db = ensureFinanceStore()
  const vendorKey = vendorOrSource.trim().toLowerCase()
  const dateOnly = date.slice(0, 10)
  const records: Array<{
    id: string
    vendor: string
    date: string
    amount: number
  }> =
    kind === 'income'
      ? db.income_records.map((r) => ({
          id: r.id,
          vendor: r.sourceName,
          date: r.dateReceived,
          amount: r.originalAmount,
        }))
      : db.expense_records.map((r) => ({
          id: r.id,
          vendor: r.vendor,
          date: r.date,
          amount: r.amount,
        }))

  for (const r of records) {
    const sameVendor = r.vendor.trim().toLowerCase() === vendorKey
    const sameDate = r.date.slice(0, 10) === dateOnly
    const sameAmount =
      Math.abs(r.amount - amount) / Math.max(Math.abs(amount), 1) < 0.01
    if (sameVendor && sameDate && sameAmount) {
      return {
        id: r.id,
        date: r.date,
        amount: r.amount,
        vendorOrSource: r.vendor,
      }
    }
  }
  return null
}

/**
 * Learns a vendor -> category mapping from a user's correction at
 * ingestion-confirm time, so future AI extractions for the same vendor
 * start from what the user actually picked instead of the model's guess.
 * Stored under settings (not a new top-level collection) since it's a
 * single small lookup map, not a record collection with its own lifecycle.
 */
export function recordCategoryCorrection(
  vendor: string,
  category: string,
): void {
  if (!vendor.trim() || !category.trim()) return
  const db = ensureFinanceStore()
  const settings = db.settings as Record<string, unknown>
  const corrections = (
    settings.categoryCorrections &&
    typeof settings.categoryCorrections === 'object'
      ? { ...(settings.categoryCorrections as Record<string, string>) }
      : {}
  ) as Record<string, string>
  corrections[vendor.trim().toLowerCase()] = category.trim()
  settings.categoryCorrections = corrections
  writeFinanceStore(db)
  // Also propose it to HARP memory as a governed `preference` candidate.
  // Best-effort, non-blocking — the flat map above stays authoritative for
  // prompt hints until (and if) the candidate is approved.
  void proposeCategoryPreference({ vendor, category })
}

/**
 * The flat `settings.categoryCorrections` map merged with any *approved* HARP
 * category rules (a HARP rule wins a key conflict — it reflects review). When
 * HARP memory is disabled or unreachable this is exactly the flat map.
 */
export function getCategoryCorrections(): Record<string, string> {
  const db = ensureFinanceStore()
  const settings = db.settings as Record<string, unknown>
  const flat =
    settings.categoryCorrections &&
    typeof settings.categoryCorrections === 'object'
      ? (settings.categoryCorrections as Record<string, string>)
      : {}
  const harp = getCachedCategoryPreferences()
  return Object.keys(harp).length > 0 ? { ...flat, ...harp } : flat
}

/**
 * Persists a Gmail sync failure onto settings.gmailIngest so the settings UI
 * can show "last sync failed: <reason>" even after the transient toast in
 * the ingestion panel is gone — `isGmailConnected()` only checks whether a
 * refresh token *file* exists, not whether Google still honours it, so this
 * is the only durable signal that a "connected" account actually needs
 * reconnecting (e.g. invalid_grant: token expired or revoked).
 */
export function recordGmailSyncError(message: string): void {
  const db = ensureFinanceStore()
  const settings = db.settings as Record<string, unknown>
  const gmailIngest = (
    settings.gmailIngest && typeof settings.gmailIngest === 'object'
      ? { ...(settings.gmailIngest as Record<string, unknown>) }
      : {}
  ) as Record<string, unknown>
  gmailIngest.lastError = { at: Math.floor(Date.now() / 1000), message }
  settings.gmailIngest = gmailIngest
  writeFinanceStore(db)
}

function readKnownSenders(settings: Record<string, unknown>): Array<KnownSender> {
  const gmailIngest =
    settings.gmailIngest && typeof settings.gmailIngest === 'object'
      ? (settings.gmailIngest as Record<string, unknown>)
      : {}
  return Array.isArray(gmailIngest.knownSenders)
    ? (gmailIngest.knownSenders as Array<KnownSender>)
    : []
}

function writeKnownSenders(
  settings: Record<string, unknown>,
  knownSenders: Array<KnownSender>,
): void {
  const gmailIngest = (
    settings.gmailIngest && typeof settings.gmailIngest === 'object'
      ? { ...(settings.gmailIngest as Record<string, unknown>) }
      : {}
  ) as Record<string, unknown>
  gmailIngest.knownSenders = knownSenders
  settings.gmailIngest = gmailIngest
}

/** Never includes encryptedPassword's plaintext — callers that need to actually try the password use decryptKnownSenderPassword(). */
export function listKnownSenders(): Array<KnownSender> {
  const settings = ensureFinanceStore().settings as Record<string, unknown>
  return readKnownSenders(settings)
}

export function upsertKnownSender(
  input: Pick<KnownSender, 'label'> &
    Partial<Pick<KnownSender, 'id' | 'matchDomain' | 'matchAddress' | 'passwordScheme' | 'accountId'>>,
): KnownSender {
  if (!input.label.trim()) throw new Error('label is required')
  const db = ensureFinanceStore()
  const settings = db.settings as Record<string, unknown>
  const knownSenders = readKnownSenders(settings)
  const now = nowIso()
  const existingIndex = input.id
    ? knownSenders.findIndex((s) => s.id === input.id)
    : -1
  const record: KnownSender = {
    id: existingIndex >= 0 ? knownSenders[existingIndex].id : randomUUID(),
    label: input.label.trim(),
    matchDomain: input.matchDomain?.trim() || undefined,
    matchAddress: input.matchAddress?.trim().toLowerCase() || undefined,
    passwordScheme: input.passwordScheme?.trim() || undefined,
    accountId: input.accountId || undefined,
    encryptedPassword:
      existingIndex >= 0 ? knownSenders[existingIndex].encryptedPassword : undefined,
    createdAt: existingIndex >= 0 ? knownSenders[existingIndex].createdAt : now,
    updatedAt: now,
  }
  const next =
    existingIndex >= 0
      ? knownSenders.map((s, i) => (i === existingIndex ? record : s))
      : [...knownSenders, record]
  writeKnownSenders(settings, next)
  writeFinanceStore(db)
  appendAuditLog('known_sender_upserted', { id: record.id, label: record.label })
  return record
}

export function deleteKnownSender(id: string): void {
  const db = ensureFinanceStore()
  const settings = db.settings as Record<string, unknown>
  const knownSenders = readKnownSenders(settings)
  writeKnownSenders(settings, knownSenders.filter((s) => s.id !== id))
  writeFinanceStore(db)
  appendAuditLog('known_sender_deleted', { id })
}

/** Encrypts server-side via secret-crypto.ts — the plaintext password never gets stored or logged as-is. */
export function setKnownSenderPassword(id: string, password: string): KnownSender {
  if (!password) throw new Error('password is required')
  const db = ensureFinanceStore()
  const settings = db.settings as Record<string, unknown>
  const knownSenders = readKnownSenders(settings)
  const index = knownSenders.findIndex((s) => s.id === id)
  if (index === -1) throw new Error(`Known sender not found: ${id}`)
  const updated: KnownSender = {
    ...knownSenders[index],
    encryptedPassword: encryptSecret(password),
    updatedAt: nowIso(),
  }
  const next = knownSenders.map((s, i) => (i === index ? updated : s))
  writeKnownSenders(settings, next)
  writeFinanceStore(db)
  appendAuditLog('known_sender_password_set', { id }) // never logs the password itself
  return updated
}

export function clearKnownSenderPassword(id: string): KnownSender {
  const db = ensureFinanceStore()
  const settings = db.settings as Record<string, unknown>
  const knownSenders = readKnownSenders(settings)
  const index = knownSenders.findIndex((s) => s.id === id)
  if (index === -1) throw new Error(`Known sender not found: ${id}`)
  const updated: KnownSender = {
    ...knownSenders[index],
    encryptedPassword: undefined,
    updatedAt: nowIso(),
  }
  const next = knownSenders.map((s, i) => (i === index ? updated : s))
  writeKnownSenders(settings, next)
  writeFinanceStore(db)
  appendAuditLog('known_sender_password_cleared', { id })
  return updated
}

/** Server-internal only (gmail-ingest.ts) — decrypted value must never reach an API response. */
export function decryptKnownSenderPassword(sender: KnownSender): string | undefined {
  if (!sender.encryptedPassword) return undefined
  try {
    return decryptSecret(sender.encryptedPassword)
  } catch {
    return undefined
  }
}

export function listPendingIngestions(): Array<PendingIngestion> {
  return ensureFinanceStore().pending_ingestions
}

export function addPendingIngestion(
  input: Pick<PendingIngestion, 'source' | 'sourceRef'> &
    Partial<
      Pick<
        PendingIngestion,
        | 'status'
        | 'documentType'
        | 'passwordHint'
        | 'matchedSenderId'
        | 'matchedSenderLabel'
        | 'extracted'
        | 'extractedContract'
        | 'rawPreviewImagePath'
        | 'error'
      >
    >,
): PendingIngestion {
  const db = ensureFinanceStore()
  const createdAt = nowIso()
  const record: PendingIngestion = {
    id: randomUUID(),
    status: input.status ?? 'awaiting_review',
    source: input.source,
    documentType: input.documentType ?? 'transaction',
    sourceRef: input.sourceRef,
    passwordHint: input.passwordHint,
    matchedSenderId: input.matchedSenderId,
    matchedSenderLabel: input.matchedSenderLabel,
    extracted: input.extracted,
    extractedContract: input.extractedContract,
    rawPreviewImagePath: input.rawPreviewImagePath,
    error: input.error,
    createdAt,
    updatedAt: createdAt,
  }
  db.pending_ingestions.push(record)
  writeFinanceStore(db)
  appendAuditLog('pending_ingestion_added', {
    id: record.id,
    source: record.source,
    status: record.status,
  })
  return record
}

export function updatePendingIngestion(
  id: string,
  patch: Partial<Omit<PendingIngestion, 'id' | 'createdAt'>>,
): PendingIngestion {
  const db = ensureFinanceStore()
  const index = db.pending_ingestions.findIndex((r) => r.id === id)
  if (index === -1) throw new Error(`Pending ingestion not found: ${id}`)
  const updated: PendingIngestion = {
    ...db.pending_ingestions[index],
    ...patch,
    updatedAt: nowIso(),
  }
  db.pending_ingestions[index] = updated
  writeFinanceStore(db)
  appendAuditLog('pending_ingestion_updated', { id, status: updated.status })
  return updated
}

export function createTradingPlan(
  payload: AddPayload,
  base?: { id: string; source: string; createdAt: string; updatedAt: string },
): TradingPlan {
  const createdAt = nowIso()
  const recordBase = base ?? {
    id: randomUUID(),
    source: 'manual',
    createdAt,
    updatedAt: createdAt,
  }
  const riskLevel = riskLevelField(payload, 'riskLevel', 'blocked')
  const decision = decisionField(
    payload,
    'decision',
    riskLevel === 'blocked' ? 'BLOCKED' : 'HOLD',
  )
  const hasExit =
    payload.takeProfit != null ||
    stringField(payload, 'expectedHoldingPeriod', '') !== ''
  const blockers = validateTradeSafety({
    decision,
    riskLevel,
    stopLoss: numberField(payload, 'stopLoss', Number.NaN),
    hasExit,
    positionSize: numberField(payload, 'positionSize', 0),
  })
  const blocked = blockers.length > 0
  return {
    ...recordBase,
    platform: stringField(payload, 'platform', 'manual'),
    symbol: stringField(payload, 'symbol', 'UNSPECIFIED'),
    assetType: stringField(payload, 'assetType', 'other'),
    decision: blocked ? 'BLOCKED' : decision,
    reason: blocked
      ? `Blocked by safety controls: ${blockers.join('; ')}`
      : stringField(payload, 'reason', 'Manual plan'),
    riskLevel: blocked ? 'blocked' : riskLevel,
    riskScore: numberField(payload, 'riskScore', 100),
    confidenceScore: numberField(payload, 'confidenceScore', 0),
    suggestedEntryPrice: optionalNumber(payload, 'suggestedEntryPrice'),
    suggestedExitPrice: optionalNumber(payload, 'suggestedExitPrice'),
    stopLoss: optionalNumber(payload, 'stopLoss'),
    takeProfit: optionalNumber(payload, 'takeProfit'),
    positionSize: optionalNumber(payload, 'positionSize'),
    expectedHoldingPeriod: optionalString(payload, 'expectedHoldingPeriod'),
    maximumAcceptableLoss: optionalNumber(payload, 'maximumAcceptableLoss'),
    dataUsed: stringArray(payload.dataUsed),
    newsReviewed: stringArray(payload.newsReviewed),
    expectedOutcome: optionalString(payload, 'expectedOutcome'),
    alternativeOption: optionalString(payload, 'alternativeOption'),
    finalRecommendation: blocked
      ? 'Do not execute.'
      : stringField(payload, 'finalRecommendation', 'Monitor only.'),
    status: blocked ? 'blocked' : planStatus(payload.status),
    userApprovalStatus: 'pending',
    executionStatus: blocked ? 'blocked' : 'not_executable',
    actualOutcome: optionalString(payload, 'actualOutcome'),
    profitLoss: optionalNumber(payload, 'profitLoss'),
    strategyUsed: optionalString(payload, 'strategyUsed'),
    agentNotes: optionalString(payload, 'agentNotes'),
  }
}

export function createVirtualAccount(
  payload: AddPayload,
  base?: { id: string; source: string; createdAt: string; updatedAt: string },
): VirtualAccount {
  const createdAt = nowIso()
  const recordBase = base ?? {
    id: randomUUID(),
    source: 'manual',
    createdAt,
    updatedAt: createdAt,
  }
  return {
    ...recordBase,
    platform: stringField(payload, 'platform', 'manual'),
    currency: stringField(payload, 'currency', 'LKR'),
    balance: numberField(payload, 'balance', 10000),
    initialBalance: numberField(
      payload,
      'initialBalance',
      numberField(payload, 'balance', 10000),
    ),
    lockedAmount: optionalNumber(payload, 'lockedAmount') ?? 0,
    totalTrades: numberField(payload, 'totalTrades', 0),
    winningTrades: numberField(payload, 'winningTrades', 0),
    totalPnl: optionalNumber(payload, 'totalPnl') ?? 0,
    totalCost: numberField(payload, 'totalCost', 0),
    totalQuantity: numberField(payload, 'totalQuantity', 0),
    totalPnlPercentage: numberField(payload, 'totalPnlPercentage', 0),
  }
}

export function createTradeOrder(
  payload: AddPayload,
  base?: { id: string; source: string; createdAt: string; updatedAt: string },
): TradeOrder {
  const createdAt = nowIso()
  const recordBase = base ?? {
    id: randomUUID(),
    source: 'manual',
    createdAt,
    updatedAt: createdAt,
  }
  return {
    ...recordBase,
    planId: stringField(payload, 'planId', ''),
    platform: stringField(payload, 'platform', 'manual'),
    symbol: stringField(payload, 'symbol', 'UNSPECIFIED'),
    side: stringField(payload, 'side', 'buy') as 'buy' | 'sell',
    quantity: numberField(payload, 'quantity', 0),
    orderType: stringField(payload, 'orderType', 'market') as
      | 'market'
      | 'limit'
      | 'stop_limit',
    ...(optionalNumber(payload, 'price') !== undefined
      ? { price: optionalNumber(payload, 'price') }
      : {}),
    status: 'pending',
    ...(optionalString(payload, 'brokerOrderId') !== undefined
      ? { brokerOrderId: optionalString(payload, 'brokerOrderId') }
      : {}),
  }
}

export function createTradeExecution(
  payload: AddPayload,
  base?: { id: string; source: string; createdAt: string; updatedAt: string },
): TradeExecution {
  const createdAt = nowIso()
  const recordBase = base ?? {
    id: randomUUID(),
    source: 'manual',
    createdAt,
    updatedAt: createdAt,
  }
  return {
    ...recordBase,
    orderId: stringField(payload, 'orderId', ''),
    planId: stringField(payload, 'planId', ''),
    platform: stringField(payload, 'platform', 'manual'),
    symbol: stringField(payload, 'symbol', 'UNSPECIFIED'),
    side: stringField(payload, 'side', 'buy') as 'buy' | 'sell',
    quantity: numberField(payload, 'quantity', 0),
    price: numberField(payload, 'price', 0),
    fees: numberField(payload, 'fees', 0),
    executedAt: stringField(payload, 'executedAt', nowIso()),
  }
}

export function createTradingSignal(
  payload: AddPayload,
  base?: { id: string; source: string; createdAt: string; updatedAt: string },
): TradingSignal {
  const createdAt = nowIso()
  const recordBase = base ?? {
    id: randomUUID(),
    source: 'manual',
    createdAt,
    updatedAt: createdAt,
  }
  return {
    ...recordBase,
    symbol: stringField(payload, 'symbol', 'UNSPECIFIED'),
    action: stringField(payload, 'action', 'hold') as 'buy' | 'sell' | 'hold',
    strength: numberField(payload, 'strength', 50),
    confidence: numberField(payload, 'confidence', 50),
    priceTarget: numberField(payload, 'priceTarget', 0),
    stopLoss: numberField(payload, 'stopLoss', 0),
    reasoning: stringField(
      payload,
      'reasoning',
      'No specific reasoning provided',
    ),
    indicators: payload.indicators
      ? (payload.indicators as Record<string, number>)
      : {},
    timestamp: stringField(payload, 'timestamp', nowIso()),
  }
}

/**
 * PF-113: a row's reconciliation `status` gates whether it counts toward
 * *aggregate* money figures (net worth, savings rate, budget-vs-actual,
 * monthly rollups). A `pending` transaction is shown in the raw tables /
 * `getUnifiedTransactions()` but must not move the totals until it clears.
 * `status` is optional and predates the feature, so a missing value counts
 * as `cleared` (unchanged behaviour for existing data).
 */
const TOTALS_STATUSES: ReadonlyArray<'pending' | 'cleared' | 'reconciled'> = [
  'cleared',
  'reconciled',
]
function includeInTotals(row: {
  status?: 'pending' | 'cleared' | 'reconciled'
}): boolean {
  return TOTALS_STATUSES.includes(row.status ?? 'cleared')
}

/**
 * Latest `from`->`to` rate in THIS db's `exchange_rates` (most recent by date).
 * Pure over `db` — never reaches through `ensureFinanceStore`/`getExchangeRate`,
 * which re-read the backing store and would disagree with the `db` passed here.
 */
function latestRateFromDb(
  db: FinanceDatabase,
  from: string,
  to: string,
): number | undefined {
  const rows = (
    db.exchange_rates as Array<{
      base?: unknown
      target?: unknown
      rate?: unknown
      date?: unknown
    }>
  )
    .filter(
      (r) => r.base === from && r.target === to && typeof r.rate === 'number',
    )
    .sort(
      (a, b) =>
        new Date(String(b.date ?? 0)).getTime() -
        new Date(String(a.date ?? 0)).getTime(),
    )
  return rows.length ? (rows[0].rate as number) : undefined
}

/**
 * Convert `amount`, denominated in `currency`, to LKR via `latestRateFromDb`
 * (direct `currency->LKR`, else `1/inverse`). Returns `amount` unchanged when no
 * rate is on file — same fallback as `financeSummary`'s `toLkr`.
 */
function amountToLkr(
  db: FinanceDatabase,
  amount: number,
  currency: string | undefined,
): number {
  if (!currency || currency === 'LKR') return amount
  const direct = latestRateFromDb(db, currency, 'LKR')
  if (direct !== undefined) return amount * direct
  const inverse = latestRateFromDb(db, 'LKR', currency)
  if (inverse) return amount / inverse
  return amount
}

/**
 * Convert `amount` from `from` currency to `to` currency via this db's
 * `exchange_rates` (direct rate, else 1/inverse). Returns null when neither
 * leg is on file — the caller decides whether to skip or fall back.
 */
function convertBetweenCurrencies(
  db: FinanceDatabase,
  amount: number,
  from: string,
  to: string,
): number | null {
  if (!from || !to || from === to) return amount
  const direct = latestRateFromDb(db, from, to)
  if (direct !== undefined) return amount * direct
  const inverse = latestRateFromDb(db, to, from)
  if (inverse) return amount / inverse
  return null
}

/**
 * A signed movement against one account, in that record's own currency.
 * A transfer is fed in as TWO legs: `{kind: 'expense'}` on the source
 * account and `{kind: 'income'}` on the destination.
 */
export type ReconcileTransaction = {
  accountId?: string
  currency: string
  amount: number
  kind: 'income' | 'expense'
}

/**
 * AI-600: what an account's own tagged transactions say its balance should
 * be, starting from `openingBalance`. Returns null when there's no
 * `openingBalance` (nothing to reconcile against). Lives here rather than in
 * `screens/…/utils.ts` so `financeSummary` can use it and so cross-currency
 * legs convert through the FX table. A record in a currency other than the
 * account's is converted via `exchange_rates`; it is skipped only when no
 * rate is on file.
 */
export function computeAccountLedgerBalance(
  db: FinanceDatabase,
  account: { id: string; currency: string; openingBalance?: number },
  records: Array<ReconcileTransaction>,
): number | null {
  if (account.openingBalance === undefined) return null
  let balance = account.openingBalance
  for (const record of records) {
    if (record.accountId !== account.id) continue
    let value = record.amount
    if (record.currency !== account.currency) {
      const converted = convertBetweenCurrencies(
        db,
        record.amount,
        record.currency,
        account.currency,
      )
      if (converted === null) continue // no rate on file — exclude, as before
      value = converted
    }
    balance += record.kind === 'income' ? value : -value
  }
  return balance
}

/** Every income, expense and transfer in `db` as reconcile legs. */
export function ledgerTransactionsForDb(
  db: FinanceDatabase,
): Array<ReconcileTransaction> {
  const legs: Array<ReconcileTransaction> = []
  for (const inc of db.income_records) {
    legs.push({
      accountId: inc.accountId,
      currency: inc.originalCurrency,
      amount: inc.originalAmount,
      kind: 'income',
    })
  }
  for (const exp of db.expense_records) {
    legs.push({
      accountId: exp.accountId,
      currency: exp.currency,
      amount: exp.amount,
      kind: 'expense',
    })
  }
  for (const t of db.transfers) {
    if (t.fromAccountId) {
      legs.push({
        accountId: t.fromAccountId,
        currency: t.currency,
        amount: t.amount,
        kind: 'expense',
      })
    }
    if (t.toAccountId) {
      legs.push({
        accountId: t.toAccountId,
        currency: t.currency,
        amount: t.amount,
        kind: 'income',
      })
    }
  }
  return legs
}

/**
 * The balance to use for `account` in aggregates: the ledger-derived figure
 * when the account opted in (`deriveBalanceFromLedger`) AND it's computable,
 * otherwise the manually-entered `balance`. Fails closed — never 0, never
 * drops the account.
 */
export function effectiveAccountBalance(
  db: FinanceDatabase,
  account: FinanceAccount,
  legs: Array<ReconcileTransaction> = ledgerTransactionsForDb(db),
): number {
  if (!account.deriveBalanceFromLedger) return account.balance
  const derived = computeAccountLedgerBalance(db, account, legs)
  return derived ?? account.balance
}

export function financeSummary(db: FinanceDatabase) {
  // PF-201: the reporting currency. Stored amounts stay LKR-denominated
  // (`convertedLkrAmount`, `wealthGoalTargetLkr`, …); this only changes what
  // the aggregate `*Lkr` figures below are *expressed* in. Default 'LKR' keeps
  // every existing install byte-identical.
  const base = db.settings.baseCurrency || 'LKR'

  // Latest currency->currency rate from THIS db's `exchange_rates` (direct, or
  // 1/inverse). Kept pure over `db` — see PF-206. `fxUnconverted` collects
  // currencies with no rate on file; their raw amounts are still counted.
  const fxUnconverted = new Set<string>()
  const latestRate = (from: string, to: string): number | undefined =>
    latestRateFromDb(db, from, to)
  /** Convert an amount in `currency` to LKR. */
  const toLkr = (amount: number, currency: CurrencyCode | undefined): number => {
    if (!currency || currency === 'LKR') return amount
    const direct = latestRate(currency, 'LKR')
    if (direct !== undefined) return amount * direct
    const inverse = latestRate('LKR', currency)
    if (inverse) return amount / inverse
    fxUnconverted.add(currency)
    return amount
  }
  /** Convert an LKR amount to the configured reporting currency. */
  const toBase = (lkr: number): number => {
    if (base === 'LKR') return lkr
    const direct = latestRate('LKR', base)
    if (direct !== undefined) return lkr * direct
    const inverse = latestRate(base, 'LKR')
    if (inverse) return lkr / inverse
    fxUnconverted.add(base)
    return lkr
  }

  const totalIncomeBase = db.income_records
    .filter(includeInTotals)
    .reduce((sum, row) => sum + row.convertedLkrAmount, 0)
  const totalExpensesBase = db.expense_records
    .filter(includeInTotals)
    .reduce((sum, row) => sum + row.convertedLkrAmount, 0)
  const netSavingsBase = totalIncomeBase - totalExpensesBase
  const savingsRate =
    totalIncomeBase > 0 ? (netSavingsBase / totalIncomeBase) * 100 : 0
  // Accounts that opted into `deriveBalanceFromLedger` contribute their
  // ledger-derived balance (openingBalance + tagged movements) instead of the
  // manual `balance`; the rest are unchanged. `legs` built once.
  const reconcileLegs = ledgerTransactionsForDb(db)
  const cashBalanceBase = db.finance_accounts.reduce(
    (sum, row) =>
      sum +
      toLkr(effectiveAccountBalance(db, row, reconcileLegs), row.currency),
    0,
  )
  // PF-201: budget categories may be non-LKR (getBudgetVsActual converts them
  // to LKR for the comparison). Run them through `toLkr` here for its side
  // effect only — a missing rate then lands in `fxUnconverted`, raising the
  // "Missing exchange rate" alert the same way an un-priced holding does.
  for (const b of db.budget_categories) toLkr(b.budgetAmount, b.currency)
  const taxReserveBase = db.savings_goals
    .filter((goal) => goal.name.toLowerCase().includes('tax'))
    .reduce((sum, goal) => sum + goal.currentAmount, 0)
  // 'loan'-type accounts no longer contribute here — Phase 40 gives loans a
  // dedicated entity (principal/rate/term, remaining balance tracked
  // separately from the original amount); 'card' stays account-based since
  // credit cards have no term/rate model.
  const debtBase =
    db.finance_accounts
      .filter((account) => account.type === 'card')
      .reduce(
        (sum, row) =>
          sum + Math.abs(effectiveAccountBalance(db, row, reconcileLegs)),
        0,
      ) +
    db.loans
      .filter((loan) => loan.status === 'active')
      .reduce((sum, loan) => sum + loan.currentBalance, 0)
  // PF-206: holdings / FDs / properties may be denominated in a non-LKR
  // currency — `toLkr` (hoisted above) converts each via this db's
  // `exchange_rates`. Never blocked on a live CSE price fetch succeeding —
  // falls back to the buy price when no cached/manual current price is
  // available yet.
  const stockHoldingsValueBase = db.stock_holdings.reduce(
    (sum, holding) =>
      sum +
      toLkr(
        (holding.lastKnownPrice ?? holding.buyPrice) * holding.quantity,
        holding.currency,
      ),
    0,
  )
  const fixedDepositsValueBase = db.fixed_deposits
    .filter((fd) => fd.status !== 'withdrawn')
    .reduce((sum, fd) => sum + toLkr(fd.principal, fd.currency), 0)
  const propertyValueBase = db.properties.reduce(
    (sum, p) => sum + toLkr(p.currentValue, p.currency),
    0,
  )
  const unrealizedStockPnlBase = db.stock_holdings.reduce(
    (sum, holding) =>
      sum +
      toLkr(
        ((holding.lastKnownPrice ?? holding.buyPrice) - holding.buyPrice) *
          holding.quantity,
        holding.currency,
      ),
    0,
  )
  const totalStockCostBasisLkr = db.stock_holdings.reduce(
    (sum, holding) =>
      sum + toLkr(holding.buyPrice * holding.quantity, holding.currency),
    0,
  )
  const unrealizedStockPnlPct =
    totalStockCostBasisLkr > 0
      ? (unrealizedStockPnlBase / totalStockCostBasisLkr) * 100
      : 0
  const netWorthBase =
    cashBalanceBase +
    db.savings_goals.reduce((sum, goal) => sum + goal.currentAmount, 0) +
    stockHoldingsValueBase +
    fixedDepositsValueBase +
    propertyValueBase -
    debtBase
  const openPlans = db.trading_plans.filter(
    (plan) =>
      !['cancelled', 'expired', 'failed', 'blocked'].includes(plan.status),
  ).length
  const blockedPlans = db.trading_plans.filter(
    (plan) => plan.status === 'blocked' || plan.decision === 'BLOCKED',
  ).length
  return {
    // PF-201: every `*Lkr` figure is expressed in `baseCurrency` (default
    // 'LKR', in which case `toBase` is the identity). Percentages
    // (savingsRate, unrealizedStockPnlPct) are currency-free — not converted.
    baseCurrency: base,
    totalIncomeBase: toBase(totalIncomeBase),
    totalExpensesBase: toBase(totalExpensesBase),
    netSavingsBase: toBase(netSavingsBase),
    savingsRate,
    cashBalanceBase: toBase(cashBalanceBase),
    taxReserveBase: toBase(taxReserveBase),
    debtBase: toBase(debtBase),
    netWorthBase: toBase(netWorthBase),
    stockHoldingsValueBase: toBase(stockHoldingsValueBase),
    fixedDepositsValueBase: toBase(fixedDepositsValueBase),
    propertyValueBase: toBase(propertyValueBase),
    unrealizedStockPnlBase: toBase(unrealizedStockPnlBase),
    unrealizedStockPnlPct,
    /** Currencies (an asset's own, or `baseCurrency` itself) with no exchange
     * rate on file — the affected amounts are still counted, unconverted. */
    fxUnconverted: [...fxUnconverted].sort(),
    accountCount: db.finance_accounts.length,
    goalCount: db.savings_goals.length,
    taxRecordCount: db.tax_records.length,
    openPlans,
    blockedPlans,
    tradingMode: db.settings.tradingMode,
    liveTradingEnabled: db.settings.liveTradingEnabled,
    emergencyKillSwitch: db.settings.emergencyKillSwitch,
    primaryTradingProvider: db.settings.primaryTradingProvider,
    executionAccount: db.settings.executionAccount,
    paperShadowEnabled: db.settings.paperShadowEnabled,
    livePerOrderCapUsdt: db.settings.livePerOrderCapUsdt,
    liveBinanceApproved: Boolean(db.settings.liveBinanceApprovedAt),
    ibkrStatus: db.settings.ibkrStatus,
  }
}

/**
 * Compute today's net-worth snapshot (all LKR) and upsert it into
 * `db.net_worth_snapshots` by `date` — at most one row per calendar day, so
 * re-running is idempotent. Mutates and returns `db`; the caller persists.
 */
export function recordNetWorthSnapshot(
  db: FinanceDatabase,
  today: string = nowIso().slice(0, 10),
): { db: FinanceDatabase; snapshot: NetWorthSnapshot } {
  // Pin to LKR — snapshots are stored LKR-denominated like every other figure.
  const lkrDb = { ...db, settings: { ...db.settings, baseCurrency: 'LKR' } }
  const s = financeSummary(lkrDb)
  const investmentsLkr =
    s.stockHoldingsValueBase + s.fixedDepositsValueBase + s.propertyValueBase
  const now = nowIso()
  const existing = db.net_worth_snapshots.find((r) => r.date === today)
  const snapshot: NetWorthSnapshot = {
    id: existing?.id ?? `nws-${today}`,
    date: today,
    netWorthLkr: s.netWorthBase,
    cashLkr: s.cashBalanceBase,
    investmentsLkr,
    debtLkr: s.debtBase,
    source: 'snapshot',
    createdAt: existing?.createdAt ?? now,
    updatedAt: now,
  }
  db.net_worth_snapshots = [
    ...db.net_worth_snapshots.filter((r) => r.date !== today),
    snapshot,
  ].sort((a, b) => (a.date < b.date ? -1 : 1))
  return { db, snapshot }
}

export function financeAlerts(db: FinanceDatabase): Array<{
  level: 'info' | 'warning' | 'critical'
  title: string
  detail: string
}> {
  const summary = financeSummary(db)
  const alerts: Array<{
    level: 'info' | 'warning' | 'critical'
    title: string
    detail: string
  }> = []
  if (
    summary.totalExpensesBase > summary.totalIncomeBase &&
    summary.totalIncomeBase > 0
  ) {
    alerts.push({
      level: 'warning',
      title: 'Expenses exceed income',
      detail: 'Current tracked expenses are higher than tracked income.',
    })
  }
  for (const account of db.finance_accounts) {
    if (account.type !== 'loan' && account.balance < 5_000) {
      alerts.push({
        level: 'warning',
        title: 'Low balance',
        detail: `${account.name} is below LKR 5,000.`,
      })
    }
  }
  for (const plan of db.trading_plans) {
    if (plan.riskLevel === 'blocked' || plan.decision === 'BLOCKED') {
      alerts.push({
        level: 'critical',
        title: 'Trading plan blocked',
        detail: `${plan.platform}:${plan.symbol} failed safety controls.`,
      })
    }
  }
  if (db.settings.emergencyKillSwitch) {
    alerts.push({
      level: 'info',
      title: 'Emergency kill switch active',
      detail: 'Real order execution is disabled.',
    })
  }
  if (summary.fxUnconverted.length > 0) {
    alerts.push({
      level: 'warning',
      title: 'Missing exchange rate',
      detail: `Some assets are held in ${summary.fxUnconverted.join(
        ', ',
      )} with no exchange rate on file — their value is counted at face amount, not converted to LKR. Add a rate to fix the totals.`,
    })
  }

  // Category-level budget alerts (this calendar month). Over budget is
  // critical regardless of timing; "nearly spent" only fires while there is
  // still a meaningful part of the month left, so it doesn't nag on the 30th.
  const now = new Date()
  const daysInMonth = new Date(
    now.getFullYear(),
    now.getMonth() + 1,
    0,
  ).getDate()
  const daysLeft = daysInMonth - now.getDate()
  const lkr = (n: number) => `LKR ${Math.round(n).toLocaleString('en-LK')}`
  for (const row of budgetVsActualSummary(db)) {
    if (row.budget <= 0) continue
    if (row.overBudget) {
      alerts.push({
        level: 'critical',
        title: `Over budget: ${row.category}`,
        detail: `Spent ${lkr(row.actual)} of a ${lkr(row.budget)} budget this month (${Math.round(row.percentUsed)}%).`,
      })
    } else if (row.percentUsed >= 90 && daysLeft >= 3) {
      alerts.push({
        level: 'warning',
        title: `Budget nearly spent: ${row.category}`,
        detail: `${Math.round(row.percentUsed)}% of the ${row.category} budget used with ${daysLeft} days left in the month.`,
      })
    }
  }
  return alerts
}

export function maskSensitive(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(maskSensitive)
  if (!value || typeof value !== 'object') return value
  const result: Record<string, unknown> = {}
  for (const [key, entry] of Object.entries(value)) {
    if (/secret|token|key|password|accountNumber|api/i.test(key)) {
      result[key] = '[masked]'
    } else {
      result[key] = maskSensitive(entry)
    }
  }
  return result
}

function validateTradeSafety(input: {
  decision: TradingDecision
  riskLevel: RiskLevel
  stopLoss: number
  hasExit: boolean
  positionSize: number
}): Array<string> {
  const blockers: Array<string> = []
  if (input.riskLevel === 'blocked') blockers.push('risk is blocked or missing')
  if (
    [
      'BUY_NOW',
      'PLAN_BUY_LATER',
      'SELL_NOW',
      'PLAN_SELL_LATER',
      'REDUCE_POSITION',
    ].includes(input.decision)
  ) {
    if (!Number.isFinite(input.stopLoss)) blockers.push('stop-loss is required')
    if (!input.hasExit)
      blockers.push('take-profit or exit condition is required')
    if (!Number.isFinite(input.positionSize) || input.positionSize <= 0)
      blockers.push('position size is required')
  }
  return blockers
}

function stringField(
  payload: AddPayload,
  key: string,
  fallback: string,
): string {
  const value = payload[key]
  return typeof value === 'string' && value.trim() ? value.trim() : fallback
}

function optionalString(payload: AddPayload, key: string): string | undefined {
  const value = payload[key]
  return typeof value === 'string' && value.trim() ? value.trim() : undefined
}

function numberField(
  payload: AddPayload,
  key: string,
  fallback: number,
): number {
  const value = payload[key]
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (
    typeof value === 'string' &&
    value.trim() &&
    Number.isFinite(Number(value))
  )
    return Number(value)
  return fallback
}

function optionalNumber(payload: AddPayload, key: string): number | undefined {
  const value = numberField(payload, key, Number.NaN)
  return Number.isFinite(value) ? value : undefined
}

/**
 * Parse `payload.splits` (from add/update_record) into `ExpenseSplit[]`, or
 * `undefined` when absent/empty. `null` / `[]` are treated as an explicit
 * "clear the splits" on update.
 */
function parseExpenseSplits(payload: AddPayload): Array<ExpenseSplit> | undefined {
  const raw = payload.splits
  if (!Array.isArray(raw) || raw.length === 0) return undefined
  return raw.map((entry) => {
    const row: AddPayload =
      entry && typeof entry === 'object' ? (entry as AddPayload) : {}
    return {
      category: stringField(row, 'category', 'Other'),
      subcategory: optionalString(row, 'subcategory'),
      amount: numberField(row, 'amount', 0),
      notes: optionalString(row, 'notes'),
    }
  })
}

/** Throws when `splits` don't form a valid split of `amount`. */
function assertValidExpenseSplits(
  splits: Array<ExpenseSplit> | undefined,
  amount: number,
): void {
  if (!splits) return
  if (splits.length < 2) {
    throw new Error('An expense split needs at least two parts')
  }
  const sum = splits.reduce((acc, part) => acc + part.amount, 0)
  if (Math.abs(sum - amount) > 0.01) {
    throw new Error(
      `Split parts add up to ${sum}, which does not match the expense amount ${amount}`,
    )
  }
}

/**
 * Parse `payload.defaultSplits` (Merchant remembered split) into
 * `{category, percent}[]`, or `undefined` when absent/empty (`[]`/`null`
 * clears on update). Percentages must be positive and sum to ~100.
 */
function parseMerchantDefaultSplits(
  payload: AddPayload,
): Array<{ category: string; percent: number }> | undefined {
  const raw = payload.defaultSplits
  if (!Array.isArray(raw) || raw.length === 0) return undefined
  const parts = raw.map((entry) => {
    const row: AddPayload =
      entry && typeof entry === 'object' ? (entry as AddPayload) : {}
    return {
      category: stringField(row, 'category', 'Other'),
      percent: numberField(row, 'percent', 0),
    }
  })
  const sum = parts.reduce((acc, p) => acc + p.percent, 0)
  if (
    parts.length < 2 ||
    parts.some((p) => p.percent <= 0) ||
    Math.abs(sum - 100) > 0.5
  ) {
    throw new Error(
      `Merchant default split percentages must be positive and sum to ~100 (got ${sum})`,
    )
  }
  return parts
}

function booleanField(
  payload: AddPayload,
  key: string,
  fallback: boolean,
): boolean {
  const value = payload[key]
  return typeof value === 'boolean' ? value : fallback
}

function stringArray(value: unknown): Array<string> {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === 'string')
    : []
}

function accountType(value: unknown): FinanceAccount['type'] {
  const allowed: Array<FinanceAccount['type']> = [
    'bank',
    'cash',
    'card',
    'crypto_wallet',
    'broker',
    'foreign_currency',
    'loan',
    'other',
  ]
  return allowed.includes(value as FinanceAccount['type'])
    ? (value as FinanceAccount['type'])
    : 'other'
}

function categoryKind(value: unknown): Category['kind'] {
  const allowed: Array<Category['kind']> = ['income', 'expense', 'both']
  return allowed.includes(value as Category['kind'])
    ? (value as Category['kind'])
    : 'both'
}

function goalStatus(value: unknown): GoalStatus {
  const allowed: Array<GoalStatus> = [
    'active',
    'completed',
    'paused',
    'cancelled',
    'behind_schedule',
    'ahead_of_schedule',
  ]
  return allowed.includes(value as GoalStatus)
    ? (value as GoalStatus)
    : 'active'
}

function goalKindField(value: unknown): 'general' | 'sinking' {
  return value === 'sinking' ? 'sinking' : 'general'
}

function employmentTypeField(value: unknown): IncomeSource['employmentType'] {
  const allowed: Array<IncomeSource['employmentType']> = [
    'full_time',
    'contract',
    'freelance',
    'other',
  ]
  return allowed.includes(value as IncomeSource['employmentType'])
    ? (value as IncomeSource['employmentType'])
    : 'other'
}

function interestPayoutField(value: unknown): FixedDeposit['interestPayout'] {
  const allowed: Array<FixedDeposit['interestPayout']> = [
    'monthly',
    'quarterly',
    'annually',
    'at_maturity',
  ]
  return allowed.includes(value as FixedDeposit['interestPayout'])
    ? (value as FixedDeposit['interestPayout'])
    : 'at_maturity'
}

function fixedDepositStatusField(value: unknown): FixedDeposit['status'] {
  const allowed: Array<FixedDeposit['status']> = [
    'active',
    'matured',
    'withdrawn',
  ]
  return allowed.includes(value as FixedDeposit['status'])
    ? (value as FixedDeposit['status'])
    : 'active'
}

function loanStatusField(value: unknown): Loan['status'] {
  const allowed: Array<Loan['status']> = ['active', 'paid_off', 'defaulted']
  return allowed.includes(value as Loan['status'])
    ? (value as Loan['status'])
    : 'active'
}

function propertyTypeField(value: unknown): Property['propertyType'] {
  const allowed: Array<Property['propertyType']> = [
    'residential',
    'land',
    'commercial',
    'other',
  ]
  return allowed.includes(value as Property['propertyType'])
    ? (value as Property['propertyType'])
    : 'residential'
}

function reconciliationStatus(
  value: unknown,
): 'pending' | 'cleared' | 'reconciled' {
  const allowed: Array<'pending' | 'cleared' | 'reconciled'> = [
    'pending',
    'cleared',
    'reconciled',
  ]
  return allowed.includes(value as 'pending' | 'cleared' | 'reconciled')
    ? (value as 'pending' | 'cleared' | 'reconciled')
    : 'cleared'
}

function planStatus(value: unknown): PlanStatus {
  const allowed: Array<PlanStatus> = [
    'draft',
    'waiting_for_condition',
    'ready_for_approval',
    'approved',
    'executed',
    'cancelled',
    'expired',
    'failed',
    'blocked',
  ]
  return allowed.includes(value as PlanStatus) ? (value as PlanStatus) : 'draft'
}

function riskLevelField(
  payload: AddPayload,
  key: string,
  fallback: RiskLevel,
): RiskLevel {
  const value = payload[key]
  const allowed: Array<RiskLevel> = [
    'low_risk',
    'medium_risk',
    'high_risk',
    'blocked',
  ]
  return allowed.includes(value as RiskLevel) ? (value as RiskLevel) : fallback
}

function decisionField(
  payload: AddPayload,
  key: string,
  fallback: TradingDecision,
): TradingDecision {
  const value = payload[key]
  return DECISIONS.includes(value as TradingDecision)
    ? (value as TradingDecision)
    : fallback
}

function parseDate(dateString: string): { year: number; month: number } | null {
  const match = dateString.match(/^(\d{4})-(\d{2})-\d{2}$/)
  if (!match) return null
  return {
    year: parseInt(match[1], 10),
    month: parseInt(match[2], 10),
  }
}

/**
 * PF review item 2: the category-level LKR breakdown of one expense. With
 * `splits`, each part gets its share of `convertedLkrAmount` pro-rata to its
 * `amount` (so an FX-converted record total is preserved exactly). Without
 * splits, the whole record lands under its own `category`. Category-level
 * aggregations (budget-vs-actual, trend category totals, the analyst's
 * category breakdown) go through this; record-level totals never do.
 */
export function expenseCategoryBreakdown(
  exp: ExpenseRecord,
): Array<{ category: string; subcategory?: string; lkr: number }> {
  if (!exp.splits || exp.splits.length === 0) {
    return [
      {
        category: exp.category || 'Other',
        subcategory: exp.subcategory,
        lkr: exp.convertedLkrAmount,
      },
    ]
  }
  const partsTotal =
    exp.amount || exp.splits.reduce((acc, p) => acc + p.amount, 0) || 1
  return exp.splits.map((part) => ({
    category: part.category || 'Other',
    subcategory: part.subcategory,
    lkr: exp.convertedLkrAmount * (part.amount / partsTotal),
  }))
}

export function getUnifiedTransactions(
  db: FinanceDatabase,
): Array<UnifiedTransaction> {
  const fromIncome: Array<UnifiedTransaction> = db.income_records.map(
    (inc) => ({
      id: inc.id,
      kind: 'income',
      date: inc.dateReceived,
      counterparty: inc.sourceName,
      category: inc.incomeType,
      accountId: inc.accountId,
      currency: inc.originalCurrency,
      amount: inc.originalAmount,
      convertedLkrAmount: inc.convertedLkrAmount,
      notes: inc.notes,
      documentRef: inc.documentRef,
      taxable: inc.taxable,
      incomeSourceId: inc.incomeSourceId,
      tags: inc.tags,
      status: inc.status,
      source: inc.source,
      createdAt: inc.createdAt,
      updatedAt: inc.updatedAt,
    }),
  )

  const fromExpense: Array<UnifiedTransaction> = db.expense_records.map(
    (exp) => ({
      id: exp.id,
      kind: 'expense',
      date: exp.date,
      counterparty: exp.vendor,
      category: exp.category,
      accountId: exp.accountId,
      currency: exp.currency,
      amount: exp.amount,
      convertedLkrAmount: exp.convertedLkrAmount,
      notes: exp.notes,
      documentRef: exp.documentRef,
      recurring: exp.recurring,
      subcategory: exp.subcategory,
      splits: exp.splits,
      tags: exp.tags,
      status: exp.status,
      source: exp.source,
      createdAt: exp.createdAt,
      updatedAt: exp.updatedAt,
    }),
  )

  const fromTransfer: Array<UnifiedTransaction> = db.transfers.map((t) => ({
    id: t.id,
    kind: 'transfer',
    date: t.date,
    counterparty: [t.fromAccountId, t.toAccountId].filter(Boolean).join(' → '),
    category: 'Transfer',
    accountId: t.fromAccountId,
    fromAccountId: t.fromAccountId,
    toAccountId: t.toAccountId,
    currency: t.currency,
    amount: t.amount,
    convertedLkrAmount: t.convertedLkrAmount,
    notes: t.notes,
    source: t.source,
    createdAt: t.createdAt,
    updatedAt: t.updatedAt,
  }))

  return [...fromIncome, ...fromExpense, ...fromTransfer].sort((a, b) => {
    if (a.date !== b.date) return a.date < b.date ? 1 : -1
    return a.createdAt < b.createdAt ? 1 : -1
  })
}

export function getMonthlySummary(
  db: FinanceDatabase,
  year?: number,
  month?: number,
): Array<{
  year: number
  month: number
  income: number
  expense: number
  savings: number
}> {
  const incomeMap = new Map<string, number>()
  const expenseMap = new Map<string, number>()

  for (const inc of db.income_records) {
    if (!includeInTotals(inc)) continue
    const dateInfo = parseDate(inc.dateReceived)
    if (!dateInfo) continue
    if (year !== undefined && dateInfo.year !== year) continue
    if (month !== undefined && dateInfo.month !== month) continue
    const key = `${dateInfo.year}-${dateInfo.month}`
    const current = incomeMap.get(key) ?? 0
    incomeMap.set(key, current + inc.convertedLkrAmount)
  }

  for (const exp of db.expense_records) {
    if (!includeInTotals(exp)) continue
    const dateInfo = parseDate(exp.date)
    if (!dateInfo) continue
    if (year !== undefined && dateInfo.year !== year) continue
    if (month !== undefined && dateInfo.month !== month) continue
    const key = `${dateInfo.year}-${dateInfo.month}`
    const current = expenseMap.get(key) ?? 0
    expenseMap.set(key, current + exp.convertedLkrAmount)
  }

  const result: Array<{
    year: number
    month: number
    income: number
    expense: number
    savings: number
  }> = []
  const allKeys = new Set([...incomeMap.keys(), ...expenseMap.keys()])
  for (const key of allKeys) {
    const [y, m] = key.split('-').map(Number)
    const income = incomeMap.get(key) ?? 0
    const expense = expenseMap.get(key) ?? 0
    result.push({
      year: y,
      month: m,
      income,
      expense,
      savings: income - expense,
    })
  }

  // Sort by year, then month
  result.sort((a, b) => {
    if (a.year !== b.year) return a.year - b.year
    return a.month - b.month
  })

  return result
}

// ---------------------------------------------------------------------------
// PF review item 7: dashboard derivations that used to be recomputed in the
// browser (finance-trends-card, recurring-bills-insight, upcoming-money) and
// re-implemented a THIRD time in Python in personal-finance-digest.sh. Now
// computed once here and carried on the payload. All amounts are raw LKR; the
// payload applies the PF-201 `fxToBase` scaling for display.
// ---------------------------------------------------------------------------

/** Last `monthsBack` calendar months of income/expense/net plus this month's
 *  top expense categories. Mirrors the old client `buildTrendData` /
 *  `buildCategoryData` (no pending-status filter — matches prior UI). */
export function getFinanceTrends(
  db: FinanceDatabase,
  monthsBack = 6,
): {
  series: Array<{
    month: string
    income: number
    expense: number
    net: number
  }>
  categoriesThisMonth: Array<{ category: string; amount: number }>
} {
  const now = new Date()
  const months: Array<string> = []
  for (let i = monthsBack - 1; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1)
    months.push(
      `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`,
    )
  }
  const incomeByMonth = new Map<string, number>()
  const expenseByMonth = new Map<string, number>()
  for (const row of db.income_records) {
    const m = String(row.dateReceived).slice(0, 7)
    incomeByMonth.set(m, (incomeByMonth.get(m) ?? 0) + row.convertedLkrAmount)
  }
  for (const row of db.expense_records) {
    const m = String(row.date).slice(0, 7)
    expenseByMonth.set(m, (expenseByMonth.get(m) ?? 0) + row.convertedLkrAmount)
  }
  const series = months.map((month) => {
    const income = incomeByMonth.get(month) ?? 0
    const expense = expenseByMonth.get(month) ?? 0
    return { month, income, expense, net: income - expense }
  })

  const currentMonth = months[months.length - 1]
  const catTotals = new Map<string, number>()
  for (const row of db.expense_records) {
    if (String(row.date).slice(0, 7) !== currentMonth) continue
    for (const part of expenseCategoryBreakdown(row)) {
      catTotals.set(
        part.category,
        (catTotals.get(part.category) ?? 0) + part.lkr,
      )
    }
  }
  const categoriesThisMonth = [...catTotals.entries()]
    .map(([category, amount]) => ({ category, amount }))
    .sort((a, b) => b.amount - a.amount)
    .slice(0, 8)

  return { series, categoriesThisMonth }
}

/** Vendors seen with a similar amount (±20%) in 2+ of the last `monthsBack`
 *  distinct months — the shape of a recurring bill. Port of the old client
 *  `detectRecurringVendors`. */
export interface RecurringBill {
  /** Lower-cased match key (stable identity for the UI list). */
  vendor: string
  /** Original casing of the vendor as first entered — for display + write-back. */
  displayVendor: string
  category: string
  monthsSeen: number
  averageAmount: number
  /** True when an expense for this vendor already exists in the current
   *  calendar month — the "Log this month" action hides itself then. */
  loggedThisMonth: boolean
  /** Total logged for this vendor in the current calendar month (LKR), or
   *  null when nothing is logged yet. */
  thisMonthAmount: number | null
  /** Fractional change of `thisMonthAmount` vs `averageAmount` (e.g. 0.25 =
   *  25% higher than usual), or null when this month isn't logged. */
  drift: number | null
}

export function getRecurringBills(
  db: FinanceDatabase,
  monthsBack = 3,
): Array<RecurringBill> {
  const now = new Date()
  const cutoff = new Date()
  cutoff.setMonth(cutoff.getMonth() - monthsBack)
  const cutoffMonth = `${cutoff.getFullYear()}-${String(cutoff.getMonth() + 1).padStart(2, '0')}`
  const thisMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`

  const byVendor = new Map<
    string,
    {
      displayVendor: string
      category: string
      entries: Array<{ month: string; amount: number }>
      loggedThisMonth: boolean
      thisMonthAmount: number
    }
  >()
  for (const row of db.expense_records) {
    const month = row.date.slice(0, 7)
    const vendorKey = row.vendor.trim().toLowerCase()
    if (!vendorKey || !month) continue
    const bucket = byVendor.get(vendorKey) ?? {
      displayVendor: row.vendor.trim(),
      category: row.category || 'Other',
      entries: [],
      loggedThisMonth: false,
      thisMonthAmount: 0,
    }
    if (month === thisMonth) {
      bucket.loggedThisMonth = true
      bucket.thisMonthAmount += row.convertedLkrAmount || row.amount || 0
    }
    if (month >= cutoffMonth) {
      const amount = row.convertedLkrAmount || row.amount || 0
      bucket.entries.push({ month, amount })
    }
    byVendor.set(vendorKey, bucket)
  }

  const results: Array<RecurringBill> = []
  for (const [vendor, bucket] of byVendor) {
    const distinctMonths = new Set(bucket.entries.map((e) => e.month))
    if (distinctMonths.size < 2) continue
    const amounts = bucket.entries.map((e) => e.amount)
    const avg = amounts.reduce((s, a) => s + a, 0) / amounts.length
    if (!amounts.every((a) => avg > 0 && Math.abs(a - avg) / avg <= 0.2)) continue
    const thisMonthAmount = bucket.loggedThisMonth
      ? bucket.thisMonthAmount
      : null
    results.push({
      vendor,
      displayVendor: bucket.displayVendor,
      category: bucket.category,
      monthsSeen: distinctMonths.size,
      averageAmount: avg,
      loggedThisMonth: bucket.loggedThisMonth,
      thisMonthAmount,
      drift:
        thisMonthAmount !== null && avg > 0
          ? (thisMonthAmount - avg) / avg
          : null,
    })
  }
  return results.sort((a, b) => b.monthsSeen - a.monthsSeen)
}

/** This-month payday state for a job. Pure. The client keeps an identical copy
 *  in `payday-status.ts` (with its own test) for the per-row badge; this one
 *  feeds `getUpcomingMoney` + the payload so the digest cron stops
 *  re-implementing it in Python. */
function paydayStatusFor(
  job: Record<string, unknown>,
  incomeRecords: Array<Record<string, unknown>>,
  today: Date,
):
  | { state: 'not_tracked' }
  | { state: 'paid'; lastPaidDate: string }
  | { state: 'due_soon'; daysUntil: number }
  | { state: 'overdue'; daysOverdue: number } {
  const status = (job.status as string) || 'active'
  const monthly = job.monthlyIncomeAmount
  const paydayDay = job.expectedPaydayDayOfMonth
  if (
    status !== 'active' ||
    typeof monthly !== 'number' ||
    typeof paydayDay !== 'number'
  ) {
    return { state: 'not_tracked' }
  }
  const jobId = (job.id as string) || ''
  const employer = String(job.employerName ?? '').trim().toLowerCase()
  const now = new Date(today.getFullYear(), today.getMonth(), today.getDate())
  const monthKey = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`
  const matches = incomeRecords.filter((r) => {
    if (String(r.dateReceived ?? '').slice(0, 7) !== monthKey) return false
    const linked = String(r.incomeSourceId ?? '')
    if (linked) return linked === jobId
    return String(r.sourceName ?? '').trim().toLowerCase() === employer
  })
  if (matches.length > 0) {
    const lastPaidDate = matches
      .map((r) => String(r.dateReceived ?? ''))
      .sort()
      .at(-1) as string
    return { state: 'paid', lastPaidDate }
  }
  const lastDay = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate()
  const payday = new Date(
    now.getFullYear(),
    now.getMonth(),
    Math.min(paydayDay, lastDay),
  )
  const daysDiff = Math.round(
    (payday.getTime() - now.getTime()) / (24 * 60 * 60 * 1000),
  )
  if (daysDiff < -3) return { state: 'overdue', daysOverdue: -daysDiff }
  return { state: 'due_soon', daysUntil: daysDiff }
}

/** Forward-looking money events (paydays due/overdue, contract expiries, FD
 *  maturities) as structured data — the UI and the digest each render their
 *  own labels. Port of the data half of the old client `upcoming-money`. */
export function getUpcomingMoney(
  db: FinanceDatabase,
  today: Date = new Date(),
): {
  paydays: Array<{
    name: string
    state: 'due_soon' | 'overdue'
    days: number
  }>
  contracts: Array<{ name: string; days: number }>
  fdMaturities: Array<{ name: string; days: number }>
  scheduled: Array<{
    id: string
    dueDate: string
    kind: 'income' | 'expense'
    counterparty: string
    amount: number
    days: number
  }>
} {
  const dayMs = 24 * 60 * 60 * 1000
  const paydays: Array<{
    name: string
    state: 'due_soon' | 'overdue'
    days: number
  }> = []
  const contracts: Array<{ name: string; days: number }> = []
  for (const job of db.income_sources as Array<Record<string, unknown>>) {
    const name = String(job.employerName ?? '') || 'Income source'
    const s = paydayStatusFor(job, db.income_records, today)
    if (s.state === 'overdue')
      paydays.push({ name, state: 'overdue', days: s.daysOverdue })
    else if (s.state === 'due_soon' && s.daysUntil <= 3)
      paydays.push({ name, state: 'due_soon', days: s.daysUntil })

    if (job.employmentType === 'contract' && job.status === 'active') {
      const end = Date.parse(String(job.contractEndDate ?? ''))
      if (Number.isFinite(end)) {
        const days = Math.ceil((end - today.getTime()) / dayMs)
        if (days <= 30) contracts.push({ name, days })
      }
    }
  }

  const fdMaturities: Array<{ name: string; days: number }> = []
  for (const fd of db.fixed_deposits) {
    if (fd.status !== 'active') continue
    const maturity = Date.parse(fd.maturityDate)
    if (!Number.isFinite(maturity)) continue
    const days = Math.ceil((maturity - today.getTime()) / dayMs)
    if (days >= -7 && days <= 30) {
      fdMaturities.push({ name: fd.bankName || 'Fixed deposit', days })
    }
  }

  // Pending scheduled transactions from ~2 weeks overdue to ~45 days out.
  const startOfToday = new Date(
    today.getFullYear(),
    today.getMonth(),
    today.getDate(),
  ).getTime()
  const scheduled = db.scheduled_transactions
    .filter((s) => s.status === 'pending')
    .map((s) => ({
      id: s.id,
      dueDate: s.dueDate,
      kind: s.kind,
      counterparty: s.counterparty,
      amount: s.amount,
      days: Math.round((Date.parse(s.dueDate) - startOfToday) / dayMs),
    }))
    .filter((s) => Number.isFinite(s.days) && s.days >= -14 && s.days <= 45)
    .sort((a, b) => a.days - b.days)

  return { paydays, contracts, fdMaturities, scheduled }
}

/** Non-LKR exposure across active jobs, holdings and FDs — grouped by
 *  currency, never summed across (no single-figure conversion). Port of the
 *  old screen-level `currencyExposure`. */
export type CurrencyExposureSource = 'jobs' | 'holdings' | 'fixed_deposits'

export interface CurrencyExposure {
  currency: string
  amount: number
  /** What drives this currency's exposure, so the UI can label it. */
  breakdown: Array<{
    source: CurrencyExposureSource
    label: string
    amount: number
    count: number
  }>
}

export function getCurrencyExposure(db: FinanceDatabase): Array<CurrencyExposure> {
  // per currency → per source: { amount, count }
  const byCurrency = new Map<
    string,
    Map<CurrencyExposureSource, { amount: number; count: number }>
  >()
  const add = (
    currency: string,
    source: CurrencyExposureSource,
    amount: number,
  ) => {
    if (!(amount > 0)) return
    const cur = byCurrency.get(currency) ?? new Map()
    const entry = cur.get(source) ?? { amount: 0, count: 0 }
    entry.amount += amount
    entry.count += 1
    cur.set(source, entry)
    byCurrency.set(currency, cur)
  }

  for (const job of db.income_sources as Array<Record<string, unknown>>) {
    if (job.status !== 'active') continue
    const amount = job.monthlyIncomeAmount
    if (typeof amount === 'number')
      add((job.currency as string) || 'LKR', 'jobs', amount)
  }
  for (const h of db.stock_holdings) {
    const qty = typeof h.quantity === 'number' ? h.quantity : 0
    const price =
      (typeof h.lastKnownPrice === 'number' ? h.lastKnownPrice : undefined) ??
      (typeof h.buyPrice === 'number' ? h.buyPrice : 0)
    add(h.currency || 'LKR', 'holdings', qty * price)
  }
  for (const fd of db.fixed_deposits) {
    if (fd.status === 'withdrawn') continue
    if (typeof fd.principal === 'number')
      add(fd.currency || 'LKR', 'fixed_deposits', fd.principal)
  }

  const sourceLabel: Record<CurrencyExposureSource, string> = {
    jobs: 'active job',
    holdings: 'holding',
    fixed_deposits: 'fixed deposit',
  }

  return [...byCurrency.entries()]
    .map(([currency, sources]) => {
      const breakdown = [...sources.entries()]
        .map(([source, { amount, count }]) => ({
          source,
          label: `${count} ${sourceLabel[source]}${count === 1 ? '' : 's'}`,
          amount,
          count,
        }))
        .sort((a, b) => b.amount - a.amount)
      const amount = breakdown.reduce((sum, b) => sum + b.amount, 0)
      return { currency, amount, breakdown }
    })
    .filter((e) => e.amount > 0)
    .sort((a, b) => b.amount - a.amount)
}

/**
 * Multi-currency FX gain/loss decomposition for stock holdings — closes the
 * gap that `unrealizedStockPnlBase` conflates asset price movement and
 * currency movement into one number (it converts both cost and current
 * value at *today's* rate, per PF-206's toLkr). This splits a holding's
 * total return in LKR into the part attributable to the asset's own price
 * change (assetGainLkr) and the part attributable purely to the
 * currency/LKR exchange rate moving between buyDate and now (fxGainLkr):
 *
 *   totalReturnLkr = valueAtCurrentFx - costAtBuyFx
 *   assetGainLkr   = (valueNative - costNative) converted at *today's* rate
 *   fxGainLkr      = totalReturnLkr - assetGainLkr
 *                  = costNative * (rateNow - rateAtBuy)
 *
 * A holding is excluded (insufficientHistory: true, zeroed fields) when
 * there's no exchange rate on file for its buyDate — convertCurrency()
 * only walks direct/pivot/inverse *known* rates, it never estimates.
 */
export type FxGainLossEntry = {
  id: string
  symbol: string
  currency: CurrencyCode
  quantity: number
  assetGainLkr: number
  fxGainLkr: number
  totalReturnLkr: number
  insufficientHistory: boolean
}

/**
 * Same lookup logic as getExchangeRate(), but scoped to a given `db`
 * instead of calling ensureFinanceStore() itself. getFxGainLoss (and
 * getCurrencyExposure alongside it) is meant to operate purely on its `db`
 * argument — convertCurrency()/getExchangeRate() always re-read the real
 * global store regardless of what `db` is passed around them, which is
 * fine in production (same underlying data) but silently breaks any test
 * that builds its own in-memory `db` without also writing it to the store.
 */
function localExchangeRate(
  db: FinanceDatabase,
  base: string,
  target: string,
  date?: string,
): number | undefined {
  let relevant = (
    db.exchange_rates as Array<{
      base?: unknown
      target?: unknown
      rate?: unknown
      date?: unknown
    }>
  ).filter(
    (r) => r.base === base && r.target === target && typeof r.rate === 'number',
  )
  if (date !== undefined) {
    const targetDate = new Date(date).getTime()
    relevant = relevant.filter(
      (r) => new Date((r.date as string) || 0).getTime() <= targetDate,
    )
  }
  relevant = relevant.sort(
    (a, b) =>
      new Date((b.date as string) || 0).getTime() -
      new Date((a.date as string) || 0).getTime(),
  )
  return relevant.length > 0 ? (relevant[0].rate as number) : undefined
}

function localConvertToLkr(
  db: FinanceDatabase,
  amount: number,
  currency: string,
  date?: string,
): number | undefined {
  if (currency === 'LKR') return amount
  const direct = localExchangeRate(db, currency, 'LKR', date)
  if (direct !== undefined) return amount * direct
  const inverse = localExchangeRate(db, 'LKR', currency, date)
  if (inverse !== undefined) return amount / inverse
  return undefined
}

export function getFxGainLoss(db: FinanceDatabase): {
  entries: Array<FxGainLossEntry>
  totalAssetGainLkr: number
  totalFxGainLkr: number
  totalReturnLkr: number
  excludedCount: number
} {
  let totalAssetGainLkr = 0
  let totalFxGainLkr = 0
  let totalReturnLkr = 0
  let excludedCount = 0

  const entries = db.stock_holdings.map((h): FxGainLossEntry => {
    const currentPrice = h.lastKnownPrice ?? h.buyPrice
    const costNative = h.buyPrice * h.quantity
    const valueNative = currentPrice * h.quantity

    if (h.currency === 'LKR') {
      const returnLkr = valueNative - costNative
      totalAssetGainLkr += returnLkr
      totalReturnLkr += returnLkr
      return {
        id: h.id,
        symbol: h.symbol,
        currency: h.currency,
        quantity: h.quantity,
        assetGainLkr: returnLkr,
        fxGainLkr: 0,
        totalReturnLkr: returnLkr,
        insufficientHistory: false,
      }
    }

    const valueLkrNow = localConvertToLkr(db, valueNative, h.currency)
    const costLkrAtBuy = localConvertToLkr(db, costNative, h.currency, h.buyDate)
    const assetGainLkr = localConvertToLkr(db, valueNative - costNative, h.currency)
    if (
      valueLkrNow === undefined ||
      costLkrAtBuy === undefined ||
      assetGainLkr === undefined
    ) {
      excludedCount += 1
      return {
        id: h.id,
        symbol: h.symbol,
        currency: h.currency,
        quantity: h.quantity,
        assetGainLkr: 0,
        fxGainLkr: 0,
        totalReturnLkr: 0,
        insufficientHistory: true,
      }
    }

    const returnLkr = valueLkrNow - costLkrAtBuy
    const fxGainLkr = returnLkr - assetGainLkr
    totalAssetGainLkr += assetGainLkr
    totalFxGainLkr += fxGainLkr
    totalReturnLkr += returnLkr
    return {
      id: h.id,
      symbol: h.symbol,
      currency: h.currency,
      quantity: h.quantity,
      assetGainLkr,
      fxGainLkr,
      totalReturnLkr: returnLkr,
      insufficientHistory: false,
    }
  })

  return {
    entries,
    totalAssetGainLkr,
    totalFxGainLkr,
    totalReturnLkr,
    excludedCount,
  }
}

/**
 * Trailing average of monthly expenses, excluding the current in-progress
 * calendar month (which is always partial). Used to convert an "N months of
 * expenses" emergency-fund target into an LKR amount. Returns 0 if there is
 * no complete month of expense history yet.
 */
export function getAverageMonthlyExpensesLkr(
  db: FinanceDatabase,
  months = 3,
): number {
  const now = new Date()
  const currentKey = `${now.getUTCFullYear()}-${now.getUTCMonth() + 1}`
  const complete = getMonthlySummary(db).filter(
    (row) => `${row.year}-${row.month}` !== currentKey,
  )
  if (complete.length === 0) return 0
  const trailing = complete.slice(-months)
  const total = trailing.reduce((sum, row) => sum + row.expense, 0)
  return total / trailing.length
}

/**
 * Trailing 3-month (by default) savings rate, excluding the current
 * in-progress calendar month, as a ratio of summed savings to summed income
 * across the window (not an average of each month's own percentage — a
 * near-zero-income month would otherwise produce an extreme or undefined
 * individual rate and distort the result). Used to compare against a
 * PF-304 savings-rate target. `hasData` is false when there's no complete
 * month of history yet, or the window's total income is 0.
 */
export function getAverageMonthlySavingsRatePct(
  db: FinanceDatabase,
  months = 3,
): { actualPct: number; hasData: boolean } {
  const now = new Date()
  const currentKey = `${now.getUTCFullYear()}-${now.getUTCMonth() + 1}`
  const complete = getMonthlySummary(db).filter(
    (row) => `${row.year}-${row.month}` !== currentKey,
  )
  if (complete.length === 0) return { actualPct: 0, hasData: false }
  const trailing = complete.slice(-months)
  const sumIncome = trailing.reduce((sum, row) => sum + row.income, 0)
  const sumSavings = trailing.reduce((sum, row) => sum + row.savings, 0)
  if (sumIncome <= 0) return { actualPct: 0, hasData: false }
  return { actualPct: (sumSavings / sumIncome) * 100, hasData: true }
}

/**
 * Phase 24 (AI-200/201): bounded, pre-aggregated context for the Finance
 * Analyst LLM call — not a raw transaction dump (unbounded prompt size,
 * more PII exposure than necessary). Reuses already-computed
 * financeSummary()/getMonthlySummary(); only the category/vendor breakdown
 * here is new, grouping getUnifiedTransactions()'s expense rows by month.
 */
export function buildFinanceQueryContext(db: FinanceDatabase): {
  /** PF-201: every figure in this context is LKR, including `summary` — the
   *  Finance Analyst prompt must not see base-currency aggregates next to the
   *  raw-LKR `monthlySummary` / `categoryBreakdown` / `topVendors`. */
  currency: 'LKR'
  summary: ReturnType<typeof financeSummary>
  monthlySummary: ReturnType<typeof getMonthlySummary>
  categoryBreakdown: {
    thisMonth: Record<string, number>
    lastMonth: Record<string, number>
  }
  topVendors: { thisMonth: Array<{ vendor: string; amount: number }> }
  tradingSummary: ReturnType<typeof tradingPerformanceSummary>
} {
  const now = new Date()
  const thisMonthKey = `${now.getUTCFullYear()}-${now.getUTCMonth() + 1}`
  const lastMonthDate = new Date(now)
  lastMonthDate.setUTCMonth(lastMonthDate.getUTCMonth() - 1)
  const lastMonthKey = `${lastMonthDate.getUTCFullYear()}-${lastMonthDate.getUTCMonth() + 1}`

  const expenses = getUnifiedTransactions(db).filter(
    (t) => t.kind === 'expense',
  )
  const byCategory = (monthKey: string) => {
    const totals: Record<string, number> = {}
    // Iterate raw expense_records (not the unified list) so `splits` are
    // visible and each part is attributed to its own category.
    for (const exp of db.expense_records) {
      const d = parseDate(exp.date)
      if (!d || `${d.year}-${d.month}` !== monthKey) continue
      for (const part of expenseCategoryBreakdown(exp)) {
        totals[part.category] = (totals[part.category] ?? 0) + part.lkr
      }
    }
    return totals
  }
  const vendorTotals: Record<string, number> = {}
  for (const t of expenses) {
    const d = parseDate(t.date)
    if (!d || `${d.year}-${d.month}` !== thisMonthKey) continue
    vendorTotals[t.counterparty] =
      (vendorTotals[t.counterparty] ?? 0) + t.convertedLkrAmount
  }
  const topVendorsThisMonth = Object.entries(vendorTotals)
    .map(([vendor, amount]) => ({ vendor, amount }))
    .sort((a, b) => b.amount - a.amount)
    .slice(0, 10)

  // Pin the summary to LKR regardless of the configured reporting currency —
  // the rest of this context (monthlySummary, categoryBreakdown, topVendors)
  // is raw `convertedLkrAmount`, so a base-currency summary would be a
  // units mismatch inside one LLM prompt.
  const lkrDb = { ...db, settings: { ...db.settings, baseCurrency: 'LKR' } }
  return {
    currency: 'LKR' as const,
    summary: financeSummary(lkrDb),
    monthlySummary: getMonthlySummary(db).slice(-6),
    categoryBreakdown: {
      thisMonth: byCategory(thisMonthKey),
      lastMonth: byCategory(lastMonthKey),
    },
    topVendors: { thisMonth: topVendorsThisMonth },
    // AI-206: db already contains the trading tables (trading_plans etc.) —
    // tradingPerformanceSummary operates on the already-loaded db with no
    // extra readFinanceStore() calls, unlike the richer getTradingSummary()
    // (trading-summary.ts) which re-reads the store across all 4 engines.
    tradingSummary: tradingPerformanceSummary(db),
  }
}

export function getBudgetVsActual(
  db: FinanceDatabase,
  category: string,
  year: number,
  month: number,
): { budget: number; actual: number; variance: number } | null {
  // Format month as MM with leading zero
  const monthStr = month.toString().padStart(2, '0')
  const monthKey = `${year}-${monthStr}`

  // Find the budget category for the given category, year, month
  const budgetEntry = db.budget_categories.find(
    (b) => b.category === category && b.month === monthKey,
  )
  if (!budgetEntry) return null

  // Calculate actual expenses for that category, year, month. Expenses are
  // already stored LKR-converted (`convertedLkrAmount`), so the budget side
  // must be LKR too — PF-201: a budget category may be denominated in a
  // non-LKR currency, so normalise `budgetAmount` here rather than comparing
  // (say) a USD budget against an LKR spend total.
  let actual = 0
  for (const exp of db.expense_records) {
    if (!includeInTotals(exp)) continue
    const dateInfo = parseDate(exp.date)
    if (!dateInfo) continue
    if (dateInfo.year !== year || dateInfo.month !== month) continue
    // A split expense contributes only the parts tagged to this category.
    for (const part of expenseCategoryBreakdown(exp)) {
      if (part.category === category) actual += part.lkr
    }
  }

  const budget = amountToLkr(db, budgetEntry.budgetAmount, budgetEntry.currency)
  return {
    budget,
    actual,
    variance: budget - actual,
  }
}

export function budgetVsActualSummary(
  db: FinanceDatabase,
  monthKey?: string,
): Array<{
  category: string
  month: string
  currency: CurrencyCode
  budget: number
  actual: number
  variance: number
  percentUsed: number
  overBudget: boolean
}> {
  const month = monthKey ?? nowIso().slice(0, 7)
  const [year, monthNum] = month.split('-').map(Number)
  // De-duplicate by category: if the same category/month was submitted more
  // than once, getBudgetVsActual's find() always resolves to the first
  // matching entry — mirror that here so a form double-submit doesn't
  // produce two rows for the same category.
  const seenCategories = new Set<string>()
  return db.budget_categories
    .filter((b) => {
      if (b.month !== month) return false
      if (seenCategories.has(b.category)) return false
      seenCategories.add(b.category)
      return true
    })
    .map((b) => {
      const result = getBudgetVsActual(db, b.category, year, monthNum)
      const budget =
        result?.budget ?? amountToLkr(db, b.budgetAmount, b.currency)
      const actual = result?.actual ?? 0
      return {
        category: b.category,
        month: b.month,
        // PF-201: budget/actual/variance below are all LKR-normalised.
        currency: 'LKR' as CurrencyCode,
        budget,
        actual,
        variance: result?.variance ?? budget,
        percentUsed: budget > 0 ? (actual / budget) * 100 : 0,
        overBudget: actual > budget,
      }
    })
}

/**
 * Closes the "budgets are static" gap: budget_categories is a per-(category,
 * month) row with nothing that carries it forward — a category with no row
 * for the requested month simply doesn't appear in budgetVsActualSummary,
 * so today's budget stops applying the moment the calendar rolls over unless
 * the user manually re-enters every category again. This copies each
 * category from the most recent PRIOR month that has a budget row into
 * `targetMonth`, skipping any category that already has a row there (never
 * overwrites an explicit entry the user already set for this month).
 *
 * When a source row has `rolloverEnabled`, the copied amount also picks up
 * that category's *positive* leftover from the source month (budget minus
 * actual spend) — an intentional, per-category opt-in, not a default,
 * since carrying spending headroom forward isn't what every category
 * should do (e.g. it makes sense for "Home improvements", not "Groceries").
 * A negative leftover (already over budget) never reduces next month's
 * budget — this only ever adds unspent room, never subtracts overspend.
 */
export function copyBudgetsToMonth(
  db: FinanceDatabase,
  targetMonth: string,
): { copied: number; skippedExisting: number } {
  const existingCategories = new Set(
    db.budget_categories.filter((b) => b.month === targetMonth).map((b) => b.category),
  )
  // The most recent month strictly before targetMonth, per category — a
  // plain string comparison works because month keys are YYYY-MM.
  const latestPriorByCategory = new Map<string, BudgetCategory>()
  for (const b of db.budget_categories) {
    if (b.month >= targetMonth) continue
    const current = latestPriorByCategory.get(b.category)
    if (!current || b.month > current.month) {
      latestPriorByCategory.set(b.category, b)
    }
  }

  let copied = 0
  let skippedExisting = 0
  const createdAt = nowIso()
  for (const [category, source] of latestPriorByCategory) {
    if (existingCategories.has(category)) {
      skippedExisting += 1
      continue
    }
    let budgetAmount = source.budgetAmount
    if (source.rolloverEnabled) {
      const [year, monthNum] = source.month.split('-').map(Number)
      const result = getBudgetVsActual(db, category, year, monthNum)
      if (result && result.variance > 0) {
        // result.variance is LKR-normalised; source.budgetAmount is in
        // source.currency — convert the leftover back before adding.
        const leftoverInSourceCurrency =
          source.currency === 'LKR'
            ? result.variance
            : (convertCurrency(result.variance, 'LKR', source.currency) ??
              result.variance)
        budgetAmount += leftoverInSourceCurrency
      }
    }
    db.budget_categories.push({
      id: randomUUID(),
      month: targetMonth,
      category,
      currency: source.currency,
      budgetAmount,
      rolloverEnabled: source.rolloverEnabled,
      source: 'rollover',
      createdAt,
      updatedAt: createdAt,
    })
    copied += 1
  }
  return { copied, skippedExisting }
}

export function updateExchangeRate(
  base: string,
  target: string,
  rate: number,
  date?: string,
): FinanceDatabase {
  const db = ensureFinanceStore()
  const dateStr = date ?? new Date().toISOString().split('T')[0]
  const rateRecord = {
    base,
    target,
    rate,
    date: dateStr,
    updatedAt: new Date().toISOString(),
  }

  // Upsert by (base, target, date): getExchangeRate/latestRateFromDb both pick
  // "latest by date", so a same-day duplicate makes the winner arbitrary. A
  // daily refresh cron (or a manual re-entry) replaces the day's row in place
  // rather than piling up.
  const idx = db.exchange_rates.findIndex(
    (r) => r.base === base && r.target === target && r.date === dateStr,
  )
  if (idx >= 0) db.exchange_rates[idx] = rateRecord
  else db.exchange_rates.push(rateRecord)
  writeFinanceStore(db)
  appendAuditLog('exchange_rate_updated', { base, target, rate, date: dateStr })
  return db
}

export function getExchangeRate(
  base: string,
  target: string,
  date?: string,
): number | undefined {
  // Filter rates for the base and target, then take the one with the latest date
  const db = ensureFinanceStore()
  let relevant = db.exchange_rates.filter(
    (r: any) =>
      r.base === base && r.target === target && typeof r.rate === 'number',
  )

  // If a date is provided, only consider rates on or before that date
  if (date !== undefined) {
    const targetDate = new Date(date).getTime()
    relevant = relevant.filter((r: any) => {
      const rDate = new Date(r.date || 0).getTime()
      return rDate <= targetDate
    })
  }

  // Sort by date descending (latest first)
  relevant = relevant.sort((a: any, b: any) => {
    const dateA = new Date(a.date || 0).getTime()
    const dateB = new Date(b.date || 0).getTime()
    return dateB - dateA
  })

  if (relevant.length === 0) return undefined
  return relevant[0].rate as number
}

export function convertCurrency(
  amount: number,
  fromCurrency: CurrencyCode,
  toCurrency: CurrencyCode,
  date?: string,
): number | undefined {
  if (fromCurrency === toCurrency) {
    return amount
  }

  // Try direct rate
  const rate = getExchangeRate(fromCurrency, toCurrency, date)
  if (rate !== undefined) {
    return amount * rate
  }

  // Pivot via LKR (the storage currency — rates are stored LKR-denominated
  // regardless of the configured reporting currency) if both legs exist.
  const baseCurrency = 'LKR'
  const rateFromToBase = getExchangeRate(fromCurrency, baseCurrency, date)
  const rateBaseTo = getExchangeRate(baseCurrency, toCurrency, date)
  if (rateFromToBase !== undefined && rateBaseTo !== undefined) {
    return amount * rateFromToBase * rateBaseTo
  }

  // Try the inverse: if we have toCurrency -> fromCurrency, then use 1/rate
  const rateInverse = getExchangeRate(toCurrency, fromCurrency, date)
  if (rateInverse !== undefined) {
    return amount / rateInverse
  }

  // If we still don't have a rate, return undefined
  return undefined
}

export function tradingPerformanceSummary(db: FinanceDatabase) {
  // Get all executed trading plans with profitLoss
  const trades = db.trading_plans
    .flatMap((plan) => {
      if (
        plan.executionStatus !== 'executed' ||
        typeof plan.profitLoss !== 'number'
      )
        return []
      return [
        {
          id: plan.id,
          profitLoss: plan.profitLoss,
          decision: plan.decision,
          expectedOutcome: plan.expectedOutcome ?? '',
          actualOutcome: plan.actualOutcome ?? '',
          date: new Date(plan.updatedAt), // or plan.createdAt? We'll use updatedAt as the time when the plan was last updated (should be after execution)
          symbol: plan.symbol,
        },
      ]
    })
    .sort((a, b) => a.date.getTime() - b.date.getTime()) // ascending chronological

  if (trades.length === 0) {
    return {
      winRate: 0,
      avgProfit: 0,
      avgLoss: 0,
      avgProfitLossPerTrade: 0,
      profitFactor: 0,
      sharpeRatio: 0,
      maxDrawdown: 0,
      predictionAccuracy: 0,
      totalTrades: 0,
    }
  }

  const profits = trades
    .filter((t) => t.profitLoss > 0)
    .map((t) => t.profitLoss)
  const losses = trades.filter((t) => t.profitLoss < 0).map((t) => t.profitLoss)
  const totalProfit = profits.reduce((sum, p) => sum + p, 0)
  const totalLoss = losses.reduce((sum, l) => sum + l, 0) // negative number
  const totalNet = totalProfit + totalLoss
  const winRate = profits.length / trades.length
  const avgProfit = profits.length > 0 ? totalProfit / profits.length : 0
  const avgLoss = losses.length > 0 ? totalLoss / losses.length : 0 // will be negative
  const avgProfitLossPerTrade = totalNet / trades.length
  // Profit factor: gross profit / gross loss (gross loss as a positive magnitude)
  const grossLoss = Math.abs(totalLoss)
  const profitFactor =
    grossLoss !== 0 ? totalProfit / grossLoss : totalProfit > 0 ? 999 : 0

  // Sharpe ratio: using profitLoss as return, risk-free rate = 0
  const returns = trades.map((t) => t.profitLoss)
  const meanReturn = returns.reduce((sum, r) => sum + r, 0) / returns.length
  const variance =
    returns.reduce((sum, r) => sum + Math.pow(r - meanReturn, 2), 0) /
    returns.length
  const stdDev = Math.sqrt(variance)
  const sharpeRatio = stdDev !== 0 ? meanReturn / stdDev : 0

  // Max drawdown: compute cumulative sum and track peak
  let cumulative = 0
  let peak = 0
  let maxDrawdown = 0
  for (const t of trades) {
    cumulative += t.profitLoss
    if (cumulative > peak) {
      peak = cumulative
    }
    const drawdown = peak - cumulative // positive when below peak
    if (drawdown > maxDrawdown) {
      maxDrawdown = drawdown
    }
  }
  // maxDrawdown is the largest peak-to-trough decline (positive number)

  // Prediction accuracy: compare expectedOutcome with actual profit/loss sign
  let correctPredictions = 0
  for (const t of trades) {
    const expected = t.expectedOutcome.toLowerCase()
    const profit = t.profitLoss
    let correct = false
    if (expected.includes('profit') && profit > 0) {
      correct = true
    } else if (expected.includes('loss') && profit < 0) {
      correct = true
    } else if (
      expected.includes('break even') ||
      expected.includes('break-even') ||
      expected.includes('breakeven')
    ) {
      if (Math.abs(profit) < 1e-9) {
        // approximately zero
        correct = true
      }
    }
    // If expectedOutcome is empty, we cannot judge; we'll treat as incorrect.
    if (correct) {
      correctPredictions++
    }
  }
  const predictionAccuracy = correctPredictions / trades.length

  return {
    winRate,
    avgProfit,
    avgLoss,
    avgProfitLossPerTrade,
    profitFactor,
    sharpeRatio,
    maxDrawdown,
    predictionAccuracy,
    totalTrades: trades.length,
  }
}
