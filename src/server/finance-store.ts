import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import { randomUUID } from 'node:crypto'

export const FINANCE_SCHEMA_VERSION = 1
export const FINANCE_DATA_DIR = path.join(os.homedir(), '.hermes', 'finance')
export const FINANCE_DATA_PATH = path.join(FINANCE_DATA_DIR, 'finance.json')
export const FINANCE_AUDIT_PATH = path.join(FINANCE_DATA_DIR, 'audit.jsonl')

export const SUPPORTED_CURRENCIES = ['LKR', 'AUD', 'USD'] as const
export const TRADING_MODES = [
  'observe_only',
  'paper_trade',
  'testnet_execute',
  'live_recommend_only',
  'live_manual_approval',
  'live_auto_trade',
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
  type: 'bank' | 'cash' | 'card' | 'crypto_wallet' | 'broker' | 'foreign_currency' | 'loan' | 'other'
  currency: CurrencyCode
  balance: number
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
  executionStatus: 'not_executable' | 'blocked' | 'pending' | 'executed' | 'failed'
  actualOutcome?: string
  profitLoss?: number
  strategyUsed?: string
  agentNotes?: string
  source: string
  createdAt: string
  updatedAt: string
}

export type FinanceSettings = {
  baseCurrency: 'LKR'
  reportingCurrencies: Array<CurrencyCode>
  tradingMode: TradingMode
  liveTradingEnabled: boolean
  emergencyKillSwitch: boolean
  binanceWithdrawalsAllowed: false
  leverageEnabled: false
  futuresEnabled: false
  riskControls: {
    maxPositionSizeLkr: number
    maxExposurePerAssetPct: number
    maxExposurePerPlatformPct: number
    maxPortfolioExposurePct: number
    maxDailyLossLkr: number
    maxWeeklyLossLkr: number
    maxTradesPerDay: number
    maxOpenPositions: number
    requireStopLoss: boolean
    requireTakeProfitOrExitCondition: boolean
  }
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
  savings_goals: Array<SavingsGoal>
  tax_records: Array<TaxRecord>
  exchange_rates: Array<Record<string, unknown>>
  investment_accounts: Array<Record<string, unknown>>
  trading_platforms: Array<Record<string, unknown>>
  api_connections: Array<Record<string, unknown>>
  assets: Array<AssetRecord>
  market_prices: Array<MarketPrice>
  historical_candles: Array<Record<string, unknown>>
  news_items: Array<NewsItem>
  sentiment_scores: Array<Record<string, unknown>>
  risk_scores: Array<RiskScore>
  trading_plans: Array<TradingPlan>
  trade_orders: Array<Record<string, unknown>>
  trade_executions: Array<Record<string, unknown>>
  portfolio_positions: Array<Record<string, unknown>>
  account_balances: Array<Record<string, unknown>>
  strategy_results: Array<Record<string, unknown>>
  prediction_results: Array<Record<string, unknown>>
  agent_memory: Array<Record<string, unknown>>
  audit_logs: Array<Record<string, unknown>>
  error_logs: Array<Record<string, unknown>>
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
    binanceWithdrawalsAllowed: false,
    leverageEnabled: false,
    futuresEnabled: false,
    riskControls: {
      maxPositionSizeLkr: 25_000,
      maxExposurePerAssetPct: 5,
      maxExposurePerPlatformPct: 25,
      maxPortfolioExposurePct: 60,
      maxDailyLossLkr: 5_000,
      maxWeeklyLossLkr: 15_000,
      maxTradesPerDay: 3,
      maxOpenPositions: 5,
      requireStopLoss: true,
      requireTakeProfitOrExitCondition: true,
    },
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
    savings_goals: [],
    tax_records: [],
    exchange_rates: [],
    investment_accounts: [],
    trading_platforms: [
      { id: 'binance', name: 'Binance', mode: 'observe_only', source: 'system', createdAt, updatedAt: createdAt },
      { id: 'ibkr', name: 'Interactive Brokers', mode: 'observe_only', source: 'system', createdAt, updatedAt: createdAt },
    ],
    api_connections: [],
    assets: [],
    market_prices: [],
    historical_candles: [],
    news_items: [],
    sentiment_scores: [],
    risk_scores: [],
    trading_plans: [],
    trade_orders: [],
    trade_executions: [],
    portfolio_positions: [],
    account_balances: [],
    strategy_results: [],
    prediction_results: [],
    agent_memory: [],
    audit_logs: [],
    error_logs: [],
  }
}

