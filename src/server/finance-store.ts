import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import { createHash, randomUUID } from 'node:crypto'
import {
  appendFinanceAuditPostgres,
  financePostgresStatus,
  readFinancePostgresStore,
  writeFinancePostgresStore,
} from './finance-postgres-store'
import {
  readPersonalFinanceStore,
  writePersonalFinanceStore,
} from './personal-finance-store'
import { readTradingStore, writeTradingStore } from './trading-store'
import type { ConnectivityBreakerState } from './connectivity-breaker'

export const FINANCE_SCHEMA_VERSION = 1
export const FINANCE_DATA_DIR = path.join(os.homedir(), '.hermes', 'finance')
export const FINANCE_DATA_PATH = path.join(FINANCE_DATA_DIR, 'finance.json')
export const FINANCE_AUDIT_PATH = path.join(FINANCE_DATA_DIR, 'audit.jsonl')
/** Original documents/photos from both ingestion paths (upload, Gmail attachments) — referenced by pending_ingestions.sourceRef. */
export const FINANCE_INGESTION_UPLOAD_DIR = path.join(FINANCE_DATA_DIR, 'ingestion-uploads')

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
  source: string
  createdAt: string
  updatedAt: string
}

export type ExpenseRecord = {
  id: string
  date: string
  vendor: string
  category: string
  subcategory?: string
  accountId?: string
  currency: CurrencyCode
  amount: number
  convertedLkrAmount: number
  recurring: boolean
  workRelated: boolean
  taxDeductiblePossible: boolean
  notes?: string
  documentRef?: string
  source: string
  createdAt: string
  updatedAt: string
}

/** Read-only unified view over income_records + expense_records for a single combined transaction list/UI. Storage stays split; this is computed on read, never persisted. */
export type UnifiedTransaction = {
  id: string
  kind: 'income' | 'expense'
  date: string
  counterparty: string
  category: string
  accountId?: string
  currency: CurrencyCode
  amount: number
  convertedLkrAmount: number
  notes?: string
  documentRef?: string
  recurring?: boolean
  taxable?: boolean
  incomeSourceId?: string
  subcategory?: string
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
  extracted?: ExtractedTransaction
  extractedContract?: ExtractedContract
  rawPreviewImagePath?: string
  error?: string
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
  baseCurrency: 'LKR'
  reportingCurrencies: Array<CurrencyCode>
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
  strategyDecayDetection?: Record<string, unknown>
  /** Per-strategy validated backtest baselines, keyed by strategyId. See strategy-decay.ts. */
  strategyBaselines?: Record<string, unknown>
}

