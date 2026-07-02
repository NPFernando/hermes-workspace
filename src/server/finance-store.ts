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
  strength: number  // 0-100
  confidence: number  // 0-100
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
    virtual_accounts: [],
    portfolio_positions: [],
    account_balances: [],
    strategy_results: [],
    prediction_results: [],
    agent_memory: [],
    audit_logs: [],
    error_logs: [],
    trading_signals: [],
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

export function updateFinanceRecord(kind: string, id: string, payload: AddPayload): FinanceDatabase {
  const db = ensureFinanceStore()
  let updated = false
  if (kind === 'income') {
    const index = db.income_records.findIndex(r => r.id === id)
    if (index !== -1) {
      db.income_records[index] = { ...db.income_records[index], ...payload, updatedAt: nowIso() }
      updated = true
    }
  } else if (kind === 'expense') {
    const index = db.expense_records.findIndex(r => r.id === id)
    if (index !== -1) {
      db.expense_records[index] = { ...db.expense_records[index], ...payload, updatedAt: nowIso() }
      updated = true
    }
  } else if (kind === 'account') {
    const index = db.finance_accounts.findIndex(r => r.id === id)
    if (index !== -1) {
      db.finance_accounts[index] = { ...db.finance_accounts[index], ...payload, updatedAt: nowIso() }
      updated = true
    }
  } else if (kind === 'goal') {
    const index = db.savings_goals.findIndex(r => r.id === id)
    if (index !== -1) {
      db.savings_goals[index] = { ...db.savings_goals[index], ...payload, updatedAt: nowIso() }
      updated = true
    }
  } else if (kind === 'tax') {
    const index = db.tax_records.findIndex(r => r.id === id)
    if (index !== -1) {
      db.tax_records[index] = { ...db.tax_records[index], ...payload, updatedAt: nowIso() }
      updated = true
    }
  } else if (kind === 'budget_category') {
    const index = db.budget_categories.findIndex(r => r.id === id)
    if (index !== -1) {
      db.budget_categories[index] = { ...db.budget_categories[index], ...payload, updatedAt: nowIso() }
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

export function createVirtualAccount(payload: AddPayload, base?: { id: string; source: string; createdAt: string; updatedAt: string }): VirtualAccount {
  const createdAt = nowIso()
  const recordBase = base ?? { id: randomUUID(), source: 'manual', createdAt, updatedAt: createdAt }
  return {
    ...recordBase,
    platform: stringField(payload, 'platform', 'manual'),
    currency: stringField(payload, 'currency', 'LKR'),
    balance: numberField(payload, 'balance', 10000),
    initialBalance: numberField(payload, 'initialBalance', numberField(payload, 'balance', 10000)),
    lockedAmount: optionalNumber(payload, 'lockedAmount') ?? 0,
    totalTrades: numberField(payload, 'totalTrades', 0),
    winningTrades: numberField(payload, 'winningTrades', 0),
    totalPnl: optionalNumber(payload, 'totalPnl') ?? 0,
    totalPnlPercentage: optionalNumber(payload, 'totalPnlPercentage') ?? 0,
  }
}

export function createTradeOrder(payload: AddPayload, base?: { id: string; source: string; createdAt: string; updatedAt: string }): TradeOrder {
  const createdAt = nowIso()
  const recordBase = base ?? { id: randomUUID(), source: 'manual', createdAt, updatedAt: createdAt }
  return {
    ...recordBase,
    planId: stringField(payload, 'planId', ''),
    platform: stringField(payload, 'platform', 'manual'),
    symbol: stringField(payload, 'symbol', 'UNSPECIFIED'),
    side: stringField(payload, 'side', 'buy') as 'buy' | 'sell',
    quantity: numberField(payload, 'quantity', 0),
    orderType: stringField(payload, 'orderType', 'market') as 'market' | 'limit' | 'stop_limit',
    ...(optionalNumber(payload, 'price') !== undefined ? { price: optionalNumber(payload, 'price') } : {}),
    status: 'pending',
    ...(optionalString(payload, 'brokerOrderId') !== undefined ? { brokerOrderId: optionalString(payload, 'brokerOrderId') } : {}),
  }
}

export function createTradeExecution(payload: AddPayload, base?: { id: string; source: string; createdAt: string; updatedAt: string }): TradeExecution {
  const createdAt = nowIso()
  const recordBase = base ?? { id: randomUUID(), source: 'manual', createdAt, updatedAt: createdAt }
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

export function createTradingSignal(payload: AddPayload, base?: { id: string; source: string; createdAt: string; updatedAt: string }): TradingSignal {
  const createdAt = nowIso()
  const recordBase = base ?? { id: randomUUID(), source: 'manual', createdAt, updatedAt: createdAt }
  return {
    ...recordBase,
    symbol: stringField(payload, 'symbol', 'UNSPECIFIED'),
    action: stringField(payload, 'action', 'hold') as 'buy' | 'sell' | 'hold',
    strength: numberField(payload, 'strength', 50),
    confidence: numberField(payload, 'confidence', 50),
    priceTarget: numberField(payload, 'priceTarget', 0),
    stopLoss: numberField(payload, 'stopLoss', 0),
    reasoning: stringField(payload, 'reasoning', 'No specific reasoning provided'),
    indicators: payload.indicators ? (payload.indicators as Record<string, number>) : {},
    timestamp: stringField(payload, 'timestamp', nowIso()),
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

export function executeTradingPlan(planId: string, useTestnet: boolean = false): { order: TradeOrder; execution: TradeExecution; updatedAccount: VirtualAccount } {
  const db = ensureFinanceStore()

  // Find the trading plan
  const plan = db.trading_plans.find(p => p.id === planId)
  if (!plan) {
    throw new Error(`Trading plan not found: ${planId}`)
  }

  // Check if plan is executable
  if (plan.executionStatus !== 'pending' && plan.userApprovalStatus !== 'approved') {
    throw new Error(`Trading plan is not executable. Status: ${plan.executionStatus}`)
  }

  // Check if trading mode allows execution
  const mode = db.settings.tradingMode
  if (mode === 'observe_only') {
    throw new Error('Trading is disabled in observe_only mode')
  }

  if (mode === 'live_recommend_only' || mode === 'live_manual_approval' || mode === 'live_auto_trade') {
    if (!db.settings.liveTradingEnabled) {
      throw new Error('Live trading is not enabled')
    }
  }

  // For paper_trade or testnet_execute, we can proceed with simulation
  // For live modes, we would integrate with actual exchange APIs

  // Create market order based on plan
  const orderPayload: any = {
    planId: plan.id,
    platform: plan.platform,
    symbol: plan.symbol,
    side: plan.decision === 'BUY_NOW' || plan.decision === 'PLAN_BUY_LATER' ? 'buy' : 'sell',
    quantity: plan.positionSize ?? 0,
    orderType: 'market',
    price: plan.decision === 'BUY_NOW' || plan.decision === 'PLAN_BUY_LATER' ? (plan.suggestedEntryPrice ?? 0) : (plan.suggestedExitPrice ?? 0),
  }

  const order = createTradeOrder(orderPayload)
  db.trade_orders.push(order)

  // Simulate execution (in real implementation, this would call exchange API)
  // For paper trading, we use the suggested price or current market price
  const executionPrice = order.price ?? (Math.random() * 100 + 50) // Mock price

  const executionPayload: any = {
    orderId: order.id,
    planId: plan.id,
    platform: plan.platform,
    symbol: plan.symbol,
    side: order.side,
    quantity: order.quantity,
    price: executionPrice,
    fees: Math.abs(order.quantity * executionPrice) * 0.001, // 0.1% fee
    executedAt: new Date().toISOString(),
  }

  const execution = createTradeExecution(executionPayload)
  db.trade_executions.push(execution)

  // Update plan status
  plan.executionStatus = 'executed'
  plan.status = 'executed'
  plan.actualOutcome = `Executed at ${executionPrice}`
  plan.profitLoss = 0 // Will be calculated when position is closed

  // Update or create virtual account
  let account = db.virtual_accounts.find(acc => acc.platform === plan.platform && acc.currency === 'LKR')
  if (!account) {
    const accountPayload: any = {
      platform: plan.platform,
      currency: 'LKR',
      balance: 10000, // Starting balance
      initialBalance: 10000,
    }
    account = createVirtualAccount(accountPayload)
    db.virtual_accounts.push(account)
  }

  // Update account based on trade
  if (order.side === 'buy') {
    // Buying: decrease cash balance, increase position value
    const cost = order.quantity * executionPrice + execution.fees
    account.balance -= cost
    // In a real system, we'd track positions separately
  } else {
    // Selling: increase cash balance, decrease position value
    const revenue = order.quantity * executionPrice - execution.fees
    account.balance += revenue
    // Calculate P&L (simplified)
    account.totalPnl += revenue
    account.winningTrades += revenue > 0 ? 1 : 0
  }
  account.totalTrades += 1
  account.updatedAt = new Date().toISOString()

  // Update plan P&L
  plan.profitLoss = account.totalPnl

  writeFinanceStore(db)
  appendAuditLog('trade_executed', { planId, orderId: order.id, executionId: execution.id, platform: plan.platform, symbol: plan.symbol })

  return { order, execution, updatedAccount: account }
}

export function generateTradingSignal(symbol: string, marketData: Record<string, any> = {}): TradingSignal {
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

export function updateVirtualAccountPrices(prices: Record<string, number>): void {
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

export function createPaperTradingAccount(platform: 'binance' | 'ibkr' = 'binance', initialBalance: number = 10000): VirtualAccount {
  const db = ensureFinanceStore()

  // Check if account already exists for this platform
  let account = db.virtual_accounts.find(acc => acc.platform === platform && acc.currency === 'LKR')

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
    appendAuditLog('paper_trading_account_created', { platform, initialBalance })
  }

  return account
}

export function getPaperTradingBalance(platform: 'binance' | 'ibkr' = 'binance'): { balance: number; initialBalance: number; totalPnl: number; totalPnlPercentage: number } | null {
  const db = ensureFinanceStore()
  const account = db.virtual_accounts.find(acc => acc.platform === platform && acc.currency === 'LKR')

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


function parseDate(dateString: string): { year: number; month: number } | null {
  const match = dateString.match(/^(\d{4})-(\d{2})-\d{2}$/)
  if (!match) return null
  return {
    year: parseInt(match[1], 10),
    month: parseInt(match[2], 10)
  }
}

export function getMonthlySummary(db: FinanceDatabase, year?: number, month?: number): Array<{ year: number; month: number; income: number; expense: number; savings: number }> {
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

  const result: Array<{ year: number; month: number; income: number; expense: number; savings: number }> = []
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
      savings: income - expense
    })
  }

  // Sort by year, then month
  result.sort((a, b) => {
    if (a.year !== b.year) return a.year - b.year
    return a.month - b.month
  })

  return result
}

export function getBudgetVsActual(db: FinanceDatabase, category: string, year: number, month: number): { budget: number; actual: number; variance: number } | null {
  // Format month as MM with leading zero
  const monthStr = month.toString().padStart(2, '0')
  const monthKey = `${year}-${monthStr}`
  
  // Find the budget category for the given category, year, month
  const budgetEntry = db.budget_categories.find(
    b => b.category === category && b.month === monthKey
  )
  if (!budgetEntry) return null

  // Calculate actual expenses for that category, year, month
  let actual = 0
  for (const exp of db.expense_records) {
    const dateInfo = parseDate(exp.date)
    if (!dateInfo) continue
    if (dateInfo.year === year && dateInfo.month === month && exp.category === category) {
      actual += exp.convertedLkrAmount
    }
  }

  return {
    budget: budgetEntry.budgetAmount,
    actual,
    variance: budgetEntry.budgetAmount - actual
  }
}

export function updateExchangeRate(base: string, target: string, rate: number, date?: string): FinanceDatabase {
  const db = ensureFinanceStore()
  const dateStr = date ?? new Date().toISOString().split('T')[0]
  const rateRecord = { base, target, rate, date: dateStr, updatedAt: new Date().toISOString() }
  
  db.exchange_rates.push(rateRecord)
  writeFinanceStore(db)
  appendAuditLog('exchange_rate_updated', { base, target, rate, date: dateStr })
  return db
}

export function getExchangeRate(base: string, target: string, date?: string): number | undefined {
  // Filter rates for the base and target, then take the one with the latest date
  const db = ensureFinanceStore()
  let relevant = db.exchange_rates
    .filter((r: any) => 
      r.base === base && 
      r.target === target && 
      typeof r.rate === 'number'
    );

  // If a date is provided, only consider rates on or before that date
  if (date !== undefined) {
    const targetDate = new Date(date).getTime();
    relevant = relevant.filter((r: any) => {
      const rDate = new Date(r.date || 0).getTime();
      return rDate <= targetDate;
    });
  }

  // Sort by date descending (latest first)
  relevant = relevant.sort((a: any, b: any) => {
    const dateA = new Date(a.date || 0).getTime()
    const dateB = new Date(b.date || 0).getTime()
    return dateB - dateA
  });

  if (relevant.length === 0) return undefined
  return relevant[0].rate as number
}

export function convertCurrency(
  amount: number,
  fromCurrency: CurrencyCode,
  toCurrency: CurrencyCode,
  date?: string
): number | undefined {
  if (fromCurrency === toCurrency) {
    return amount
  }

  // Try direct rate
  let rate = getExchangeRate(fromCurrency, toCurrency, date)
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
    .flatMap(plan => {
      if (plan.executionStatus !== 'executed' || typeof plan.profitLoss !== 'number') return []
      return [{
        id: plan.id,
        profitLoss: plan.profitLoss,
        decision: plan.decision,
        expectedOutcome: plan.expectedOutcome ?? '',
        actualOutcome: plan.actualOutcome ?? '',
        date: new Date(plan.updatedAt), // or plan.createdAt? We'll use updatedAt as the time when the plan was last updated (should be after execution)
        symbol: plan.symbol,
      }]
    })
    .sort((a, b) => a.date.getTime() - b.date.getTime()); // ascending chronological

  if (trades.length === 0) {
    return {
      winRate: 0,
      avgProfit: 0,
      avgLoss: 0,
      avgProfitLossPerTrade: 0,
      sharpeRatio: 0,
      maxDrawdown: 0,
      predictionAccuracy: 0,
      totalTrades: 0,
    };
  }

  const profits = trades.filter(t => t.profitLoss > 0).map(t => t.profitLoss);
  const losses = trades.filter(t => t.profitLoss < 0).map(t => t.profitLoss);
  const totalProfit = profits.reduce((sum, p) => sum + p, 0);
  const totalLoss = losses.reduce((sum, l) => sum + l, 0); // negative number
  const totalNet = totalProfit + totalLoss;
  const winRate = profits.length / trades.length;
  const avgProfit = profits.length > 0 ? totalProfit / profits.length : 0;
  const avgLoss = losses.length > 0 ? totalLoss / losses.length : 0; // will be negative
  const avgProfitLossPerTrade = totalNet / trades.length;

  // Sharpe ratio: using profitLoss as return, risk-free rate = 0
  const returns = trades.map(t => t.profitLoss);
  const meanReturn = returns.reduce((sum, r) => sum + r, 0) / returns.length;
  const variance = returns.reduce((sum, r) => sum + Math.pow(r - meanReturn, 2), 0) / returns.length;
  const stdDev = Math.sqrt(variance);
  const sharpeRatio = stdDev !== 0 ? meanReturn / stdDev : 0;

  // Max drawdown: compute cumulative sum and track peak
  let cumulative = 0;
  let peak = 0;
  let maxDrawdown = 0;
  for (const t of trades) {
    cumulative += t.profitLoss;
    if (cumulative > peak) {
      peak = cumulative;
    }
    const drawdown = peak - cumulative; // positive when below peak
    if (drawdown > maxDrawdown) {
      maxDrawdown = drawdown;
    }
  }
  // maxDrawdown is the largest peak-to-trough decline (positive number)

  // Prediction accuracy: compare expectedOutcome with actual profit/loss sign
  let correctPredictions = 0;
  for (const t of trades) {
    const expected = t.expectedOutcome.toLowerCase();
    const profit = t.profitLoss;
    let correct = false;
    if (expected.includes('profit') && profit > 0) {
      correct = true;
    } else if (expected.includes('loss') && profit < 0) {
      correct = true;
    } else if (expected.includes('break even') || expected.includes('break-even') || expected.includes('breakeven')) {
      if (Math.abs(profit) < 1e-9) { // approximately zero
        correct = true;
      }
    }
    // If expectedOutcome is empty, we cannot judge; we'll treat as incorrect.
    if (correct) {
      correctPredictions++;
    }
  }
  const predictionAccuracy = correctPredictions / trades.length;

  return {
    winRate,
    avgProfit,
    avgLoss,
    avgProfitLossPerTrade,
    sharpeRatio,
    maxDrawdown,
    predictionAccuracy,
    totalTrades: trades.length,
  };
}