export function ensureFinanceStore(): FinanceDatabase {
  fs.mkdirSync(FINANCE_DATA_DIR, { recursive: true, mode: 0o700 })
  if (!fs.existsSync(FINANCE_DATA_PATH)) {
    const db = createEmptyFinanceDatabase()
    writeFinanceStore(db)
    appendAuditLog('database_initialized', { schemaVersion: db.schemaVersion })
    return db
  }
  return readFinanceStore()
}

export function readFinanceStore(): FinanceDatabase {
  try {
    const parsed = JSON.parse(fs.readFileSync(FINANCE_DATA_PATH, 'utf8')) as FinanceDatabase
    return migrateFinanceStore(parsed)
  } catch {
    const db = createEmptyFinanceDatabase()
    writeFinanceStore(db)
    appendAuditLog('database_recreated_after_read_failure', {})
    return db
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
  fs.writeFileSync(FINANCE_DATA_PATH, `${JSON.stringify(updated, null, 2)}\n`, { mode: 0o600 })
}

export function appendAuditLog(action: string, details: Record<string, unknown>): void {
  fs.mkdirSync(FINANCE_DATA_DIR, { recursive: true, mode: 0o700 })
  const entry = {
    id: randomUUID(),
    action,
    details: maskSensitive(details),
    source: 'hermes-finance',
    createdAt: nowIso(),
  }
  fs.appendFileSync(FINANCE_AUDIT_PATH, `${JSON.stringify(entry)}\n`, { mode: 0o600 })
}

export function addFinanceRecord(kind: string, payload: AddPayload): FinanceDatabase {
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
      dateReceived: stringField(payload, 'dateReceived', createdAt.slice(0, 10)),
      sourceName: stringField(payload, 'sourceName', 'Unspecified income'),
      incomeType: stringField(payload, 'incomeType', 'Other income'),
      originalCurrency: stringField(payload, 'originalCurrency', 'LKR'),
      originalAmount: numberField(payload, 'originalAmount', 0),
      exchangeRateUsed: numberField(payload, 'exchangeRateUsed', 1),
      convertedLkrAmount: numberField(payload, 'convertedLkrAmount', numberField(payload, 'originalAmount', 0)),
      accountId: optionalString(payload, 'accountId'),
      taxable: booleanField(payload, 'taxable', true),
      notes: optionalString(payload, 'notes'),
      documentRef: optionalString(payload, 'documentRef'),
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
      convertedLkrAmount: numberField(payload, 'convertedLkrAmount', numberField(payload, 'amount', 0)),
      recurring: booleanField(payload, 'recurring', false),
      workRelated: booleanField(payload, 'workRelated', false),
      taxDeductiblePossible: booleanField(payload, 'taxDeductiblePossible', false),
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
      taxYear: stringField(payload, 'taxYear', new Date().getFullYear().toString()),
      incomeType: stringField(payload, 'incomeType', 'Other income'),
      amount: numberField(payload, 'amount', 0),
      currency: stringField(payload, 'currency', 'LKR'),
      convertedLkrAmount: numberField(payload, 'convertedLkrAmount', numberField(payload, 'amount', 0)),
      exchangeRateSource: stringField(payload, 'exchangeRateSource', 'manual'),
      deductionCategory: optionalString(payload, 'deductionCategory'),
      estimatedTaxableAmount: numberField(payload, 'estimatedTaxableAmount', 0),
      taxPaid: numberField(payload, 'taxPaid', 0),
      taxDue: numberField(payload, 'taxDue', 0),
      requiresConfirmation: booleanField(payload, 'requiresConfirmation', true),
      notes: optionalString(payload, 'notes'),
      supportingDocument: optionalString(payload, 'supportingDocument'),
    })
  } else if (kind === 'trading_plan') {
    db.trading_plans.push(createTradingPlan(payload, base))
  } else {
    throw new Error(`Unsupported finance record kind: ${kind}`)
  }

  writeFinanceStore(db)
  appendAuditLog(`record_added:${kind}`, { id: base.id, kind })
  return db
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
  const decision = decisionField(payload, 'decision', riskLevel === 'blocked' ? 'BLOCKED' : 'HOLD')
  const hasExit = payload.takeProfit != null || stringField(payload, 'expectedHoldingPeriod', '') !== ''
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
    reason: blocked ? `Blocked by safety controls: ${blockers.join('; ')}` : stringField(payload, 'reason', 'Manual plan'),
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
    finalRecommendation: blocked ? 'Do not execute.' : stringField(payload, 'finalRecommendation', 'Monitor only.'),
    status: blocked ? 'blocked' : planStatus(payload.status),
    userApprovalStatus: 'pending',
    executionStatus: blocked ? 'blocked' : 'not_executable',
    actualOutcome: optionalString(payload, 'actualOutcome'),
    profitLoss: optionalNumber(payload, 'profitLoss'),
    strategyUsed: optionalString(payload, 'strategyUsed'),
    agentNotes: optionalString(payload, 'agentNotes'),
  }
}

