import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import { createHash, randomUUID } from 'node:crypto'
import {
  appendFinanceAuditPostgres,
  financePostgresStatus,
  readFinancePostgresNormalized,
  readFinancePostgresStore,
  writeFinancePostgresNormalized,
  writeFinancePostgresStore,
} from './finance-postgres-store'
import {
  readPersonalFinancePostgresStore,
  writePersonalFinancePostgresStore,
} from './personal-finance-postgres-store'
import { readTradingStore, writeTradingStore } from './trading-store'
import type { ContractChange } from './contract-change-detection'
import type { ConnectivityBreakerState } from './connectivity-breaker'
import type { FinancialRules } from './financial-rules'
import type { FinanceDocumentClass } from './finance-document-classifier'

export const FINANCE_SCHEMA_VERSION = 1
// Respect HOME overrides used by isolated tests while retaining the normal
// ~/.hermes/finance location in production.
export const FINANCE_DATA_DIR = path.join(
  process.env.HOME || os.homedir(),
  '.hermes',
  'finance',
)
export const FINANCE_DATA_PATH = path.join(FINANCE_DATA_DIR, 'finance.json')
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
  maskedIdentifier?: string
  platform?: string
  /** Original bank/account document path inside the private finance directory. */
  documentRef?: string
  source: string
  createdAt: string
  updatedAt: string
}

export type TransactionType = 'income' | 'expense' | 'transfer'

export type IncomeRecord = {
  id: string
  dateReceived: string
  sourceName: string
  incomeType: string
  /** Structured reporting hint while preserving the existing free-text incomeType label. */
  incomeSubtype?: 'salary' | 'dividend' | 'interest' | 'freelance' | 'other'
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
  /** Links dividend income back to the stock holding that paid it, when known. */
  stockHoldingId?: string
  /** Comma-separated free text — matches the Tag catalogue (PF-112) by name, no FK. */
  tags?: string
  /** Reconciliation status (PF-113). Defaults to 'cleared' to match prior implicit behavior. */
  status?: 'pending' | 'cleared' | 'reconciled'
  /** Paired transfer metadata; ordinary income records leave these absent. */
  transactionType?: TransactionType
  transferId?: string
  transferAccountId?: string
  /** Soft-delete tombstone; retained for recovery and audit instead of being physically removed. */
  deletedAt?: string
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
  /** Rate used to convert this transaction into the reporting currency, when available. */
  exchangeRateUsed?: number
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
  /** Paired transfer metadata; ordinary expense records leave these absent. */
  transactionType?: TransactionType
  transferId?: string
  transferAccountId?: string
  /** Group metadata for an expense split; each row is one category allocation. */
  splitGroupId?: string
  splitIndex?: number
  /** Soft-delete tombstone; retained for recovery and audit instead of being physically removed. */
  deletedAt?: string
  source: string
  createdAt: string
  updatedAt: string
}