export type FinanceDatabase = {
  schemaVersion: number
  createdAt: string
  updatedAt: string
  settings: FinanceSettings
  finance_accounts: Array<FinanceAccount>
  income_records: Array<IncomeRecord>
  expense_records: Array<ExpenseRecord>
  budget_categories: Array<BudgetCategory>
  categories: Array<Category>
  subcategories: Array<Subcategory>
  merchants: Array<Merchant>
  savings_goals: Array<SavingsGoal>
  tax_records: Array<TaxRecord>
  pending_ingestions: Array<PendingIngestion>
  income_sources: Array<IncomeSource>
  stock_holdings: Array<StockHolding>
  fixed_deposits: Array<FixedDeposit>
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

export type FinanceStorageHealthStatus =
  | 'healthy'
  | 'json_primary'
  | 'postgres_unavailable'
  | 'postgres_behind'
  | 'mirror_mismatch'

export type FinanceStorageHealth = {
  status: FinanceStorageHealthStatus
  warnings: Array<string>
  jsonUpdatedAt: string | null
  postgresUpdatedAt: string | null
  postgresLagMs: number
  isPostgresBehindJson: boolean
  selfHeal: {
    attempted: boolean
    attempts: number
    succeeded: boolean
    lastAttemptAt: string | null
  }
  rowCounts: {
    json: Record<string, number>
    postgres: Record<string, number>
    lagging: Record<string, { json: number; postgres: number }>
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
    budget_categories: [],
    categories: [],
    subcategories: [],
    merchants: [],
    savings_goals: [],
    tax_records: [],
    pending_ingestions: [],
    income_sources: [],
    stock_holdings: [],
    fixed_deposits: [],
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

export function readFinanceStore(): FinanceDatabase {
  const jsonDb = readFinanceJsonStore()
  const pgDb = readFinancePostgresStore()
  if (pgDb && shouldPreferPostgresStore(pgDb, jsonDb)) {
    const migrated = migrateFinanceStore(pgDb)
    writeFinanceJsonStore(migrated)
    return migrated
  }
  if (jsonDb) {
    const migrated = migrateFinanceStore(jsonDb)
    writeFinancePostgresStore(migrated)
    return migrated
  }
  const db = createEmptyFinanceDatabase()
  writeFinanceStore(db)
  appendAuditLog('database_recreated_after_read_failure', {})
  return db
}

function writeFinanceJsonStore(db: FinanceDatabase): void {
  fs.mkdirSync(FINANCE_DATA_DIR, { recursive: true, mode: 0o700 })
  fs.writeFileSync(FINANCE_DATA_PATH, `${JSON.stringify(db, null, 2)}\n`, {
    mode: 0o600,
  })
  mirrorIntoSplitStores(db)
}

/**
 * Phase 5 (dual-write step) of the finance/trading backend split — mirror
 * into the two split stores in preparation for the eventual read cutover.
 * Best-effort only: writeFinanceJsonStore's own write above (and the
 * Postgres mirror alongside it) remain the sole source of truth. Never let
 * a mirror failure propagate — see each store's own module doc.
 *
 * Hooked into writeFinanceJsonStore() specifically (not writeFinanceStore())
 * because readFinanceStore()'s self-heal path calls writeFinanceJsonStore()
 * directly when Postgres data should be preferred over local JSON — that
 * path bypasses writeFinanceStore() entirely, and since Postgres is
 * generally preferred in this environment, it's the dominant write path in
 * practice. Confirmed via production journal: the JSON file's mtime updates
 * on plain reads through that self-heal branch even with no engine cycle
 * having run.
 */
function mirrorIntoSplitStores(db: FinanceDatabase): void {
  writePersonalFinanceStore({
    finance_accounts: db.finance_accounts,
    income_records: db.income_records,
    expense_records: db.expense_records,
    budget_categories: db.budget_categories,
    categories: db.categories,
    subcategories: db.subcategories,
    merchants: db.merchants,
    savings_goals: db.savings_goals,
    tax_records: db.tax_records,
    exchange_rates: db.exchange_rates,
    investment_accounts: db.investment_accounts,
    pending_ingestions: db.pending_ingestions,
    income_sources: db.income_sources,
    stock_holdings: db.stock_holdings,
    fixed_deposits: db.fixed_deposits,
  })
  writeTradingStore({
    assets: db.assets,
    market_prices: db.market_prices,
    historical_candles: db.historical_candles,
    news_items: db.news_items,
    sentiment_scores: db.sentiment_scores,
    risk_scores: db.risk_scores,
    intelligence_records: db.intelligence_records,
    trading_plans: db.trading_plans,
    trade_orders: db.trade_orders,
    trade_executions: db.trade_executions,
    virtual_accounts: db.virtual_accounts,
    portfolio_positions: db.portfolio_positions,
    account_balances: db.account_balances,
    strategy_results: db.strategy_results,
    prediction_results: db.prediction_results,
    trading_signals: db.trading_signals,
    riskState: db.riskState,
    connectivityBreaker: db.connectivityBreaker,
  })
}

function readFinanceJsonStore(): FinanceDatabase | null {
  let base: FinanceDatabase
  try {
    base = JSON.parse(
      fs.readFileSync(FINANCE_DATA_PATH, 'utf8'),
    ) as FinanceDatabase
  } catch {
    return null
  }
  return overlaySplitStores(base)
}

/**
 * Phase 5 (read cutover step) of the finance/trading backend split.
 * mirrorIntoSplitStores() writes the split stores from this same base
 * file's own data on every write, so in the normal case they're never
 * staler than it — overlay them here so callers gradually source
 * personal/trading collections from the split files, while settings and
 * the still-unsplit misc collections (trading_platforms, api_connections,
 * agent_memory, audit_logs, error_logs) keep coming from this shared base
 * file (never split — see the plan's own rationale).
 *
 * The mirror write is deliberately best-effort and can silently fail (must
 * never block a real trade write) — if it failed on the most recent write
 * while the base file succeeded, the split store would hold OLDER data
 * than the base file for that collection. Guard against serving that stale
 * data: only overlay a split store if its own updatedAt is not older than
 * the base file's.
 */
function overlaySplitStores(base: FinanceDatabase): FinanceDatabase {
  const baseUpdatedMs = updatedAtMs(base)
  const personal = readPersonalFinanceStore()
  const trading = readTradingStore()
  const personalFresh = personal && Date.parse(personal.updatedAt) >= baseUpdatedMs
  const tradingFresh = trading && Date.parse(trading.updatedAt) >= baseUpdatedMs

  return {
    ...base,
    ...(personalFresh
      ? {
          finance_accounts: personal.finance_accounts,
          income_records: personal.income_records,
          expense_records: personal.expense_records,
          budget_categories: personal.budget_categories,
          categories: personal.categories ?? [],
          subcategories: personal.subcategories ?? [],
          merchants: personal.merchants ?? [],
          savings_goals: personal.savings_goals,
          tax_records: personal.tax_records,
          exchange_rates: personal.exchange_rates,
          investment_accounts: personal.investment_accounts,
          pending_ingestions: personal.pending_ingestions,
          income_sources: personal.income_sources,
          stock_holdings: personal.stock_holdings,
          fixed_deposits: personal.fixed_deposits,
        }
      : {}),
    ...(tradingFresh
      ? {
          assets: trading.assets,
          market_prices: trading.market_prices,
          historical_candles: trading.historical_candles,
          news_items: trading.news_items,
          sentiment_scores: trading.sentiment_scores,
          risk_scores: trading.risk_scores,
          intelligence_records: trading.intelligence_records,
          trading_plans: trading.trading_plans,
          trade_orders: trading.trade_orders,
          trade_executions: trading.trade_executions,
          virtual_accounts: trading.virtual_accounts,
          portfolio_positions: trading.portfolio_positions,
          account_balances: trading.account_balances,
          strategy_results: trading.strategy_results,
          prediction_results: trading.prediction_results,
          trading_signals: trading.trading_signals,
          riskState: trading.riskState as RiskState,
          connectivityBreaker: trading.connectivityBreaker as ConnectivityBreakerState,
        }
      : {}),
  } as FinanceDatabase
}

function updatedAtMs(db: FinanceDatabase): number {
  const value = Date.parse(db.updatedAt)
  return Number.isFinite(value) ? value : 0
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

function financeDataWeight(db: FinanceDatabase): number {
  return Object.values(financeCollectionCounts(db)).reduce(
    (sum, count) => sum + count,
    0,
  )
}

function shouldPreferPostgresStore(
  pgDb: FinanceDatabase,
  jsonDb: FinanceDatabase | null,
): boolean {
  if (!jsonDb) return true
  const pgUpdated = updatedAtMs(pgDb)
  const jsonUpdated = updatedAtMs(jsonDb)
  if (pgUpdated !== jsonUpdated) return pgUpdated > jsonUpdated
  return financeDataWeight(pgDb) >= financeDataWeight(jsonDb)
}

export function buildFinanceStorageHealth(input: {
  jsonDb: FinanceDatabase | null
  postgresDb: FinanceDatabase | null
  postgres: {
    enabled: boolean
    available: boolean
    snapshotAvailable: boolean
    reason?: string
    lastWriteError?: string
  }
  selfHeal?: FinanceStorageHealth['selfHeal']
}): FinanceStorageHealth {
  const jsonUpdatedAt = input.jsonDb?.updatedAt ?? null
  const postgresUpdatedAt = input.postgresDb?.updatedAt ?? null
  const jsonUpdatedMs = input.jsonDb ? updatedAtMs(input.jsonDb) : 0
  const postgresUpdatedMs = input.postgresDb ? updatedAtMs(input.postgresDb) : 0
  const postgresLagMs =
    jsonUpdatedMs > postgresUpdatedMs ? jsonUpdatedMs - postgresUpdatedMs : 0
  const jsonCounts = financeCollectionCounts(input.jsonDb)
  const postgresCounts = financeCollectionCounts(input.postgresDb)
  const lagging: Record<string, { json: number; postgres: number }> = {}
  for (const key of STORAGE_HEALTH_COLLECTIONS) {
    if (jsonCounts[key] > postgresCounts[key]) {
      lagging[key] = { json: jsonCounts[key], postgres: postgresCounts[key] }
    }
  }

  const warnings: Array<string> = []
  let status: FinanceStorageHealthStatus = 'healthy'

  if (!input.postgres.enabled) {
    status = 'json_primary'
  } else if (!input.postgres.available) {
    status = 'postgres_unavailable'
    warnings.push(
      input.postgres.reason
        ? `Postgres mirror unavailable: ${input.postgres.reason}.`
        : 'Postgres mirror unavailable; using JSON fallback.',
    )
  } else if (!input.postgres.snapshotAvailable || !input.postgresDb) {
    status = 'postgres_unavailable'
    warnings.push('Postgres mirror has no finance snapshot yet.')
  } else if (postgresLagMs > 0) {
    status = 'postgres_behind'
    warnings.push(
      `Postgres mirror is ${Math.ceil(postgresLagMs / 1000)}s behind JSON finance storage.`,
    )
  } else if (Object.keys(lagging).length > 0) {
    status = 'mirror_mismatch'
    const summary = Object.entries(lagging)
      .slice(0, 3)
      .map(([key, counts]) => `${key} ${counts.postgres}/${counts.json}`)
      .join(', ')
    warnings.push(
      `Postgres mirror has fewer rows than JSON storage (${summary}).`,
    )
  }
  if (input.postgres.lastWriteError) {
    warnings.push(
      `Last Postgres mirror write failed: ${input.postgres.lastWriteError}.`,
    )
  }

  return {
    status,
    warnings,
    jsonUpdatedAt,
    postgresUpdatedAt,
    postgresLagMs,
    isPostgresBehindJson:
      status === 'postgres_behind' || status === 'mirror_mismatch',
    selfHeal: input.selfHeal ?? {
      attempted: false,
      attempts: 0,
      succeeded: false,
      lastAttemptAt: null,
    },
    rowCounts: {
      json: jsonCounts,
      postgres: postgresCounts,
      lagging,
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

export function writeFinanceStore(db: FinanceDatabase): void {
  fs.mkdirSync(FINANCE_DATA_DIR, { recursive: true, mode: 0o700 })
  const updated = { ...db, updatedAt: nowIso() }
  writeFinanceJsonStore(updated) // also mirrors into the split stores, see its own doc
  writeFinancePostgresStore(updated)
}

export function appendAuditLog(
  action: string,
  details: Record<string, unknown>,
): void {
  fs.mkdirSync(FINANCE_DATA_DIR, { recursive: true, mode: 0o700 })
  const entry = {
    id: randomUUID(),
    action,
    details: maskSensitive(details) as Record<string, unknown>,
    source: 'hermes-finance',
    createdAt: nowIso(),
  }
  fs.appendFileSync(FINANCE_AUDIT_PATH, `${JSON.stringify(entry)}\n`, {
    mode: 0o600,
  })
  appendFinanceAuditPostgres(entry)
}

function storageHealthNeedsSelfHeal(health: FinanceStorageHealth): boolean {
  return (
    health.status === 'postgres_behind' ||
    health.status === 'mirror_mismatch' ||
    health.status === 'postgres_unavailable'
  )
}

export function financeStorageStatus(
  options: { selfHeal?: boolean; selfHealRetries?: number } = {},
) {
  let pg = financePostgresStatus()
  const jsonDb = readFinanceJsonStore()
  let postgresDb = readFinancePostgresStore()
  let selfHeal: FinanceStorageHealth['selfHeal'] = {
    attempted: false,
    attempts: 0,
    succeeded: false,
    lastAttemptAt: null,
  }
  let health = buildFinanceStorageHealth({
    jsonDb,
    postgresDb,
    postgres: pg,
    selfHeal,
  })

  if (
    options.selfHeal &&
    jsonDb &&
    pg.enabled &&
    pg.available &&
    storageHealthNeedsSelfHeal(health)
  ) {
    const retries = Math.max(1, Math.min(options.selfHealRetries ?? 2, 5))
    for (let attempt = 1; attempt <= retries; attempt += 1) {
      selfHeal = {
        attempted: true,
        attempts: attempt,
        succeeded: false,
        lastAttemptAt: nowIso(),
      }
      const ok = writeFinancePostgresStore(jsonDb)
      pg = financePostgresStatus()
      postgresDb = readFinancePostgresStore()
      health = buildFinanceStorageHealth({
        jsonDb,
        postgresDb,
        postgres: pg,
        selfHeal: { ...selfHeal, succeeded: ok },
      })
      if (ok && !storageHealthNeedsSelfHeal(health)) break
    }
    const healed = !storageHealthNeedsSelfHeal(health)
    appendAuditLog(
      healed
        ? 'finance_postgres_mirror_self_healed'
        : 'finance_postgres_mirror_self_heal_failed',
      {
        attempts: selfHeal.attempts,
        status: health.status,
        warnings: health.warnings,
      },
    )
  }

  return {
    active:
      pg.available && pg.snapshotAvailable && !health.isPostgresBehindJson
        ? 'postgres'
        : 'json',
    fallback: 'json',
    jsonPath: FINANCE_DATA_PATH,
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
      title: 'Finance storage mirror unhealthy',
      detail: `${health.warnings.join(' ')}${
        health.selfHeal.attempted
          ? ` Self-heal ${health.selfHeal.succeeded ? 'succeeded' : 'did not resolve it'} after ${health.selfHeal.attempts} attempt(s).`
          : ''
      }`,
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
    })
  } else if (kind === 'expense') {
    db.expense_records.push({
      ...base,
      date: stringField(payload, 'date', createdAt.slice(0, 10)),
      vendor: stringField(payload, 'vendor', 'Unspecified vendor'),
      category: stringField(payload, 'category', 'Other'),
      subcategory: optionalString(payload, 'subcategory'),
      accountId: optionalString(payload, 'accountId'),
      currency: stringField(payload, 'currency', 'LKR'),
      amount: numberField(payload, 'amount', 0),
      convertedLkrAmount: numberField(
        payload,
        'convertedLkrAmount',
        numberField(payload, 'amount', 0),
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
    db.merchants.push({
      ...base,
      name: stringField(payload, 'name', 'Untitled'),
      defaultCategory: optionalString(payload, 'defaultCategory'),
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
      expectedPaydayDayOfMonth: optionalNumber(payload, 'expectedPaydayDayOfMonth'),
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
      maturityDate: stringField(payload, 'maturityDate', createdAt.slice(0, 10)),
      status: fixedDepositStatusField(payload.status),
      notes: optionalString(payload, 'notes'),
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
      db.expense_records[index] = {
        ...db.expense_records[index],
        ...payload,
        updatedAt: nowIso(),
      }
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
      db.categories[index] = { ...db.categories[index], ...payload, updatedAt: nowIso() }
      updated = true
    }
  } else if (kind === 'subcategory_entry') {
    const index = db.subcategories.findIndex((r) => r.id === id)
    if (index !== -1) {
      db.subcategories[index] = { ...db.subcategories[index], ...payload, updatedAt: nowIso() }
      updated = true
    }
  } else if (kind === 'merchant') {
    const index = db.merchants.findIndex((r) => r.id === id)
    if (index !== -1) {
      db.merchants[index] = { ...db.merchants[index], ...payload, updatedAt: nowIso() }
      updated = true
    }
  } else if (kind === 'income_source') {
    const index = db.income_sources.findIndex((r) => r.id === id)
    if (index !== -1) {
      db.income_sources[index] = { ...db.income_sources[index], ...payload, updatedAt: nowIso() }
      updated = true
    }
  } else if (kind === 'stock_holding') {
    const index = db.stock_holdings.findIndex((r) => r.id === id)
    if (index !== -1) {
      db.stock_holdings[index] = { ...db.stock_holdings[index], ...payload, updatedAt: nowIso() }
      updated = true
    }
  } else if (kind === 'fixed_deposit') {
    const index = db.fixed_deposits.findIndex((r) => r.id === id)
    if (index !== -1) {
      db.fixed_deposits[index] = { ...db.fixed_deposits[index], ...payload, updatedAt: nowIso() }
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

export type DuplicateMatch = { id: string; date: string; amount: number; vendorOrSource: string }

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
  const records: Array<{ id: string; vendor: string; date: string; amount: number }> =
    kind === 'income'
      ? db.income_records.map((r) => ({ id: r.id, vendor: r.sourceName, date: r.dateReceived, amount: r.originalAmount }))
      : db.expense_records.map((r) => ({ id: r.id, vendor: r.vendor, date: r.date, amount: r.amount }))

  for (const r of records) {
    const sameVendor = r.vendor.trim().toLowerCase() === vendorKey
    const sameDate = r.date.slice(0, 10) === dateOnly
    const sameAmount = Math.abs(r.amount - amount) / Math.max(Math.abs(amount), 1) < 0.01
    if (sameVendor && sameDate && sameAmount) {
      return { id: r.id, date: r.date, amount: r.amount, vendorOrSource: r.vendor }
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
export function recordCategoryCorrection(vendor: string, category: string): void {
  if (!vendor.trim() || !category.trim()) return
  const db = ensureFinanceStore()
  const settings = db.settings as Record<string, unknown>
  const corrections = (
    settings.categoryCorrections && typeof settings.categoryCorrections === 'object'
      ? { ...(settings.categoryCorrections as Record<string, string>) }
      : {}
  ) as Record<string, string>
  corrections[vendor.trim().toLowerCase()] = category.trim()
  settings.categoryCorrections = corrections
  writeFinanceStore(db)
}

export function getCategoryCorrections(): Record<string, string> {
  const db = ensureFinanceStore()
  const settings = db.settings as Record<string, unknown>
  return settings.categoryCorrections && typeof settings.categoryCorrections === 'object'
    ? (settings.categoryCorrections as Record<string, string>)
    : {}
}

export function listPendingIngestions(): Array<PendingIngestion> {
  return ensureFinanceStore().pending_ingestions
}

export function addPendingIngestion(
  input: Pick<PendingIngestion, 'source' | 'sourceRef'> &
    Partial<
      Pick<
        PendingIngestion,
        'status' | 'documentType' | 'passwordHint' | 'extracted' | 'extractedContract' | 'rawPreviewImagePath' | 'error'
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
    extracted: input.extracted,
    extractedContract: input.extractedContract,
    rawPreviewImagePath: input.rawPreviewImagePath,
    error: input.error,
    createdAt,
    updatedAt: createdAt,
  }
  db.pending_ingestions.push(record)
  writeFinanceStore(db)
  appendAuditLog('pending_ingestion_added', { id: record.id, source: record.source, status: record.status })
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

export function financeSummary(db: FinanceDatabase) {
  const totalIncomeLkr = db.income_records.reduce(
    (sum, row) => sum + row.convertedLkrAmount,
    0,
  )
  const totalExpensesLkr = db.expense_records.reduce(
    (sum, row) => sum + row.convertedLkrAmount,
    0,
  )
  const netSavingsLkr = totalIncomeLkr - totalExpensesLkr
  const savingsRate =
    totalIncomeLkr > 0 ? (netSavingsLkr / totalIncomeLkr) * 100 : 0
  const cashBalanceLkr = db.finance_accounts.reduce(
    (sum, row) => sum + (row.currency === 'LKR' ? row.balance : 0),
    0,
  )
  const taxReserveLkr = db.savings_goals
    .filter((goal) => goal.name.toLowerCase().includes('tax'))
    .reduce((sum, goal) => sum + goal.currentAmount, 0)
  const debtLkr = db.finance_accounts
    .filter((account) => account.type === 'loan' || account.type === 'card')
    .reduce((sum, row) => sum + Math.abs(row.balance), 0)
  // Never blocked on a live CSE price fetch succeeding — falls back to the
  // buy price when no cached/manual current price is available yet.
  const stockHoldingsValueLkr = db.stock_holdings.reduce(
    (sum, holding) => sum + (holding.lastKnownPrice ?? holding.buyPrice) * holding.quantity,
    0,
  )
  const fixedDepositsValueLkr = db.fixed_deposits
    .filter((fd) => fd.status !== 'withdrawn')
    .reduce((sum, fd) => sum + fd.principal, 0)
  const unrealizedStockPnlLkr = db.stock_holdings.reduce(
    (sum, holding) => sum + ((holding.lastKnownPrice ?? holding.buyPrice) - holding.buyPrice) * holding.quantity,
    0,
  )
  const netWorthLkr =
    cashBalanceLkr +
    db.savings_goals.reduce((sum, goal) => sum + goal.currentAmount, 0) +
    stockHoldingsValueLkr +
    fixedDepositsValueLkr -
    debtLkr
  const openPlans = db.trading_plans.filter(
    (plan) =>
      !['cancelled', 'expired', 'failed', 'blocked'].includes(plan.status),
  ).length
  const blockedPlans = db.trading_plans.filter(
    (plan) => plan.status === 'blocked' || plan.decision === 'BLOCKED',
  ).length
  return {
    totalIncomeLkr,
    totalExpensesLkr,
    netSavingsLkr,
    savingsRate,
    cashBalanceLkr,
    taxReserveLkr,
    debtLkr,
    netWorthLkr,
    stockHoldingsValueLkr,
    fixedDepositsValueLkr,
    unrealizedStockPnlLkr,
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
    summary.totalExpensesLkr > summary.totalIncomeLkr &&
    summary.totalIncomeLkr > 0
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
  return alerts
}

export function generateTradingSignal(
  symbol: string,
  marketData: Record<string, any> = {},
): TradingSignal {
  // This is a simplified decision engine
  // In a real implementation, this would use technical analysis, ML models, etc.

  // Generate a mock signal based on some basic logic
  const rsi = Math.random() * 100 // Simulated RSI
  const macd = Math.random() * 2 - 1 // Simulated MACD
  const smaRatio = Math.random() * 0.5 + 0.8 // Price vs SMA ratio

  let action: 'buy' | 'sell' | 'hold' = 'hold'
  let strength = 50
  let confidence = 50

  if (rsi < 30 && macd > 0) {
    // Oversold and bullish momentum
    action = 'buy'
    strength = 80
    confidence = 75
  } else if (rsi > 70 && macd < 0) {
    // Overbought and bearish momentum
    action = 'sell'
    strength = 80
    confidence = 75
  } else if (smaRatio > 1.05) {
    // Price above SMA - bullish
    action = 'buy'
    strength = 60
    confidence = 60
  } else if (smaRatio < 0.95) {
    // Price below SMA - bearish
    action = 'sell'
    strength = 60
    confidence = 60
  }

  const price = 100 + Math.random() * 50 // Mock price

  const signalPayload: any = {
    symbol,
    action,
    strength,
    confidence,
    priceTarget: action === 'buy' ? price * 1.1 : price * 0.9,
    stopLoss: action === 'buy' ? price * 0.95 : price * 1.05,
    reasoning: `RSI: ${rsi.toFixed(1)}, MACD: ${macd.toFixed(3)}, SMA Ratio: ${smaRatio.toFixed(3)}`,
    indicators: { rsi, macd, smaRatio },
  }

  return createTradingSignal(signalPayload)
}

export function updateVirtualAccountPrices(
  prices: Record<string, number>,
): void {
  const db = ensureFinanceStore()

  // Update unrealized P&L for all virtual accounts based on current prices
  // In a real system, we would track individual positions
  for (const account of db.virtual_accounts) {
    // This is simplified - in reality we'd need to track what assets we hold
    const priceChange = (Math.random() - 0.5) * 0.1 // Random +/- 5% change
    const portfolioValue = account.balance * (1 + priceChange)
    const unrealizedPnl = portfolioValue - account.balance

    account.unrealizedPnl = unrealizedPnl
    account.balance = portfolioValue
    account.updatedAt = new Date().toISOString()
  }

  writeFinanceStore(db)
}

export function createPaperTradingAccount(
  platform: 'binance' | 'binance_shadow' = 'binance',
  initialBalance: number = 10000,
): VirtualAccount {
  const db = ensureFinanceStore()

  // Check if account already exists for this platform
  let account = db.virtual_accounts.find(
    (acc) => acc.platform === platform && acc.currency === 'LKR',
  )

  if (!account) {
    const accountPayload: any = {
      platform,
      currency: 'LKR',
      balance: initialBalance,
      initialBalance: initialBalance,
    }
    account = createVirtualAccount(accountPayload)
    db.virtual_accounts.push(account)
    writeFinanceStore(db)
    appendAuditLog('paper_trading_account_created', {
      platform,
      initialBalance,
    })
  }

  return account
}

export function getPaperTradingBalance(
  platform: 'binance' | 'binance_shadow' = 'binance',
): {
  balance: number
  initialBalance: number
  totalPnl: number
  totalPnlPercentage: number
} | null {
  const db = ensureFinanceStore()
  const account = db.virtual_accounts.find(
    (acc) => acc.platform === platform && acc.currency === 'LKR',
  )

  if (!account) {
    return null
  }

  return {
    balance: account.balance,
    initialBalance: account.initialBalance,
    totalPnl: account.totalPnl,
    totalPnlPercentage: account.totalPnlPercentage,
  }
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
  return allowed.includes(value as Category['kind']) ? (value as Category['kind']) : 'both'
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

function employmentTypeField(value: unknown): IncomeSource['employmentType'] {
  const allowed: Array<IncomeSource['employmentType']> = ['full_time', 'contract', 'freelance', 'other']
  return allowed.includes(value as IncomeSource['employmentType'])
    ? (value as IncomeSource['employmentType'])
    : 'other'
}

function interestPayoutField(value: unknown): FixedDeposit['interestPayout'] {
  const allowed: Array<FixedDeposit['interestPayout']> = ['monthly', 'quarterly', 'annually', 'at_maturity']
  return allowed.includes(value as FixedDeposit['interestPayout'])
    ? (value as FixedDeposit['interestPayout'])
    : 'at_maturity'
}

function fixedDepositStatusField(value: unknown): FixedDeposit['status'] {
  const allowed: Array<FixedDeposit['status']> = ['active', 'matured', 'withdrawn']
  return allowed.includes(value as FixedDeposit['status'])
    ? (value as FixedDeposit['status'])
    : 'active'
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

export function getUnifiedTransactions(db: FinanceDatabase): Array<UnifiedTransaction> {
  const fromIncome: Array<UnifiedTransaction> = db.income_records.map((inc) => ({
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
    source: inc.source,
    createdAt: inc.createdAt,
    updatedAt: inc.updatedAt,
  }))

  const fromExpense: Array<UnifiedTransaction> = db.expense_records.map((exp) => ({
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
    source: exp.source,
    createdAt: exp.createdAt,
    updatedAt: exp.updatedAt,
  }))

  return [...fromIncome, ...fromExpense].sort((a, b) => {
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
    const dateInfo = parseDate(inc.dateReceived)
    if (!dateInfo) continue
    if (year !== undefined && dateInfo.year !== year) continue
    if (month !== undefined && dateInfo.month !== month) continue
    const key = `${dateInfo.year}-${dateInfo.month}`
    const current = incomeMap.get(key) ?? 0
    incomeMap.set(key, current + inc.convertedLkrAmount)
  }

  for (const exp of db.expense_records) {
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

  // Calculate actual expenses for that category, year, month
  let actual = 0
  for (const exp of db.expense_records) {
    const dateInfo = parseDate(exp.date)
    if (!dateInfo) continue
    if (
      dateInfo.year === year &&
      dateInfo.month === month &&
      exp.category === category
    ) {
      actual += exp.convertedLkrAmount
    }
  }

  return {
    budget: budgetEntry.budgetAmount,
    actual,
    variance: budgetEntry.budgetAmount - actual,
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
      const budget = result?.budget ?? b.budgetAmount
      const actual = result?.actual ?? 0
      return {
        category: b.category,
        month: b.month,
        currency: b.currency,
        budget,
        actual,
        variance: result?.variance ?? budget,
        percentUsed: budget > 0 ? (actual / budget) * 100 : 0,
        overBudget: actual > budget,
      }
    })
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

  db.exchange_rates.push(rateRecord)
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

  // Try via base currency (LKR) if both legs exist
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