export function financeSummary(db: FinanceDatabase) {
  const totalIncomeLkr = db.income_records.reduce((sum, row) => sum + row.convertedLkrAmount, 0)
  const totalExpensesLkr = db.expense_records.reduce((sum, row) => sum + row.convertedLkrAmount, 0)
  const netSavingsLkr = totalIncomeLkr - totalExpensesLkr
  const savingsRate = totalIncomeLkr > 0 ? (netSavingsLkr / totalIncomeLkr) * 100 : 0
  const cashBalanceLkr = db.finance_accounts.reduce((sum, row) => sum + (row.currency === 'LKR' ? row.balance : 0), 0)
  const taxReserveLkr = db.savings_goals
    .filter((goal) => goal.name.toLowerCase().includes('tax'))
    .reduce((sum, goal) => sum + goal.currentAmount, 0)
  const debtLkr = db.finance_accounts
    .filter((account) => account.type === 'loan' || account.type === 'card')
    .reduce((sum, row) => sum + Math.abs(row.balance), 0)
  const netWorthLkr = cashBalanceLkr + db.savings_goals.reduce((sum, goal) => sum + goal.currentAmount, 0) - debtLkr
  const openPlans = db.trading_plans.filter((plan) => !['cancelled', 'expired', 'failed', 'blocked'].includes(plan.status)).length
  const blockedPlans = db.trading_plans.filter((plan) => plan.status === 'blocked' || plan.decision === 'BLOCKED').length
  return {
    totalIncomeLkr,
    totalExpensesLkr,
    netSavingsLkr,
    savingsRate,
    cashBalanceLkr,
    taxReserveLkr,
    debtLkr,
    netWorthLkr,
    accountCount: db.finance_accounts.length,
    goalCount: db.savings_goals.length,
    taxRecordCount: db.tax_records.length,
    openPlans,
    blockedPlans,
    tradingMode: db.settings.tradingMode,
    liveTradingEnabled: db.settings.liveTradingEnabled,
    emergencyKillSwitch: db.settings.emergencyKillSwitch,
  }
}