/** Read-only unified view over income_records + expense_records for a single combined transaction list/UI. Storage stays split; this is computed on read, never persisted. */
export type UnifiedTransaction = {
  id: string
  kind: 'income' | 'expense' | 'transfer'
  date: string
  counterparty: string
  category: string
  accountId?: string
  currency: CurrencyCode
  amount: number
  exchangeRateUsed?: number
  convertedLkrAmount: number
  notes?: string
  documentRef?: string
  recurring?: boolean
  taxable?: boolean
  incomeSourceId?: string
  subcategory?: string
  tags?: string
  status?: 'pending' | 'cleared' | 'reconciled'
  /** Stable type in the unified read model; legacy rows are inferred from their collection. */
  transactionType: TransactionType
  transferId?: string
  transferAccountId?: string
  splitGroupId?: string
  splitIndex?: number
  source: string
  createdAt: string
  updatedAt: string
  deletedAt?: string
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

export type BudgetTemplateLine = {
  category: string
  currency: string
  budgetAmount: number
}

export type BudgetTemplate = {
  id: string
  name: string
  lines: Array<BudgetTemplateLine>
  source: string
  createdAt: string
  updatedAt: string
}

export type GoalCompletionEvent = {
  id: string
  goalId: string
  goalName: string
  targetAmount: number
  currency: string
  completedAt: string
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
  /** Original tax document path inside the private finance directory. */
  documentRef?: string
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
  status: 'active' | 'paused' | 'notice_period' | 'ended' | 'terminated'
  notes?: string
  /** Path to the original uploaded contract/offer letter, when created via that intake path. */
  documentRef?: string
  source: string
  createdAt: string
  updatedAt: string
}

export type SalaryHistoryEntry = {
  id: string
  incomeSourceId?: string
  employerName: string
  effectiveDate: string
  amount: number
  currency: CurrencyCode
  reason?: string
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
  /** Latest optional daily quote statistics from the CSE provider. */
  lastPriceHigh?: number
  lastPriceLow?: number
  lastPriceClose?: number
  lastPriceVolume?: number
  lastPriceTurnover?: number
  /** Bounded price observations captured from CSE refreshes or manual updates. */
  priceHistory?: Array<StockPricePoint>
  notes?: string
  /** Original broker/trade document path inside the private finance directory. */
  documentRef?: string
  source: string
  createdAt: string
  updatedAt: string
}

export type CseProviderHealth = {
  status: 'healthy' | 'degraded' | 'stale' | 'manual' | 'unknown'
  holdingsCount: number
  cseQuoteCount: number
  manualFallbackCount: number
  staleQuoteCount: number
  latestQuoteAt: string | null
}

export type StockPricePoint = {
  price: number
  observedAt: string
  source: 'cse_api' | 'manual'
  high?: number
  low?: number
  close?: number
  volume?: number
  turnover?: number
}

export type FixedDeposit = {
  id: string
  bankName: string
  principal: number
  currency: CurrencyCode
  interestRatePct: number
  interestPayout: 'monthly' | 'quarterly' | 'annually' | 'at_maturity'
  /** Manually recorded gross interest already paid by the bank. */
  interestReceived?: number
  /** Manually recorded withholding/tax deducted from received interest. */
  taxDeducted?: number
  /** Optional finance account where the bank pays out interest. */
  payoutAccountId?: string
  /** Preference only; no renewal or money movement is performed automatically. */
  autoRenew?: boolean
  startDate: string
  maturityDate: string
  status: 'active' | 'matured' | 'withdrawn'
  notes?: string
  /** Original certificate path, retained inside the private finance data directory. */
  documentRef?: string
  source: string
  createdAt: string
  updatedAt: string
}

export type NetWorthSnapshot = {
  id: string
  snapshotDate: string
  netWorthLkr: number
  cashLkr: number
  debtLkr: number
  investmentsLkr: number
  liquidNetWorthLkr: number
  lockedWealthLkr: number
  /** Holdings valued at the moment this snapshot was captured. */
  portfolioPositions?: Array<PortfolioSnapshotPosition>
  source: 'manual' | 'scheduled'
  createdAt: string
}

export type PortfolioSnapshotPosition = {
  holdingId: string
  symbol: string
  currency: CurrencyCode
  quantity: number
  price: number
  marketValue: number
  costBasis: number
  priceSource: 'cse_api' | 'manual' | 'buy_price_fallback'
}

export type InvestmentJournalEntry = {
  id: string
  stockHoldingId?: string
  symbol: string
  entryDate: string
  entryType: 'thesis' | 'review' | 'buy' | 'sell' | 'note'
  content: string
  thesis?: string
  invalidationCondition?: string
  nextReviewDate?: string
  source: string
  createdAt: string
  updatedAt: string
}

export type FinanceAiTaskStatus =
  | 'queued'
  | 'running'
  | 'awaiting_approval'
  | 'completed'
  | 'failed'
  | 'cancelled'

export type FinanceAiTaskStatusEvent = {
  status: FinanceAiTaskStatus
  at: string
  by?: 'human' | 'finance_agent' | 'system'
}

export type FinanceAiTask = {
  id: string
  auditCorrelationId: string
  taskType: string
  title: string
  status: FinanceAiTaskStatus
  risk: 'low' | 'medium' | 'high'
  requestedAction: string
  inputSummary: string
  resultSummary?: string
  errorMessage?: string
  approvalRequired: boolean
  source: string
  agentName?: string
  createdAt: string
  updatedAt: string
  startedAt?: string
  completedAt?: string
  statusHistory?: Array<FinanceAiTaskStatusEvent>
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
  /** Informational only (PF-1004 precedent) — does not affect debtLkr/propertyValueLkr/netWorthLkr, each already counted once independently. */
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

/** DOC-109: informational policy register; premiums and coverage are not assets or liabilities. */
export type InsurancePolicy = {
  id: string
  provider: string
  policyNumber?: string
  policyType: string
  insuredItem: string
  premiumAmount?: number
  premiumFrequency?: string
  coverageAmount?: number
  currency: CurrencyCode
  startDate: string
  endDate?: string
  status: 'active' | 'expired' | 'cancelled'
  notes?: string
  documentRef?: string
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

export type KnownSender = {
  id: string
  label: string
  matchAddress?: string
  matchDomain?: string
  passwordScheme?: string
  encryptedPassword?: string
  createdAt: string
  updatedAt: string
}

export type ExtractedTransaction = {
  kind: 'income' | 'expense'
  amount: number
  currency: string
  vendorOrSource: string
  date: string
  category?: string
  confidence: 'high' | 'medium' | 'low'
}

/** Payroll-specific fields retained until the user confirms the payment. */
export type ExtractedSalarySlip = {
  employerName: string
  employeeName?: string
  payPeriod?: string
  paymentDate?: string
  grossAmount?: number
  deductions?: number
  netAmount: number
  currency: string
  confidence: 'high' | 'medium' | 'low'
}

/** Trade-confirmation fields retained for review; confirming creates a journal entry, not a position. */
export type ExtractedContractNote = {
  symbol: string
  companyName?: string
  side: 'buy' | 'sell'
  quantity: number
  price: number
  grossAmount?: number
  fees?: number
  currency: string
  broker?: string
  tradeDate?: string
  settlementDate?: string
  confidence: 'high' | 'medium' | 'low'
}

/** Fixed-deposit certificate fields retained until the user approves creation. */
export type ExtractedFdCertificate = {
  bankName: string
  certificateNumber?: string
  principal: number
  currency: string
  interestRatePct: number
  interestPayout: 'monthly' | 'quarterly' | 'annually' | 'at_maturity'
  startDate?: string
  maturityDate?: string
  autoRenew?: boolean
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
  documentType: 'transaction' | 'statement' | 'contract'
  documentClass?: FinanceDocumentClass
  sourceRef: string
  /** SHA-256 of the original uploaded bytes, used for duplicate intake detection. */
  checksumSha256?: string
  passwordHint?: string
  matchedSenderId?: string
  matchedSenderLabel?: string
  extracted?: ExtractedTransaction
  extractedSalarySlip?: ExtractedSalarySlip
  extractedContractNote?: ExtractedContractNote
  extractedFdCertificate?: ExtractedFdCertificate
  extractedContract?: ExtractedContract
  contractChanges?: Array<ContractChange>
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
  baseCurrency: CurrencyCode
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
  /** AUTO-110: suppresses non-critical Telegram delivery without hiding in-app alerts. */
  quietModeEnabled?: boolean
  /** PF-303: user-set emergency fund target, in months of average expenses. Unset/0 means no target configured yet. */
  emergencyFundTargetMonths?: number
  /** PF-304: user-set savings rate target, as a percentage. Unset/0 means no target configured yet. */
  savingsRateTargetPct?: number
  /** PF-808: monthly budget warning threshold, as a percentage of the budget. */
  budgetAlertThresholdPct?: number
  /** PF-810: reusable monthly budget plans; applying one never overwrites existing rows. */
  budgetTemplates?: Array<BudgetTemplate>
  /** PF-1009: bounded goal completion events; informational, never a balance mutation. */
  goalCompletionEvents?: Array<GoalCompletionEvent>
  /** PF-302: minimum cash reserve in LKR used by the safe-to-spend estimate. */
  minimumCashReserveLkr?: number
  /** PF-300: explicit user-authored thresholds used by future rule evaluations. */
  financialRules?: FinancialRules
  /** WEALTH-107: user-set long-term net worth target. Unset/0 means no target configured yet. */
  wealthGoalTargetLkr?: number
  /** WEALTH-107: optional target date for wealthGoalTargetLkr — a target date without an amount is meaningless, so this is only read when wealthGoalTargetLkr is set. */
  wealthGoalTargetDate?: string
  /** AI-202: capped (last 10) recent-activity list for the Finance Analyst — same "bounded log" convention as AI-506's gmailIngest.syncHistory. */
  financeQaHistory?: Array<{ at: number; question: string; answer: string }>
  /** AI-205: explicit opt-in for review-only proactive finance tasks. */
  proactiveInsightsEnabled?: boolean
  /** PF-505: explicit salary-rate changes, separate from posted income events. */
  salaryHistory?: Array<SalaryHistoryEntry>
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
  /** PF-104: standalone transfer rows retained for unified-ledger consumers. */
  transfers: Array<Record<string, unknown>>
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
  investment_journal: Array<InvestmentJournalEntry>
  ai_tasks: Array<FinanceAiTask>
  net_worth_snapshots: Array<NetWorthSnapshot>
  loans: Array<Loan>
  properties: Array<Property>
  beneficiaries: Array<Beneficiary>
  insurance_policies: Array<InsurancePolicy>
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

function isTransferRecord(record: { transactionType?: string }): boolean {
  return record.transactionType === 'transfer'
}

function isDeletedRecord(record: { deletedAt?: string }): boolean {
  return Boolean(record.deletedAt)
}

function nowIso(): string {
  return new Date().toISOString()
}

function recordGoalCompletionEvent(
  db: FinanceDatabase,
  goal: Record<string, unknown>,
): void {
  const goalId = stringField(goal, 'id', '')
  const events = db.settings.goalCompletionEvents ?? []
  if (!goalId || events.some((event) => event.goalId === goalId)) return
  db.settings.goalCompletionEvents = [
    ...events,
    {
      id: randomUUID(),
      goalId,
      goalName: stringField(goal, 'name', 'Savings goal'),
      targetAmount: numberField(goal, 'targetAmount', 0),
      currency: stringField(goal, 'currency', 'LKR'),
      completedAt: nowIso(),
    },
  ].slice(-20)
}

function normalizedStockPriceHistory(value: unknown): Array<StockPricePoint> {
  if (!Array.isArray(value)) return []
  return value
    .filter(
      (point): point is Record<string, unknown> =>
        typeof point === 'object' && point !== null,
    )
    .map((point) => {
      const source: StockPricePoint['source'] =
        point.source === 'cse_api' ? 'cse_api' : 'manual'
      const normalized: StockPricePoint = {
        price: typeof point.price === 'number' ? point.price : Number.NaN,
        observedAt:
          typeof point.observedAt === 'string' ? point.observedAt : '',
        source,
      }
      if (typeof point.high === 'number' && point.high > 0)
        normalized.high = point.high
      if (typeof point.low === 'number' && point.low > 0)
        normalized.low = point.low
      if (typeof point.close === 'number' && point.close > 0)
        normalized.close = point.close
      if (typeof point.volume === 'number' && point.volume > 0)
        normalized.volume = point.volume
      if (typeof point.turnover === 'number' && point.turnover > 0)
        normalized.turnover = point.turnover
      return normalized
    })
    .filter(
      (point) =>
        Number.isFinite(point.price) && point.price > 0 && point.observedAt,
    )
    .slice(-365)
}

function appendStockPricePoint(
  existing: unknown,
  point: StockPricePoint,
): Array<StockPricePoint> {
  const history = normalizedStockPriceHistory(existing)
  const last = history.at(-1)
  if (last?.observedAt === point.observedAt && last.price === point.price) {
    return history
  }
  return [...history, point].slice(-365)
}

function budgetTemplateLines(value: unknown): Array<BudgetTemplateLine> {
  if (!Array.isArray(value)) return []
  return value
    .map((line) => {
      if (!line || typeof line !== 'object' || Array.isArray(line)) return null
      const item = line as Record<string, unknown>
      const category =
        typeof item.category === 'string' ? item.category.trim() : ''
      const currency =
        typeof item.currency === 'string'
          ? item.currency.trim().toUpperCase()
          : 'LKR'
      const budgetAmount =
        typeof item.budgetAmount === 'number'
          ? item.budgetAmount
          : Number(item.budgetAmount)
      if (
        !category ||
        !SUPPORTED_CURRENCIES.includes(
          currency as (typeof SUPPORTED_CURRENCIES)[number],
        ) ||
        !Number.isFinite(budgetAmount) ||
        budgetAmount <= 0
      )
        return null
      return {
        category,
        currency,
        budgetAmount: Math.round(budgetAmount * 100) / 100,
      }
    })
    .filter((line): line is BudgetTemplateLine => line !== null)
}

export function saveBudgetTemplate(
  db: FinanceDatabase,
  payload: Record<string, unknown>,
): BudgetTemplate {
  const name =
    typeof payload.name === 'string' ? payload.name.trim().slice(0, 80) : ''
  const lines = budgetTemplateLines(payload.lines)
  if (!name) throw new Error('Template name is required.')
  if (lines.length === 0)
    throw new Error('At least one valid budget line is required.')
  const existingId = typeof payload.id === 'string' ? payload.id : ''
  const existing = db.settings.budgetTemplates?.find(
    (template) => template.id === existingId,
  )
  const now = nowIso()
  const template: BudgetTemplate = {
    id: existing?.id ?? randomUUID(),
    name,
    lines,
    source: existing?.source ?? 'manual',
    createdAt: existing?.createdAt ?? now,
    updatedAt: now,
  }
  db.settings.budgetTemplates = [
    ...(db.settings.budgetTemplates ?? []).filter(
      (item) => item.id !== template.id,
    ),
    template,
  ]
  return template
}

export function deleteBudgetTemplate(db: FinanceDatabase, id: string): boolean {
  const templates = db.settings.budgetTemplates ?? []
  const next = templates.filter((template) => template.id !== id)
  db.settings.budgetTemplates = next
  return next.length !== templates.length
}

export function applyBudgetTemplate(
  db: FinanceDatabase,
  templateId: string,
  month: string,
): { appliedCount: number; skippedCount: number; template: BudgetTemplate } {
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month))
    throw new Error('A valid target month is required.')
  const template = (db.settings.budgetTemplates ?? []).find(
    (item) => item.id === templateId,
  )
  if (!template) throw new Error('Budget template was not found.')
  let appliedCount = 0
  let skippedCount = 0
  for (const line of template.lines) {
    const exists = db.budget_categories.some(
      (row) =>
        row.month === month &&
        row.category === line.category &&
        row.currency === line.currency,
    )
    if (exists) {
      skippedCount += 1
      continue
    }
    const now = nowIso()
    db.budget_categories.push({
      id: randomUUID(),
      month,
      category: line.category,
      currency: line.currency,
      budgetAmount: line.budgetAmount,
      source: `budget_template:${template.id}`,
      createdAt: now,
      updatedAt: now,
    })
    appliedCount += 1
  }
  return { appliedCount, skippedCount, template }
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
    budgetAlertThresholdPct: 80,
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
    investment_journal: [],
    ai_tasks: [],
    net_worth_snapshots: [],
    loans: [],
    properties: [],
    beneficiaries: [],
    insurance_policies: [],
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
  if (process.env.VITEST || process.env.NODE_ENV === 'test') {
    return readFinanceStoreJsonCompatibility()
  }
  const postgresDb = readFinancePostgresNormalized()
  if (!postgresDb) {
    throw new Error(
      'Finance PostgreSQL runtime store is unavailable; refusing JSON fallback.',
    )
  }
  return migrateFinanceStore(postgresDb)
}

function readFinanceStoreJsonCompatibility(): FinanceDatabase {
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
  // Postgres Migration Phase D: calls the Postgres write directly instead of
  // through the now-removed personal-finance-store.ts JSON split-store
  // mirror (frozen at ~/.hermes/finance/personal-finance.json.frozen-phaseD-*
  // as a rollback-only snapshot, no longer written to).
  writePersonalFinancePostgresStore({
    finance_accounts: db.finance_accounts,
    income_records: db.income_records,
    expense_records: db.expense_records,
    budget_categories: db.budget_categories,
    categories: db.categories,
    subcategories: db.subcategories,
    merchants: db.merchants,
    tags: db.tags,
    savings_goals: db.savings_goals,
    tax_records: db.tax_records,
    exchange_rates: db.exchange_rates,
    investment_accounts: db.investment_accounts,
    pending_ingestions: db.pending_ingestions,
    income_sources: db.income_sources,
    stock_holdings: db.stock_holdings,
    fixed_deposits: db.fixed_deposits,
    investment_journal: db.investment_journal,
    ai_tasks: db.ai_tasks,
    net_worth_snapshots: db.net_worth_snapshots,
    loans: db.loans,
    properties: db.properties,
    beneficiaries: db.beneficiaries,
    personalFinanceSettings: {
      baseCurrency: db.settings.baseCurrency,
      alertsEnabled: db.settings.alertsEnabled,
      quietModeEnabled: db.settings.quietModeEnabled,
      emergencyFundTargetMonths: db.settings.emergencyFundTargetMonths,
      savingsRateTargetPct: db.settings.savingsRateTargetPct,
      budgetAlertThresholdPct: db.settings.budgetAlertThresholdPct,
      budgetTemplates: db.settings.budgetTemplates,
      goalCompletionEvents: db.settings.goalCompletionEvents,
      minimumCashReserveLkr: db.settings.minimumCashReserveLkr,
      financialRules: db.settings.financialRules,
      wealthGoalTargetLkr: db.settings.wealthGoalTargetLkr,
      wealthGoalTargetDate: db.settings.wealthGoalTargetDate,
      financeQaHistory: db.settings.financeQaHistory,
      proactiveInsightsEnabled: db.settings.proactiveInsightsEnabled,
      salaryHistory: db.settings.salaryHistory,
      gmailIngestState: (db.settings as unknown as Record<string, unknown>)
        .gmailIngest as
        | {
            lastSyncedAtSeconds?: number
            syncHistory?: Array<{
              at: number
              found: number
              queued: number
              skippedAlreadyQueued: number
            }>
          }
        | undefined,
      categoryCorrections: (db.settings as unknown as Record<string, unknown>)
        .categoryCorrections as Record<string, string> | undefined,
    },
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
 * mirrorIntoSplitStores() writes the trading split store from this same
 * base file's own data on every write, so in the normal case it's never
 * staler than it — overlay it here so callers gradually source trading
 * collections from the split file, while the trading-shared remainder of
 * settings and the still-unsplit misc collections (trading_platforms,
 * api_connections, agent_memory, audit_logs, error_logs) keep coming from
 * this shared base file (never split — see the plan's own rationale).
 *
 * Postgres Migration Phase D: personal-finance collections and settings are
 * now a clean TWO-tier fallback: Postgres (via
 * readPersonalFinancePostgresStore()) when it succeeds, otherwise whatever
 * is already in `base` (no explicit override applied) — the old JSON split
 * store (personal-finance.json) is retired (frozen as a rollback snapshot,
 * see personal-finance-store.ts's history) since nothing writes it anymore
 * and it would otherwise silently go stale forever. The base file itself
 * never goes stale for these fields despite having no dedicated mirror-
 * write step: overlaySplitStores() already populates it with fresh
 * Postgres data on every read, and the app's normal read-mutate-write cycle
 * serializes that already-current object straight back to disk. Set
 * HERMES_PERSONAL_FINANCE_READ_SOURCE=json to skip Postgres and use the
 * base file directly — still an instant, no-redeploy rollback.
 */
function overlaySplitStores(base: FinanceDatabase): FinanceDatabase {
  const baseUpdatedMs = updatedAtMs(base)
  const personalSource =
    process.env.HERMES_PERSONAL_FINANCE_READ_SOURCE === 'json'
      ? null
      : readPersonalFinancePostgresStore()
  const trading = readTradingStore()
  const tradingFresh = trading && Date.parse(trading.updatedAt) >= baseUpdatedMs
  const postgresSettings = personalSource?.personalFinanceSettings

  const merged = {
    ...base,
    ...(personalSource
      ? {
          finance_accounts: personalSource.finance_accounts,
          income_records: personalSource.income_records,
          expense_records: personalSource.expense_records,
          budget_categories: personalSource.budget_categories,
          categories: personalSource.categories ?? [],
          subcategories: personalSource.subcategories ?? [],
          merchants: personalSource.merchants ?? [],
          tags: personalSource.tags ?? [],
          savings_goals: personalSource.savings_goals,
          tax_records: personalSource.tax_records,
          exchange_rates: personalSource.exchange_rates,
          investment_accounts: personalSource.investment_accounts,
          pending_ingestions: personalSource.pending_ingestions,
          income_sources: personalSource.income_sources,
          stock_holdings: personalSource.stock_holdings,
          fixed_deposits: personalSource.fixed_deposits,
          investment_journal: personalSource.investment_journal ?? [],
          ai_tasks: personalSource.ai_tasks ?? [],
          net_worth_snapshots: personalSource.net_worth_snapshots ?? [],
          loans: personalSource.loans ?? [],
          properties: personalSource.properties ?? [],
          beneficiaries: personalSource.beneficiaries ?? [],
          insurance_policies: personalSource.insurance_policies ?? [],
        }
      : {}),
    ...(postgresSettings
      ? {
          settings: {
            ...base.settings,
            ...(postgresSettings.baseCurrency !== undefined
              ? { baseCurrency: postgresSettings.baseCurrency }
              : {}),
            ...(postgresSettings.alertsEnabled !== undefined
              ? { alertsEnabled: postgresSettings.alertsEnabled }
              : {}),
            emergencyFundTargetMonths:
              postgresSettings.emergencyFundTargetMonths,
            savingsRateTargetPct: postgresSettings.savingsRateTargetPct,
            budgetAlertThresholdPct: postgresSettings.budgetAlertThresholdPct,
            budgetTemplates:
              postgresSettings.budgetTemplates as FinanceSettings['budgetTemplates'],
            goalCompletionEvents:
              postgresSettings.goalCompletionEvents as FinanceSettings['goalCompletionEvents'],
            minimumCashReserveLkr: postgresSettings.minimumCashReserveLkr,
            financialRules: postgresSettings.financialRules,
            wealthGoalTargetLkr: postgresSettings.wealthGoalTargetLkr,
            wealthGoalTargetDate: postgresSettings.wealthGoalTargetDate,
            financeQaHistory: postgresSettings.financeQaHistory,
            salaryHistory:
              postgresSettings.salaryHistory as FinanceSettings['salaryHistory'],
            gmailIngest: postgresSettings.gmailIngestState,
            categoryCorrections: postgresSettings.categoryCorrections,
          } as FinanceSettings,
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
          connectivityBreaker:
            trading.connectivityBreaker as ConnectivityBreakerState,
        }
      : {}),
  } as FinanceDatabase
  return normalizeFinanceCurrencyFields(merged)
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

export function migrateFinanceStore(
  db: Partial<FinanceDatabase> & {
    schemaVersion?: unknown
    settings?: Partial<FinanceSettings> | null
  },
): FinanceDatabase {
  if (typeof db !== 'object' || Array.isArray(db)) {
    throw new Error('Finance store snapshot must be an object')
  }
  const rawVersion = db.schemaVersion
  const incomingVersion = rawVersion === undefined ? 0 : rawVersion
  if (!Number.isInteger(incomingVersion) || incomingVersion < 0) {
    throw new Error('Finance schema version must be a non-negative integer')
  }
  if (incomingVersion > FINANCE_SCHEMA_VERSION) {
    throw new Error(
      `Finance schema version ${incomingVersion} is newer than the supported version ${FINANCE_SCHEMA_VERSION}`,
    )
  }
  const baseline = createEmptyFinanceDatabase()
  const migrated = {
    ...baseline,
    ...db,
    settings:
      db.settings &&
      typeof db.settings === 'object' &&
      !Array.isArray(db.settings)
        ? { ...baseline.settings, ...db.settings }
        : baseline.settings,
    schemaVersion: FINANCE_SCHEMA_VERSION,
  }
  for (const [key, baselineValue] of Object.entries(baseline)) {
    if (
      Array.isArray(baselineValue) &&
      !Array.isArray(migrated[key as keyof FinanceDatabase])
    ) {
      Object.assign(migrated as unknown as Record<string, unknown>, {
        [key]: baselineValue,
      })
    }
  }

  // Repair legacy/imported casing at the compatibility boundary. This is a
  // read-time normalization only; it never changes amounts or creates FX data.
  const currencyCollections = [
    'finance_accounts',
    'income_records',
    'expense_records',
    'budget_categories',
    'tax_records',
    'income_sources',
    'stock_holdings',
    'fixed_deposits',
    'loans',
    'properties',
    'insurance_policies',
  ] as const
  for (const key of currencyCollections) {
    const records = migrated[key]
    if (!Array.isArray(records)) continue
    migrated[key] = records.map((record) => {
      if (typeof record !== 'object' || Array.isArray(record)) return record
      const normalized = { ...record } as Record<string, unknown>
      for (const field of ['currency', 'originalCurrency', 'feeCurrency']) {
        if (field in normalized)
          normalized[field] = normalizeCurrencyCode(normalized[field])
      }
      return normalized
    }) as never
  }
  if (Array.isArray(migrated.exchange_rates)) {
    migrated.exchange_rates = migrated.exchange_rates.map((rate) => ({
      ...rate,
      ...(typeof rate.base === 'string'
        ? { base: normalizeCurrencyCode(rate.base) }
        : {}),
      ...(typeof rate.target === 'string'
        ? { target: normalizeCurrencyCode(rate.target) }
        : {}),
    }))
  }
  const reportingCurrencies = Array.isArray(
    migrated.settings.reportingCurrencies,
  )
    ? migrated.settings.reportingCurrencies.map((currency) =>
        normalizeCurrencyCode(currency),
      )
    : baseline.settings.reportingCurrencies
  migrated.settings = {
    ...migrated.settings,
    baseCurrency: normalizeCurrencyCode(migrated.settings.baseCurrency),
    reportingCurrencies,
  }
  return migrated
}

export function writeFinanceStore(db: FinanceDatabase): void {
  const updated = { ...db, updatedAt: nowIso() }
  if (process.env.VITEST || process.env.NODE_ENV === 'test') {
    fs.mkdirSync(FINANCE_DATA_DIR, { recursive: true, mode: 0o700 })
    writeFinanceJsonStore(updated)
    writeFinancePostgresStore(updated)
  } else if (!writeFinancePostgresNormalized(updated)) {
    throw new Error(
      'Finance PostgreSQL runtime store is unavailable; write was not persisted.',
    )
  }
  // Invalidate (rather than repopulate) the read cache: `updated` here is
  // the raw pre-overlay object, not the merged result readFinanceStore()
  // normally returns (Postgres-sourced personal-finance collections/settings,
  // split-store trading data, etc. — see overlaySplitStores()). Caching it
  // directly would let callers observe a write that skips that merge.
  // Invalidating just means the very next read after a write pays the full
  // uncached cost once, which is rare next to the read-heavy dashboard
  // access pattern this cache targets.
  financeStoreCache = null
}

export function setNonLiveExecutionMode(
  mode: 'observe_only' | 'paper_trade' | 'testnet_execute',
): FinanceDatabase {
  const db = readFinanceStore()
  const validationRuns = (db.settings as Record<string, unknown>).validationRuns
  const activeRuns =
    validationRuns && typeof validationRuns === 'object'
      ? ((validationRuns as { active?: Array<{ stage?: string }> }).active ??
        [])
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

export function appendAuditLog(
  action: string,
  details: Record<string, unknown>,
): void {
  const previousHash = latestFinanceAuditHash()
  const unsignedEntry = {
    id: randomUUID(),
    action,
    details: maskSensitive(details) as Record<string, unknown>,
    source: 'hermes-finance',
    createdAt: nowIso(),
    chainVersion: 1,
    previousHash,
  }
  const entry = {
    ...unsignedEntry,
    entryHash: hashFinanceAuditEntry(unsignedEntry),
  }
  try {
    fs.mkdirSync(FINANCE_DATA_DIR, { recursive: true, mode: 0o700 })
    fs.appendFileSync(FINANCE_AUDIT_PATH, `${JSON.stringify(entry)}\n`, {
      mode: 0o600,
    })
    if (process.env.VITEST || process.env.NODE_ENV === 'test') {
      appendFinanceAuditPostgres(entry)
      return
    }
    if (!appendFinanceAuditPostgres(entry)) {
      // Best-effort persistence: keep the local audit trail authoritative even
      // when Postgres is temporarily unavailable, rather than crashing a live
      // trading cycle or dashboard request.
      return
    }
  } catch {
    // Fall back silently to the local JSONL file; the local audit trail is still
    // valuable even when the database is unavailable.
  }
}

function hashFinanceAuditEntry(entry: {
  id: string
  action: string
  details: Record<string, unknown>
  source: string
  createdAt: string
  chainVersion: number
  previousHash: string | null
}): string {
  return createHash('sha256').update(JSON.stringify(entry)).digest('hex')
}

function latestFinanceAuditHash(): string | null {
  try {
    const lines = fs
      .readFileSync(FINANCE_AUDIT_PATH, 'utf8')
      .split('\n')
      .filter(Boolean)
    for (let index = lines.length - 1; index >= 0; index -= 1) {
      const parsed = JSON.parse(lines[index]) as Record<string, unknown>
      if (typeof parsed.entryHash === 'string' && parsed.entryHash)
        return parsed.entryHash
      // A legacy tail starts a new verifiable chain segment.
      return null
    }
  } catch {
    return null
  }
  return null
}

export type FinanceAuditChainStatus = {
  valid: boolean
  entries: number
  chainedEntries: number
  legacyEntries: number
  firstInvalidAt: string | null
  latestHash: string | null
  fileBytes: number
  retentionDays: number
  retentionWarning: boolean
}

/** AI-114: verifies the append-only audit chain without mutating it. */
export function verifyFinanceAuditChain(): FinanceAuditChainStatus {
  let raw = ''
  try {
    raw = fs.readFileSync(FINANCE_AUDIT_PATH, 'utf8')
  } catch {
    raw = ''
  }
  const lines = raw.split('\n').filter(Boolean)
  let previousHash: string | null = null
  let chainedEntries = 0
  let legacyEntries = 0
  let firstInvalidAt: string | null = null
  let latestHash: string | null = null
  for (const line of lines) {
    let entry: Record<string, unknown>
    try {
      entry = JSON.parse(line) as Record<string, unknown>
    } catch {
      if (!firstInvalidAt) firstInvalidAt = 'unparseable-line'
      continue
    }
    if (
      typeof entry.entryHash !== 'string' ||
      typeof entry.chainVersion !== 'number'
    ) {
      legacyEntries += 1
      previousHash = null
      continue
    }
    const unsigned = {
      id: typeof entry.id === 'string' ? entry.id : '',
      action: typeof entry.action === 'string' ? entry.action : '',
      details:
        entry.details && typeof entry.details === 'object'
          ? (entry.details as Record<string, unknown>)
          : {},
      source: typeof entry.source === 'string' ? entry.source : '',
      createdAt: typeof entry.createdAt === 'string' ? entry.createdAt : '',
      chainVersion: entry.chainVersion,
      previousHash:
        typeof entry.previousHash === 'string' ? entry.previousHash : null,
    }
    const valid =
      unsigned.previousHash === previousHash &&
      hashFinanceAuditEntry(unsigned) === entry.entryHash
    if (!valid && !firstInvalidAt) {
      firstInvalidAt = unsigned.createdAt || 'unknown-time'
    }
    if (valid) {
      chainedEntries += 1
      previousHash = entry.entryHash
      latestHash = entry.entryHash
    }
  }
  const retentionRaw = Number(process.env.HERMES_FINANCE_AUDIT_RETENTION_DAYS)
  const retentionDays =
    Number.isFinite(retentionRaw) && retentionRaw >= 1
      ? Math.floor(retentionRaw)
      : 3650
  const oldestEntry = lines[0]
    ? (() => {
        try {
          return (JSON.parse(lines[0]) as Record<string, unknown>).createdAt
        } catch {
          return undefined
        }
      })()
    : undefined
  const oldestMs =
    typeof oldestEntry === 'string' ? Date.parse(oldestEntry) : NaN
  return {
    valid: !firstInvalidAt,
    entries: lines.length,
    chainedEntries,
    legacyEntries,
    firstInvalidAt,
    latestHash,
    fileBytes: Buffer.byteLength(raw, 'utf8'),
    retentionDays,
    retentionWarning:
      Number.isFinite(oldestMs) &&
      Date.now() - oldestMs > retentionDays * 86_400_000,
  }
}

export type FinanceAuditPrunePreview = {
  retentionDays: number
  cutoff: string
  totalEntries: number
  eligibleEntries: number
  retainedEntries: number
  oldestEntry: string | null
  newestEntry: string | null
}

function auditRetentionDays(value?: number): number {
  const candidate =
    value ?? Number(process.env.HERMES_FINANCE_AUDIT_RETENTION_DAYS)
  return Number.isFinite(candidate) && candidate >= 1
    ? Math.floor(candidate)
    : 3650
}

function readFinanceAuditEntriesForRetention(): Array<Record<string, unknown>> {
  let raw = ''
  try {
    raw = fs.readFileSync(FINANCE_AUDIT_PATH, 'utf8')
  } catch {
    return []
  }
  return raw
    .split('\n')
    .filter(Boolean)
    .map((line) => JSON.parse(line) as Record<string, unknown>)
}

export function previewFinanceAuditPrune(
  requestedRetentionDays?: number,
  now = new Date(),
): FinanceAuditPrunePreview {
  const retentionDays = auditRetentionDays(requestedRetentionDays)
  const cutoffMs = now.getTime() - retentionDays * 86_400_000
  const entries = readFinanceAuditEntriesForRetention()
  const dated = entries
    .map((entry) =>
      typeof entry.createdAt === 'string' ? entry.createdAt : null,
    )
    .filter((createdAt): createdAt is string => createdAt !== null)
  const eligibleEntries = entries.filter((entry) => {
    const createdAt =
      typeof entry.createdAt === 'string' ? Date.parse(entry.createdAt) : NaN
    return Number.isFinite(createdAt) && createdAt < cutoffMs
  }).length
  return {
    retentionDays,
    cutoff: new Date(cutoffMs).toISOString(),
    totalEntries: entries.length,
    eligibleEntries: Math.min(eligibleEntries, Math.max(0, entries.length - 1)),
    retainedEntries:
      entries.length -
      Math.min(eligibleEntries, Math.max(0, entries.length - 1)),
    oldestEntry: dated.at(0) ?? null,
    newestEntry: dated.at(-1) ?? null,
  }
}

/** AI-115: prune only after an encrypted archive has been successfully written. */
export function pruneFinanceAudit(
  preview: FinanceAuditPrunePreview,
  archiveCompleted: boolean,
): { prunedEntries: number; retainedEntries: number } {
  if (!archiveCompleted)
    throw new Error('Encrypted audit archive is required before pruning.')
  const entries = readFinanceAuditEntriesForRetention()
  const cutoffMs = Date.parse(preview.cutoff)
  const eligible = entries.filter((entry) => {
    const createdAt =
      typeof entry.createdAt === 'string' ? Date.parse(entry.createdAt) : NaN
    return Number.isFinite(createdAt) && createdAt < cutoffMs
  })
  const keepCount = Math.max(
    1,
    entries.length - Math.min(eligible.length, Math.max(0, entries.length - 1)),
  )
  const retained = entries.slice(-keepCount)
  let previousHash: string | null = null
  const reanchored = retained.map((entry) => {
    const unsigned = {
      id: typeof entry.id === 'string' ? entry.id : randomUUID(),
      action: typeof entry.action === 'string' ? entry.action : 'unknown',
      details:
        entry.details && typeof entry.details === 'object'
          ? (entry.details as Record<string, unknown>)
          : {},
      source: typeof entry.source === 'string' ? entry.source : 'unknown',
      createdAt:
        typeof entry.createdAt === 'string' ? entry.createdAt : nowIso(),
      chainVersion: 1,
      previousHash,
    }
    const next = { ...unsigned, entryHash: hashFinanceAuditEntry(unsigned) }
    previousHash = next.entryHash
    return next
  })
  const temporary = `${FINANCE_AUDIT_PATH}.${randomUUID()}.tmp`
  fs.mkdirSync(FINANCE_DATA_DIR, { recursive: true, mode: 0o700 })
  fs.writeFileSync(
    temporary,
    reanchored.map((entry) => JSON.stringify(entry)).join('\n') +
      (reanchored.length ? '\n' : ''),
    { mode: 0o600, flag: 'wx' },
  )
  fs.renameSync(temporary, FINANCE_AUDIT_PATH)
  return {
    prunedEntries: entries.length - retained.length,
    retainedEntries: retained.length,
  }
}

export type TransactionAuditEntry = {
  id: string
  action: string
  details: Record<string, unknown>
  source: string
  createdAt: string
}

/** Read the redacted transaction mutation history for the Personal Finance UI. */
export function readTransactionAudit(limit = 50): Array<TransactionAuditEntry> {
  try {
    const entries = fs
      .readFileSync(FINANCE_AUDIT_PATH, 'utf8')
      .split('\n')
      .filter(Boolean)
      .flatMap((line) => {
        try {
          return [JSON.parse(line) as Record<string, unknown>]
        } catch {
          // A truncated or manually-corrupted line must not hide every valid
          // transaction entry that follows it. The chain verifier remains the
          // authoritative integrity signal for operators.
          return []
        }
      })
      .filter((entry) => {
        const action = typeof entry.action === 'string' ? entry.action : ''
        return /^record_(added|updated|deleted):(income|expense|transfer|split)$/.test(
          action,
        )
      })
      .map((entry) => ({
        id: typeof entry.id === 'string' ? entry.id : randomUUID(),
        action: String(entry.action),
        details:
          entry.details && typeof entry.details === 'object'
            ? (entry.details as Record<string, unknown>)
            : {},
        source: typeof entry.source === 'string' ? entry.source : 'unknown',
        createdAt: typeof entry.createdAt === 'string' ? entry.createdAt : '',
      }))
    return entries.slice(-Math.max(1, Math.min(limit, 100))).reverse()
  } catch {
    return []
  }
}

/** Read the raw local audit stream only for encryption into a backup envelope. */
export function readFinanceAuditLog(): string {
  try {
    return fs.readFileSync(FINANCE_AUDIT_PATH, 'utf8')
  } catch {
    return ''
  }
}

function transactionAuditSnapshot(
  record: IncomeRecord | ExpenseRecord | undefined,
): Record<string, unknown> | undefined {
  if (!record) return undefined
  const isIncome = 'dateReceived' in record
  return {
    id: record.id,
    kind: isIncome ? 'income' : 'expense',
    date: isIncome ? record.dateReceived : record.date,
    counterparty: isIncome ? record.sourceName : record.vendor,
    category: isIncome ? record.incomeType : record.category,
    amount: isIncome ? record.originalAmount : record.amount,
    currency: isIncome ? record.originalCurrency : record.currency,
    exchangeRateUsed: record.exchangeRateUsed,
    convertedLkrAmount: record.convertedLkrAmount,
    accountId: record.accountId,
    status: record.status,
    transactionType: record.transactionType,
    transferId: record.transferId,
    splitGroupId: 'splitGroupId' in record ? record.splitGroupId : undefined,
    splitIndex: 'splitIndex' in record ? record.splitIndex : undefined,
    deletedAt: record.deletedAt,
  }
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
  if (!(process.env.VITEST || process.env.NODE_ENV === 'test')) {
    const pg = financePostgresStatus()
    const postgresDb = readFinancePostgresNormalized()
    const health = buildFinanceStorageHealth({
      jsonDb: null,
      postgresDb,
      postgres: {
        ...pg,
        snapshotAvailable: postgresDb !== null,
      },
    })
    return {
      active: postgresDb ? 'postgres' : 'unavailable',
      fallback: 'none',
      jsonPath: FINANCE_DATA_PATH,
      auditPath: FINANCE_AUDIT_PATH,
      postgres: pg,
      health,
    }
  }
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
    const dateReceived = stringField(
      payload,
      'dateReceived',
      createdAt.slice(0, 10),
    )
    const originalCurrency = currencyField(payload, 'originalCurrency', 'LKR')
    const originalAmount = numberField(payload, 'originalAmount', 0)
    const fx = resolveTransactionFx(
      originalAmount,
      originalCurrency,
      dateReceived,
      optionalNumber(payload, 'exchangeRateUsed'),
      numberField(payload, 'convertedLkrAmount', originalAmount),
    )
    db.income_records.push({
      ...base,
      dateReceived,
      sourceName: stringField(payload, 'sourceName', 'Unspecified income'),
      incomeType: stringField(payload, 'incomeType', 'Other income'),
      incomeSubtype: incomeSubtypeField(payload.incomeSubtype),
      originalCurrency,
      originalAmount,
      exchangeRateUsed: fx.exchangeRateUsed ?? 1,
      convertedLkrAmount: fx.convertedLkrAmount,
      accountId: optionalString(payload, 'accountId'),
      taxable: booleanField(payload, 'taxable', true),
      notes: optionalString(payload, 'notes'),
      documentRef: optionalString(payload, 'documentRef'),
      incomeSourceId: optionalString(payload, 'incomeSourceId'),
      stockHoldingId: optionalString(payload, 'stockHoldingId'),
      tags: optionalString(payload, 'tags'),
      status: reconciliationStatus(payload.status),
      transactionType:
        payload.transactionType === 'transfer' ? 'transfer' : undefined,
      transferId: optionalString(payload, 'transferId'),
      transferAccountId: optionalString(payload, 'transferAccountId'),
    })
  } else if (kind === 'expense') {
    const date = stringField(payload, 'date', createdAt.slice(0, 10))
    const currency = currencyField(payload, 'currency', 'LKR')
    const amount = numberField(payload, 'amount', 0)
    const fx = resolveTransactionFx(
      amount,
      currency,
      date,
      optionalNumber(payload, 'exchangeRateUsed'),
      numberField(payload, 'convertedLkrAmount', amount),
    )
    db.expense_records.push({
      ...base,
      date,
      vendor: stringField(payload, 'vendor', 'Unspecified vendor'),
      category: stringField(payload, 'category', 'Other'),
      subcategory: optionalString(payload, 'subcategory'),
      accountId: optionalString(payload, 'accountId'),
      currency,
      amount,
      exchangeRateUsed: fx.exchangeRateUsed,
      convertedLkrAmount: fx.convertedLkrAmount,
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
      transactionType:
        payload.transactionType === 'transfer' ? 'transfer' : undefined,
      transferId: optionalString(payload, 'transferId'),
      transferAccountId: optionalString(payload, 'transferAccountId'),
    })
  } else if (kind === 'account') {
    db.finance_accounts.push({
      ...base,
      name: stringField(payload, 'name', 'Account'),
      type: accountType(payload.type),
      currency: currencyField(payload, 'currency', 'LKR'),
      balance: numberField(payload, 'balance', 0),
      openingBalance: optionalNumber(payload, 'openingBalance'),
      openingBalanceDate: optionalString(payload, 'openingBalanceDate'),
      maskedIdentifier: optionalString(payload, 'maskedIdentifier'),
      platform: optionalString(payload, 'platform'),
      documentRef: optionalString(payload, 'documentRef'),
    })
  } else if (kind === 'goal') {
    db.savings_goals.push({
      ...base,
      name: stringField(payload, 'name', 'Savings goal'),
      targetAmount: numberField(payload, 'targetAmount', 0),
      currentAmount: numberField(payload, 'currentAmount', 0),
      currency: currencyField(payload, 'currency', 'LKR'),
      targetDate: optionalString(payload, 'targetDate'),
      monthlyContribution: numberField(payload, 'monthlyContribution', 0),
      priority: numberField(payload, 'priority', 3),
      linkedAccountId: optionalString(payload, 'linkedAccountId'),
      status: goalStatus(payload.status),
      goalKind: goalKindField(payload.goalKind),
    })
    const goal = db.savings_goals.at(-1)
    if (
      goal &&
      goal.currentAmount >= goal.targetAmount &&
      goal.targetAmount > 0
    ) {
      recordGoalCompletionEvent(db, goal)
    }
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
      currency: currencyField(payload, 'currency', 'LKR'),
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
      currency: currencyField(payload, 'currency', 'LKR'),
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
      currency: currencyField(payload, 'currency', 'LKR'),
      contractStartDate: optionalString(payload, 'contractStartDate'),
      contractEndDate: optionalString(payload, 'contractEndDate'),
      jobTitle: optionalString(payload, 'jobTitle'),
      expectedPaydayDayOfMonth: optionalNumber(
        payload,
        'expectedPaydayDayOfMonth',
      ),
      paySchedule: optionalString(payload, 'paySchedule'),
      status: incomeSourceStatusField(payload.status),
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
      currency: currencyField(payload, 'currency', 'LKR'),
      lastKnownPrice: optionalNumber(payload, 'lastKnownPrice'),
      lastPriceUpdatedAt: optionalString(payload, 'lastPriceUpdatedAt'),
      priceSource: payload.priceSource === 'cse_api' ? 'cse_api' : 'manual',
      lastPriceHigh: optionalNumber(payload, 'lastPriceHigh'),
      lastPriceLow: optionalNumber(payload, 'lastPriceLow'),
      lastPriceClose: optionalNumber(payload, 'lastPriceClose'),
      lastPriceVolume: optionalNumber(payload, 'lastPriceVolume'),
      lastPriceTurnover: optionalNumber(payload, 'lastPriceTurnover'),
      priceHistory: normalizedStockPriceHistory(payload.priceHistory),
      notes: optionalString(payload, 'notes'),
      documentRef: optionalString(payload, 'documentRef'),
    })
  } else if (kind === 'fixed_deposit') {
    db.fixed_deposits.push({
      ...base,
      bankName: stringField(payload, 'bankName', 'Bank'),
      principal: numberField(payload, 'principal', 0),
      currency: currencyField(payload, 'currency', 'LKR'),
      interestRatePct: numberField(payload, 'interestRatePct', 0),
      interestPayout: interestPayoutField(payload.interestPayout),
      interestReceived: optionalNumber(payload, 'interestReceived'),
      taxDeducted: optionalNumber(payload, 'taxDeducted'),
      payoutAccountId: optionalString(payload, 'payoutAccountId'),
      autoRenew: booleanField(payload, 'autoRenew', false),
      startDate: stringField(payload, 'startDate', createdAt.slice(0, 10)),
      maturityDate: stringField(
        payload,
        'maturityDate',
        createdAt.slice(0, 10),
      ),
      status: fixedDepositStatusField(payload.status),
      notes: optionalString(payload, 'notes'),
      documentRef: optionalString(payload, 'documentRef'),
    })
  } else if (kind === 'investment_journal') {
    db.investment_journal.push({
      ...base,
      stockHoldingId: optionalString(payload, 'stockHoldingId'),
      symbol: stringField(payload, 'symbol', 'Portfolio'),
      entryDate: stringField(payload, 'entryDate', createdAt.slice(0, 10)),
      entryType: investmentJournalEntryTypeField(payload.entryType),
      content: stringField(payload, 'content', ''),
      thesis: optionalString(payload, 'thesis'),
      invalidationCondition: optionalString(payload, 'invalidationCondition'),
      nextReviewDate: optionalString(payload, 'nextReviewDate'),
    })
  } else if (kind === 'ai_task') {
    db.ai_tasks.push(normalizeFinanceAiTask(payload, base))
  } else if (kind === 'loan') {
    db.loans.push({
      ...base,
      lender: stringField(payload, 'lender', 'Lender'),
      principal: numberField(payload, 'principal', 0),
      currentBalance: numberField(payload, 'currentBalance', 0),
      currency: currencyField(payload, 'currency', 'LKR'),
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
      currency: currencyField(payload, 'currency', 'LKR'),
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
  } else if (kind === 'insurance_policy') {
    db.insurance_policies.push({
      ...base,
      provider: stringField(payload, 'provider', 'Insurance provider'),
      policyNumber: optionalString(payload, 'policyNumber'),
      policyType: stringField(payload, 'policyType', 'Other'),
      insuredItem: stringField(payload, 'insuredItem', 'Insured item'),
      premiumAmount: optionalNumber(payload, 'premiumAmount'),
      premiumFrequency: optionalString(payload, 'premiumFrequency'),
      coverageAmount: optionalNumber(payload, 'coverageAmount'),
      currency: currencyField(payload, 'currency', 'LKR'),
      startDate: stringField(payload, 'startDate', createdAt.slice(0, 10)),
      endDate: optionalString(payload, 'endDate'),
      status: insuranceStatusField(payload.status),
      notes: optionalString(payload, 'notes'),
      documentRef: optionalString(payload, 'documentRef'),
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
  if (kind === 'income' || kind === 'expense') {
    const record =
      kind === 'income'
        ? db.income_records.find((item) => item.id === base.id)
        : db.expense_records.find((item) => item.id === base.id)
    appendAuditLog(`record_added:${kind}`, {
      id: base.id,
      kind,
      after: transactionAuditSnapshot(record),
    })
  } else {
    appendAuditLog(`record_added:${kind}`, {
      id: base.id,
      kind,
      ...(kind === 'ai_task'
        ? { auditCorrelationId: db.ai_tasks.at(-1)?.auditCorrelationId }
        : {}),
    })
  }
  return db
}

/**
 * Add a balanced, same-currency account transfer as two linked records.
 * Keeping the pair in the existing income/expense collections preserves the
 * current Postgres/JSON contract while making the transfer visible in the
 * unified ledger and neutral to income/expense summaries.
 */
export function addFinanceTransfer(payload: AddPayload): FinanceDatabase {
  const db = ensureFinanceStore()
  const sourceAccountId = stringField(payload, 'sourceAccountId', '')
  const destinationAccountId = stringField(payload, 'destinationAccountId', '')
  const amount = numberField(payload, 'amount', 0)
  if (!sourceAccountId || !destinationAccountId) {
    throw new Error('sourceAccountId and destinationAccountId are required')
  }
  if (sourceAccountId === destinationAccountId) {
    throw new Error('A transfer must use two different accounts')
  }
  if (!Number.isFinite(amount) || amount <= 0) {
    throw new Error('Transfer amount must be greater than zero')
  }
  const source = db.finance_accounts.find(
    (account) => account.id === sourceAccountId,
  )
  const destination = db.finance_accounts.find(
    (account) => account.id === destinationAccountId,
  )
  if (!source || !destination) {
    throw new Error('Both transfer accounts must exist')
  }
  if (source.currency !== destination.currency) {
    throw new Error(
      'Transfers currently require accounts with the same currency',
    )
  }

  const createdAt = nowIso()
  const transferId = randomUUID()
  const date = stringField(payload, 'date', createdAt.slice(0, 10))
  const currency = currencyField(payload, 'currency', source.currency)
  if (currency !== source.currency) {
    throw new Error('Transfer currency must match the source account')
  }
  const convertedLkrAmount = numberField(payload, 'convertedLkrAmount', amount)
  const shared = {
    transferId,
    transactionType: 'transfer' as const,
    currency,
    amount,
    convertedLkrAmount,
    notes: optionalString(payload, 'notes'),
    tags: optionalString(payload, 'tags'),
    status: reconciliationStatus(payload.status),
    source: stringField(payload, 'source', 'manual'),
    createdAt,
    updatedAt: createdAt,
  }
  db.expense_records.push({
    id: randomUUID(),
    date,
    vendor: `Transfer to ${destination.name}`,
    category: 'Transfer',
    accountId: sourceAccountId,
    transferAccountId: destinationAccountId,
    recurring: false,
    workRelated: false,
    taxDeductiblePossible: false,
    ...shared,
  })
  db.income_records.push({
    id: randomUUID(),
    dateReceived: date,
    sourceName: `Transfer from ${source.name}`,
    incomeType: 'Transfer',
    originalCurrency: currency,
    originalAmount: amount,
    exchangeRateUsed: 1,
    accountId: destinationAccountId,
    transferAccountId: sourceAccountId,
    taxable: false,
    ...shared,
  })
  source.balance -= amount
  source.updatedAt = createdAt
  destination.balance += amount
  destination.updatedAt = createdAt
  writeFinanceStore(db)
  appendAuditLog('record_added:transfer', {
    transferId,
    sourceAccountId,
    destinationAccountId,
    amount,
    after: [
      transactionAuditSnapshot(db.expense_records.at(-1)),
      transactionAuditSnapshot(db.income_records.at(-1)),
    ],
  })
  return db
}

/**
 * Add one expense split as several ordinary expense rows sharing a group ID.
 * The existing summaries already aggregate expense rows, so category budgets
 * remain correct without introducing a second ledger table or a data rewrite.
 */
export function addFinanceSplit(payload: AddPayload): FinanceDatabase {
  const db = ensureFinanceStore()
  const rawSplits = Array.isArray(payload.splits) ? payload.splits : []
  const splits = rawSplits.filter(
    (split): split is Record<string, unknown> =>
      typeof split === 'object' && split !== null,
  )
  if (splits.length < 2) {
    throw new Error('A split expense requires at least two categories')
  }
  const amounts = splits.map((split) => numberField(split, 'amount', 0))
  if (amounts.some((value) => !Number.isFinite(value) || value <= 0)) {
    throw new Error('Every split amount must be greater than zero')
  }
  const vendor = stringField(payload, 'vendor', '').trim()
  if (!vendor) throw new Error('Vendor is required')
  const accountId = optionalString(payload, 'accountId')
  const account = accountId
    ? db.finance_accounts.find((candidate) => candidate.id === accountId)
    : undefined
  if (accountId && !account) throw new Error('Expense account does not exist')

  const createdAt = nowIso()
  const splitGroupId = randomUUID()
  const date = stringField(payload, 'date', createdAt.slice(0, 10))
  const currency = currencyField(
    payload,
    'currency',
    account?.currency ?? 'LKR',
  )
  const shared = {
    date,
    vendor,
    subcategory: optionalString(payload, 'subcategory'),
    accountId,
    currency,
    recurring: booleanField(payload, 'recurring', false),
    workRelated: booleanField(payload, 'workRelated', false),
    taxDeductiblePossible: booleanField(
      payload,
      'taxDeductiblePossible',
      false,
    ),
    notes: optionalString(payload, 'notes'),
    tags: optionalString(payload, 'tags'),
    status: reconciliationStatus(payload.status),
    source: stringField(payload, 'source', 'manual'),
    splitGroupId,
    createdAt,
    updatedAt: createdAt,
  }
  splits.forEach((split, index) => {
    const amount = amounts[index]
    const fx = resolveTransactionFx(
      amount,
      currency,
      date,
      optionalNumber(split, 'exchangeRateUsed') ??
        optionalNumber(payload, 'exchangeRateUsed'),
      numberField(split, 'convertedLkrAmount', amount),
    )
    db.expense_records.push({
      id: randomUUID(),
      category: stringField(split, 'category', '').trim() || 'Other',
      amount,
      exchangeRateUsed: fx.exchangeRateUsed,
      convertedLkrAmount: fx.convertedLkrAmount,
      splitIndex: index,
      ...shared,
    })
  })
  if (account) {
    account.balance -= amounts.reduce((sum, amount) => sum + amount, 0)
    account.updatedAt = createdAt
  }
  writeFinanceStore(db)
  appendAuditLog('record_added:split', {
    splitGroupId,
    vendor,
    count: splits.length,
    after: db.expense_records
      .filter((record) => record.splitGroupId === splitGroupId)
      .map((record) => transactionAuditSnapshot(record)),
  })
  return db
}

export function updateFinanceRecord(
  kind: string,
  id: string,
  payload: AddPayload,
): FinanceDatabase {
  const db = ensureFinanceStore()
  const beforeTransaction =
    kind === 'income'
      ? transactionAuditSnapshot(
          db.income_records.find((r) => r.id === id && !isDeletedRecord(r)),
        )
      : kind === 'expense'
        ? transactionAuditSnapshot(
            db.expense_records.find((r) => r.id === id && !isDeletedRecord(r)),
          )
        : undefined
  let updated = false
  if (kind === 'income') {
    const index = db.income_records.findIndex(
      (r) => r.id === id && !isDeletedRecord(r),
    )
    if (index !== -1) {
      const nextRecord = {
        ...db.income_records[index],
        ...payload,
        updatedAt: nowIso(),
      } as IncomeRecord
      const fx = resolveTransactionFx(
        nextRecord.originalAmount,
        nextRecord.originalCurrency,
        nextRecord.dateReceived,
        optionalNumber(payload, 'exchangeRateUsed'),
        nextRecord.convertedLkrAmount,
      )
      db.income_records[index] = {
        ...nextRecord,
        exchangeRateUsed: fx.exchangeRateUsed ?? 1,
        convertedLkrAmount: fx.convertedLkrAmount,
      }
      updated = true
    }
  } else if (kind === 'expense') {
    const index = db.expense_records.findIndex(
      (r) => r.id === id && !isDeletedRecord(r),
    )
    if (index !== -1) {
      const nextRecord = {
        ...db.expense_records[index],
        ...payload,
        updatedAt: nowIso(),
      } as ExpenseRecord
      const fx = resolveTransactionFx(
        nextRecord.amount,
        nextRecord.currency,
        nextRecord.date,
        optionalNumber(payload, 'exchangeRateUsed'),
        nextRecord.convertedLkrAmount,
      )
      db.expense_records[index] = {
        ...nextRecord,
        exchangeRateUsed: fx.exchangeRateUsed,
        convertedLkrAmount: fx.convertedLkrAmount,
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
      const wasComplete =
        db.savings_goals[index].targetAmount > 0 &&
        db.savings_goals[index].currentAmount >=
          db.savings_goals[index].targetAmount
      db.savings_goals[index] = {
        ...db.savings_goals[index],
        ...payload,
        updatedAt: nowIso(),
      }
      const goal = db.savings_goals[index]
      if (
        !wasComplete &&
        goal.targetAmount > 0 &&
        goal.currentAmount >= goal.targetAmount
      ) {
        recordGoalCompletionEvent(db, goal)
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
      db.merchants[index] = {
        ...db.merchants[index],
        ...payload,
        updatedAt: nowIso(),
      }
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
        status:
          payload.status === undefined
            ? db.income_sources[index].status
            : incomeSourceStatusField(payload.status),
        updatedAt: nowIso(),
      }
      updated = true
    }
  } else if (kind === 'stock_holding') {
    const index = db.stock_holdings.findIndex((r) => r.id === id)
    if (index !== -1) {
      const updatedAt = nowIso()
      const current = db.stock_holdings[index]
      const next = { ...current, ...payload, updatedAt }
      const price = optionalNumber(payload, 'lastKnownPrice')
      if (price !== undefined && price > 0) {
        const observedAt =
          optionalString(payload, 'lastPriceUpdatedAt') ?? updatedAt
        const source = payload.priceSource === 'cse_api' ? 'cse_api' : 'manual'
        const point: StockPricePoint = {
          price,
          observedAt,
          source,
        }
        const high = optionalNumber(payload, 'lastPriceHigh')
        const low = optionalNumber(payload, 'lastPriceLow')
        const close = optionalNumber(payload, 'lastPriceClose')
        const volume = optionalNumber(payload, 'lastPriceVolume')
        const turnover = optionalNumber(payload, 'lastPriceTurnover')
        if (high !== undefined && high > 0) point.high = high
        if (low !== undefined && low > 0) point.low = low
        if (close !== undefined && close > 0) point.close = close
        if (volume !== undefined && volume > 0) point.volume = volume
        if (turnover !== undefined && turnover > 0) point.turnover = turnover
        next.priceHistory = appendStockPricePoint(current.priceHistory, point)
      } else {
        next.priceHistory = normalizedStockPriceHistory(current.priceHistory)
      }
      db.stock_holdings[index] = next
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
  } else if (kind === 'investment_journal') {
    const index = db.investment_journal.findIndex((r) => r.id === id)
    if (index !== -1) {
      db.investment_journal[index] = {
        ...db.investment_journal[index],
        ...payload,
        entryType: investmentJournalEntryTypeField(payload.entryType),
        updatedAt: nowIso(),
      }
      updated = true
    }
  } else if (kind === 'ai_task') {
    const index = db.ai_tasks.findIndex((r) => r.id === id)
    if (index !== -1) {
      db.ai_tasks[index] = normalizeFinanceAiTask(
        payload,
        db.ai_tasks[index],
        true,
      )
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
  } else if (kind === 'insurance_policy') {
    const index = db.insurance_policies.findIndex((r) => r.id === id)
    if (index !== -1) {
      db.insurance_policies[index] = {
        ...db.insurance_policies[index],
        ...payload,
        status:
          payload.status === undefined
            ? db.insurance_policies[index].status
            : insuranceStatusField(payload.status),
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
  if (kind === 'income' || kind === 'expense') {
    const afterTransaction =
      kind === 'income'
        ? transactionAuditSnapshot(db.income_records.find((r) => r.id === id))
        : transactionAuditSnapshot(db.expense_records.find((r) => r.id === id))
    appendAuditLog(`record_updated:${kind}`, {
      id,
      kind,
      before: beforeTransaction,
      after: afterTransaction,
    })
  } else {
    appendAuditLog(`record_updated:${kind}`, {
      id,
      kind,
      ...(kind === 'ai_task'
        ? {
            auditCorrelationId: db.ai_tasks.find((task) => task.id === id)
              ?.auditCorrelationId,
          }
        : {}),
    })
  }
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
  let removedAuditCorrelationId: string | undefined
  const beforeTransaction =
    kind === 'income'
      ? transactionAuditSnapshot(db.income_records.find((r) => r.id === id))
      : kind === 'expense'
        ? transactionAuditSnapshot(db.expense_records.find((r) => r.id === id))
        : undefined

  if (kind === 'income') {
    const target = db.income_records.find(
      (r) => r.id === id && !isDeletedRecord(r),
    )
    const transferId =
      target && isTransferRecord(target) ? target.transferId : undefined
    if (target && transferId && target.accountId && target.transferAccountId) {
      const destination = db.finance_accounts.find(
        (account) => account.id === target.accountId,
      )
      const source = db.finance_accounts.find(
        (account) => account.id === target.transferAccountId,
      )
      if (destination && source) {
        destination.balance -= target.originalAmount
        source.balance += target.originalAmount
        destination.updatedAt = nowIso()
        source.updatedAt = destination.updatedAt
      }
    }
    const deletedAt = nowIso()
    for (const record of db.income_records) {
      if (
        record.id === id ||
        (transferId && record.transferId === transferId)
      ) {
        record.deletedAt = deletedAt
        record.updatedAt = deletedAt
        removed = true
      }
    }
    if (transferId) {
      for (const record of db.expense_records) {
        if (record.transferId === transferId && !isDeletedRecord(record)) {
          record.deletedAt = deletedAt
          record.updatedAt = deletedAt
          removed = true
        }
      }
    }
  } else if (kind === 'expense') {
    const target = db.expense_records.find(
      (r) => r.id === id && !isDeletedRecord(r),
    )
    const transferId =
      target && isTransferRecord(target) ? target.transferId : undefined
    const splitGroupId = target?.splitGroupId
    if (target && splitGroupId && target.accountId) {
      const splitTotal = db.expense_records
        .filter((record) => record.splitGroupId === splitGroupId)
        .reduce((sum, record) => sum + record.amount, 0)
      const account = db.finance_accounts.find(
        (candidate) => candidate.id === target.accountId,
      )
      if (account) {
        account.balance += splitTotal
        account.updatedAt = nowIso()
      }
    }
    if (target && transferId && target.accountId && target.transferAccountId) {
      const source = db.finance_accounts.find(
        (account) => account.id === target.accountId,
      )
      const destination = db.finance_accounts.find(
        (account) => account.id === target.transferAccountId,
      )
      if (source && destination) {
        source.balance += target.amount
        destination.balance -= target.amount
        source.updatedAt = nowIso()
        destination.updatedAt = source.updatedAt
      }
    }
    const deletedAt = nowIso()
    for (const record of db.expense_records) {
      if (
        record.id === id ||
        (transferId && record.transferId === transferId) ||
        (splitGroupId && record.splitGroupId === splitGroupId)
      ) {
        if (!isDeletedRecord(record)) {
          record.deletedAt = deletedAt
          record.updatedAt = deletedAt
          removed = true
        }
      }
    }
    if (transferId) {
      for (const record of db.income_records) {
        if (record.transferId === transferId && !isDeletedRecord(record)) {
          record.deletedAt = deletedAt
          record.updatedAt = deletedAt
          removed = true
        }
      }
    }
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
  } else if (kind === 'investment_journal') {
    const before = db.investment_journal.length
    db.investment_journal = db.investment_journal.filter((r) => r.id !== id)
    removed = db.investment_journal.length !== before
  } else if (kind === 'ai_task') {
    removedAuditCorrelationId = db.ai_tasks.find(
      (task) => task.id === id,
    )?.auditCorrelationId
    const before = db.ai_tasks.length
    db.ai_tasks = db.ai_tasks.filter((r) => r.id !== id)
    removed = db.ai_tasks.length !== before
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
  } else if (kind === 'insurance_policy') {
    const before = db.insurance_policies.length
    db.insurance_policies = db.insurance_policies.filter((r) => r.id !== id)
    removed = db.insurance_policies.length !== before
  } else {
    throw new Error(`Unsupported finance record kind for delete: ${kind}`)
  }

  if (!removed) {
    throw new Error(`Record not found for kind ${kind} and id ${id}`)
  }

  writeFinanceStore(db)
  if (kind === 'income' || kind === 'expense') {
    appendAuditLog(`record_deleted:${kind}`, {
      id,
      kind,
      before: beforeTransaction,
    })
  } else {
    appendAuditLog(`record_deleted:${kind}`, {
      id,
      kind,
      ...(kind === 'ai_task'
        ? {
            auditCorrelationId:
              db.ai_tasks.find((task) => task.id === id)?.auditCorrelationId ??
              removedAuditCorrelationId,
          }
        : {}),
    })
  }
  return db
}

export type FinanceAiTaskListFilters = {
  status?: FinanceAiTaskStatus
  risk?: FinanceAiTask['risk']
  agentName?: string
  from?: string
  to?: string
  terminalOnly?: boolean
  limit?: number
  offset?: number
}

export type FinanceAiTaskListItem = Omit<
  FinanceAiTask,
  'inputSummary' | 'resultSummary' | 'errorMessage'
>

/** AI-112: bounded server-side task history; never returns task summaries. */
export function listFinanceAiTasks(filters: FinanceAiTaskListFilters = {}): {
  items: Array<FinanceAiTaskListItem>
  total: number
  limit: number
  offset: number
  hasMore: boolean
} {
  const db = readFinanceStore()
  const limit = Math.max(1, Math.min(Math.floor(filters.limit ?? 25), 100))
  const offset = Math.max(0, Math.floor(filters.offset ?? 0))
  const filtered = db.ai_tasks
    .filter((task) => !filters.status || task.status === filters.status)
    .filter((task) => !filters.risk || task.risk === filters.risk)
    .filter(
      (task) => !filters.agentName || task.agentName === filters.agentName,
    )
    .filter(
      (task) =>
        !filters.terminalOnly ||
        task.status === 'completed' ||
        task.status === 'cancelled',
    )
    .filter((task) => !filters.from || task.createdAt >= filters.from)
    .filter((task) => !filters.to || task.createdAt <= filters.to)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
  const page = filtered.slice(offset, offset + limit)
  return {
    items: page.map(
      ({
        inputSummary: _input,
        resultSummary: _result,
        errorMessage: _error,
        ...safe
      }) => ({
        ...safe,
        auditCorrelationId: safe.auditCorrelationId || `ai-task:${safe.id}`,
      }),
    ),
    total: filtered.length,
    limit,
    offset,
    hasMore: offset + limit < filtered.length,
  }
}

/** Restore a soft-deleted transaction (including its transfer/split peers). */
export function restoreFinanceRecord(
  kind: string,
  id: string,
): FinanceDatabase {
  const db = ensureFinanceStore()
  const target =
    kind === 'income'
      ? db.income_records.find((record) => record.id === id && record.deletedAt)
      : kind === 'expense'
        ? db.expense_records.find(
            (record) => record.id === id && record.deletedAt,
          )
        : undefined
  if (!target)
    throw new Error(`Deleted record not found for kind ${kind} and id ${id}`)

  const transferId = isTransferRecord(target) ? target.transferId : undefined
  const splitGroupId =
    'splitGroupId' in target ? target.splitGroupId : undefined
  const peers: Array<IncomeRecord | ExpenseRecord> = []
  for (const record of db.income_records) {
    if (record.id === id || (transferId && record.transferId === transferId))
      peers.push(record)
  }
  for (const record of db.expense_records) {
    if (
      record.id === id ||
      (transferId && record.transferId === transferId) ||
      (splitGroupId && record.splitGroupId === splitGroupId)
    )
      peers.push(record)
  }

  const restoredAt = nowIso()
  if (
    transferId &&
    'accountId' in target &&
    target.accountId &&
    target.transferAccountId
  ) {
    const first = db.finance_accounts.find(
      (account) => account.id === target.accountId,
    )
    const second = db.finance_accounts.find(
      (account) => account.id === target.transferAccountId,
    )
    const amount =
      'originalAmount' in target ? target.originalAmount : target.amount
    if (first && second) {
      if (kind === 'income') {
        first.balance += amount
        second.balance -= amount
      } else {
        first.balance -= amount
        second.balance += amount
      }
      first.updatedAt = restoredAt
      second.updatedAt = restoredAt
    }
  } else if (splitGroupId && 'accountId' in target && target.accountId) {
    const account = db.finance_accounts.find(
      (candidate) => candidate.id === target.accountId,
    )
    if (account) {
      const total = db.expense_records
        .filter(
          (record) => record.splitGroupId === splitGroupId && record.deletedAt,
        )
        .reduce((sum, record) => sum + record.amount, 0)
      account.balance -= total
      account.updatedAt = restoredAt
    }
  }

  for (const record of peers) {
    if (record.deletedAt) {
      delete record.deletedAt
      record.updatedAt = restoredAt
    }
  }
  writeFinanceStore(db)
  appendAuditLog(`record_restored:${kind}`, {
    id,
    kind,
    restoredCount: peers.length,
  })
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
      ? db.income_records
          .filter((r) => !isDeletedRecord(r))
          .map((r) => ({
            id: r.id,
            vendor: r.sourceName,
            date: r.dateReceived,
            amount: r.originalAmount,
          }))
      : db.expense_records
          .filter((r) => !isDeletedRecord(r))
          .map((r) => ({
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
}

export function getCategoryCorrections(): Record<string, string> {
  const db = ensureFinanceStore()
  const settings = db.settings as Record<string, unknown>
  return settings.categoryCorrections &&
    typeof settings.categoryCorrections === 'object'
    ? (settings.categoryCorrections as Record<string, string>)
    : {}
}

export function listKnownSenders(): Array<KnownSender> {
  const settings = ensureFinanceStore().settings as Record<string, unknown>
  return Array.isArray(settings.knownSenders) ? settings.knownSenders as Array<KnownSender> : []
}

export function decryptKnownSenderPassword(senderId: string): string | undefined {
  const sender = listKnownSenders().find((item) => item.id === senderId)
  // Password decryption is intentionally opt-in and delegated to the existing
  // encrypted-finance credential path when a caller has stored one.
  return sender?.encryptedPassword
}

export function listPendingIngestions(): Array<PendingIngestion> {
  return ensureFinanceStore().pending_ingestions
}

export function findPendingIngestionByChecksum(
  checksumSha256: string,
): PendingIngestion | null {
  if (!/^[a-f0-9]{64}$/.test(checksumSha256)) return null
  return (
    ensureFinanceStore().pending_ingestions.find(
      (pending) =>
        pending.checksumSha256 === checksumSha256 &&
        pending.status !== 'rejected',
    ) ?? null
  )
}

export function addPendingIngestion(
  input: Pick<PendingIngestion, 'source' | 'sourceRef'> &
    Partial<
      Pick<
        PendingIngestion,
        | 'status'
        | 'documentType'
        | 'documentClass'
        | 'passwordHint'
        | 'matchedSenderId'
        | 'matchedSenderLabel'
        | 'checksumSha256'
        | 'extracted'
        | 'extractedSalarySlip'
        | 'extractedContractNote'
        | 'extractedFdCertificate'
        | 'extractedContract'
        | 'contractChanges'
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
    documentClass: input.documentClass,
    sourceRef: input.sourceRef,
    checksumSha256: input.checksumSha256,
    passwordHint: input.passwordHint,
    matchedSenderId: input.matchedSenderId,
    matchedSenderLabel: input.matchedSenderLabel,
    extracted: input.extracted,
    extractedSalarySlip: input.extractedSalarySlip,
    extractedContractNote: input.extractedContractNote,
    extractedFdCertificate: input.extractedFdCertificate,
    extractedContract: input.extractedContract,
    contractChanges: input.contractChanges,
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
    currency: currencyField(payload, 'currency', 'LKR'),
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

/** PF-201/PF-206: value an amount against the rates in the supplied snapshot. */
function valuationToCurrency(
  db: FinanceDatabase,
  amount: number,
  currency: string,
  targetCurrency: string,
  date: string,
): number {
  if (!Number.isFinite(amount)) return 0
  if (currency === targetCurrency) return amount
  const rates = Array.isArray(db.exchange_rates) ? db.exchange_rates : []
  const lookup = (base: string, target: string): number | undefined => {
    const candidates = rates
      .filter(
        (row) =>
          row.base === base &&
          row.target === target &&
          typeof row.rate === 'number' &&
          Number.isFinite(row.rate) &&
          (!date || String(row.date) <= date),
      )
      .sort((a, b) => String(b.date).localeCompare(String(a.date)))
    return candidates[0]?.rate as number | undefined
  }
  const direct = lookup(currency, targetCurrency)
  if (direct !== undefined) return amount * direct
  const inverse = lookup(targetCurrency, currency)
  if (inverse !== undefined && inverse > 0) return amount / inverse
  if (currency !== 'LKR' && targetCurrency !== 'LKR') {
    const fromLkr = lookup(currency, 'LKR')
    const toLkr = lookup('LKR', targetCurrency)
    if (fromLkr !== undefined && toLkr !== undefined)
      return amount * fromLkr * toLkr
    const fromLkrInverse = lookup('LKR', currency)
    const toLkrInverse = lookup(targetCurrency, 'LKR')
    if (
      fromLkrInverse !== undefined &&
      fromLkrInverse > 0 &&
      toLkrInverse !== undefined
    )
      return amount / fromLkrInverse / toLkrInverse
  }
  return 0
}

function valuationToLkr(
  db: FinanceDatabase,
  amount: number,
  currency: string,
  date: string,
): number {
  return valuationToCurrency(db, amount, currency, 'LKR', date)
}

type BaseFinanceSummary = {
  totalIncome: number
  totalExpenses: number
  netSavings: number
  savingsRate: number
  cashBalance: number
  taxReserve: number
  debt: number
  netWorth: number
  liquidNetWorth: number
  lockedWealth: number
  stockHoldingsValue: number
  fixedDepositsValue: number
  propertyValue: number
  unrealizedStockPnl: number
  unrealizedStockPnlPct: number
  accountCount: number
}

function buildBaseFinanceSummary(
  db: FinanceDatabase,
  baseCurrency: string,
  legacy: {
    totalIncomeLkr: number
    totalExpensesLkr: number
    netSavingsLkr: number
    savingsRate: number
    cashBalanceLkr: number
    taxReserveLkr: number
    debtLkr: number
    netWorthLkr: number
    liquidNetWorthLkr: number
    lockedWealthLkr: number
    stockHoldingsValueLkr: number
    fixedDepositsValueLkr: number
    propertyValueLkr: number
    unrealizedStockPnlLkr: number
    unrealizedStockPnlPct: number
    accountCount: number
  },
): BaseFinanceSummary {
  if (baseCurrency === 'LKR') {
    return {
      totalIncome: legacy.totalIncomeLkr,
      totalExpenses: legacy.totalExpensesLkr,
      netSavings: legacy.netSavingsLkr,
      savingsRate: legacy.savingsRate,
      cashBalance: legacy.cashBalanceLkr,
      taxReserve: legacy.taxReserveLkr,
      debt: legacy.debtLkr,
      netWorth: legacy.netWorthLkr,
      liquidNetWorth: legacy.liquidNetWorthLkr,
      lockedWealth: legacy.lockedWealthLkr,
      stockHoldingsValue: legacy.stockHoldingsValueLkr,
      fixedDepositsValue: legacy.fixedDepositsValueLkr,
      propertyValue: legacy.propertyValueLkr,
      unrealizedStockPnl: legacy.unrealizedStockPnlLkr,
      unrealizedStockPnlPct: legacy.unrealizedStockPnlPct,
      accountCount: legacy.accountCount,
    }
  }

  const date = new Date().toISOString().slice(0, 10)
  const income = db.income_records.reduce(
    (sum, row) =>
      sum +
      (isDeletedRecord(row) || isTransferRecord(row)
        ? 0
        : valuationToCurrency(
            db,
            row.originalAmount,
            row.originalCurrency,
            baseCurrency,
            date,
          )),
    0,
  )
  const expenses = db.expense_records.reduce(
    (sum, row) =>
      sum +
      (isDeletedRecord(row) || isTransferRecord(row)
        ? 0
        : valuationToCurrency(
            db,
            row.amount,
            row.currency,
            baseCurrency,
            date,
          )),
    0,
  )
  const cash = db.finance_accounts.reduce(
    (sum, row) =>
      sum +
      valuationToCurrency(db, row.balance, row.currency, baseCurrency, date),
    0,
  )
  const taxReserve = db.savings_goals
    .filter((goal) => goal.name.toLowerCase().includes('tax'))
    .reduce(
      (sum, goal) =>
        sum +
        valuationToCurrency(
          db,
          goal.currentAmount,
          goal.currency,
          baseCurrency,
          date,
        ),
      0,
    )
  const debt =
    db.finance_accounts
      .filter((account) => account.type === 'card')
      .reduce(
        (sum, row) =>
          sum +
          valuationToCurrency(
            db,
            Math.abs(row.balance),
            row.currency,
            baseCurrency,
            date,
          ),
        0,
      ) +
    db.loans
      .filter((loan) => loan.status === 'active')
      .reduce(
        (sum, loan) =>
          sum +
          valuationToCurrency(
            db,
            loan.currentBalance,
            loan.currency,
            baseCurrency,
            date,
          ),
        0,
      )
  const stocks = db.stock_holdings.reduce(
    (sum, holding) =>
      sum +
      valuationToCurrency(
        db,
        (holding.lastKnownPrice ?? holding.buyPrice) * holding.quantity,
        holding.currency,
        baseCurrency,
        date,
      ),
    0,
  )
  const fixedDeposits = db.fixed_deposits
    .filter((fd) => fd.status !== 'withdrawn')
    .reduce(
      (sum, fd) =>
        sum +
        valuationToCurrency(db, fd.principal, fd.currency, baseCurrency, date),
      0,
    )
  const property = db.properties.reduce(
    (sum, row) =>
      sum +
      valuationToCurrency(
        db,
        row.currentValue,
        row.currency,
        baseCurrency,
        date,
      ),
    0,
  )
  const goals = db.savings_goals.reduce(
    (sum, goal) =>
      sum +
      valuationToCurrency(
        db,
        goal.currentAmount,
        goal.currency,
        baseCurrency,
        date,
      ),
    0,
  )
  const unrealizedStockPnl = db.stock_holdings.reduce(
    (sum, holding) =>
      sum +
      valuationToCurrency(
        db,
        ((holding.lastKnownPrice ?? holding.buyPrice) - holding.buyPrice) *
          holding.quantity,
        holding.currency,
        baseCurrency,
        date,
      ),
    0,
  )
  const stockCostBasis = db.stock_holdings.reduce(
    (sum, holding) =>
      sum +
      valuationToCurrency(
        db,
        holding.buyPrice * holding.quantity,
        holding.currency,
        baseCurrency,
        date,
      ),
    0,
  )
  return {
    totalIncome: income,
    totalExpenses: expenses,
    netSavings: income - expenses,
    savingsRate: income > 0 ? ((income - expenses) / income) * 100 : 0,
    cashBalance: cash,
    taxReserve,
    debt,
    netWorth: cash + goals + stocks + fixedDeposits + property - debt,
    liquidNetWorth: cash + goals + stocks - debt,
    lockedWealth: fixedDeposits + property,
    stockHoldingsValue: stocks,
    fixedDepositsValue: fixedDeposits,
    propertyValue: property,
    unrealizedStockPnl,
    unrealizedStockPnlPct:
      stockCostBasis > 0 ? (unrealizedStockPnl / stockCostBasis) * 100 : 0,
    accountCount: db.finance_accounts.length,
  }
}

export function financeSummary(db: FinanceDatabase) {
  const valuationDate = new Date().toISOString().slice(0, 10)
  const totalIncomeLkr = db.income_records.reduce(
    (sum, row) =>
      sum +
      (isDeletedRecord(row) || isTransferRecord(row)
        ? 0
        : row.convertedLkrAmount),
    0,
  )
  const totalExpensesLkr = db.expense_records.reduce(
    (sum, row) =>
      sum +
      (isDeletedRecord(row) || isTransferRecord(row)
        ? 0
        : row.convertedLkrAmount),
    0,
  )
  const netSavingsLkr = totalIncomeLkr - totalExpensesLkr
  const savingsRate =
    totalIncomeLkr > 0 ? (netSavingsLkr / totalIncomeLkr) * 100 : 0
  const cashBalanceLkr = db.finance_accounts.reduce(
    (sum, row) =>
      sum + valuationToLkr(db, row.balance, row.currency, valuationDate),
    0,
  )
  const taxReserveLkr = db.savings_goals
    .filter((goal) => goal.name.toLowerCase().includes('tax'))
    .reduce(
      (sum, goal) =>
        sum +
        valuationToLkr(db, goal.currentAmount, goal.currency, valuationDate),
      0,
    )
  // 'loan'-type accounts no longer contribute here — Phase 40 gives loans a
  // dedicated entity (principal/rate/term, remaining balance tracked
  // separately from the original amount); 'card' stays account-based since
  // credit cards have no term/rate model.
  const debtLkr =
    db.finance_accounts
      .filter((account) => account.type === 'card')
      .reduce(
        (sum, row) =>
          sum +
          valuationToLkr(
            db,
            Math.abs(row.balance),
            row.currency,
            valuationDate,
          ),
        0,
      ) +
    db.loans
      .filter((loan) => loan.status === 'active')
      .reduce(
        (sum, loan) =>
          sum +
          valuationToLkr(db, loan.currentBalance, loan.currency, valuationDate),
        0,
      )
  // Never blocked on a live CSE price fetch succeeding — falls back to the
  // buy price when no cached/manual current price is available yet.
  const stockHoldingsValueLkr = db.stock_holdings.reduce(
    (sum, holding) =>
      sum +
      valuationToLkr(
        db,
        (holding.lastKnownPrice ?? holding.buyPrice) * holding.quantity,
        holding.currency,
        valuationDate,
      ),
    0,
  )
  const fixedDepositsValueLkr = db.fixed_deposits
    .filter((fd) => fd.status !== 'withdrawn')
    .reduce(
      (sum, fd) =>
        sum + valuationToLkr(db, fd.principal, fd.currency, valuationDate),
      0,
    )
  const propertyValueLkr = db.properties.reduce(
    (sum, p) =>
      sum + valuationToLkr(db, p.currentValue, p.currency, valuationDate),
    0,
  )
  const unrealizedStockPnlLkr = db.stock_holdings.reduce(
    (sum, holding) =>
      sum +
      valuationToLkr(
        db,
        ((holding.lastKnownPrice ?? holding.buyPrice) - holding.buyPrice) *
          holding.quantity,
        holding.currency,
        valuationDate,
      ),
    0,
  )
  const totalStockCostBasisLkr = db.stock_holdings.reduce(
    (sum, holding) =>
      sum +
      valuationToLkr(
        db,
        holding.buyPrice * holding.quantity,
        holding.currency,
        valuationDate,
      ),
    0,
  )
  const unrealizedStockPnlPct =
    totalStockCostBasisLkr > 0
      ? (unrealizedStockPnlLkr / totalStockCostBasisLkr) * 100
      : 0
  const baseCurrency = SUPPORTED_CURRENCIES.includes(
    db.settings.baseCurrency as (typeof SUPPORTED_CURRENCIES)[number],
  )
    ? db.settings.baseCurrency
    : 'LKR'
  const netWorthLkr =
    cashBalanceLkr +
    db.savings_goals.reduce(
      (sum, goal) =>
        sum +
        valuationToLkr(db, goal.currentAmount, goal.currency, valuationDate),
      0,
    ) +
    stockHoldingsValueLkr +
    fixedDepositsValueLkr +
    propertyValueLkr -
    debtLkr
  const liquidNetWorthLkr =
    cashBalanceLkr +
    db.savings_goals.reduce(
      (sum, goal) =>
        sum +
        valuationToLkr(db, goal.currentAmount, goal.currency, valuationDate),
      0,
    ) +
    stockHoldingsValueLkr -
    debtLkr
  const lockedWealthLkr = fixedDepositsValueLkr + propertyValueLkr
  const openPlans = db.trading_plans.filter(
    (plan) =>
      !['cancelled', 'expired', 'failed', 'blocked'].includes(plan.status),
  ).length
  const blockedPlans = db.trading_plans.filter(
    (plan) => plan.status === 'blocked' || plan.decision === 'BLOCKED',
  ).length
  const legacySummary = {
    totalIncomeLkr,
    totalExpensesLkr,
    netSavingsLkr,
    savingsRate,
    cashBalanceLkr,
    taxReserveLkr,
    debtLkr,
    netWorthLkr,
    liquidNetWorthLkr,
    lockedWealthLkr,
    stockHoldingsValueLkr,
    fixedDepositsValueLkr,
    propertyValueLkr,
    unrealizedStockPnlLkr,
    unrealizedStockPnlPct,
    accountCount: db.finance_accounts.length,
  }
  return {
    ...legacySummary,
    baseCurrency,
    baseSummary: buildBaseFinanceSummary(db, baseCurrency, legacySummary),
    totalIncomeLkr,
    totalExpensesLkr,
    netSavingsLkr,
    savingsRate,
    cashBalanceLkr,
    taxReserveLkr,
    debtLkr,
    netWorthLkr,
    liquidNetWorthLkr,
    lockedWealthLkr,
    stockHoldingsValueLkr,
    fixedDepositsValueLkr,
    propertyValueLkr,
    unrealizedStockPnlLkr,
    unrealizedStockPnlPct,
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

/** OPS-103: read-only aggregate over stored quote provenance; never refreshes or rewrites holdings. */
export function cseProviderHealth(
  db: FinanceDatabase,
  now = new Date(),
): CseProviderHealth {
  const holdings = db.stock_holdings
  const cseQuotes = holdings.filter(
    (holding) => holding.priceSource === 'cse_api',
  )
  const manualFallbackCount = holdings.filter(
    (holding) => holding.priceSource === 'manual',
  ).length
  const quoteDates = cseQuotes
    .map((holding) => holding.lastPriceUpdatedAt)
    .filter((value): value is string =>
      Boolean(value && Number.isFinite(Date.parse(value))),
    )
  const latestQuoteAt =
    quoteDates.length > 0
      ? quoteDates.reduce((latest, value) => (value > latest ? value : latest))
      : null
  const staleQuoteCount = cseQuotes.filter((holding) => {
    const timestamp = holding.lastPriceUpdatedAt
      ? Date.parse(holding.lastPriceUpdatedAt)
      : NaN
    return (
      !Number.isFinite(timestamp) ||
      now.getTime() - timestamp > 24 * 60 * 60 * 1000
    )
  }).length
  let status: CseProviderHealth['status'] = 'unknown'
  if (holdings.length > 0) {
    if (cseQuotes.length === 0) status = 'manual'
    else if (staleQuoteCount > 0) status = 'stale'
    else if (manualFallbackCount > 0) status = 'degraded'
    else status = 'healthy'
  }
  return {
    status,
    holdingsCount: holdings.length,
    cseQuoteCount: cseQuotes.length,
    manualFallbackCount,
    staleQuoteCount,
    latestQuoteAt,
  }
}

/** AN-100: manually captured, immutable-present-moment net-worth snapshot. */
export function captureNetWorthSnapshot(
  db: FinanceDatabase,
  snapshotDate = new Date().toISOString().slice(0, 10),
  source: NetWorthSnapshot['source'] = 'manual',
): NetWorthSnapshot {
  if (
    !/^\d{4}-\d{2}-\d{2}$/.test(snapshotDate) ||
    !Number.isFinite(Date.parse(snapshotDate))
  ) {
    throw new Error('snapshotDate must be a valid YYYY-MM-DD date')
  }
  const existing = db.net_worth_snapshots.find(
    (snapshot) => snapshot.snapshotDate === snapshotDate,
  )
  if (existing) return existing
  const summary = financeSummary(db)
  const snapshot: NetWorthSnapshot = {
    id: randomUUID(),
    snapshotDate,
    netWorthLkr: summary.netWorthLkr,
    cashLkr: summary.cashBalanceLkr,
    debtLkr: summary.debtLkr,
    investmentsLkr:
      summary.stockHoldingsValueLkr + summary.fixedDepositsValueLkr,
    liquidNetWorthLkr: summary.liquidNetWorthLkr,
    lockedWealthLkr: summary.lockedWealthLkr,
    portfolioPositions: db.stock_holdings
      .map((holding): PortfolioSnapshotPosition | null => {
        const price = holding.lastKnownPrice ?? holding.buyPrice
        if (holding.quantity <= 0 || price <= 0) return null
        return {
          holdingId: holding.id,
          symbol: holding.symbol,
          currency: holding.currency,
          quantity: holding.quantity,
          price,
          marketValue: holding.quantity * price,
          costBasis: holding.quantity * holding.buyPrice,
          priceSource:
            holding.lastKnownPrice !== undefined
              ? holding.priceSource
              : 'buy_price_fallback',
        }
      })
      .filter(
        (position): position is PortfolioSnapshotPosition => position !== null,
      ),
    source,
    createdAt: nowIso(),
  }
  db.net_worth_snapshots.push(snapshot)
  db.net_worth_snapshots.sort((a, b) =>
    b.snapshotDate.localeCompare(a.snapshotDate),
  )
  return snapshot
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
  alerts.push(...financialRuleAlerts(db))
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

/** PF-306/307: evaluate only rules with an explicit user threshold. These are
 * read-only, explainable alerts; they never create records or move money. */
export function financialRuleAlerts(db: FinanceDatabase): Array<{
  level: 'info' | 'warning' | 'critical'
  title: string
  detail: string
}> {
  const rules = db.settings.financialRules ?? {}
  const alerts: Array<{
    level: 'info' | 'warning' | 'critical'
    title: string
    detail: string
  }> = []
  const month = new Date().toISOString().slice(0, 7)
  const transactions = getUnifiedTransactions(db).filter(
    (transaction) =>
      transaction.date.startsWith(month) &&
      transaction.transactionType !== 'transfer',
  )

  if (rules.largeTransactionThresholdLkr) {
    const large = transactions.filter(
      (transaction) =>
        Math.abs(transaction.convertedLkrAmount || transaction.amount) >=
        rules.largeTransactionThresholdLkr!,
    )
    if (large.length > 0) {
      alerts.push({
        level: 'info',
        title: 'Large transaction review',
        detail: `${large.length} tracked transaction${large.length === 1 ? '' : 's'} this month meet your LKR ${rules.largeTransactionThresholdLkr.toLocaleString()} threshold.`,
      })
    }
  }

  if (rules.monthlyInvestmentTargetLkr) {
    const investedThisMonth =
      db.stock_holdings
        .filter(
          (holding) =>
            holding.buyDate.startsWith(month) && holding.currency === 'LKR',
        )
        .reduce(
          (sum, holding) =>
            sum + Math.max(0, holding.quantity * holding.buyPrice),
          0,
        ) +
      db.fixed_deposits
        .filter(
          (deposit) =>
            deposit.startDate.startsWith(month) && deposit.currency === 'LKR',
        )
        .reduce((sum, deposit) => sum + Math.max(0, deposit.principal), 0)
    const target = rules.monthlyInvestmentTargetLkr
    if (investedThisMonth >= target) {
      alerts.push({
        level: 'info',
        title: 'Monthly investment target reached',
        detail: `Tracked LKR ${Math.round(investedThisMonth).toLocaleString()} of your LKR ${target.toLocaleString()} target this month.`,
      })
    } else {
      alerts.push({
        level: 'warning',
        title: 'Monthly investment target behind',
        detail: `Tracked LKR ${Math.round(investedThisMonth).toLocaleString()} of your LKR ${target.toLocaleString()} target this month; the gap is LKR ${Math.round(target - investedThisMonth).toLocaleString()}.`,
      })
    }
  }

  if (rules.discretionarySpendingThresholdLkr) {
    const discretionaryCategories = new Set([
      'dining',
      'entertainment',
      'shopping',
      'discretionary',
      'hobbies',
      'leisure',
    ])
    const discretionarySpend = transactions
      .filter(
        (transaction) =>
          transaction.kind === 'expense' &&
          discretionaryCategories.has(
            transaction.category.trim().toLowerCase(),
          ),
      )
      .reduce(
        (sum, transaction) =>
          sum +
          Math.max(0, transaction.convertedLkrAmount || transaction.amount),
        0,
      )
    if (discretionarySpend > rules.discretionarySpendingThresholdLkr) {
      alerts.push({
        level: 'warning',
        title: 'Discretionary spending threshold exceeded',
        detail: `Tracked categories Dining, Entertainment, Shopping, Discretionary, Hobbies, and Leisure total LKR ${Math.round(discretionarySpend).toLocaleString()} this month, above your LKR ${rules.discretionarySpendingThresholdLkr.toLocaleString()} threshold.`,
      })
    }
  }

  if (rules.investmentAllocationTargetPct) {
    const hasNonLkrInvestment = [
      ...db.stock_holdings,
      ...db.fixed_deposits,
    ].some((holding) => holding.currency !== 'LKR')
    const summary = financeSummary(db)
    if (hasNonLkrInvestment || summary.netWorthLkr <= 0) {
      alerts.push({
        level: 'info',
        title: 'Investment allocation not evaluated',
        detail:
          'The allocation target needs positive net worth and LKR-denominated investment values; add FX valuation before relying on this comparison.',
      })
    } else {
      const invested =
        summary.stockHoldingsValueLkr + summary.fixedDepositsValueLkr
      const allocationPct = (invested / summary.netWorthLkr) * 100
      const target = rules.investmentAllocationTargetPct
      alerts.push({
        level: allocationPct >= target ? 'info' : 'warning',
        title:
          allocationPct >= target
            ? 'Investment allocation target reached'
            : 'Investment allocation below target',
        detail: `Tracked LKR ${Math.round(invested).toLocaleString()} is ${allocationPct.toFixed(1)}% of net worth; target is ${target.toLocaleString()}%.`,
      })
    }
  }
  return alerts
}

export function safeToSpendSummary(db: FinanceDatabase): {
  cashLkr: number
  reserveLkr: number
  committedLkr: number
  amountLkr: number
  configured: boolean
  basis: string
} {
  const cashLkr = financeSummary(db).cashBalanceLkr
  const reserveLkr = Math.max(0, db.settings.minimumCashReserveLkr ?? 0)
  const cutoff = new Date()
  cutoff.setMonth(cutoff.getMonth() - 2)
  const cutoffMonth = `${cutoff.getFullYear()}-${String(cutoff.getMonth() + 1).padStart(2, '0')}`
  const recurringExpenses = db.expense_records.filter(
    (expense) =>
      expense.recurring &&
      !isDeletedRecord(expense) &&
      !isTransferRecord(expense) &&
      expense.date.slice(0, 7) >= cutoffMonth,
  )
  const recurringMonths = new Set(
    recurringExpenses.map((expense) => expense.date.slice(0, 7)),
  )
  const recurringTotal = recurringExpenses.reduce(
    (sum, expense) =>
      sum + Math.max(0, expense.convertedLkrAmount || expense.amount),
    0,
  )
  const committedLkr =
    recurringMonths.size > 0 ? recurringTotal / recurringMonths.size : 0
  return {
    cashLkr,
    reserveLkr,
    committedLkr,
    amountLkr: Math.max(0, cashLkr - reserveLkr - committedLkr),
    configured: reserveLkr > 0,
    basis:
      committedLkr > 0
        ? 'Cash balance minus the minimum reserve and average monthly recurring expenses from the last three months. Unrecorded commitments are not included.'
        : 'Cash balance minus the minimum reserve. No recurring expenses were recorded in the last three months.',
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

/** Keep currency joins deterministic across forms, imports, and legacy clients. */
export function normalizeCurrencyCode(
  value: unknown,
  fallback = 'LKR',
): CurrencyCode {
  if (typeof value !== 'string' || !value.trim()) return fallback
  return value.trim().toUpperCase()
}

function currencyField(
  payload: AddPayload,
  key: string,
  fallback: string,
): CurrencyCode {
  return normalizeCurrencyCode(payload[key], fallback)
}

function normalizeFinanceCurrencyFields(db: FinanceDatabase): FinanceDatabase {
  const currencyCollections = [
    'finance_accounts',
    'income_records',
    'expense_records',
    'budget_categories',
    'tax_records',
    'income_sources',
    'stock_holdings',
    'fixed_deposits',
    'loans',
    'properties',
    'insurance_policies',
  ] as const
  const normalized = { ...db, settings: { ...db.settings } }
  normalized.transfers = Array.isArray(normalized.transfers) ? normalized.transfers : []
  for (const key of currencyCollections) {
    normalized[key] = (Array.isArray(normalized[key]) ? normalized[key] : []).map((record) => {
      const next = { ...record } as Record<string, unknown>
      for (const field of ['currency', 'originalCurrency', 'feeCurrency']) {
        if (field in next) next[field] = normalizeCurrencyCode(next[field])
      }
      return next
    }) as never
  }
  normalized.exchange_rates = normalized.exchange_rates.map((rate) => ({
    ...rate,
    ...(typeof rate.base === 'string'
      ? { base: normalizeCurrencyCode(rate.base) }
      : {}),
    ...(typeof rate.target === 'string'
      ? { target: normalizeCurrencyCode(rate.target) }
      : {}),
  }))
  normalized.settings.baseCurrency = normalizeCurrencyCode(
    normalized.settings.baseCurrency,
  )
  normalized.settings.reportingCurrencies =
    normalized.settings.reportingCurrencies.map((currency) =>
      normalizeCurrencyCode(currency),
    )
  return normalized
}

const FINANCE_AI_TASK_STATUSES: Array<FinanceAiTaskStatus> = [
  'queued',
  'running',
  'awaiting_approval',
  'completed',
  'failed',
  'cancelled',
]

function financeAiTaskStatus(value: unknown): FinanceAiTaskStatus {
  return FINANCE_AI_TASK_STATUSES.includes(value as FinanceAiTaskStatus)
    ? (value as FinanceAiTaskStatus)
    : 'queued'
}

function financeAiTaskRisk(value: unknown): FinanceAiTask['risk'] {
  return value === 'high' || value === 'medium' ? value : 'low'
}

function normalizeFinanceAiTask(
  payload: AddPayload,
  base: Partial<FinanceAiTask> & {
    id: string
    createdAt: string
    updatedAt: string
  },
  updating = false,
): FinanceAiTask {
  const currentStatus = base.status ?? 'queued'
  const nextStatus =
    payload.status === undefined && updating
      ? currentStatus
      : financeAiTaskStatus(payload.status)
  if (updating && nextStatus !== currentStatus) {
    const allowed: Record<FinanceAiTaskStatus, Array<FinanceAiTaskStatus>> = {
      queued: ['running', 'cancelled'],
      running: ['awaiting_approval', 'completed', 'failed', 'cancelled'],
      awaiting_approval: ['running', 'completed', 'cancelled'],
      completed: [],
      failed: ['queued', 'running', 'cancelled'],
      cancelled: ['queued'],
    }
    if (!allowed[currentStatus].includes(nextStatus)) {
      throw new Error(
        `Invalid AI task status transition: ${currentStatus} -> ${nextStatus}`,
      )
    }
  }
  const terminal =
    nextStatus === 'completed' ||
    nextStatus === 'failed' ||
    nextStatus === 'cancelled'
  const now = nowIso()
  const priorHistory = Array.isArray(base.statusHistory)
    ? base.statusHistory.filter(
        (event): event is FinanceAiTaskStatusEvent =>
          FINANCE_AI_TASK_STATUSES.includes(event.status) &&
          typeof event.at === 'string',
      )
    : []
  const statusHistory: Array<FinanceAiTaskStatusEvent> =
    updating && nextStatus !== currentStatus
      ? [
          ...priorHistory,
          {
            status: nextStatus,
            at: now,
            by:
              payload.statusChangedBy === 'finance_agent'
                ? 'finance_agent'
                : 'human',
          },
        ]
      : priorHistory.length > 0
        ? priorHistory
        : [{ status: nextStatus, at: base.createdAt }]
  return {
    id: base.id,
    auditCorrelationId:
      base.auditCorrelationId ??
      (updating ? `ai-task:${base.id}` : randomUUID()),
    taskType: stringField(
      payload,
      'taskType',
      base.taskType ?? 'finance_assist',
    ),
    title: stringField(payload, 'title', base.title ?? 'Finance AI task'),
    status: nextStatus,
    risk:
      payload.risk === undefined && updating
        ? (base.risk ?? 'low')
        : financeAiTaskRisk(payload.risk),
    requestedAction: stringField(
      payload,
      'requestedAction',
      base.requestedAction ?? 'review',
    ),
    inputSummary: stringField(payload, 'inputSummary', base.inputSummary ?? ''),
    resultSummary:
      optionalString(payload, 'resultSummary') ??
      (payload.resultSummary === undefined ? base.resultSummary : undefined),
    errorMessage:
      optionalString(payload, 'errorMessage') ??
      (payload.errorMessage === undefined ? base.errorMessage : undefined),
    approvalRequired: booleanField(
      payload,
      'approvalRequired',
      base.approvalRequired ?? false,
    ),
    source: stringField(payload, 'source', base.source ?? 'finance-agent'),
    agentName:
      optionalString(payload, 'agentName') ??
      (payload.agentName === undefined ? base.agentName : undefined),
    createdAt: base.createdAt,
    updatedAt: now,
    startedAt:
      optionalString(payload, 'startedAt') ??
      (nextStatus === 'running' ? (base.startedAt ?? now) : base.startedAt),
    completedAt:
      optionalString(payload, 'completedAt') ??
      (terminal ? (base.completedAt ?? now) : base.completedAt),
    statusHistory,
  }
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

function investmentJournalEntryTypeField(
  value: unknown,
): InvestmentJournalEntry['entryType'] {
  const allowed: Array<InvestmentJournalEntry['entryType']> = [
    'thesis',
    'review',
    'buy',
    'sell',
    'note',
  ]
  return allowed.includes(value as InvestmentJournalEntry['entryType'])
    ? (value as InvestmentJournalEntry['entryType'])
    : 'note'
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

function incomeSourceStatusField(value: unknown): IncomeSource['status'] {
  const allowed: Array<IncomeSource['status']> = [
    'active',
    'paused',
    'notice_period',
    'ended',
    'terminated',
  ]
  return allowed.includes(value as IncomeSource['status'])
    ? (value as IncomeSource['status'])
    : 'active'
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

function incomeSubtypeField(value: unknown): IncomeRecord['incomeSubtype'] {
  const allowed: Array<NonNullable<IncomeRecord['incomeSubtype']>> = [
    'salary',
    'dividend',
    'interest',
    'freelance',
    'other',
  ]
  return allowed.includes(value as NonNullable<IncomeRecord['incomeSubtype']>)
    ? (value as IncomeRecord['incomeSubtype'])
    : 'other'
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

function insuranceStatusField(value: unknown): InsurancePolicy['status'] {
  const allowed: Array<InsurancePolicy['status']> = [
    'active',
    'expired',
    'cancelled',
  ]
  return allowed.includes(value as InsurancePolicy['status'])
    ? (value as InsurancePolicy['status'])
    : 'active'
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

export function getUnifiedTransactions(
  db: FinanceDatabase,
  options: { includeDeleted?: boolean } = {},
): Array<UnifiedTransaction> {
  const fromIncome: Array<UnifiedTransaction> = db.income_records
    .filter((inc) => options.includeDeleted || !isDeletedRecord(inc))
    .map((inc) => ({
      id: inc.id,
      kind: 'income',
      date: inc.dateReceived,
      counterparty: inc.sourceName,
      category: inc.incomeType,
      accountId: inc.accountId,
      currency: inc.originalCurrency,
      amount: inc.originalAmount,
      exchangeRateUsed: inc.exchangeRateUsed,
      convertedLkrAmount: inc.convertedLkrAmount,
      notes: inc.notes,
      documentRef: inc.documentRef,
      taxable: inc.taxable,
      incomeSourceId: inc.incomeSourceId,
      tags: inc.tags,
      status: inc.status,
      transactionType: inc.transactionType ?? 'income',
      transferId: inc.transferId,
      transferAccountId: inc.transferAccountId,
      source: inc.source,
      createdAt: inc.createdAt,
      updatedAt: inc.updatedAt,
      deletedAt: inc.deletedAt,
    }))

  const fromExpense: Array<UnifiedTransaction> = db.expense_records
    .filter((exp) => options.includeDeleted || !isDeletedRecord(exp))
    .map((exp) => ({
      id: exp.id,
      kind: 'expense',
      date: exp.date,
      counterparty: exp.vendor,
      category: exp.category,
      accountId: exp.accountId,
      currency: exp.currency,
      amount: exp.amount,
      exchangeRateUsed: exp.exchangeRateUsed,
      convertedLkrAmount: exp.convertedLkrAmount,
      notes: exp.notes,
      documentRef: exp.documentRef,
      recurring: exp.recurring,
      subcategory: exp.subcategory,
      tags: exp.tags,
      status: exp.status,
      transactionType: exp.transactionType ?? 'expense',
      transferId: exp.transferId,
      transferAccountId: exp.transferAccountId,
      splitGroupId: exp.splitGroupId,
      splitIndex: exp.splitIndex,
      source: exp.source,
      createdAt: exp.createdAt,
      updatedAt: exp.updatedAt,
      deletedAt: exp.deletedAt,
    }))

  const fromTransfers: Array<UnifiedTransaction> = (db.transfers ?? [])
    .filter((transfer) => options.includeDeleted || !isDeletedRecord(transfer))
    .flatMap((transfer) => {
      const row = transfer as Record<string, unknown>
      const date = typeof row.date === 'string' ? row.date : ''
      const fromAccountId = typeof row.fromAccountId === 'string' ? row.fromAccountId : ''
      const toAccountId = typeof row.toAccountId === 'string' ? row.toAccountId : ''
      const amount = typeof row.amount === 'number' ? row.amount : Number(row.amount)
      if (!date || !Number.isFinite(amount)) return []
      return [{
        id: String(row.id ?? randomUUID()), kind: 'transfer' as const, date,
        counterparty: `${fromAccountId} → ${toAccountId}`, category: 'Transfer',
        accountId: fromAccountId || undefined, currency: String(row.currency ?? 'LKR') as CurrencyCode,
        amount, convertedLkrAmount: Number(row.convertedLkrAmount ?? amount),
        status: reconciliationStatus(row.status), source: String(row.source ?? 'unknown'),
        createdAt: String(row.createdAt ?? date), updatedAt: String(row.updatedAt ?? date),
        notes: typeof row.notes === 'string' ? row.notes : undefined,
      }]
    })

  return [...fromIncome, ...fromExpense, ...fromTransfers].sort((a, b) => {
    if (a.date !== b.date) return a.date < b.date ? 1 : -1
    return a.createdAt < b.createdAt ? 1 : -1
  })
}

function csvCell(value: unknown): string {
  const text = value === undefined || value === null ? '' : String(value)
  const safeText =
    typeof value === 'string' && /^[=+\-@]/.test(text) ? `'${text}` : text
  return `"${safeText.replace(/"/g, '""')}"`
}

/** AI-113: export review-safe task metadata, never task input/result summaries. */
export function buildAiTaskReviewCsv(db: FinanceDatabase): string {
  const columns = [
    'auditCorrelationId',
    'id',
    'taskType',
    'title',
    'status',
    'risk',
    'requestedAction',
    'approvalRequired',
    'source',
    'agentName',
    'createdAt',
    'updatedAt',
    'startedAt',
    'completedAt',
    'statusHistory',
  ] as const
  const rows = [...db.ai_tasks]
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
    .map((task) =>
      columns
        .map((column) =>
          csvCell(
            column === 'auditCorrelationId'
              ? task.auditCorrelationId || `ai-task:${task.id}`
              : column === 'statusHistory'
                ? JSON.stringify(task.statusHistory || [])
                : task[column],
          ),
        )
        .join(','),
    )
  return [columns.map(csvCell).join(','), ...rows].join('\r\n') + '\r\n'
}

/** Build a formula-safe CSV export of the authenticated user's unified ledger. */
export function buildTransactionsCsv(db: FinanceDatabase): string {
  const columns = [
    'id',
    'kind',
    'transactionType',
    'date',
    'counterparty',
    'category',
    'subcategory',
    'accountId',
    'transferId',
    'transferAccountId',
    'splitGroupId',
    'splitIndex',
    'currency',
    'amount',
    'convertedLkrAmount',
    'status',
    'tags',
    'source',
    'createdAt',
    'updatedAt',
  ] as const
  const rows = getUnifiedTransactions(db).map((transaction) =>
    columns.map((column) => csvCell(transaction[column])).join(','),
  )
  return [columns.map(csvCell).join(','), ...rows].join('\r\n') + '\r\n'
}

/** Build a formula-safe CSV export of tax records for external review/filing. */
export function buildTaxRecordsCsv(db: FinanceDatabase): string {
  const columns = [
    'id',
    'taxYear',
    'incomeType',
    'amount',
    'currency',
    'convertedLkrAmount',
    'exchangeRateSource',
    'deductionCategory',
    'estimatedTaxableAmount',
    'taxPaid',
    'taxDue',
    'requiresConfirmation',
    'notes',
    'supportingDocument',
    'source',
    'createdAt',
    'updatedAt',
  ] as const
  const rows = db.tax_records.map((record) =>
    columns.map((column) => csvCell(record[column])).join(','),
  )
  return [columns.map(csvCell).join(','), ...rows].join('\r\n') + '\r\n'
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
    if (isDeletedRecord(inc) || isTransferRecord(inc)) continue
    const dateInfo = parseDate(inc.dateReceived)
    if (!dateInfo) continue
    if (year !== undefined && dateInfo.year !== year) continue
    if (month !== undefined && dateInfo.month !== month) continue
    const key = `${dateInfo.year}-${dateInfo.month}`
    const current = incomeMap.get(key) ?? 0
    incomeMap.set(key, current + inc.convertedLkrAmount)
  }

  for (const exp of db.expense_records) {
    if (isDeletedRecord(exp) || isTransferRecord(exp)) continue
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
  summary: ReturnType<typeof financeSummary>
  monthlySummary: ReturnType<typeof getMonthlySummary>
  categoryBreakdown: {
    thisMonth: Record<string, number>
    lastMonth: Record<string, number>
  }
  topVendors: { thisMonth: Array<{ vendor: string; amount: number }> }
  budgetVsActual: ReturnType<typeof budgetVsActualSummary>
  budgetAlertThresholdPct: number
  tradingSummary: ReturnType<typeof tradingPerformanceSummary>
} {
  const now = new Date()
  const thisMonthKey = `${now.getUTCFullYear()}-${now.getUTCMonth() + 1}`
  const lastMonthDate = new Date(now)
  lastMonthDate.setUTCMonth(lastMonthDate.getUTCMonth() - 1)
  const lastMonthKey = `${lastMonthDate.getUTCFullYear()}-${lastMonthDate.getUTCMonth() + 1}`

  const expenses = getUnifiedTransactions(db).filter(
    (t) => t.kind === 'expense' && t.transactionType !== 'transfer',
  )
  const byCategory = (monthKey: string) => {
    const totals: Record<string, number> = {}
    for (const t of expenses) {
      const d = parseDate(t.date)
      if (!d || `${d.year}-${d.month}` !== monthKey) continue
      totals[t.category] = (totals[t.category] ?? 0) + t.convertedLkrAmount
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

  return {
    summary: financeSummary(db),
    monthlySummary: getMonthlySummary(db).slice(-6),
    categoryBreakdown: {
      thisMonth: byCategory(thisMonthKey),
      lastMonth: byCategory(lastMonthKey),
    },
    topVendors: { thisMonth: topVendorsThisMonth },
    budgetVsActual: budgetVsActualSummary(db),
    budgetAlertThresholdPct: Math.max(
      50,
      Math.min(100, db.settings.budgetAlertThresholdPct ?? 80),
    ),
    // AI-206: db already contains the trading tables (trading_plans etc.) —
    // tradingPerformanceSummary operates on the already-loaded db with no
    // extra readFinanceStore() calls, unlike the richer getTradingSummary()
    // (trading-summary.ts) which re-reads the store across all 4 engines.
    tradingSummary: tradingPerformanceSummary(db),
  }
}

/**
 * AI-109: the stable, read-only context contract for finance agents. This is
 * deliberately separate from the full finance payload and from the Q&A
 * prompt context: agents get bounded aggregates plus task lifecycle counts,
 * never raw transaction/account/document rows.
 */
export type FinanceAgentContext = {
  contextVersion: 'finance-agent-v1'
  generatedAt: string
  sensitivity: 'aggregated_personal_finance'
  dataClassification: Record<string, FinanceDataSensitivity>
  aiRoutingPolicy: FinanceAiRoutingPolicy
  excludedFields: Array<string>
  data: ReturnType<typeof buildFinanceQueryContext> & {
    aiTaskSummary: {
      total: number
      byStatus: Record<FinanceAiTaskStatus, number>
      awaitingApproval: number
      highRisk: number
    }
  }
}

export type FinanceDataSensitivity =
  | 'public'
  | 'internal'
  | 'personal'
  | 'highly_sensitive'
  | 'secret'

export type FinanceAiRoutingPolicy = {
  policyVersion: 'finance-ai-routing-v1'
  externalProvider: {
    allowedDataClasses: Array<'public' | 'aggregated_personal_finance'>
    explicitUserActionRequired: Array<'personal' | 'highly_sensitive'>
    prohibitedDataClasses: Array<'secret'>
  }
  agentContext: {
    rawRecordsAllowed: false
    secretsAllowed: false
  }
}

export const FINANCE_AI_ROUTING_POLICY: FinanceAiRoutingPolicy = {
  policyVersion: 'finance-ai-routing-v1',
  externalProvider: {
    allowedDataClasses: ['public', 'aggregated_personal_finance'],
    explicitUserActionRequired: ['personal', 'highly_sensitive'],
    prohibitedDataClasses: ['secret'],
  },
  agentContext: {
    rawRecordsAllowed: false,
    secretsAllowed: false,
  },
}

export const FINANCE_DATA_CLASSIFICATION: Record<
  string,
  FinanceDataSensitivity
> = {
  'context.summary': 'personal',
  'context.monthlySummary': 'personal',
  'context.categoryBreakdown': 'personal',
  'context.topVendors': 'personal',
  'context.budgetVsActual': 'personal',
  'context.tradingSummary': 'personal',
  'context.aiTaskSummary': 'internal',
  'raw transaction rows': 'highly_sensitive',
  'account identifiers and balances': 'highly_sensitive',
  'document contents and source paths': 'highly_sensitive',
  'credentials, tokens, and secrets': 'secret',
}

export function buildFinanceAgentContext(
  db: FinanceDatabase,
): FinanceAgentContext {
  const byStatus: Record<FinanceAiTaskStatus, number> = {
    queued: 0,
    running: 0,
    awaiting_approval: 0,
    completed: 0,
    failed: 0,
    cancelled: 0,
  }
  let highRisk = 0
  for (const task of db.ai_tasks) {
    byStatus[task.status] += 1
    if (task.risk === 'high') highRisk += 1
  }
  return {
    contextVersion: 'finance-agent-v1',
    generatedAt: nowIso(),
    sensitivity: 'aggregated_personal_finance',
    dataClassification: { ...FINANCE_DATA_CLASSIFICATION },
    aiRoutingPolicy: {
      ...FINANCE_AI_ROUTING_POLICY,
      externalProvider: { ...FINANCE_AI_ROUTING_POLICY.externalProvider },
      agentContext: { ...FINANCE_AI_ROUTING_POLICY.agentContext },
    },
    excludedFields: [
      'raw income/expense transaction rows',
      'account identifiers and balances by account',
      'document contents and source paths',
      'agent task input/result summaries',
      'credentials, tokens, and secrets',
    ],
    data: {
      ...buildFinanceQueryContext(db),
      aiTaskSummary: {
        total: db.ai_tasks.length,
        byStatus,
        awaitingApproval: byStatus.awaiting_approval,
        highRisk,
      },
    },
  }
}

export function getBudgetVsActual(
  db: FinanceDatabase,
  category: string,
  year: number,
  month: number,
): {
  budget: number
  actual: number
  variance: number
  actualConversionAvailable?: boolean
} | null {
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
  let actualConversionAvailable = true
  for (const exp of db.expense_records) {
    if (isDeletedRecord(exp) || isTransferRecord(exp)) continue
    const dateInfo = parseDate(exp.date)
    if (!dateInfo) continue
    if (
      dateInfo.year === year &&
      dateInfo.month === month &&
      exp.category === category
    ) {
      if (
        normalizeCurrencyCode(exp.currency) ===
        normalizeCurrencyCode(budgetEntry.currency)
      ) {
        actual += exp.amount
      } else if (normalizeCurrencyCode(budgetEntry.currency) === 'LKR') {
        actual += exp.convertedLkrAmount
      } else {
        const converted = valuationToCurrency(
          db,
          exp.convertedLkrAmount,
          'LKR',
          budgetEntry.currency,
          exp.date,
        )
        if (converted === 0 && exp.convertedLkrAmount !== 0) {
          actualConversionAvailable = false
        } else {
          actual += converted
        }
      }
    }
  }

  return {
    budget: budgetEntry.budgetAmount,
    actual,
    variance: budgetEntry.budgetAmount - actual,
    ...(normalizeCurrencyCode(budgetEntry.currency) !== 'LKR'
      ? { actualConversionAvailable }
      : {}),
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
  approachingBudget: boolean
}> {
  const month = monthKey ?? nowIso().slice(0, 7)
  const [year, monthNum] = month.split('-').map(Number)
  const threshold = Math.max(
    50,
    Math.min(100, db.settings.budgetAlertThresholdPct ?? 80),
  )
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
        ...(result?.actualConversionAvailable === undefined
          ? {}
          : { actualConversionAvailable: result.actualConversionAvailable }),
        percentUsed: budget > 0 ? (actual / budget) * 100 : 0,
        overBudget: actual > budget,
        approachingBudget:
          actual <= budget &&
          budget > 0 &&
          (actual / budget) * 100 >= threshold,
      }
    })
}

export function annualBudgetVsActualSummary(
  db: FinanceDatabase,
  year = new Date().getUTCFullYear(),
): Array<{
  category: string
  year: number
  currency: CurrencyCode
  budget: number
  actual: number
  variance: number
  percentUsed: number
  overBudget: boolean
  approachingBudget: boolean
  monthsTracked: number
  actualConversionAvailable?: boolean
}> {
  const byCategory = new Map<
    string,
    {
      currency: CurrencyCode
      budget: number
      actual: number
      months: Set<string>
      actualConversionAvailable: boolean
    }
  >()
  for (const budgetEntry of db.budget_categories) {
    if (!/^\d{4}-\d{2}$/.test(budgetEntry.month)) continue
    if (Number(budgetEntry.month.slice(0, 4)) !== year) continue
    const existing = byCategory.get(budgetEntry.category) ?? {
      currency: budgetEntry.currency,
      budget: 0,
      actual: 0,
      months: new Set<string>(),
      actualConversionAvailable: true,
    }
    if (existing.months.has(budgetEntry.month)) continue
    existing.budget += budgetEntry.budgetAmount
    existing.months.add(budgetEntry.month)
    const [entryYear, entryMonth] = budgetEntry.month.split('-').map(Number)
    const monthly = getBudgetVsActual(
      db,
      budgetEntry.category,
      entryYear,
      entryMonth,
    )
    existing.actual += monthly?.actual ?? 0
    if (monthly?.actualConversionAvailable === false) {
      existing.actualConversionAvailable = false
    }
    byCategory.set(budgetEntry.category, existing)
  }
  const threshold = Math.max(
    50,
    Math.min(100, db.settings.budgetAlertThresholdPct ?? 80),
  )
  return [...byCategory.entries()].map(([category, result]) => {
    const percentUsed =
      result.budget > 0 ? (result.actual / result.budget) * 100 : 0
    return {
      category,
      year,
      currency: result.currency,
      budget: result.budget,
      actual: result.actual,
      variance: result.budget - result.actual,
      percentUsed,
      overBudget: result.actual > result.budget,
      approachingBudget:
        result.actual <= result.budget &&
        result.budget > 0 &&
        percentUsed >= threshold,
      monthsTracked: result.months.size,
      ...(result.actualConversionAvailable
        ? {}
        : { actualConversionAvailable: false }),
    }
  })
}

export type FinancialHealthComponent = {
  key: 'savings' | 'emergency' | 'budget' | 'debt' | 'data'
  label: string
  score: number
  maxScore: number
  detail: string
}

export type FinancialHealthSummary = {
  score: number
  band: 'excellent' | 'stable' | 'needs_attention' | 'at_risk'
  components: Array<FinancialHealthComponent>
}

/**
 * PF-412: a deterministic, explainable overview score. It is deliberately
 * not an investment recommendation or an AI judgment; each weighted input is
 * shown to the user so the score can be audited and improved.
 */
export function financialHealthSummary(
  db: FinanceDatabase,
  dataHealthStatus:
    | 'healthy'
    | 'json_primary'
    | 'postgres_unavailable'
    | 'postgres_behind'
    | 'mirror_mismatch' = 'healthy',
): FinancialHealthSummary {
  const summary = financeSummary(db)
  const budgetRows = budgetVsActualSummary(db)
  const averageExpenses = getAverageMonthlyExpensesLkr(db, 3)
  const emergencyTargetMonths = db.settings.emergencyFundTargetMonths ?? 0
  const emergencyTargetLkr = emergencyTargetMonths * averageExpenses
  const emergencyProgress =
    emergencyTargetLkr > 0
      ? Math.min(
          100,
          Math.max(0, (summary.cashBalanceLkr / emergencyTargetLkr) * 100),
        )
      : 50
  const overBudgetCount = budgetRows.filter((row) => row.overBudget).length
  const budgetAdherence =
    budgetRows.length > 0
      ? ((budgetRows.length - overBudgetCount) / budgetRows.length) * 100
      : 50
  const debtBase =
    Math.max(0, summary.netWorthLkr) + Math.max(0, summary.debtLkr)
  const debtRatio = debtBase > 0 ? summary.debtLkr / debtBase : 0.5
  const dataScore =
    dataHealthStatus === 'healthy' || dataHealthStatus === 'json_primary'
      ? 10
      : dataHealthStatus === 'postgres_behind' ||
          dataHealthStatus === 'mirror_mismatch'
        ? 6
        : 2
  const components: Array<FinancialHealthComponent> = [
    {
      key: 'savings',
      label: 'Savings rate',
      score: Math.min(30, Math.max(0, summary.savingsRate) * 1.5),
      maxScore: 30,
      detail:
        summary.totalIncomeLkr > 0
          ? `${Math.round(summary.savingsRate)}% of recorded income retained`
          : 'Add income and expenses to measure savings',
    },
    {
      key: 'emergency',
      label: 'Emergency fund',
      score: (emergencyProgress / 100) * 25,
      maxScore: 25,
      detail:
        emergencyTargetMonths > 0
          ? `${Math.round(emergencyProgress)}% of the ${emergencyTargetMonths}-month target`
          : 'Set an emergency-fund target to make this measure personal',
    },
    {
      key: 'budget',
      label: 'Budget adherence',
      score: (budgetAdherence / 100) * 20,
      maxScore: 20,
      detail:
        budgetRows.length > 0
          ? `${overBudgetCount} of ${budgetRows.length} budgets over limit`
          : 'Set monthly budgets to track spending discipline',
    },
    {
      key: 'debt',
      label: 'Debt load',
      score: Math.max(0, Math.min(15, (1 - debtRatio) * 15)),
      maxScore: 15,
      detail:
        summary.debtLkr > 0
          ? `${Math.round(debtRatio * 100)}% debt share of assets plus debt`
          : 'No active debt recorded',
    },
    {
      key: 'data',
      label: 'Data confidence',
      score: dataScore,
      maxScore: 10,
      detail:
        dataHealthStatus === 'healthy' || dataHealthStatus === 'json_primary'
          ? 'Financial data is available for this review'
          : 'Storage needs attention; score may be incomplete',
    },
  ]
  const score = Math.round(
    components.reduce((total, item) => total + item.score, 0),
  )
  const band =
    score >= 80
      ? 'excellent'
      : score >= 60
        ? 'stable'
        : score >= 40
          ? 'needs_attention'
          : 'at_risk'
  return { score, band, components }
}

export function updateExchangeRate(
  base: string,
  target: string,
  rate: number,
  date?: string,
  source = 'manual',
  observedAt = new Date().toISOString(),
): FinanceDatabase {
  const db = ensureFinanceStore()
  const normalizedBase = normalizeCurrencyCode(base)
  const normalizedTarget = normalizeCurrencyCode(target)
  const dateStr = date ?? new Date().toISOString().split('T')[0]
  const rateRecord = {
    base: normalizedBase,
    target: normalizedTarget,
    rate,
    date: dateStr,
    source,
    observedAt,
    updatedAt: new Date().toISOString(),
  }

  db.exchange_rates = db.exchange_rates.filter(
    (existing) =>
      !(
        existing.base === normalizedBase &&
        existing.target === normalizedTarget &&
        existing.date === dateStr
      ),
  )
  db.exchange_rates.push(rateRecord)
  writeFinanceStore(db)
  appendAuditLog('exchange_rate_updated', {
    base: normalizedBase,
    target: normalizedTarget,
    rate,
    date: dateStr,
  })
  return db
}

export function getExchangeRate(
  base: string,
  target: string,
  date?: string,
): number | undefined {
  const normalizedBase = normalizeCurrencyCode(base)
  const normalizedTarget = normalizeCurrencyCode(target)
  // Filter rates for the base and target, then take the one with the latest date
  const db = ensureFinanceStore()
  let relevant = db.exchange_rates.filter(
    (r: any) =>
      r.base === normalizedBase &&
      r.target === normalizedTarget &&
      typeof r.rate === 'number',
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
  const normalizedFrom = normalizeCurrencyCode(fromCurrency)
  const normalizedTo = normalizeCurrencyCode(toCurrency)
  if (normalizedFrom === normalizedTo) {
    return amount
  }

  // Try direct rate
  const rate = getExchangeRate(normalizedFrom, normalizedTo, date)
  if (rate !== undefined) {
    return amount * rate
  }

  // Try via base currency (LKR) if both legs exist
  const baseCurrency = 'LKR'
  const rateFromToBase = getExchangeRate(normalizedFrom, baseCurrency, date)
  const rateBaseTo = getExchangeRate(baseCurrency, normalizedTo, date)
  if (rateFromToBase !== undefined && rateBaseTo !== undefined) {
    return amount * rateFromToBase * rateBaseTo
  }

  // Try the inverse: if we have toCurrency -> fromCurrency, then use 1/rate
  const rateInverse = getExchangeRate(normalizedTo, normalizedFrom, date)
  if (rateInverse !== undefined) {
    return amount / rateInverse
  }

  // If we still don't have a rate, return undefined
  return undefined
}

/**
 * PF-205/PF-207: resolve a transaction into the reporting currency using the
 * dated stored rate, while allowing an explicit per-transaction override.
 * The fallback preserves legacy records when no rate is available.
 */
function resolveTransactionFx(
  amount: number,
  currency: string,
  date: string,
  overrideRate: number | undefined,
  fallbackConvertedAmount: number,
): { exchangeRateUsed?: number; convertedLkrAmount: number } {
  if (currency === 'LKR') {
    return { exchangeRateUsed: 1, convertedLkrAmount: amount }
  }
  if (
    overrideRate !== undefined &&
    Number.isFinite(overrideRate) &&
    overrideRate > 0
  ) {
    return {
      exchangeRateUsed: overrideRate,
      convertedLkrAmount: amount * overrideRate,
    }
  }
  const converted = convertCurrency(amount, currency, 'LKR', date)
  if (converted !== undefined && Number.isFinite(converted)) {
    return {
      exchangeRateUsed: amount !== 0 ? converted / amount : undefined,
      convertedLkrAmount: converted,
    }
  }
  return {
    exchangeRateUsed: undefined,
    convertedLkrAmount: fallbackConvertedAmount,
  }
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