export function financeAlerts(db: FinanceDatabase): Array<{ level: 'info' | 'warning' | 'critical'; title: string; detail: string }> {
  const summary = financeSummary(db)
  const alerts: Array<{ level: 'info' | 'warning' | 'critical'; title: string; detail: string }> = []
  if (summary.totalExpensesLkr > summary.totalIncomeLkr && summary.totalIncomeLkr > 0) {
    alerts.push({ level: 'warning', title: 'Expenses exceed income', detail: 'Current tracked expenses are higher than tracked income.' })
  }
  for (const account of db.finance_accounts) {
    if (account.type !== 'loan' && account.balance < 5_000) {
      alerts.push({ level: 'warning', title: 'Low balance', detail: `${account.name} is below LKR 5,000.` })
    }
  }
  for (const plan of db.trading_plans) {
    if (plan.riskLevel === 'blocked' || plan.decision === 'BLOCKED') {
      alerts.push({ level: 'critical', title: 'Trading plan blocked', detail: `${plan.platform}:${plan.symbol} failed safety controls.` })
    }
  }
  if (db.settings.emergencyKillSwitch) {
    alerts.push({ level: 'info', title: 'Emergency kill switch active', detail: 'Real order execution is disabled.' })
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
  if (['BUY_NOW', 'PLAN_BUY_LATER', 'SELL_NOW', 'PLAN_SELL_LATER', 'REDUCE_POSITION'].includes(input.decision)) {
    if (!Number.isFinite(input.stopLoss)) blockers.push('stop-loss is required')
    if (!input.hasExit) blockers.push('take-profit or exit condition is required')
    if (!Number.isFinite(input.positionSize) || input.positionSize <= 0) blockers.push('position size is required')
  }
  return blockers
}

function stringField(payload: AddPayload, key: string, fallback: string): string {
  const value = payload[key]
  return typeof value === 'string' && value.trim() ? value.trim() : fallback
}

function optionalString(payload: AddPayload, key: string): string | undefined {
  const value = payload[key]
  return typeof value === 'string' && value.trim() ? value.trim() : undefined
}

function numberField(payload: AddPayload, key: string, fallback: number): number {
  const value = payload[key]
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (typeof value === 'string' && value.trim() && Number.isFinite(Number(value))) return Number(value)
  return fallback
}

function optionalNumber(payload: AddPayload, key: string): number | undefined {
  const value = numberField(payload, key, Number.NaN)
  return Number.isFinite(value) ? value : undefined
}

function booleanField(payload: AddPayload, key: string, fallback: boolean): boolean {
  const value = payload[key]
  return typeof value === 'boolean' ? value : fallback
}

function stringArray(value: unknown): Array<string> {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : []
}

function accountType(value: unknown): FinanceAccount['type'] {
  const allowed: Array<FinanceAccount['type']> = ['bank', 'cash', 'card', 'crypto_wallet', 'broker', 'foreign_currency', 'loan', 'other']
  return allowed.includes(value as FinanceAccount['type']) ? (value as FinanceAccount['type']) : 'other'
}

function goalStatus(value: unknown): GoalStatus {
  const allowed: Array<GoalStatus> = ['active', 'completed', 'paused', 'cancelled', 'behind_schedule', 'ahead_of_schedule']
  return allowed.includes(value as GoalStatus) ? (value as GoalStatus) : 'active'
}

function planStatus(value: unknown): PlanStatus {
  const allowed: Array<PlanStatus> = ['draft', 'waiting_for_condition', 'ready_for_approval', 'approved', 'executed', 'cancelled', 'expired', 'failed', 'blocked']
  return allowed.includes(value as PlanStatus) ? (value as PlanStatus) : 'draft'
}

function riskLevelField(payload: AddPayload, key: string, fallback: RiskLevel): RiskLevel {
  const value = payload[key]
  const allowed: Array<RiskLevel> = ['low_risk', 'medium_risk', 'high_risk', 'blocked']
  return allowed.includes(value as RiskLevel) ? (value as RiskLevel) : fallback
}

function decisionField(payload: AddPayload, key: string, fallback: TradingDecision): TradingDecision {
  const value = payload[key]
  return DECISIONS.includes(value as TradingDecision) ? (value as TradingDecision) : fallback
}
