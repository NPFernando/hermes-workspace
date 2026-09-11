import { randomUUID } from 'node:crypto'
import { createFileRoute } from '@tanstack/react-router'
import { json } from '@tanstack/react-start'
import { isAuthenticated } from '../../server/auth-middleware'
import {
  getClientIp,
  rateLimit,
  rateLimitResponse,
  requireJsonContentType,
  safeErrorMessage,
} from '../../server/rate-limit'
import { buildMonthlyFinanceReport } from '../../screens/personal-finance/components/financial-report'
import {
  FINANCE_AUDIT_PATH,
  FINANCE_DATA_PATH,
  SUPPORTED_CURRENCIES,
  TRADING_MODES,
  addFinanceRecord,
  addFinanceSplit,
  addFinanceTransfer,
  addPendingIngestion,
  annualBudgetVsActualSummary,
  appendAuditLog,
  applyBudgetTemplate,
  budgetVsActualSummary,
  buildAiTaskReviewCsv,
  buildFinanceAgentContext,
  buildFinanceQueryContext,
  buildTaxRecordsCsv,
  buildTransactionsCsv,
  captureNetWorthSnapshot,
  cseProviderHealth,
  deleteBudgetTemplate,
  deleteFinanceRecord,
  ensureFinanceStore,
  financeAlerts,
  financeStorageAlerts,
  financeStorageStatus,
  financeSummary,
  financialHealthSummary,
  findPossibleDuplicate,
  getAverageMonthlyExpensesLkr,
  getAverageMonthlySavingsRatePct,
  getCategoryCorrections,
  getUnifiedTransactions,
  listFinanceAiTasks,
  listPendingIngestions,
  maskSensitive,
  previewFinanceAuditPrune,
  pruneFinanceAudit,
  readFinanceAuditLog,
  readFinanceStore,
  readTransactionAudit,
  recordCategoryCorrection,
  restoreFinanceRecord,
  safeToSpendSummary,
  saveBudgetTemplate,
  setNonLiveExecutionMode,
  storeIntelligenceRecords,
  tradingPerformanceSummary,
  updateExchangeRate,
  updateFinanceRecord,
  updatePendingIngestion,
  verifyFinanceAuditChain,
  writeFinanceStore,
} from '../../server/finance-store'
import type { FinanceDatabase } from '../../server/finance-store'
import { isPdfEncrypted, pdfToImages } from '../../server/document-normalizer'
import { listFinanceDocuments } from '../../server/finance-document-vault'
import {
  assessFxProviderHealth,
  fetchFrankfurterRate,
} from '../../server/finance-fx-provider'
import { detectContractChanges } from '../../server/contract-change-detection'
import { getFinanceManagerAgentProfile } from '../../server/finance-agent-profile'
import {
  answerFinanceQuestion,
  extractEmploymentContract,
  extractTransactionFromImage,
  extractTransactionsFromImages,
} from '../../server/finance-extraction'
import {
  approveMemory,
  flagFinanceMemory,
  getUserFinanceMemoriesForPrompt,
  isHarpMemoryEnabled,
  listActiveFinanceMemories,
  listPendingFinanceCandidates,
  proposeCategoryPreference,
  proposeFinancialRule,
  rejectMemory,
} from '../../server/harp-memory-client'
import { syncGmailNow } from '../../server/gmail-ingest'
import { validateFinancialRules } from '../../server/financial-rules'
import {
  financeAgentAuthenticationError,
  financeAgentScopeGuard,
  financeMutationGuard,
  financeMutationRisk,
} from '../../server/finance-action-guard'
import { fetchCsePrice } from '../../server/cse-market.service'
import { prepareTransactionImport } from '../../server/transaction-import'
import {
  decryptFinanceBackup,
  encryptFinanceBackup,
} from '../../server/encrypted-finance-backup'
import {
  defaultEncryptedBackupConfig,
  encryptedFinanceBackupHealth,
  listEncryptedFinanceAuditArchives,
  verifyEncryptedFinanceAuditArchive,
  writeEncryptedFinanceAuditArchive,
} from '../../server/encrypted-finance-retention'
import {
  addBinanceCandles,
  addMarketPrice,
  fetchBinanceKlines,
  fetchBinanceTickerPrice,
} from '../../server/binance-market.service'
import { STRATEGIES } from '../../server/trading-strategies'
import {
  applyLearningCandidate,
  applyRecommendedSafeguards,
  applyStrategyOverrideRecommendations,
  decisionQualityReport,
  demoTradingPerformance,
  getLastTradingCycleDiagnostics,
  getLiveMonitor,
  getStrategyEligibilityAudit,
  learningReport,
  marketLearningReport,
  rearmSandboxExperiment,
  reviewSandboxExperiments,
  rollbackSandboxExperiment,
  runLearningCycle,
  safeguardHistory,
  setStrategyOverride,
  startSandboxExperiment,
  stopSandboxExperiment,
  strategyCatalog,
  strategyGuardReview,
  strategyOverrideState,
} from '../../server/demo-trading-engine'
import { startFinanceStorageMonitor } from '../../server/finance-storage-monitor'
import { fetchAndStoreGoogleNews } from '../../server/finance-news.service'
import { tradingCycleDiagnosticTrends } from '../../server/finance-postgres-store'
import {
  INTELLIGENCE_FORMULA_VERSION,
  assessResearchRisk,
  buildCompositeSentiment,
} from '../../server/finance-intelligence'

export function detectDurableFinancePreference(text: string): string | null {
  if (!['1', 'true', 'yes'].includes((process.env.FINANCE_LEARNED_FACTS_ENABLED ?? '').toLowerCase())) return null
  const value = text.trim()
  if (value.length < 20 || /\?\s*$/.test(value)) return null
  if (!/^(i\s+(always|never|prefer|avoid|only|usually)|my\s+rule\s+is\b)/i.test(value)) return null
  return value
}
import {
  appendPaperDecisionSnapshot,
  readPaperDecisionJournal,
} from '../../server/paper-decision-journal'
import { evaluatePaperDecisionQuality } from '../../server/paper-decision-quality'
import { resetConnectivityBreaker } from '../../server/connectivity-breaker'
import {
  ensureValidationRunAutomation,
  finalizeValidationRun,
  recoverValidationRunAutomationIfStale,
  runValidationCycle,
  startValidationRun,
  stopValidationRun,
  validationReconciliationPayload,
  validationRunsPayload,
} from '../../server/validation-run'
import {
  activateLiveReadiness,
  approveLiveApproval,
  assessAndPersistReadiness,
  assessReadiness,
  deactivateLiveReadiness,
  getReadinessState,
  requestLiveApproval,
} from '../../server/trading-readiness'

const VALID_LONG_SHORT_PERIODS = new Set([
  '5m',
  '15m',
  '30m',
  '1h',
  '2h',
  '4h',
  '6h',
  '12h',
  '1d',
])

type JsonRecord = Record<string, unknown>

startFinanceStorageMonitor()
ensureValidationRunAutomation()

async function parseJsonBody(request: Request): Promise<JsonRecord> {
  try {
    const body = (await request.json()) as unknown
    return body && typeof body === 'object' && !Array.isArray(body)
      ? (body as JsonRecord)
      : {}
  } catch {
    return {}
  }
}

function unauthorized() {
  return json({ ok: false, error: 'Unauthorized' }, { status: 401 })
}

/**
 * add_record/update_record/delete_record are only ever called from the
 * Personal Finance screen's generic DataTable/panels (confirmed: no trading
 * UI calls these actions) — for these kinds, respond with
 * personalFinancePayload() so the caller's cast to PersonalFinancePayload is
 * actually correct (financePayload() lacks emergencyFund and other
 * personal-finance-only fields, which previously crashed EmergencyFundCard
 * on every goal/tax/budget-category edit or delete).
 */
const PERSONAL_FINANCE_RECORD_KINDS = new Set([
  'income',
  'expense',
  'account',
  'goal',
  'tax',
  'budget_category',
  'category',
  'subcategory_entry',
  'merchant',
  'tag',
  'income_source',
  'stock_holding',
  'fixed_deposit',
  'investment_journal',
  'ai_task',
  'beneficiary',
  'insurance_policy',
  'transfer',
  'split',
  'scheduled_transaction',
])

function recordActionResponse(kind: string) {
  return json(
    PERSONAL_FINANCE_RECORD_KINDS.has(kind)
      ? personalFinancePayload()
      : financePayload(),
  )
}

function binanceSymbolFromBody(body: JsonRecord): string {
  const symbol =
    typeof body.symbol === 'string' ? body.symbol.trim().toUpperCase() : ''
  if (!symbol) throw new Error('symbol is required')
  if (!/^[A-Z0-9]{5,20}$/.test(symbol))
    throw new Error('symbol must be a Binance spot symbol such as BTCUSDT')
  if (body.platform === 'ibkr') {
    appendAuditLog('ibkr_future_feature_redirected', {
      requestedPlatform: 'ibkr',
      activeProvider: 'binance',
      symbol,
    })
  }
  return symbol
}

/** Research snapshots are provider-neutral and must not emit provider audit events. */
function researchSymbolFromBody(body: JsonRecord): string {
  const symbol =
    typeof body.symbol === 'string' ? body.symbol.trim().toUpperCase() : ''
  if (!symbol) throw new Error('symbol is required')
  if (!/^[A-Z0-9]{5,20}$/.test(symbol))
    throw new Error('symbol must be an uppercase alphanumeric market symbol')
  return symbol
}

function isLiveMode(mode: string): boolean {
  return (
    mode === 'live_manual_approval' ||
    mode === 'live_auto_trade' ||
    mode === 'live_monitored'
  )
}

function financePayload() {
  recoverValidationRunAutomationIfStale()
  const db = ensureFinanceStore()
  const storage = financeStorageStatus({ selfHeal: true })
  const backupConfig = defaultEncryptedBackupConfig()
  const alerts = [...financeStorageAlerts(storage.health), ...financeAlerts(db)]
  return {
    ok: true,
    checkedAt: Date.now(),
    baseCurrency: db.settings.baseCurrency,
    storage,
    backupHealth: encryptedFinanceBackupHealth(backupConfig),
    paths: {
      database: FINANCE_DATA_PATH,
      postgresDatabase: storage.postgres.database,
      auditLog: FINANCE_AUDIT_PATH,
      secretStorage:
        'external secret manager / environment references only; API keys are not stored here',
    },
    security: {
      secretsStoredInPlainText: false,
      accountNumbersMaskedInNormalPayload: true,
      liveTradingRequiresManualApproval: true,
      withdrawalsDisabled: true,
      leverageDisabledByDefault: true,
      futuresDisabledByDefault: true,
    },
    connectors: {
      binance: {
        publicMarketData: true,
        paperTradingSupported: true,
        spotTestnetSupported: true,
        gatedLiveSpotSupported: true,
        liveTradingEnabled: db.settings.liveTradingEnabled,
        paperShadowEnabled: db.settings.paperShadowEnabled,
        withdrawalsAllowed: false,
        futuresEnabled: false,
      },
      ibkr: {
        status: 'future_feature',
        active: false,
        blocksImplementation: false,
        liveTradingEnabled: false,
        requiresContractVerification: true,
      },
    },
    summary: financeSummary(db),
    cseProviderHealth: cseProviderHealth(db),
    netWorthSnapshots: db.net_worth_snapshots,
    safeToSpend: safeToSpendSummary(db),
    nextRecommendation: (() => {
      const mode = db.settings.tradingMode
      if (mode === 'live_manual_approval' || mode === 'live_auto_trade') {
        return {
          decision: 'live_requires_manual_review',
          currentMode: mode,
          liveTradingEnabled: true,
          requiresExplicitApproval: true,
          summary:
            'Live execution is already armed or requested. Keep the safety cutoff engaged and require explicit manual review before any additional live risk.',
          nextAction:
            'Pause further live expansion until the operator re-validates the evidence and re-arms only under a tightly bounded approval flow.',
          safeSandboxCaps: {
            durationMinutes: 60,
            maxCycles: 3,
            maxTrades: 3,
            maxExposureUsdt: 50,
          },
        }
      }
      if (mode === 'testnet_execute') {
        return {
          decision: 'sandbox_evidence_only',
          currentMode: mode,
          liveTradingEnabled: false,
          requiresExplicitApproval: true,
          summary:
            'The engine is in sandbox/testnet evidence mode. Treat it as a controlled validation stage, not a sign of live readiness.',
          nextAction:
            'Continue with bounded testnet evidence only, then return to paper mode and reconcile before any stage promotion.',
          safeSandboxCaps: {
            durationMinutes: 60,
            maxCycles: 3,
            maxTrades: 3,
            maxExposureUsdt: 50,
          },
        }
      }
      return {
        decision: 'stay_paper_only',
        currentMode: mode,
        liveTradingEnabled: false,
        requiresExplicitApproval: true,
        summary:
          'Keep the engine in paper mode until explicit approval for one bounded sandbox/testnet pilot.',
        nextAction:
          'Use the strategy audit as the evidence gate; no live activation and no strategy tuning unless approval is granted.',
        safeSandboxCaps: {
          durationMinutes: 60,
          maxCycles: 3,
          maxTrades: 3,
          maxExposureUsdt: 50,
        },
      }
    })(),
    budgetVsActual: budgetVsActualSummary(db),
    annualBudgetVsActual: annualBudgetVsActualSummary(db),
    exchangeRates: (Array.isArray(db.exchange_rates) ? db.exchange_rates : [])
      .filter(
        (rate) =>
          typeof rate.base === 'string' &&
          typeof rate.target === 'string' &&
          typeof rate.rate === 'number',
      )
      .sort((a, b) => String(b.date).localeCompare(String(a.date)))
      .slice(0, 100),
    fxProviderHealth: assessFxProviderHealth(
      Array.isArray(db.exchange_rates) ? db.exchange_rates : [],
    ),
    transactions: maskSensitive(getUnifiedTransactions(db)),
    deletedTransactions: maskSensitive(
      getUnifiedTransactions(db, { includeDeleted: true }).filter(
        (transaction) => transaction.deletedAt,
      ),
    ),
    transactionAudit: readTransactionAudit(100),
    tradingPerformance: tradingPerformanceSummary(db),
    demoPerformance: demoTradingPerformance(),
    decisionQuality: decisionQualityReport(),
    paperDecisionQuality: evaluatePaperDecisionQuality({
      decisions: readPaperDecisionJournal(),
      historicalCandles: db.historical_candles,
      evaluatedAt: new Date().toISOString(),
    }),
    learning: learningReport(),
    marketLearning: marketLearningReport(),
    safeguardHistory: safeguardHistory(),
    strategyCatalog: strategyCatalog(),
    strategyEligibilityAudit: getStrategyEligibilityAudit(),
    strategyOverrides: strategyOverrideState(),
    sandboxExperiments: reviewSandboxExperiments(),
    validationRuns: validationRunsPayload(),
    validationReconciliation: validationReconciliationPayload(),
    lastTradingCycleDiagnostics: getLastTradingCycleDiagnostics(),
    tradingCycleDiagnosticTrends: {
      paper: tradingCycleDiagnosticTrends('paper'),
      sandbox: tradingCycleDiagnosticTrends('sandbox'),
    },
    guardEvidence: strategyGuardReview(),
    alerts,
    settings: db.settings,
    connectivityBreaker: db.connectivityBreaker,
    // Read-only dry-run assessment (never persists) plus whatever
    // snapshot/approval was last explicitly persisted via the
    // live_readiness_* actions below — see trading-readiness.ts.
    liveReadiness: { live: assessReadiness(), stored: getReadinessState() },
    // market_prices/risk_scores are fetched but never rendered anywhere in
    // the UI (confirmed via grep) — dropped here to shrink this response,
    // which finance-screen.tsx's polling/refetch cycle re-fetches in full.
    data: maskSensitive({
      ...db,
      income_records: Array.isArray(db.income_records)
        ? db.income_records.filter((record) => !record.deletedAt)
        : [],
      expense_records: Array.isArray(db.expense_records)
        ? db.expense_records.filter((record) => !record.deletedAt)
        : [],
      market_prices: [],
      risk_scores: [],
    }),
  }
}

/**
 * Lighter-weight sibling of financePayload() for the Personal Finance
 * screen: skips every trading-only report (tradingPerformanceSummary,
 * decisionQualityReport, paperDecisionQuality, learningReport,
 * marketLearningReport, safeguardHistory, strategyCatalog,
 * strategyOverrideState — none of which Personal Finance ever reads) and
 * only includes the personal-finance collections, not the full trading
 * state (historical_candles, trading_plans, trade_orders, etc.). Reuses the
 * same ensureFinanceStore() call as financePayload() — no change to the
 * underlying read/write/migration path. The Trading screen keeps using the
 * unscoped GET (financePayload()) unchanged.
 */
function personalFinancePayload() {
  const db = ensureFinanceStore()
  const summary = financeSummary(db)
  const exchangeRateRows = Array.isArray(db.exchange_rates)
    ? db.exchange_rates
    : []
  const fxUnconverted = (() => {
    const base = String(summary.baseCurrency ?? 'LKR').toUpperCase()
    const currencies = new Set<string>()
    const add = (value: unknown) => {
      if (typeof value !== 'string') return
      const currency = value.trim().toUpperCase()
      if (currency && currency !== base) currencies.add(currency)
    }
    const storedRows: Array<unknown> = [
      db.finance_accounts as Array<unknown>,
      db.income_records as Array<unknown>,
      db.expense_records as Array<unknown>,
      db.savings_goals as Array<unknown>,
      db.stock_holdings as Array<unknown>,
      db.fixed_deposits as Array<unknown>,
      db.loans as Array<unknown>,
    ].flatMap((rows: unknown) => (Array.isArray(rows) ? rows : []))
    for (const row of storedRows) {
      const record = row as Record<string, unknown>
      add(record.currency ?? record.originalCurrency)
    }
    return [...currencies].filter(
      (currency) =>
        !exchangeRateRows.some((rate) => {
          const record = rate as Record<string, unknown>
          const value = Number(record.rate)
          const from = String(record.base ?? '').toUpperCase()
          const to = String(record.target ?? '').toUpperCase()
          return value > 0 &&
            ((from === base && to === currency) ||
              (from === currency && to === base))
        }),
    ).sort()
  })()
  const snapshots = Array.isArray(db.net_worth_snapshots)
    ? db.net_worth_snapshots
    : []
  const storage = financeStorageStatus({ selfHeal: true })
  const backupConfig = defaultEncryptedBackupConfig()
  const alerts = [...financeStorageAlerts(storage.health), ...financeAlerts(db)]
  const efTargetMonths = db.settings.emergencyFundTargetMonths ?? 0
  const efAvgMonthlyExpensesLkr = getAverageMonthlyExpensesLkr(db, 3)
  const efCurrentLkr = summary.cashBalanceLkr
  const efTargetLkr = efTargetMonths * efAvgMonthlyExpensesLkr
  const efCoverageMonths =
    efAvgMonthlyExpensesLkr > 0 ? efCurrentLkr / efAvgMonthlyExpensesLkr : 0
  const efProgressPct =
    efTargetLkr > 0 ? Math.min(100, (efCurrentLkr / efTargetLkr) * 100) : 0
  const srTargetPct = db.settings.savingsRateTargetPct ?? 0
  const { actualPct: srActualPct, hasData: srHasData } =
    getAverageMonthlySavingsRatePct(db, 3)
  const srProgressPct =
    srTargetPct > 0
      ? Math.min(100, Math.max(0, (srActualPct / srTargetPct) * 100))
      : 0
  const wgTargetLkr = db.settings.wealthGoalTargetLkr ?? 0
  const wgTargetDate = db.settings.wealthGoalTargetDate ?? null
  const wgCurrentLkr = summary.netWorthLkr
  const wgProgressPct =
    wgTargetLkr > 0
      ? Math.min(100, Math.max(0, (wgCurrentLkr / wgTargetLkr) * 100))
      : 0
  return {
    ok: true,
    checkedAt: Date.now(),
    storage,
    backupHealth: encryptedFinanceBackupHealth(backupConfig),
    summary: {
      ...summary,
      fxUnconverted,
    },
    cseProviderHealth: cseProviderHealth(db),
    netWorthSnapshots: snapshots,
    netWorthHistory: snapshots.slice(-180).map((snapshot) => ({
      date: snapshot.snapshotDate,
      netWorthBase: snapshot.netWorthLkr,
      cashBase: snapshot.cashLkr,
      investmentsBase: snapshot.investmentsLkr,
      debtBase: snapshot.debtLkr,
    })),
    safeToSpend: safeToSpendSummary(db),
    financialHealth: financialHealthSummary(db, storage.health.status),
    budgetVsActual: budgetVsActualSummary(db),
    annualBudgetVsActual: annualBudgetVsActualSummary(db),
    exchangeRates: (Array.isArray(db.exchange_rates) ? db.exchange_rates : [])
      .filter(
        (rate) =>
          typeof rate.base === 'string' &&
          typeof rate.target === 'string' &&
          typeof rate.rate === 'number',
      )
      .sort((a, b) => String(b.date).localeCompare(String(a.date)))
      .slice(0, 100),
    budgetAlertThresholdPct: Math.max(
      50,
      Math.min(100, db.settings.budgetAlertThresholdPct ?? 80),
    ),
    budgetTemplates: db.settings.budgetTemplates ?? [],
    goalCompletionEvents: db.settings.goalCompletionEvents ?? [],
    proactiveInsightsEnabled: db.settings.proactiveInsightsEnabled === true,
    salaryHistory: db.settings.salaryHistory ?? [],
    alertsEnabled: db.settings.alertsEnabled === true,
    quietModeEnabled: db.settings.quietModeEnabled === true,
    financialRules: db.settings.financialRules ?? {},
    transactions: maskSensitive(getUnifiedTransactions(db)),
    deletedTransactions: maskSensitive(
      getUnifiedTransactions(db, { includeDeleted: true }).filter(
        (transaction) => transaction.deletedAt,
      ),
    ),
    transactionAudit: readTransactionAudit(100),
    alerts,
    emergencyFund: {
      targetMonths: efTargetMonths,
      avgMonthlyExpensesLkr: efAvgMonthlyExpensesLkr,
      currentLkr: efCurrentLkr,
      targetLkr: efTargetLkr,
      coverageMonths: efCoverageMonths,
      progressPct: efProgressPct,
    },
    savingsRateTarget: {
      targetPct: srTargetPct,
      actualPct: srActualPct,
      progressPct: srProgressPct,
      hasData: srHasData,
    },
    wealthGoal: {
      targetLkr: wgTargetLkr,
      targetDate: wgTargetDate,
      currentLkr: wgCurrentLkr,
      progressPct: wgProgressPct,
    },
    financeQaHistory: db.settings.financeQaHistory ?? [],
    data: maskSensitive({
      finance_accounts: db.finance_accounts,
      income_records: Array.isArray(db.income_records)
        ? db.income_records.filter((record) => !record.deletedAt)
        : [],
      expense_records: Array.isArray(db.expense_records)
        ? db.expense_records.filter((record) => !record.deletedAt)
        : [],
      budget_categories: db.budget_categories,
      categories: db.categories,
      subcategories: db.subcategories,
      merchants: db.merchants,
      tags: db.tags,
      savings_goals: db.savings_goals,
      tax_records: db.tax_records,
      income_sources: db.income_sources,
      stock_holdings: db.stock_holdings,
      fixed_deposits: db.fixed_deposits,
      investment_journal: db.investment_journal,
      ai_tasks: db.ai_tasks,
      loans: db.loans,
      properties: db.properties,
      beneficiaries: db.beneficiaries,
      insurance_policies: db.insurance_policies,
      pending_ingestions: db.pending_ingestions,
      scheduled_transactions:
        (db as FinanceDatabase & {
          scheduled_transactions?: Array<Record<string, unknown>>
        }).scheduled_transactions ?? [],
      exchange_rates: (Array.isArray(db.exchange_rates) ? db.exchange_rates : [])
        .filter(
          (rate) =>
            typeof rate.base === 'string' &&
            typeof rate.target === 'string' &&
            typeof rate.rate === 'number',
        )
        .slice(0, 100),
    }),
  }
}

function refreshIntelligence(symbol: string) {
  const db = readFinanceStore()
  const now = new Date()
  const composite = buildCompositeSentiment({
    symbol,
    items: db.news_items,
    sentimentScores: db.sentiment_scores,
    now,
  })
  const risk = assessResearchRisk(composite)
  const createdAt = now.toISOString()
  const scoreId = `sentiment:${symbol}:${INTELLIGENCE_FORMULA_VERSION}:${createdAt}`
  const riskId = `risk:${symbol}:${INTELLIGENCE_FORMULA_VERSION}:${createdAt}`
  const stored = storeIntelligenceRecords({
    sentiment: {
      id: scoreId,
      symbol,
      kind: 'news_composite',
      score: composite.score ?? 0,
      label: composite.label,
      confidenceScore: composite.confidence,
      freshness: composite.freshness,
      inputRefs: composite.sourceIds,
      formulaVersion: composite.formulaVersion,
      observedAt: composite.observedAt,
      expiresAt: composite.expiresAt,
      source: 'finance-intelligence',
      createdAt,
      updatedAt: createdAt,
    },
    risk: {
      id: riskId,
      platform: 'research_only',
      symbol,
      ...risk,
      formulaVersion: composite.formulaVersion,
      inputRefs: composite.sourceIds,
      observedAt: composite.observedAt,
      expiresAt: composite.expiresAt,
      source: 'finance-intelligence',
      createdAt,
      updatedAt: createdAt,
    },
  })
  return { composite, stored, researchOnly: true }
}

export const Route = createFileRoute('/api/finance')({
  server: {
    handlers: {
      GET: async ({ request }) => {
        if (!isAuthenticated(request)) return unauthorized()
        const searchParams = new URL(request.url).searchParams
        const scope = searchParams.get('scope')
        if (
          scope === 'personal_finance' &&
          searchParams.get('format') === 'monthly-report'
        ) {
          const requestedMonth = searchParams.get('month') ?? ''
          const month = /^\d{4}-\d{2}$/.test(requestedMonth)
            ? requestedMonth
            : new Date().toISOString().slice(0, 7)
          const report = buildMonthlyFinanceReport(
            personalFinancePayload() as unknown as Parameters<
              typeof buildMonthlyFinanceReport
            >[0],
            month,
          )
          return new Response(report, {
            headers: {
              'Content-Type': 'text/markdown; charset=utf-8',
              'Content-Disposition': `attachment; filename="hermes-finance-report-${month}.md"`,
              'Cache-Control': 'no-store',
            },
          })
        }
        if (
          scope === 'personal_finance' &&
          (searchParams.get('format') === 'csv' ||
            searchParams.get('format') === 'tax-csv')
        ) {
          const taxExport = searchParams.get('format') === 'tax-csv'
          const csv = taxExport
            ? buildTaxRecordsCsv(ensureFinanceStore())
            : buildTransactionsCsv(ensureFinanceStore())
          return new Response(csv, {
            headers: {
              'Content-Type': 'text/csv; charset=utf-8',
              'Content-Disposition': `attachment; filename="hermes-${taxExport ? 'tax-records' : 'transactions'}-${new Date().toISOString().slice(0, 10)}.csv"`,
              'Cache-Control': 'no-store',
            },
          })
        }
        if (scope === 'personal_finance') return json(personalFinancePayload())
        await getLiveMonitor()
        return json(financePayload())
      },
      POST: async ({ request }) => {
        if (!isAuthenticated(request)) return unauthorized()
        const csrfCheck = requireJsonContentType(request)
        if (csrfCheck) return csrfCheck
        if (!rateLimit(`finance-write:${getClientIp(request)}`, 120, 60_000)) {
          return rateLimitResponse()
        }
        const body = await parseJsonBody(request)
        const action =
          typeof body.action === 'string' ? body.action : 'add_record'
        try {
          const agentAuthenticationError = financeAgentAuthenticationError(
            request,
            body,
          )
          if (agentAuthenticationError) {
            appendAuditLog('finance_agent_auth_rejected', {
              action,
              reason: agentAuthenticationError.error,
              source: 'finance_agent_token_guard',
            })
            return json(
              { ok: false, error: agentAuthenticationError.error },
              { status: agentAuthenticationError.status },
            )
          }
          const guardError = financeMutationGuard(action, body)
          if (guardError) {
            appendAuditLog('finance_action_rejected', {
              action,
              risk: financeMutationRisk(action),
              reason: guardError,
              source: 'finance_mutation_guard',
            })
            return json(
              {
                ok: false,
                error: guardError,
                risk: financeMutationRisk(action),
              },
              { status: 400 },
            )
          }
          const agentScopeError = financeAgentScopeGuard(action, body)
          if (agentScopeError) {
            appendAuditLog('finance_agent_scope_rejected', {
              action,
              risk: financeMutationRisk(action),
              reason: agentScopeError,
              source: 'finance_agent_scope_guard',
            })
            return json(
              {
                ok: false,
                error: agentScopeError,
                risk: financeMutationRisk(action),
              },
              { status: 403 },
            )
          }
          if (action === 'add_record') {
            const kind = typeof body.kind === 'string' ? body.kind : ''
            const payload =
              body.payload && typeof body.payload === 'object'
                ? (body.payload as JsonRecord)
                : {}
            addFinanceRecord(kind, payload)
            return recordActionResponse(kind)
          }
          if (action === 'add_transfer') {
            const payload =
              body.payload && typeof body.payload === 'object'
                ? (body.payload as JsonRecord)
                : {}
            addFinanceTransfer(payload)
            return recordActionResponse('transfer')
          }
          if (action === 'add_split') {
            const payload =
              body.payload && typeof body.payload === 'object'
                ? (body.payload as JsonRecord)
                : {}
            addFinanceSplit(payload)
            return recordActionResponse('split')
          }
          if (action === 'post_scheduled') {
            const id = typeof body.id === 'string' ? body.id.trim() : ''
            const db = readFinanceStore()
            const scheduled = db.scheduled_transactions.find(
              (record) => record.id === id,
            )
            if (!scheduled || scheduled.status !== 'pending') {
              return json(
                { ok: false, error: 'No pending scheduled transaction with that id.' },
                { status: 404 },
              )
            }
            const recordPayload =
              scheduled.kind === 'income'
                ? {
                    dateReceived: scheduled.dueDate,
                    sourceName: scheduled.counterparty,
                    incomeType: scheduled.category,
                    originalAmount: scheduled.amount,
                    originalCurrency: 'LKR',
                    accountId: scheduled.accountId,
                    notes: scheduled.notes,
                  }
                : {
                    date: scheduled.dueDate,
                    vendor: scheduled.counterparty,
                    category: scheduled.category,
                    amount: scheduled.amount,
                    currency: 'LKR',
                    accountId: scheduled.accountId,
                    notes: scheduled.notes,
                  }
            const fresh = addFinanceRecord(scheduled.kind, recordPayload)
            const records =
              scheduled.kind === 'income'
                ? fresh.income_records
                : fresh.expense_records
            const posted = records.at(-1)
            updateFinanceRecord('scheduled_transaction', id, {
              status: 'posted',
              postedRecordId: posted?.id,
            })
            appendAuditLog('scheduled_transaction_posted', {
              id,
              recordId: posted?.id,
            })
            return recordActionResponse('scheduled_transaction')
          }
          if (action === 'preview_transaction_import') {
            const csv = typeof body.csv === 'string' ? body.csv : ''
            const preview = prepareTransactionImport(csv, ensureFinanceStore())
            return json({ ok: true, transactionImportPreview: preview })
          }
          if (action === 'commit_transaction_import') {
            const csv = typeof body.csv === 'string' ? body.csv : ''
            const preview = prepareTransactionImport(csv, ensureFinanceStore())
            if (body.confirm !== true) {
              return json(
                {
                  ok: false,
                  error: 'Explicit import confirmation is required.',
                },
                { status: 400 },
              )
            }
            if (body.previewHash !== preview.fingerprint) {
              return json(
                {
                  ok: false,
                  error: 'Import preview is stale; preview the file again.',
                },
                { status: 409 },
              )
            }
            if (preview.errors.length > 0) {
              return json(
                {
                  ok: false,
                  error: 'Import contains invalid rows.',
                  transactionImportPreview: preview,
                },
                { status: 400 },
              )
            }
            if (
              preview.duplicates.length > 0 &&
              body.allowDuplicates !== true
            ) {
              return json(
                {
                  ok: false,
                  error:
                    'Import contains possible duplicates; review and explicitly allow them.',
                  transactionImportPreview: preview,
                },
                { status: 409 },
              )
            }
            for (const item of preview.items) {
              if (item.type === 'transfer') addFinanceTransfer(item.payload)
              else if (item.type === 'split') addFinanceSplit(item.payload)
              else addFinanceRecord(item.type, item.payload)
            }
            return json({
              ...personalFinancePayload(),
              transactionImportResult: {
                importedItems: preview.items.length,
                importedRows: preview.rowCount,
                duplicatesAllowed: preview.duplicates.length > 0,
              },
            })
          }
          if (action === 'download_encrypted_backup') {
            const passphrase =
              typeof body.passphrase === 'string' ? body.passphrase : ''
            const backup = encryptFinanceBackup(
              readFinanceStore(),
              readFinanceAuditLog(),
              passphrase,
            )
            return new Response(backup, {
              headers: {
                'Content-Type': 'application/json; charset=utf-8',
                'Content-Disposition': `attachment; filename="hermes-finance-backup-${new Date().toISOString().slice(0, 10)}.enc.json"`,
                'Cache-Control': 'no-store',
              },
            })
          }
          if (action === 'verify_encrypted_backup') {
            const serialized =
              typeof body.backup === 'string' ? body.backup : ''
            const passphrase =
              typeof body.passphrase === 'string' ? body.passphrase : ''
            const payload = decryptFinanceBackup(serialized, passphrase)
            const schemaVersion =
              payload.finance && typeof payload.finance === 'object'
                ? (payload.finance as { schemaVersion?: unknown }).schemaVersion
                : undefined
            return json({
              ok: true,
              encryptedBackup: {
                verified: true,
                schemaVersion,
                auditEntries: payload.auditLog.split('\n').filter(Boolean)
                  .length,
              },
            })
          }
          if (action === 'update_record') {
            const kind = typeof body.kind === 'string' ? body.kind : ''
            const id = typeof body.id === 'string' ? body.id : ''
            const payload =
              body.payload && typeof body.payload === 'object'
                ? (body.payload as JsonRecord)
                : {}
            if (!id)
              return json(
                { ok: false, error: 'id is required.' },
                { status: 400 },
              )
            if (
              kind === 'ai_task' &&
              body.agentContext &&
              typeof body.agentContext === 'object' &&
              !Array.isArray(body.agentContext) &&
              (body.agentContext as JsonRecord).actor === 'finance_agent'
            ) {
              payload.statusChangedBy = 'finance_agent'
            }
            updateFinanceRecord(kind, id, payload)
            return recordActionResponse(kind)
          }
          if (action === 'delete_record') {
            const kind = typeof body.kind === 'string' ? body.kind : ''
            const id = typeof body.id === 'string' ? body.id : ''
            if (!id)
              return json(
                { ok: false, error: 'id is required.' },
                { status: 400 },
              )
            deleteFinanceRecord(kind, id)
            return recordActionResponse(kind)
          }
          if (action === 'restore_record') {
            const kind = typeof body.kind === 'string' ? body.kind : ''
            const id = typeof body.id === 'string' ? body.id : ''
            if (!id)
              return json(
                { ok: false, error: 'id is required.' },
                { status: 400 },
              )
            restoreFinanceRecord(kind, id)
            return recordActionResponse(kind)
          }
          if (action === 'fetch_market_price') {
            // Read-only market data: Binance is the active provider. IBKR is a future feature.
            const symbol = binanceSymbolFromBody(body)
            const ticker = await fetchBinanceTickerPrice(symbol)
            addMarketPrice(
              symbol,
              ticker.price,
              ticker.bid,
              ticker.ask,
              undefined,
              'binance',
              'binance-public-api',
            )
            return json(financePayload())
          }
          if (action === 'fetch_news') {
            // Public Google News RSS only: research ingestion has no keys and
            // does not touch trading plans, orders, positions, or execution.
            const symbol = binanceSymbolFromBody(body)
            const newsIngestion = await fetchAndStoreGoogleNews(symbol)
            return json({ ...financePayload(), newsIngestion })
          }
          if (action === 'refresh_intelligence') {
            // Derives and stores research-only records from already stored
            // inputs. It never creates plans, orders, positions, or execution.
            const symbol = researchSymbolFromBody(body)
            const intelligence = refreshIntelligence(symbol)
            return json({ ok: true, intelligence })
          }
          if (action === 'record_paper_decision') {
            // Authenticated research journal only. It derives a composite from
            // stored inputs and appends one immutable snapshot; it never creates
            // plans, orders, positions, executions, or exchange requests.
            const symbol = researchSymbolFromBody(body)
            const idempotencyKey =
              typeof body.idempotencyKey === 'string'
                ? body.idempotencyKey.trim()
                : ''
            if (!idempotencyKey || idempotencyKey.length > 128) {
              return json(
                {
                  ok: false,
                  error: 'A 1-128 character idempotencyKey is required.',
                },
                { status: 400 },
              )
            }
            const db = readFinanceStore()
            const composite = buildCompositeSentiment({
              symbol,
              items: db.news_items,
              sentimentScores: db.sentiment_scores,
              now: new Date(),
            })
            const journal = appendPaperDecisionSnapshot({
              symbol,
              composite,
              idempotencyKey,
            })
            return json({
              ok: true,
              paperDecisionJournal: { ...journal, researchOnly: true },
            })
          }
          if (action === 'fetch_candles') {
            // Read-only historical OHLCV from Binance public klines.
            const symbol = binanceSymbolFromBody(body)
            const requestedLimit =
              typeof body.limit === 'number' && Number.isFinite(body.limit)
                ? body.limit
                : 100
            const limit = Math.max(1, Math.min(Math.floor(requestedLimit), 500))
            const interval =
              typeof body.interval === 'string' && body.interval.trim()
                ? body.interval.trim()
                : '1h'
            const klines = await fetchBinanceKlines(symbol, interval, limit)
            addBinanceCandles(
              symbol,
              interval,
              klines,
              'binance',
              'binance-public-api',
            )
            return json(financePayload())
          }
          if (action === 'set_trading_mode') {
            const requestedMode =
              typeof body.mode === 'string' ? body.mode : 'observe_only'
            if (
              !(TRADING_MODES as ReadonlyArray<string>).includes(requestedMode)
            ) {
              return json(
                {
                  ok: false,
                  error: `Unsupported trading mode: ${requestedMode}`,
                },
                { status: 400 },
              )
            }
            if (
              requestedMode === 'observe_only' ||
              requestedMode === 'paper_trade' ||
              requestedMode === 'testnet_execute'
            ) {
              setNonLiveExecutionMode(requestedMode)
              return json(financePayload())
            }
            const db = readFinanceStore()
            if (
              isLiveMode(requestedMode) &&
              body.approval !== 'I_APPROVE_LIVE_TRADING' &&
              !db.settings.liveBinanceApprovedAt
            ) {
              appendAuditLog('trading_mode_change_blocked', {
                requestedMode,
                reason: 'missing explicit approval phrase',
              })
              return json(
                {
                  ok: false,
                  error:
                    'Explicit approval phrase required before enabling live trading.',
                },
                { status: 400 },
              )
            }
            db.settings.tradingMode =
              requestedMode as typeof db.settings.tradingMode
            db.settings.executionAccount =
              requestedMode === 'paper_trade'
                ? 'paper'
                : requestedMode === 'testnet_execute'
                  ? 'binance_testnet'
                  : isLiveMode(requestedMode)
                    ? 'binance_live'
                    : requestedMode === 'observe_only'
                      ? 'paper'
                      : db.settings.executionAccount
            db.settings.liveTradingEnabled = isLiveMode(requestedMode)
            // NOTE: the emergency kill switch is an INDEPENDENT master cutoff — a mode
            // change must never arm or disarm it. Use `set_kill_switch` for that. This
            // keeps "select a mode" and "disarm the safety cutoff" as two deliberate,
            // separately-audited human actions instead of one being a side effect of the other.
            writeFinanceStore(db)
            appendAuditLog('trading_mode_changed', {
              requestedMode,
              liveTradingEnabled: db.settings.liveTradingEnabled,
              executionAccount: db.settings.executionAccount,
            })
            return json(financePayload())
          }
          if (action === 'set_execution_account') {
            const account =
              typeof body.account === 'string' ? body.account : 'paper'
            if (account === 'paper' || account === 'binance_testnet') {
              setNonLiveExecutionMode(
                account === 'paper' ? 'paper_trade' : 'testnet_execute',
              )
              return json(financePayload())
            }
            const db = readFinanceStore()
            if (account === 'paper') {
              db.settings.executionAccount = 'paper'
              db.settings.tradingMode = 'paper_trade'
              db.settings.liveTradingEnabled = false
            } else if (account === 'binance_testnet') {
              db.settings.executionAccount = 'binance_testnet'
              db.settings.tradingMode = 'testnet_execute'
              db.settings.liveTradingEnabled = false
            } else if (account === 'binance_live') {
              if (
                body.approval !== 'I_APPROVE_LIVE_TRADING' &&
                !db.settings.liveBinanceApprovedAt
              ) {
                appendAuditLog('execution_account_change_blocked', {
                  account,
                  reason: 'missing live approval',
                })
                return json(
                  {
                    ok: false,
                    error:
                      'Live Binance account selection requires explicit approval.',
                  },
                  { status: 400 },
                )
              }
              db.settings.executionAccount = 'binance_live'
              db.settings.tradingMode = 'live_manual_approval'
              db.settings.liveTradingEnabled = true
            } else {
              return json(
                {
                  ok: false,
                  error: `Unsupported execution account: ${account}`,
                },
                { status: 400 },
              )
            }
            writeFinanceStore(db)
            appendAuditLog('execution_account_changed', {
              account: db.settings.executionAccount,
              tradingMode: db.settings.tradingMode,
            })
            return json(financePayload())
          }
          if (action === 'arm_live_binance') {
            if (body.approval !== 'I_APPROVE_BINANCE_LIVE_TRADING') {
              appendAuditLog('live_binance_arm_blocked', {
                reason: 'missing explicit approval phrase',
              })
              return json(
                {
                  ok: false,
                  error:
                    'Arming Binance live trading requires the explicit approval phrase.',
                },
                { status: 400 },
              )
            }
            const db = readFinanceStore()
            const approvedAt = new Date().toISOString()
            db.settings.primaryTradingProvider = 'binance'
            db.settings.executionAccount = 'binance_live'
            db.settings.tradingMode = 'live_manual_approval'
            db.settings.liveTradingEnabled = true
            db.settings.paperShadowEnabled = true
            db.settings.livePerOrderCapUsdt =
              typeof body.livePerOrderCapUsdt === 'number' &&
              Number.isFinite(body.livePerOrderCapUsdt)
                ? Math.max(1, Math.min(body.livePerOrderCapUsdt, 50))
                : db.settings.livePerOrderCapUsdt || 10
            db.settings.liveBinanceApprovedAt = approvedAt
            db.settings.liveBinanceApprovalId = `live_binance_${Date.now()}`
            writeFinanceStore(db)
            appendAuditLog('live_binance_armed', {
              approvedAt,
              livePerOrderCapUsdt: db.settings.livePerOrderCapUsdt,
              paperShadowEnabled: true,
            })
            return json(financePayload())
          }
          if (action === 'emergency_stop') {
            const db = readFinanceStore()
            db.settings.tradingMode = 'observe_only'
            db.settings.executionAccount = 'paper'
            db.settings.liveTradingEnabled = false
            db.settings.emergencyKillSwitch = true
            writeFinanceStore(db)
            appendAuditLog('emergency_stop', { source: 'finance_api' })
            return json(financePayload())
          }
          if (action === 'set_kill_switch') {
            // Independent master cutoff. `engaged: true` = cutoff ON (all trading halted, safe).
            // DISARMING (engaged=false) is the dangerous direction — it requires an explicit
            // confirmation phrase and is intended to be a deliberate human action from the UI.
            const engaged = body.engaged !== false // default to engaged (fail-safe)
            const db = readFinanceStore()
            if (
              !engaged &&
              body.approval !== 'I_UNDERSTAND_DISABLE_SAFETY_CUTOFF'
            ) {
              appendAuditLog('kill_switch_disarm_blocked', {
                reason: 'missing explicit confirmation phrase',
              })
              return json(
                {
                  ok: false,
                  error:
                    'Disarming the safety cutoff requires the explicit confirmation phrase.',
                },
                { status: 400 },
              )
            }
            db.settings.emergencyKillSwitch = engaged
            writeFinanceStore(db)
            appendAuditLog('kill_switch_set', {
              engaged,
              source: 'finance_api',
            })
            return json(financePayload())
          }
          if (action === 'assess_live_readiness') {
            const snapshot = assessAndPersistReadiness()
            return json({ ...financePayload(), liveReadinessResult: snapshot })
          }
          if (action === 'request_live_readiness_approval') {
            const result = requestLiveApproval()
            return json(
              { ...financePayload(), liveReadinessResult: result },
              { status: result.ok ? 200 : 400 },
            )
          }
          if (action === 'approve_live_readiness') {
            const phrase =
              typeof body.approval === 'string' ? body.approval : ''
            const result = approveLiveApproval(phrase)
            return json(
              { ...financePayload(), liveReadinessResult: result },
              { status: result.ok ? 200 : 400 },
            )
          }
          if (action === 'activate_live_readiness') {
            const phrase =
              typeof body.approval === 'string' ? body.approval : ''
            const result = activateLiveReadiness(phrase)
            return json(
              { ...financePayload(), liveReadinessResult: result },
              { status: result.ok ? 200 : 400 },
            )
          }
          if (action === 'deactivate_live_readiness') {
            const result = deactivateLiveReadiness(
              typeof body.reason === 'string'
                ? body.reason
                : 'manual deactivation',
            )
            return json({ ...financePayload(), liveReadinessResult: result })
          }
          if (action === 'reset_connectivity_breaker') {
            // Manual-only, same as the kill switch's general philosophy —
            // no auto-recovery, a human should verify the underlying
            // credential problem is actually fixed before trading resumes.
            resetConnectivityBreaker()
            appendAuditLog('connectivity_breaker_reset', {
              source: 'finance_api',
            })
            return json(financePayload())
          }
          if (action === 'set_alerts_config') {
            // Gates non-critical (info/warning) Telegram delivery in
            // alerts.ts. Off by default, ships disarmed like every other
            // new toggle this session — critical alerts (e.g. the
            // connectivity breaker tripping) always send regardless.
            const enabled = body.enabled === true
            const db = readFinanceStore()
            db.settings.alertsEnabled = enabled
            writeFinanceStore(db)
            appendAuditLog('alerts_config_updated', {
              enabled,
              source: 'finance_api',
            })
            return json(financePayload())
          }
          if (action === 'set_quiet_mode') {
            const enabled = body.enabled === true
            const db = readFinanceStore()
            db.settings.quietModeEnabled = enabled
            writeFinanceStore(db)
            appendAuditLog('quiet_mode_updated', {
              enabled,
              source: 'finance_api',
            })
            return json(financePayload())
          }
          if (action === 'add_salary_history') {
            const employerName =
              typeof body.employerName === 'string'
                ? body.employerName.trim()
                : ''
            const effectiveDate =
              typeof body.effectiveDate === 'string' ? body.effectiveDate : ''
            const amount =
              typeof body.amount === 'number'
                ? body.amount
                : Number(body.amount)
            const currency =
              typeof body.currency === 'string'
                ? body.currency.trim().toUpperCase()
                : ''
            if (!employerName || !/^\d{4}-\d{2}-\d{2}$/.test(effectiveDate)) {
              return json(
                {
                  ok: false,
                  error: 'Employer and a valid effective date are required.',
                },
                { status: 400 },
              )
            }
            if (
              !Number.isFinite(amount) ||
              amount <= 0 ||
              !SUPPORTED_CURRENCIES.includes(
                currency as (typeof SUPPORTED_CURRENCIES)[number],
              )
            ) {
              return json(
                {
                  ok: false,
                  error:
                    'Amount must be positive and currency must be supported.',
                },
                { status: 400 },
              )
            }
            const db = readFinanceStore()
            const now = new Date().toISOString()
            const settings = db.settings
            const history = Array.isArray(settings.salaryHistory)
              ? [...settings.salaryHistory]
              : []
            history.push({
              id: randomUUID(),
              incomeSourceId:
                typeof body.incomeSourceId === 'string'
                  ? body.incomeSourceId
                  : undefined,
              employerName,
              effectiveDate,
              amount,
              currency: currency as (typeof SUPPORTED_CURRENCIES)[number],
              reason:
                typeof body.reason === 'string' && body.reason.trim()
                  ? body.reason.trim().slice(0, 240)
                  : undefined,
              source: 'manual',
              createdAt: now,
              updatedAt: now,
            })
            settings.salaryHistory = history
              .sort((a, b) => b.effectiveDate.localeCompare(a.effectiveDate))
              .slice(0, 100)
            writeFinanceStore(db)
            appendAuditLog('salary_history_added', {
              employerName,
              effectiveDate,
              currency,
              source: 'finance_api',
            })
            return json(personalFinancePayload())
          }
          if (action === 'set_emergency_fund_target') {
            // PF-303: user-set target, in months of average expenses. Clamped
            // to a sane range; 0 clears the target back to "not configured".
            const rawMonths = typeof body.months === 'number' ? body.months : 0
            const months = Math.max(0, Math.min(24, Math.round(rawMonths)))
            const db = readFinanceStore()
            db.settings.emergencyFundTargetMonths = months
            writeFinanceStore(db)
            appendAuditLog('emergency_fund_target_updated', { months })
            return json(personalFinancePayload())
          }
          if (action === 'set_savings_rate_target') {
            // PF-304: user-set target, as a percentage. Clamped to 0..100; 0
            // clears the target back to "not configured".
            const rawPct = typeof body.pct === 'number' ? body.pct : 0
            const pct = Math.max(0, Math.min(100, Math.round(rawPct)))
            const db = readFinanceStore()
            db.settings.savingsRateTargetPct = pct
            writeFinanceStore(db)
            appendAuditLog('savings_rate_target_updated', { pct })
            return json(personalFinancePayload())
          }
          if (action === 'set_budget_alert_threshold') {
            const rawPct = typeof body.pct === 'number' ? body.pct : 80
            const pct = Math.max(50, Math.min(100, Math.round(rawPct)))
            const db = readFinanceStore()
            db.settings.budgetAlertThresholdPct = pct
            writeFinanceStore(db)
            appendAuditLog('budget_alert_threshold_updated', { pct })
            return json(personalFinancePayload())
          }
          if (action === 'save_budget_template') {
            const payload =
              body.template &&
              typeof body.template === 'object' &&
              !Array.isArray(body.template)
                ? (body.template as JsonRecord)
                : {}
            try {
              const db = readFinanceStore()
              const template = saveBudgetTemplate(db, payload)
              writeFinanceStore(db)
              appendAuditLog('budget_template_saved', {
                templateId: template.id,
                name: template.name,
              })
              return json({
                ...personalFinancePayload(),
                budgetTemplateResult: { action: 'saved', template },
              })
            } catch (error) {
              return json(
                { ok: false, error: safeErrorMessage(error) },
                { status: 400 },
              )
            }
          }
          if (action === 'delete_budget_template') {
            const id = typeof body.id === 'string' ? body.id.trim() : ''
            if (!id)
              return json(
                { ok: false, error: 'Template id is required.' },
                { status: 400 },
              )
            const db = readFinanceStore()
            const deleted = deleteBudgetTemplate(db, id)
            if (!deleted)
              return json(
                { ok: false, error: 'Budget template was not found.' },
                { status: 404 },
              )
            writeFinanceStore(db)
            appendAuditLog('budget_template_deleted', { templateId: id })
            return json({
              ...personalFinancePayload(),
              budgetTemplateResult: { action: 'deleted', templateId: id },
            })
          }
          if (action === 'apply_budget_template') {
            const templateId =
              typeof body.templateId === 'string' ? body.templateId.trim() : ''
            const month = typeof body.month === 'string' ? body.month : ''
            if (!templateId || !month)
              return json(
                {
                  ok: false,
                  error: 'Template id and target month are required.',
                },
                { status: 400 },
              )
            try {
              const db = readFinanceStore()
              const result = applyBudgetTemplate(db, templateId, month)
              writeFinanceStore(db)
              appendAuditLog('budget_template_applied', {
                templateId,
                month,
                appliedCount: result.appliedCount,
                skippedCount: result.skippedCount,
              })
              return json({
                ...personalFinancePayload(),
                budgetTemplateResult: { action: 'applied', ...result },
              })
            } catch (error) {
              return json(
                { ok: false, error: safeErrorMessage(error) },
                { status: 400 },
              )
            }
          }
          if (action === 'set_financial_rules') {
            const validation = validateFinancialRules(body.rules)
            if (!validation.ok) {
              return json(
                { ok: false, error: validation.errors.join(' ') },
                { status: 400 },
              )
            }
            const db = readFinanceStore()
            db.settings.financialRules = validation.rules
            writeFinanceStore(db)
            appendAuditLog('financial_rules_updated', {
              rules: validation.rules,
              source: 'finance_api',
            })
            return json(personalFinancePayload())
          }
          if (action === 'set_base_currency') {
            const baseCurrency =
              typeof body.baseCurrency === 'string'
                ? body.baseCurrency.trim().toUpperCase()
                : ''
            if (
              !SUPPORTED_CURRENCIES.includes(
                baseCurrency as (typeof SUPPORTED_CURRENCIES)[number],
              )
            ) {
              return json(
                {
                  ok: false,
                  error: `Base currency must be one of ${SUPPORTED_CURRENCIES.join(', ')}.`,
                },
                { status: 400 },
              )
            }
            const db = readFinanceStore()
            db.settings.baseCurrency = baseCurrency
            writeFinanceStore(db)
            appendAuditLog('base_currency_updated', { baseCurrency })
            return json(personalFinancePayload())
          }
          if (action === 'set_proactive_insights') {
            const enabled = body.enabled === true
            const db = readFinanceStore()
            db.settings.proactiveInsightsEnabled = enabled
            writeFinanceStore(db)
            appendAuditLog('proactive_insights_policy_updated', {
              enabled,
              source: 'finance_api',
            })
            return json(personalFinancePayload())
          }
          if (action === 'queue_proactive_finance_review') {
            const schedulerAck = body.responseMode === 'scheduler_ack'
            const db = readFinanceStore()
            if (db.settings.proactiveInsightsEnabled !== true) {
              return json(
                { ok: false, error: 'Proactive finance reviews are disabled.' },
                { status: 403 },
              )
            }
            const today = new Date().toISOString().slice(0, 10)
            const summary = financeSummary(db)
            const storage = financeStorageStatus()
            const duplicate = db.ai_tasks.some(
              (task) =>
                task.taskType === 'proactive_finance_review' &&
                typeof task.createdAt === 'string' &&
                task.createdAt.startsWith(today) &&
                task.status !== 'cancelled',
            )
            if (duplicate) {
              return json(
                {
                  ok: false,
                  error: 'A proactive finance review is already queued today.',
                },
                { status: 409 },
              )
            }
            addFinanceRecord('ai_task', {
              taskType: 'proactive_finance_review',
              title: 'Review current finance insights',
              status: 'awaiting_approval',
              risk: 'low',
              requestedAction: 'review_finance_insights',
              inputSummary: JSON.stringify({
                asOf: today,
                netWorthLkr: summary.netWorthLkr,
                cashBalanceLkr: summary.cashBalanceLkr,
                netSavingsLkr: summary.netSavingsLkr,
                alertCount: financeStorageAlerts(storage.health).length,
              }),
              resultSummary:
                'Review-only task. No financial record or trade will be changed automatically.',
              approvalRequired: true,
              source: 'proactive_finance_review',
              agentName: 'finance-agent',
            })
            appendAuditLog('proactive_finance_review_queued', {
              asOf: today,
              source: 'finance_api',
            })
            return schedulerAck
              ? json({
                  ok: true,
                  queued: true,
                  taskType: 'proactive_finance_review',
                  status: 'awaiting_approval',
                  asOf: today,
                })
              : json(personalFinancePayload())
          }
          if (action === 'set_exchange_rate') {
            const base =
              typeof body.base === 'string'
                ? body.base.trim().toUpperCase()
                : ''
            const target =
              typeof body.target === 'string'
                ? body.target.trim().toUpperCase()
                : ''
            const rate =
              typeof body.rate === 'number' ? body.rate : Number(body.rate)
            const date = typeof body.date === 'string' ? body.date : undefined
            if (
              !base ||
              !target ||
              base === target ||
              !Number.isFinite(rate) ||
              rate <= 0
            ) {
              return json(
                {
                  ok: false,
                  error:
                    'Base, target, and a positive exchange rate are required.',
                },
                { status: 400 },
              )
            }
            if (date !== undefined && !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
              return json(
                { ok: false, error: 'Exchange-rate date must be YYYY-MM-DD.' },
                { status: 400 },
              )
            }
            updateExchangeRate(base, target, rate, date)
            return json(personalFinancePayload())
          }
          if (action === 'refresh_exchange_rate') {
            const base =
              typeof body.base === 'string'
                ? body.base.trim().toUpperCase()
                : ''
            const target =
              typeof body.target === 'string'
                ? body.target.trim().toUpperCase()
                : ''
            if (!base || !target || base === target) {
              return json(
                {
                  ok: false,
                  error: 'Choose different base and target currencies.',
                },
                { status: 400 },
              )
            }
            try {
              const quote = await fetchFrankfurterRate(base, target)
              updateExchangeRate(
                quote.base,
                quote.target,
                quote.rate,
                quote.date,
                quote.source,
                quote.observedAt,
              )
              return json({
                ...personalFinancePayload(),
                exchangeRateRefresh: quote,
              })
            } catch (error) {
              return json(
                { ok: false, error: safeErrorMessage(error) },
                { status: 502 },
              )
            }
          }
          if (action === 'set_minimum_cash_reserve') {
            const rawReserve =
              typeof body.amountLkr === 'number'
                ? body.amountLkr
                : Number(body.amountLkr)
            if (!Number.isFinite(rawReserve) || rawReserve < 0) {
              return json(
                {
                  ok: false,
                  error: 'Cash reserve must be a non-negative LKR amount.',
                },
                { status: 400 },
              )
            }
            const db = readFinanceStore()
            db.settings.minimumCashReserveLkr = Math.round(rawReserve)
            writeFinanceStore(db)
            appendAuditLog('minimum_cash_reserve_updated', {
              amountLkr: db.settings.minimumCashReserveLkr,
            })
            return json(personalFinancePayload())
          }
          if (action === 'set_wealth_goal') {
            // WEALTH-107: user-set long-term net worth target, with an
            // optional target date. 0 clears the target back to "not
            // configured"; an empty/missing targetDate clears the date only.
            const rawTargetLkr =
              typeof body.targetLkr === 'number' ? body.targetLkr : 0
            const targetLkr = Math.max(0, Math.round(rawTargetLkr))
            const targetDate =
              typeof body.targetDate === 'string' && body.targetDate
                ? body.targetDate
                : undefined
            const db = readFinanceStore()
            db.settings.wealthGoalTargetLkr = targetLkr
            db.settings.wealthGoalTargetDate = targetDate
            writeFinanceStore(db)
            appendAuditLog('wealth_goal_updated', { targetLkr, targetDate })
            return json(personalFinancePayload())
          }
          if (action === 'capture_net_worth_snapshot') {
            const snapshotDate =
              typeof body.snapshotDate === 'string' && body.snapshotDate
                ? body.snapshotDate
                : new Date().toISOString().slice(0, 10)
            const db = readFinanceStore()
            const snapshotSource =
              body.source === 'scheduled' ? 'scheduled' : 'manual'
            const snapshot = captureNetWorthSnapshot(
              db,
              snapshotDate,
              snapshotSource,
            )
            writeFinanceStore(db)
            appendAuditLog('net_worth_snapshot_captured', {
              id: snapshot.id,
              snapshotDate: snapshot.snapshotDate,
              source: snapshot.source,
            })
            return json(personalFinancePayload())
          }
          if (action === 'ask_finance_question') {
            // Phase 24 (AI-200/201): same-origin, authenticated-user-only —
            // already gated by isAuthenticated() above. No autonomous/
            // external agent access, so AI-102/103/111 (agent read
            // permissions/action contract/sensitive data classification)
            // don't apply here; deferred for any future agent variant.
            const question =
              typeof body.question === 'string' ? body.question.trim() : ''
            if (!question)
              return json(
                { ok: false, error: 'question is required.' },
                { status: 400 },
              )
            // AI-204: client sends its in-session conversation turns; never
            // trust its length, so re-validate shape and cap to the last 3
            // here regardless of what was sent.
            const rawPriorTurns = Array.isArray(body.priorTurns)
              ? body.priorTurns
              : []
            const priorTurns = rawPriorTurns
              .filter(
                (turn): turn is { question: string; answer: string } =>
                  !!turn &&
                  typeof turn === 'object' &&
                  typeof (turn as Record<string, unknown>).question ===
                    'string' &&
                  typeof (turn as Record<string, unknown>).answer === 'string',
              )
              .slice(-3)
            const db = readFinanceStore()
            const userMemories = await getUserFinanceMemoriesForPrompt(question)
            const context = {
              ...(buildFinanceQueryContext(db) as Record<string, unknown>),
              assistantMemories: userMemories,
            }
            const result = await answerFinanceQuestion(
              question,
              context,
              priorTurns,
            )
            if (!result.ok)
              return json({ ok: false, error: result.reason }, { status: 502 })
            // AI-202: capped recent-activity list, same bounded-log
            // convention as AI-506's gmailIngest.syncHistory.
            const priorHistory = db.settings.financeQaHistory ?? []
            db.settings.financeQaHistory = [
              ...priorHistory,
              {
                at: Math.floor(Date.now() / 1000),
                question,
                answer: result.answer,
              },
            ].slice(-10)
            writeFinanceStore(db)
            const learned = detectDurableFinancePreference(question)
            if (learned) void proposeFinancialRule(learned)
            return json({
              ...personalFinancePayload(),
              answer: result.answer,
              chart: result.chart,
            })
          }
          if (action === 'list_finance_memories') {
            const [memories, pending] = await Promise.all([
              listActiveFinanceMemories(),
              listPendingFinanceCandidates(),
            ])
            return json({
              ok: true,
              harpEnabled: isHarpMemoryEnabled(),
              memories,
              pending,
            })
          }
          if (
            action === 'approve_finance_memory' ||
            action === 'reject_finance_memory'
          ) {
            const memoryId =
              typeof body.memoryId === 'string' ? body.memoryId.trim() : ''
            if (!memoryId)
              return json(
                { ok: false, error: 'memoryId is required.' },
                { status: 400 },
              )
            const result =
              action === 'approve_finance_memory'
                ? await approveMemory(memoryId)
                : await rejectMemory(memoryId)
            return json(result)
          }
          if (action === 'add_financial_rule') {
            const rule = typeof body.rule === 'string' ? body.rule.trim() : ''
            if (!rule)
              return json(
                { ok: false, error: 'rule is required.' },
                { status: 400 },
              )
            const { submitted } = await proposeFinancialRule(rule)
            return json({ ok: true, submitted })
          }
          if (action === 'set_category_rule') {
            const vendor =
              typeof body.vendor === 'string' ? body.vendor.trim() : ''
            const category =
              typeof body.category === 'string' ? body.category.trim() : ''
            const replacesId =
              typeof body.replacesId === 'string' ? body.replacesId.trim() : ''
            if (!vendor || !category)
              return json(
                { ok: false, error: 'vendor and category are required.' },
                { status: 400 },
              )
            await proposeCategoryPreference({ vendor, category })
            if (replacesId) await flagFinanceMemory(replacesId)
            return json({ ok: true, submitted: true })
          }
          if (action === 'flag_finance_memory') {
            const memoryId =
              typeof body.memoryId === 'string' ? body.memoryId.trim() : ''
            if (!memoryId)
              return json(
                { ok: false, error: 'memoryId is required.' },
                { status: 400 },
              )
            await flagFinanceMemory(memoryId)
            return json({ ok: true })
          }
          if (action === 'build_finance_context') {
            const db = readFinanceStore()
            const context = buildFinanceAgentContext(db)
            appendAuditLog('finance_agent_context_read', {
              contextVersion: context.contextVersion,
              sensitivity: context.sensitivity,
              source: 'finance_agent_context_builder',
            })
            return json({ ok: true, financeAgentContext: context })
          }
          if (action === 'get_finance_agent_profile') {
            return json({
              ok: true,
              financeAgentProfile: getFinanceManagerAgentProfile(),
            })
          }
          if (action === 'list_ai_tasks') {
            const status =
              typeof body.status === 'string' ? body.status : undefined
            const risk = typeof body.risk === 'string' ? body.risk : undefined
            const agentName =
              typeof body.agentName === 'string'
                ? body.agentName.trim()
                : undefined
            const from = typeof body.from === 'string' ? body.from : undefined
            const to = typeof body.to === 'string' ? body.to : undefined
            const terminalOnly = body.terminalOnly === true
            const limit =
              typeof body.limit === 'number' && Number.isFinite(body.limit)
                ? body.limit
                : undefined
            const offset =
              typeof body.offset === 'number' && Number.isFinite(body.offset)
                ? body.offset
                : undefined
            return json({
              ok: true,
              aiTaskPage: listFinanceAiTasks({
                status: status as NonNullable<
                  Parameters<typeof listFinanceAiTasks>[0]
                >['status'],
                risk: risk as NonNullable<
                  Parameters<typeof listFinanceAiTasks>[0]
                >['risk'],
                agentName,
                from,
                to,
                terminalOnly,
                limit,
                offset,
              }),
            })
          }
          if (action === 'export_ai_task_review') {
            const csv = buildAiTaskReviewCsv(readFinanceStore())
            return new Response(csv, {
              headers: {
                'Content-Type': 'text/csv; charset=utf-8',
                'Content-Disposition': `attachment; filename="finance-ai-task-review-${new Date().toISOString().slice(0, 10)}.csv"`,
                'Cache-Control': 'no-store',
              },
            })
          }
          if (action === 'finance_audit_status') {
            return json({ ok: true, financeAudit: verifyFinanceAuditChain() })
          }
          if (action === 'list_finance_audit_archives') {
            const config = defaultEncryptedBackupConfig()
            return json({
              ok: true,
              financeAuditArchives: listEncryptedFinanceAuditArchives(
                config.auditArchiveDir,
              ),
            })
          }
          if (action === 'verify_finance_audit_archive') {
            const name = typeof body.name === 'string' ? body.name : ''
            if (!name) {
              return json(
                { ok: false, error: 'Archive name is required.' },
                { status: 400 },
              )
            }
            const config = defaultEncryptedBackupConfig()
            const verification = verifyEncryptedFinanceAuditArchive({
              archiveDir: config.auditArchiveDir,
              passphraseFile: config.passphraseFile,
              name,
            })
            return json(
              { ok: verification.valid, financeAuditArchive: verification },
              { status: verification.valid ? 200 : 422 },
            )
          }
          if (action === 'preview_finance_audit_prune') {
            const retentionDays =
              typeof body.retentionDays === 'number' &&
              Number.isFinite(body.retentionDays)
                ? body.retentionDays
                : undefined
            return json({
              ok: true,
              financeAuditPrune: previewFinanceAuditPrune(retentionDays),
            })
          }
          if (action === 'archive_and_prune_finance_audit') {
            if (body.confirm !== true) {
              return json(
                {
                  ok: false,
                  error:
                    'Explicit confirmation is required before pruning audit history.',
                },
                { status: 400 },
              )
            }
            const retentionDays =
              typeof body.retentionDays === 'number' &&
              Number.isFinite(body.retentionDays)
                ? body.retentionDays
                : undefined
            const preview = previewFinanceAuditPrune(retentionDays)
            if (preview.eligibleEntries === 0) {
              return json({
                ok: true,
                financeAuditPrune: {
                  ...preview,
                  archiveCreated: false,
                  prunedEntries: 0,
                },
                financeAudit: verifyFinanceAuditChain(),
              })
            }
            const config = defaultEncryptedBackupConfig()
            appendAuditLog('finance_audit_archive_requested', {
              retentionDays: preview.retentionDays,
              eligibleEntries: preview.eligibleEntries,
            })
            writeEncryptedFinanceAuditArchive({
              archiveDir: config.auditArchiveDir,
              passphraseFile: config.passphraseFile,
              auditLog: readFinanceAuditLog(),
              metadata: {
                retentionDays: preview.retentionDays,
                cutoff: preview.cutoff,
                eligibleEntries: preview.eligibleEntries,
              },
            })
            const result = pruneFinanceAudit(preview, true)
            appendAuditLog('finance_audit_pruned', result)
            return json({
              ok: true,
              financeAuditPrune: {
                ...preview,
                ...result,
                archiveCreated: true,
              },
              financeAudit: verifyFinanceAuditChain(),
            })
          }
          if (action === 'set_demo_config' || action === 'set_engine_config') {
            // Update the demo engine's tunable knobs (settings.demoTrading), merged
            // over defaults by resolveEngineConfig. Values are range-validated; anything
            // out of range is ignored rather than applied.
            const cfg =
              body.config && typeof body.config === 'object'
                ? (body.config as JsonRecord)
                : {}
            const inRange = (
              value: unknown,
              min: number,
              max: number,
            ): number | undefined =>
              typeof value === 'number' &&
              Number.isFinite(value) &&
              value >= min &&
              value <= max
                ? value
                : undefined
            const db = readFinanceStore()
            const settings = db.settings as Record<string, unknown>
            const dt = (
              settings.demoTrading && typeof settings.demoTrading === 'object'
                ? { ...(settings.demoTrading as Record<string, unknown>) }
                : {}
            ) as Record<string, unknown>

            const tp = inRange(cfg.takeProfitPct, 0.0005, 0.5)
            const sl = inRange(cfg.stopLossPct, 0.0005, 0.5)
            const qpt = inRange(cfg.quotePerTrade, 1, 100000)
            const maxOpen = inRange(cfg.maxOpenPositions, 1, 50)
            // 0 = off for all three; upper bounds mirror what the offline
            // backtest harness actually validated (regime up to SMA300,
            // max hold up to 7 days).
            const regimeSma = inRange(cfg.regimeSmaPeriod, 0, 300)
            const trailingStop = inRange(cfg.trailingStopPct, 0, 0.5)
            const maxHold = inRange(cfg.maxHoldMinutes, 0, 10080)
            // Regime-conditional strategy switching (off by default) — see
            // EngineConfig.regimeSwitchingEnabled's doc comment in
            // demo-trading-engine.ts.
            const regimeSwitchingVolPeriod = inRange(
              cfg.regimeSwitchingVolPeriod,
              2,
              300,
            )
            const regimeSwitchingBaselineLookback = inRange(
              cfg.regimeSwitchingBaselineLookback,
              0,
              1000,
            )
            if (typeof cfg.regimeSwitchingEnabled === 'boolean')
              dt.regimeSwitchingEnabled = cfg.regimeSwitchingEnabled
            if (regimeSwitchingVolPeriod !== undefined)
              dt.regimeSwitchingVolPeriod = Math.floor(regimeSwitchingVolPeriod)
            if (regimeSwitchingBaselineLookback !== undefined)
              dt.regimeSwitchingBaselineLookback = Math.floor(
                regimeSwitchingBaselineLookback,
              )
            if (tp !== undefined) dt.takeProfitPct = tp
            if (sl !== undefined) dt.stopLossPct = sl
            if (qpt !== undefined) dt.quotePerTrade = qpt
            if (regimeSma !== undefined)
              dt.regimeSmaPeriod = Math.floor(regimeSma)
            if (trailingStop !== undefined) dt.trailingStopPct = trailingStop
            if (maxHold !== undefined) dt.maxHoldMinutes = Math.floor(maxHold)
            if (Array.isArray(cfg.symbols)) {
              const syms = cfg.symbols
                .filter((s): s is string => typeof s === 'string')
                .map((s) => s.trim().toUpperCase())
                .filter((s) => /^[A-Z0-9]{5,20}$/.test(s))
              if (syms.length > 0) dt.symbols = Array.from(new Set(syms))
            }
            // enabledStrategies: explicit allow-list against STRATEGIES ids only.
            // Left unset, resolveEngineConfig() defaults to *every* id in
            // STRATEGIES — meaning a newly added strategy silently joins live
            // council voting on the next deploy. Setting this here locks the
            // roster until someone deliberately opts a new strategy in.
            if (Array.isArray(cfg.enabledStrategies)) {
              const validIds = new Set(STRATEGIES.map((s) => s.id))
              const ids = cfg.enabledStrategies.filter(
                (s): s is string => typeof s === 'string' && validIds.has(s),
              )
              if (ids.length > 0)
                dt.enabledStrategies = Array.from(new Set(ids))
            }
            // Signal features built 2026-07-10/11: each is its own independent,
            // off-by-default lever (see docs/trading-engine.md for the backtest
            // evidence behind each one before arming).
            const atrBaseline = inRange(cfg.atrSizeBaselinePct, 0, 0.1)
            const atrMin = inRange(cfg.atrSizeMinMultiplier, 0.1, 1)
            const atrMax = inRange(cfg.atrSizeMaxMultiplier, 1, 3)
            const kellyMinTrades = inRange(
              cfg.kellySizingMinClosedTrades,
              5,
              200,
            )
            const kellyMaxFraction = inRange(cfg.kellySizingMaxFraction, 0, 1)
            const vetoMinSamples = inRange(cfg.patternVetoMinSamples, 5, 200)
            const vetoLossThreshold = inRange(
              cfg.patternVetoLossRateThreshold,
              0,
              1,
            )
            const adxPeriod = inRange(cfg.adxPeriod, 2, 100)
            const adxThreshold = inRange(cfg.adxThreshold, 0, 100)
            const fibLookback = inRange(cfg.fibSwingLookback, 5, 200)
            const fibRatio = inRange(cfg.fibExtensionRatio, 1, 3)
            if (atrBaseline !== undefined) dt.atrSizeBaselinePct = atrBaseline
            if (atrMin !== undefined) dt.atrSizeMinMultiplier = atrMin
            if (atrMax !== undefined) dt.atrSizeMaxMultiplier = atrMax
            if (typeof cfg.kellySizingEnabled === 'boolean')
              dt.kellySizingEnabled = cfg.kellySizingEnabled
            if (kellyMinTrades !== undefined)
              dt.kellySizingMinClosedTrades = Math.floor(kellyMinTrades)
            if (kellyMaxFraction !== undefined)
              dt.kellySizingMaxFraction = kellyMaxFraction
            if (typeof cfg.patternVetoEnabled === 'boolean')
              dt.patternVetoEnabled = cfg.patternVetoEnabled
            if (vetoMinSamples !== undefined)
              dt.patternVetoMinSamples = Math.floor(vetoMinSamples)
            if (vetoLossThreshold !== undefined)
              dt.patternVetoLossRateThreshold = vetoLossThreshold
            if (adxPeriod !== undefined) dt.adxPeriod = Math.floor(adxPeriod)
            if (adxThreshold !== undefined) dt.adxThreshold = adxThreshold
            if (typeof cfg.fibTakeProfitEnabled === 'boolean')
              dt.fibTakeProfitEnabled = cfg.fibTakeProfitEnabled
            if (fibLookback !== undefined)
              dt.fibSwingLookback = Math.floor(fibLookback)
            if (fibRatio !== undefined) dt.fibExtensionRatio = fibRatio
            if (typeof cfg.longShortSentimentEnabled === 'boolean')
              dt.longShortSentimentEnabled = cfg.longShortSentimentEnabled
            if (
              typeof cfg.longShortSentimentPeriod === 'string' &&
              VALID_LONG_SHORT_PERIODS.has(cfg.longShortSentimentPeriod)
            )
              dt.longShortSentimentPeriod = cfg.longShortSentimentPeriod
            // "Patient hold" (sandbox/testnet only) — see EngineConfig.noLossExitMode's
            // doc comment in demo-trading-engine.ts. Defaults to true; this just
            // lets it be toggled off from Signal Settings if desired.
            if (typeof cfg.noLossExitMode === 'boolean')
              dt.noLossExitMode = cfg.noLossExitMode
            if (typeof cfg.strategyGuardEnabled === 'boolean')
              dt.strategyGuardEnabled = cfg.strategyGuardEnabled
            const strategyGuardMinTrades = inRange(
              cfg.strategyGuardMinClosedTrades,
              3,
              200,
            )
            const strategyGuardLossRate = inRange(
              cfg.strategyGuardLossRateThreshold,
              0,
              1,
            )
            const strategyGuardMaxPnl = inRange(
              cfg.strategyGuardMaxPnlQuote,
              -100000,
              0,
            )
            if (strategyGuardMinTrades !== undefined)
              dt.strategyGuardMinClosedTrades = Math.floor(
                strategyGuardMinTrades,
              )
            if (strategyGuardLossRate !== undefined)
              dt.strategyGuardLossRateThreshold = strategyGuardLossRate
            if (strategyGuardMaxPnl !== undefined)
              dt.strategyGuardMaxPnlQuote = strategyGuardMaxPnl
            if (
              cfg.strategyGuardAction === 'reduce_size' ||
              cfg.strategyGuardAction === 'disabled'
            )
              dt.strategyGuardAction = cfg.strategyGuardAction
            const maxBucketExposure = inRange(
              cfg.guardianMaxBucketExposureQuote,
              0,
              100000,
            )
            const guardianCorrelationBuckets =
              cfg.guardianCorrelationBuckets &&
              typeof cfg.guardianCorrelationBuckets === 'object' &&
              !Array.isArray(cfg.guardianCorrelationBuckets)
                ? Object.entries(
                    cfg.guardianCorrelationBuckets as JsonRecord,
                  ).reduce<Record<string, Array<string>>>(
                    (acc, [bucket, symbols]) => {
                      if (!Array.isArray(symbols)) return acc
                      const syms = symbols
                        .filter((s): s is string => typeof s === 'string')
                        .map((s) => s.trim().toUpperCase())
                        .filter((s) => /^[A-Z0-9]{5,20}$/.test(s))
                      if (syms.length > 0) acc[bucket] = syms
                      return acc
                    },
                    {},
                  )
                : undefined
            if (
              maxOpen !== undefined ||
              typeof cfg.guardianCorrelationBucketsEnabled === 'boolean' ||
              guardianCorrelationBuckets !== undefined ||
              maxBucketExposure !== undefined
            ) {
              const guardian = (
                dt.guardian && typeof dt.guardian === 'object'
                  ? { ...(dt.guardian as Record<string, unknown>) }
                  : {}
              ) as Record<string, unknown>
              if (maxOpen !== undefined)
                guardian.maxOpenPositions = Math.floor(maxOpen)
              if (typeof cfg.guardianCorrelationBucketsEnabled === 'boolean')
                guardian.correlationBucketsEnabled =
                  cfg.guardianCorrelationBucketsEnabled
              if (guardianCorrelationBuckets !== undefined)
                guardian.correlationBuckets = guardianCorrelationBuckets
              if (maxBucketExposure !== undefined)
                guardian.maxBucketExposureQuote = maxBucketExposure
              dt.guardian = guardian
            }
            // learningPolicy.autoApplyModes: only 'paper_trade' and
            // 'testnet_execute' are ever accepted here — the learning-loop's
            // candidate generation is structurally risk-reducing-only
            // (quotePerTrade patches are Math.min-clamped, strategyOverrides
            // can only be 'disabled'/'reduce_size'), so widening which modes
            // may auto-apply doesn't widen what it's allowed to do.
            if (
              cfg.learningPolicy &&
              typeof cfg.learningPolicy === 'object' &&
              !Array.isArray(cfg.learningPolicy)
            ) {
              const lp = cfg.learningPolicy as JsonRecord
              if (Array.isArray(lp.autoApplyModes)) {
                const modes = lp.autoApplyModes.filter(
                  (m): m is 'paper_trade' | 'testnet_execute' =>
                    m === 'paper_trade' || m === 'testnet_execute',
                )
                if (modes.length > 0) {
                  const existingPolicy = (
                    dt.learningPolicy && typeof dt.learningPolicy === 'object'
                      ? { ...(dt.learningPolicy as Record<string, unknown>) }
                      : {}
                  ) as Record<string, unknown>
                  existingPolicy.autoApplyModes = Array.from(new Set(modes))
                  dt.learningPolicy = existingPolicy
                }
              }
            }
            settings.demoTrading = dt
            // autoRefinement.enabled: a top-level settings key (not nested
            // under demoTrading, since it spans the grid/rebalance/llm
            // engines too, not just the council) — gates whether
            // src/server/auto-refinement.ts's candidates get applied live or
            // only recorded as proposals. Off by default; every candidate it
            // can generate is risk/cost-reducing-only by construction.
            if (typeof cfg.autoRefinementEnabled === 'boolean') {
              const existingRefinement = (
                settings.autoRefinement &&
                typeof settings.autoRefinement === 'object'
                  ? { ...(settings.autoRefinement as Record<string, unknown>) }
                  : {}
              ) as Record<string, unknown>
              existingRefinement.enabled = cfg.autoRefinementEnabled
              settings.autoRefinement = existingRefinement
            }
            writeFinanceStore(db)
            appendAuditLog('engine_config_updated', {
              takeProfitPct: dt.takeProfitPct,
              stopLossPct: dt.stopLossPct,
              quotePerTrade: dt.quotePerTrade,
              symbols: dt.symbols,
              enabledStrategies: dt.enabledStrategies,
              atrSizeBaselinePct: dt.atrSizeBaselinePct,
              kellySizingEnabled: dt.kellySizingEnabled,
              patternVetoEnabled: dt.patternVetoEnabled,
              adxThreshold: dt.adxThreshold,
              fibTakeProfitEnabled: dt.fibTakeProfitEnabled,
              longShortSentimentEnabled: dt.longShortSentimentEnabled,
              maxOpenPositions: (
                dt.guardian as Record<string, unknown> | undefined
              )?.maxOpenPositions,
              correlationBucketsEnabled: (
                dt.guardian as Record<string, unknown> | undefined
              )?.correlationBucketsEnabled,
              maxBucketExposureQuote: (
                dt.guardian as Record<string, unknown> | undefined
              )?.maxBucketExposureQuote,
              regimeSmaPeriod: dt.regimeSmaPeriod,
              regimeSwitchingEnabled: dt.regimeSwitchingEnabled,
              regimeSwitchingVolPeriod: dt.regimeSwitchingVolPeriod,
              regimeSwitchingBaselineLookback:
                dt.regimeSwitchingBaselineLookback,
              trailingStopPct: dt.trailingStopPct,
              maxHoldMinutes: dt.maxHoldMinutes,
              strategyGuardEnabled: dt.strategyGuardEnabled,
              strategyGuardMinClosedTrades: dt.strategyGuardMinClosedTrades,
              strategyGuardLossRateThreshold: dt.strategyGuardLossRateThreshold,
              strategyGuardMaxPnlQuote: dt.strategyGuardMaxPnlQuote,
              strategyGuardAction: dt.strategyGuardAction,
              learningPolicyAutoApplyModes: (
                dt.learningPolicy as Record<string, unknown> | undefined
              )?.autoApplyModes,
              autoRefinementEnabled: (
                settings.autoRefinement as Record<string, unknown> | undefined
              )?.enabled,
            })
            return json(financePayload())
          }
          if (action === 'record_account_baseline') {
            // Snapshots the current sandbox/testnet equity as the new
            // "starting balance" baseline for the Trading Account Overview
            // card — meant to be called right after the user resets the
            // Binance testnet account, so historical totals stay meaningful
            // across resets. Value is supplied by the client (it already
            // computed current equity from /api/demo-trading's monitor +
            // /api/trading/summary), we just persist it with a timestamp.
            const equityQuote =
              typeof body.equityQuote === 'number' &&
              Number.isFinite(body.equityQuote)
                ? body.equityQuote
                : undefined
            if (equityQuote === undefined) {
              return json(
                { ok: false, error: 'equityQuote (number) is required' },
                { status: 400 },
              )
            }
            const db = readFinanceStore()
            const settings = db.settings as Record<string, unknown>
            settings.accountBaseline = {
              equityQuote,
              recordedAt: new Date().toISOString(),
            }
            writeFinanceStore(db)
            appendAuditLog('account_baseline_recorded', { equityQuote })
            return json({ ok: true, baseline: settings.accountBaseline })
          }
          if (action === 'set_grid_config') {
            // Tunable knobs for the independent paper-only grid engine
            // (settings.demoTradingGrid, resolved by resolveGridEngineConfig
            // in grid-paper-engine.ts). Wholly separate from the council's
            // settings.demoTrading — never read or written by this branch.
            const cfg =
              body.config && typeof body.config === 'object'
                ? (body.config as JsonRecord)
                : {}
            const inRange = (
              value: unknown,
              min: number,
              max: number,
            ): number | undefined =>
              typeof value === 'number' &&
              Number.isFinite(value) &&
              value >= min &&
              value <= max
                ? value
                : undefined
            const db = readFinanceStore()
            const settings = db.settings as Record<string, unknown>
            const gc = (
              settings.demoTradingGrid &&
              typeof settings.demoTradingGrid === 'object'
                ? { ...(settings.demoTradingGrid as Record<string, unknown>) }
                : {}
            ) as Record<string, unknown>

            const gridCount = inRange(cfg.gridCount, 2, 100)
            const quotePerGrid = inRange(cfg.quotePerGrid, 1, 100000)
            const rangeLookbackCandles = inRange(
              cfg.rangeLookbackCandles,
              10,
              1000,
            )
            const upperStopPct = inRange(cfg.upperStopPct, 0, 5)
            const lowerStopPct = inRange(cfg.lowerStopPct, 0, 1)
            const efficiencyLookbackCandles = inRange(
              cfg.efficiencyLookbackCandles,
              2,
              1000,
            )
            const maxEfficiencyRatio = inRange(cfg.maxEfficiencyRatio, 0, 1)
            if (gridCount !== undefined) gc.gridCount = Math.floor(gridCount)
            if (quotePerGrid !== undefined) gc.quotePerGrid = quotePerGrid
            if (rangeLookbackCandles !== undefined)
              gc.rangeLookbackCandles = Math.floor(rangeLookbackCandles)
            if (upperStopPct !== undefined) gc.upperStopPct = upperStopPct
            if (lowerStopPct !== undefined) gc.lowerStopPct = lowerStopPct
            if (efficiencyLookbackCandles !== undefined)
              gc.efficiencyLookbackCandles = Math.floor(
                efficiencyLookbackCandles,
              )
            if (maxEfficiencyRatio !== undefined)
              gc.maxEfficiencyRatio = maxEfficiencyRatio
            const rearmOutside = inRange(cfg.rearmOutsideRangeCandles, 0, 1000)
            if (rearmOutside !== undefined)
              gc.rearmOutsideRangeCandles = Math.floor(rearmOutside)
            // Grid execution mode: 'paper' (default) or 'testnet_execute'
            // (mirror paper fills as real testnet orders). Only these two
            // literals are ever accepted — there is deliberately no live
            // mode for the grid engine.
            if (
              cfg.executionMode === 'paper' ||
              cfg.executionMode === 'testnet_execute'
            )
              gc.executionMode = cfg.executionMode
            const gridDailyLoss = inRange(cfg.maxDailyLossQuote, 0, 100000)
            if (gridDailyLoss !== undefined)
              gc.maxDailyLossQuote = gridDailyLoss
            const gridOrderBudget = inRange(cfg.maxRealOrdersPerCycle, 1, 200)
            if (gridOrderBudget !== undefined)
              gc.maxRealOrdersPerCycle = Math.floor(gridOrderBudget)
            if (cfg.spacing === 'arithmetic' || cfg.spacing === 'geometric')
              gc.spacing = cfg.spacing
            if (typeof cfg.autoRecenter === 'boolean')
              gc.autoRecenter = cfg.autoRecenter
            if (typeof cfg.efficiencyGate === 'boolean')
              gc.efficiencyGate = cfg.efficiencyGate
            if (typeof cfg.absoluteStopFloorEnabled === 'boolean')
              gc.absoluteStopFloorEnabled = cfg.absoluteStopFloorEnabled
            if (Array.isArray(cfg.symbols)) {
              const syms = cfg.symbols
                .filter((s): s is string => typeof s === 'string')
                .map((s) => s.trim().toUpperCase())
                .filter((s) => /^[A-Z0-9]{5,20}$/.test(s))
              if (syms.length > 0) gc.symbols = Array.from(new Set(syms))
            }
            settings.demoTradingGrid = gc
            writeFinanceStore(db)
            appendAuditLog('grid_config_updated', gc)
            return json(financePayload())
          }
          if (action === 'set_rebalance_config') {
            // Only `enabled` is exposed here — the rebalancing bot shares
            // the council's global settings.tradingMode (already
            // testnet_execute in production), so without its own flag,
            // deploying the code plus a cron tick would arm it with no
            // distinct sign-off step. See RebalanceConfig.enabled's docstring
            // in rebalance-engine.ts. Off by default.
            const cfg =
              body.config && typeof body.config === 'object'
                ? (body.config as JsonRecord)
                : {}
            const db = readFinanceStore()
            const settings = db.settings as Record<string, unknown>
            const rc = (
              settings.demoTradingRebalance &&
              typeof settings.demoTradingRebalance === 'object'
                ? {
                    ...(settings.demoTradingRebalance as Record<
                      string,
                      unknown
                    >),
                  }
                : {}
            ) as Record<string, unknown>
            if (typeof cfg.enabled === 'boolean') rc.enabled = cfg.enabled
            settings.demoTradingRebalance = rc
            writeFinanceStore(db)
            appendAuditLog('rebalance_config_updated', { enabled: rc.enabled })
            return json(financePayload())
          }
          if (action === 'set_strategy_decay_config') {
            // Off by default — mirrors autoRefinementEnabled and the other
            // engine flags above. Detection only ever audit-logs
            // ('strategy_decay_detected'); it never disables a strategy or
            // changes sizing itself. See strategy-decay.ts.
            const cfg =
              body.config && typeof body.config === 'object'
                ? (body.config as JsonRecord)
                : {}
            const inRange = (
              value: unknown,
              min: number,
              max: number,
            ): number | undefined =>
              typeof value === 'number' &&
              Number.isFinite(value) &&
              value >= min &&
              value <= max
                ? value
                : undefined
            const db = readFinanceStore()
            const settings = db.settings as Record<string, unknown>
            const dc = (
              settings.strategyDecayDetection &&
              typeof settings.strategyDecayDetection === 'object'
                ? {
                    ...(settings.strategyDecayDetection as Record<
                      string,
                      unknown
                    >),
                  }
                : {}
            ) as Record<string, unknown>
            if (typeof cfg.enabled === 'boolean') dc.enabled = cfg.enabled
            const winRateDropThreshold = inRange(
              cfg.winRateDropThreshold,
              0.01,
              1,
            )
            if (winRateDropThreshold !== undefined)
              dc.winRateDropThreshold = winRateDropThreshold
            const minTrailingTrades = inRange(cfg.minTrailingTrades, 1, 1000)
            if (minTrailingTrades !== undefined)
              dc.minTrailingTrades = Math.floor(minTrailingTrades)
            settings.strategyDecayDetection = dc
            writeFinanceStore(db)
            appendAuditLog('strategy_decay_config_updated', dc)
            return json(financePayload())
          }
          if (action === 'save_strategy_baseline') {
            // Persists a strategy's validated backtest summary so live
            // performance can later be compared against it (see
            // strategy-decay.ts / decisionQualityReport's byStrategy[].decay).
            // Intentionally written to finance-store settings, NOT the
            // research-store Postgres schema — research-store is documented
            // as write-only/analysis-only and is never read back by live
            // engines; this value IS read back every cycle, so it belongs in
            // the same operational store as every other engine config.
            const body2 = body as {
              strategyId?: unknown
              winRate?: unknown
              avgPnlQuote?: unknown
              trades?: unknown
            }
            if (
              typeof body2.strategyId !== 'string' ||
              body2.strategyId.length === 0 ||
              typeof body2.winRate !== 'number' ||
              !Number.isFinite(body2.winRate) ||
              typeof body2.avgPnlQuote !== 'number' ||
              !Number.isFinite(body2.avgPnlQuote) ||
              typeof body2.trades !== 'number' ||
              !Number.isFinite(body2.trades)
            ) {
              return json(
                {
                  ok: false,
                  error:
                    'strategyId, winRate, avgPnlQuote, trades are required',
                },
                { status: 400 },
              )
            }
            const db = readFinanceStore()
            const settings = db.settings as Record<string, unknown>
            const baselines = (
              settings.strategyBaselines &&
              typeof settings.strategyBaselines === 'object'
                ? { ...(settings.strategyBaselines as Record<string, unknown>) }
                : {}
            ) as Record<string, unknown>
            const baseline = {
              strategyId: body2.strategyId,
              winRate: body2.winRate,
              avgPnlQuote: body2.avgPnlQuote,
              trades: Math.floor(body2.trades),
              computedAt: new Date().toISOString(),
            }
            baselines[body2.strategyId] = baseline
            settings.strategyBaselines = baselines
            writeFinanceStore(db)
            appendAuditLog('strategy_baseline_saved', baseline)
            return json(financePayload())
          }
          if (action === 'set_llm_config') {
            // Only `enabled` is exposed here — same rationale as
            // set_rebalance_config above (this engine also shares the
            // council's global settings.tradingMode). Off by default.
            const cfg =
              body.config && typeof body.config === 'object'
                ? (body.config as JsonRecord)
                : {}
            const db = readFinanceStore()
            const settings = db.settings as Record<string, unknown>
            const lc = (
              settings.demoTradingLlm &&
              typeof settings.demoTradingLlm === 'object'
                ? { ...(settings.demoTradingLlm as Record<string, unknown>) }
                : {}
            ) as Record<string, unknown>
            if (typeof cfg.enabled === 'boolean') lc.enabled = cfg.enabled
            settings.demoTradingLlm = lc
            writeFinanceStore(db)
            appendAuditLog('llm_config_updated', { enabled: lc.enabled })
            return json(financePayload())
          }
          if (action === 'list_pending_ingestions') {
            // Unmasked on purpose — financePayload()'s `data` blob runs
            // through maskSensitive(), which would redact passwordHint
            // (matches /password/i) even though it's a plain hint the user
            // needs to read, not a secret.
            return json({
              ok: true,
              pendingIngestions: listPendingIngestions(),
            })
          }
          if (action === 'list_finance_documents') {
            return json({
              ok: true,
              financeDocuments: listFinanceDocuments(readFinanceStore()),
            })
          }
          if (action === 'submit_ingestion_password') {
            const id = typeof body.id === 'string' ? body.id : ''
            const password =
              typeof body.password === 'string' ? body.password : ''
            if (!id || !password) {
              return json(
                { ok: false, error: 'id and password are required.' },
                { status: 400 },
              )
            }
            const pending = listPendingIngestions().find((p) => p.id === id)
            if (!pending)
              return json(
                { ok: false, error: 'Pending ingestion not found.' },
                { status: 404 },
              )

            const normalized = pdfToImages(pending.sourceRef, password)
            if (!normalized.ok) {
              const updated = updatePendingIngestion(id, {
                error:
                  normalized.reason === 'bad_password'
                    ? 'Incorrect password, try again.'
                    : normalized.reason,
              })
              return json({ ok: true, pendingIngestion: updated })
            }

            const previewImagePath = normalized.imagePaths[0]
            if (pending.documentType === 'contract') {
              const extraction = await extractEmploymentContract(
                normalized.imagePaths,
              )
              const updated = updatePendingIngestion(id, {
                status: 'awaiting_review',
                rawPreviewImagePath: previewImagePath,
                extractedContract: extraction.ok ? extraction.data : undefined,
                error: extraction.ok ? undefined : extraction.reason,
              })
              return json({ ok: true, pendingIngestion: updated })
            }
            if (pending.documentType === 'statement') {
              const extraction = await extractTransactionsFromImages(
                normalized.imagePaths,
                getCategoryCorrections(),
              )
              if (!extraction.ok || extraction.data.length === 0) {
                const updated = updatePendingIngestion(id, {
                  status: 'awaiting_review',
                  rawPreviewImagePath: previewImagePath,
                  extracted: undefined,
                  error: extraction.ok
                    ? 'No posted transactions found.'
                    : extraction.reason,
                })
                return json({ ok: true, pendingIngestion: updated })
              }
              const [first, ...rest] = extraction.data
              const updated = updatePendingIngestion(id, {
                status: 'awaiting_review',
                rawPreviewImagePath: previewImagePath,
                extracted: first,
                error: undefined,
              })
              const additional = rest.map((extracted) =>
                addPendingIngestion({
                  source: pending.source,
                  documentType: 'statement',
                  sourceRef: pending.sourceRef,
                  checksumSha256: pending.checksumSha256,
                  status: 'awaiting_review',
                  rawPreviewImagePath: previewImagePath,
                  extracted,
                }),
              )
              return json({
                ok: true,
                pendingIngestion: updated,
                additionalPendingIngestionIds: additional.map(
                  (item) => item.id,
                ),
              })
            }
            const extraction = await extractTransactionFromImage(
              previewImagePath,
              getCategoryCorrections(),
            )
            const updated = updatePendingIngestion(id, {
              status: 'awaiting_review',
              rawPreviewImagePath: previewImagePath,
              extracted: extraction.ok ? extraction.data : undefined,
              error: extraction.ok ? undefined : extraction.reason,
            })
            return json({ ok: true, pendingIngestion: updated })
          }
          if (action === 'confirm_pending_ingestion') {
            const id = typeof body.id === 'string' ? body.id : ''
            const payload =
              body.payload && typeof body.payload === 'object'
                ? (body.payload as JsonRecord)
                : {}
            const force = body.force === true
            const pending = listPendingIngestions().find((p) => p.id === id)
            if (!pending)
              return json(
                { ok: false, error: 'Pending ingestion not found.' },
                { status: 404 },
              )

            if (pending.documentClass === 'salary_slip') {
              const employerName =
                typeof payload.employerName === 'string'
                  ? payload.employerName.trim()
                  : (pending.extractedSalarySlip?.employerName.trim() ?? '')
              const paymentDate =
                typeof payload.paymentDate === 'string'
                  ? payload.paymentDate.trim()
                  : (pending.extractedSalarySlip?.paymentDate?.trim() ?? '')
              const netAmount =
                typeof payload.netAmount === 'number'
                  ? payload.netAmount
                  : Number(payload.netAmount)
              const currency =
                typeof payload.currency === 'string' && payload.currency.trim()
                  ? payload.currency.trim().toUpperCase()
                  : (pending.extractedSalarySlip?.currency ?? 'LKR')
              if (
                !employerName ||
                !paymentDate ||
                !Number.isFinite(netAmount) ||
                netAmount <= 0
              ) {
                return json(
                  {
                    ok: false,
                    error:
                      'Employer, payment date, and positive net pay are required.',
                  },
                  { status: 400 },
                )
              }
              const grossAmount =
                typeof payload.grossAmount === 'number'
                  ? payload.grossAmount
                  : pending.extractedSalarySlip?.grossAmount
              const deductions =
                typeof payload.deductions === 'number'
                  ? payload.deductions
                  : pending.extractedSalarySlip?.deductions
              const payPeriod =
                typeof payload.payPeriod === 'string'
                  ? payload.payPeriod.trim()
                  : pending.extractedSalarySlip?.payPeriod
              const payrollNote = [
                payPeriod ? `Pay period: ${payPeriod}` : '',
                typeof grossAmount === 'number'
                  ? `Gross: ${grossAmount} ${currency}`
                  : '',
                typeof deductions === 'number'
                  ? `Deductions: ${deductions} ${currency}`
                  : '',
              ]
                .filter(Boolean)
                .join('; ')
              addFinanceRecord('income', {
                sourceName: employerName,
                incomeType: 'Salary',
                incomeSubtype: 'salary',
                originalCurrency: currency,
                originalAmount: netAmount,
                dateReceived: paymentDate,
                notes: payrollNote || undefined,
                documentRef: pending.sourceRef,
                source: pending.source,
              })
              const updated = updatePendingIngestion(id, {
                status: 'confirmed',
              })
              return json({ pendingIngestion: updated, ...financePayload() })
            }

            if (pending.documentClass === 'contract_note') {
              const note = pending.extractedContractNote
              const symbol =
                typeof payload.symbol === 'string'
                  ? payload.symbol.trim().toUpperCase()
                  : (note?.symbol ?? '')
              const side =
                payload.side === 'sell' || note?.side === 'sell'
                  ? 'sell'
                  : 'buy'
              const quantity =
                typeof payload.quantity === 'number'
                  ? payload.quantity
                  : Number(payload.quantity ?? note?.quantity)
              const price =
                typeof payload.price === 'number'
                  ? payload.price
                  : Number(payload.price ?? note?.price)
              if (
                !symbol ||
                !Number.isFinite(quantity) ||
                quantity <= 0 ||
                !Number.isFinite(price) ||
                price <= 0
              ) {
                return json(
                  {
                    ok: false,
                    error:
                      'Symbol, positive quantity, and positive execution price are required.',
                  },
                  { status: 400 },
                )
              }
              const currency =
                typeof payload.currency === 'string' && payload.currency.trim()
                  ? payload.currency.trim().toUpperCase()
                  : (note?.currency ?? 'LKR')
              const companyName =
                typeof payload.companyName === 'string'
                  ? payload.companyName.trim()
                  : note?.companyName
              const broker =
                typeof payload.broker === 'string'
                  ? payload.broker.trim()
                  : note?.broker
              const tradeDate =
                typeof payload.tradeDate === 'string' &&
                payload.tradeDate.trim()
                  ? payload.tradeDate.trim()
                  : (note?.tradeDate ?? new Date().toISOString().slice(0, 10))
              const settlementDate =
                typeof payload.settlementDate === 'string'
                  ? payload.settlementDate.trim()
                  : note?.settlementDate
              const grossAmount =
                typeof payload.grossAmount === 'number'
                  ? payload.grossAmount
                  : note?.grossAmount
              const fees =
                typeof payload.fees === 'number' ? payload.fees : note?.fees
              const details = [
                `${side.toUpperCase()} ${quantity} ${symbol} @ ${price} ${currency}`,
                companyName ? `Company: ${companyName}` : '',
                broker ? `Broker: ${broker}` : '',
                typeof grossAmount === 'number'
                  ? `Gross: ${grossAmount} ${currency}`
                  : '',
                typeof fees === 'number' ? `Fees: ${fees} ${currency}` : '',
                settlementDate ? `Settlement: ${settlementDate}` : '',
              ]
                .filter(Boolean)
                .join('; ')
              addFinanceRecord('investment_journal', {
                symbol,
                entryDate: tradeDate,
                entryType: side,
                content: `Contract note confirmed: ${details}`,
                source: pending.source,
              })
              const updated = updatePendingIngestion(id, {
                status: 'confirmed',
              })
              return json({ pendingIngestion: updated, ...financePayload() })
            }

            if (pending.documentClass === 'fd_certificate') {
              const certificate = pending.extractedFdCertificate
              const bankName =
                typeof payload.bankName === 'string'
                  ? payload.bankName.trim()
                  : (certificate?.bankName.trim() ?? '')
              const principal =
                typeof payload.principal === 'number'
                  ? payload.principal
                  : Number(payload.principal ?? certificate?.principal)
              const interestRatePct =
                typeof payload.interestRatePct === 'number'
                  ? payload.interestRatePct
                  : Number(
                      payload.interestRatePct ?? certificate?.interestRatePct,
                    )
              if (
                !bankName ||
                !Number.isFinite(principal) ||
                principal <= 0 ||
                !Number.isFinite(interestRatePct) ||
                interestRatePct < 0
              ) {
                return json(
                  {
                    ok: false,
                    error:
                      'Bank, positive principal, and valid interest rate are required.',
                  },
                  { status: 400 },
                )
              }
              const currency =
                typeof payload.currency === 'string' && payload.currency.trim()
                  ? payload.currency.trim().toUpperCase()
                  : (certificate?.currency ?? 'LKR')
              const interestPayout =
                payload.interestPayout === 'monthly' ||
                payload.interestPayout === 'quarterly' ||
                payload.interestPayout === 'annually' ||
                payload.interestPayout === 'at_maturity'
                  ? payload.interestPayout
                  : (certificate?.interestPayout ?? 'at_maturity')
              const startDate =
                typeof payload.startDate === 'string' &&
                payload.startDate.trim()
                  ? payload.startDate.trim()
                  : (certificate?.startDate ??
                    new Date().toISOString().slice(0, 10))
              const maturityDate =
                typeof payload.maturityDate === 'string' &&
                payload.maturityDate.trim()
                  ? payload.maturityDate.trim()
                  : (certificate?.maturityDate ?? startDate)
              const autoRenew =
                typeof payload.autoRenew === 'boolean'
                  ? payload.autoRenew
                  : (certificate?.autoRenew ?? false)
              const certificateNumber =
                typeof payload.certificateNumber === 'string'
                  ? payload.certificateNumber.trim()
                  : certificate?.certificateNumber
              addFinanceRecord('fixed_deposit', {
                bankName,
                principal,
                currency,
                interestRatePct,
                interestPayout,
                startDate,
                maturityDate,
                autoRenew,
                documentRef: pending.sourceRef,
                notes: certificateNumber
                  ? `Certificate: ${certificateNumber}`
                  : undefined,
                source: pending.source,
              })
              const updated = updatePendingIngestion(id, {
                status: 'confirmed',
              })
              return json({ pendingIngestion: updated, ...financePayload() })
            }

            if (pending.documentType === 'contract') {
              const employerName =
                typeof payload.employerName === 'string'
                  ? payload.employerName.trim()
                  : ''
              const employmentType =
                typeof payload.employmentType === 'string'
                  ? payload.employmentType
                  : undefined
              if (!employerName || !employmentType) {
                return json(
                  {
                    ok: false,
                    error: 'employerName and employmentType are required.',
                  },
                  { status: 400 },
                )
              }
              const targetIncomeSourceId =
                typeof payload.targetIncomeSourceId === 'string' &&
                payload.targetIncomeSourceId
                  ? payload.targetIncomeSourceId
                  : undefined

              const risks = pending.extractedContract?.risks ?? []
              const riskSummary = pending.extractedContract?.riskSummary
              const riskNote = riskSummary
                ? `AI contract review: ${riskSummary}${
                    risks.length > 0
                      ? `\nConcerns: ${risks.map((r) => `[${r.severity}] ${r.clause}: ${r.concern}`).join('; ')}`
                      : ''
                  }`.slice(0, 2000)
                : undefined
              const userNotes =
                typeof payload.notes === 'string' ? payload.notes.trim() : ''
              const combinedNotes =
                [userNotes, riskNote].filter(Boolean).join('\n\n') || undefined

              // Whitelist to IncomeSource's actual fields only — payload also
              // carries extraction-only data (risks, riskSummary, confidence,
              // targetIncomeSourceId) that must never be persisted onto the record.
              // Only include a key when the payload actually provided a value:
              // updateFinanceRecord does a shallow `{...existing, ...payload}`
              // merge, so an explicit `key: undefined` would wipe an existing
              // field the renewal contract simply didn't restate.
              const jobPayload: Record<string, unknown> = {
                employerName,
                employmentType,
              }
              if (typeof payload.monthlyIncomeAmount === 'number')
                jobPayload.monthlyIncomeAmount = payload.monthlyIncomeAmount
              if (typeof payload.currency === 'string')
                jobPayload.currency = payload.currency
              if (typeof payload.contractStartDate === 'string')
                jobPayload.contractStartDate = payload.contractStartDate
              if (typeof payload.contractEndDate === 'string')
                jobPayload.contractEndDate = payload.contractEndDate
              if (typeof payload.jobTitle === 'string')
                jobPayload.jobTitle = payload.jobTitle
              // Client sends the ExtractedContract field name (paydayDayOfMonth);
              // IncomeSource persists it as expectedPaydayDayOfMonth.
              if (typeof payload.paydayDayOfMonth === 'number')
                jobPayload.expectedPaydayDayOfMonth = payload.paydayDayOfMonth
              if (typeof payload.paySchedule === 'string')
                jobPayload.paySchedule = payload.paySchedule
              if (combinedNotes) jobPayload.notes = combinedNotes
              // Link back to the uploaded contract on both create and a
              // renewal update, so "view original contract" always points
              // at the most recently confirmed document for this job.
              jobPayload.documentRef = pending.sourceRef

              if (targetIncomeSourceId) {
                updateFinanceRecord(
                  'income_source',
                  targetIncomeSourceId,
                  jobPayload,
                )
              } else {
                addFinanceRecord('income_source', {
                  ...jobPayload,
                  source: pending.source,
                })
              }
              const updated = updatePendingIngestion(id, {
                status: 'confirmed',
              })
              return json({ pendingIngestion: updated, ...financePayload() })
            }

            const kind =
              typeof payload.kind === 'string'
                ? payload.kind
                : pending.extracted?.kind
            if (kind !== 'income' && kind !== 'expense') {
              return json(
                { ok: false, error: 'kind (income|expense) is required.' },
                { status: 400 },
              )
            }
            const vendorOrSource =
              typeof payload.vendorOrSource === 'string'
                ? payload.vendorOrSource
                : ''
            const date = typeof payload.date === 'string' ? payload.date : ''
            const amount =
              typeof payload.amount === 'number'
                ? payload.amount
                : Number(payload.amount)

            // Same-day/vendor/amount already on record — likely the same
            // bill arriving via both Gmail and a manual upload. Warn instead
            // of silently double-counting; the UI can resend with force:true.
            if (!force) {
              const duplicate = findPossibleDuplicate(
                kind,
                vendorOrSource,
                date,
                amount,
              )
              if (duplicate) {
                return json({
                  ok: true,
                  duplicateWarning: duplicate,
                  pendingIngestion: pending,
                })
              }
            }

            // Learn from a category correction: if the user changed the
            // AI-suggested category before confirming, remember it for next
            // time this vendor shows up.
            const suggestedCategory = pending.extracted?.category
            const finalCategory =
              typeof payload.category === 'string'
                ? payload.category
                : undefined
            if (
              vendorOrSource &&
              finalCategory &&
              finalCategory !== suggestedCategory
            ) {
              recordCategoryCorrection(vendorOrSource, finalCategory)
            }

            addFinanceRecord(kind, {
              ...payload,
              source: pending.source,
              documentRef: pending.sourceRef,
              ...(kind === 'income'
                ? {
                    sourceName: payload.vendorOrSource,
                    dateReceived: payload.date,
                  }
                : { vendor: payload.vendorOrSource, date: payload.date }),
            })
            const updated = updatePendingIngestion(id, { status: 'confirmed' })
            return json({ pendingIngestion: updated, ...financePayload() })
          }
          if (action === 'reject_pending_ingestion') {
            const id = typeof body.id === 'string' ? body.id : ''
            if (!id)
              return json(
                { ok: false, error: 'id is required.' },
                { status: 400 },
              )
            const updated = updatePendingIngestion(id, { status: 'rejected' })
            return json({ ok: true, pendingIngestion: updated })
          }
          if (action === 'reanalyze_contract') {
            const incomeSourceId =
              typeof body.incomeSourceId === 'string' ? body.incomeSourceId : ''
            if (!incomeSourceId)
              return json(
                { ok: false, error: 'incomeSourceId is required.' },
                { status: 400 },
              )
            const job = readFinanceStore().income_sources.find(
              (r) => r.id === incomeSourceId,
            )
            if (!job)
              return json(
                { ok: false, error: 'Job not found.' },
                { status: 404 },
              )
            if (!job.documentRef) {
              return json(
                { ok: false, error: 'No document on file for this job.' },
                { status: 400 },
              )
            }

            const isPdf = job.documentRef.toLowerCase().endsWith('.pdf')
            let imagePaths = [job.documentRef]
            if (isPdf) {
              if (isPdfEncrypted(job.documentRef)) {
                return json(
                  {
                    ok: false,
                    error:
                      'This document is password-protected — re-upload it to unlock and re-analyze.',
                  },
                  { status: 400 },
                )
              }
              const normalized = pdfToImages(job.documentRef)
              if (!normalized.ok) {
                return json(
                  {
                    ok: false,
                    error: `Could not process document: ${normalized.reason}`,
                  },
                  { status: 400 },
                )
              }
              imagePaths = normalized.imagePaths
            }

            const extraction = await extractEmploymentContract(imagePaths)
            const pending = addPendingIngestion({
              source: 'upload',
              documentType: 'contract',
              sourceRef: job.documentRef,
              status: 'awaiting_review',
              rawPreviewImagePath: imagePaths[0],
              extractedContract: extraction.ok ? extraction.data : undefined,
              contractChanges: extraction.ok
                ? detectContractChanges(job, extraction.data)
                : undefined,
              error: extraction.ok ? undefined : extraction.reason,
            })
            return json({ ok: true, pendingIngestionId: pending.id })
          }
          if (action === 'refresh_stock_price') {
            const id = typeof body.id === 'string' ? body.id : ''
            if (!id)
              return json(
                { ok: false, error: 'id is required.' },
                { status: 400 },
              )
            const db = readFinanceStore()
            const holding = db.stock_holdings.find((h) => h.id === id)
            if (!holding)
              return json(
                { ok: false, error: 'Stock holding not found.' },
                { status: 404 },
              )

            const priceResult = await fetchCsePrice(holding.symbol)
            if (!priceResult) {
              // Not an error — the unofficial CSE endpoint failing is an
              // expected, documented outcome; manual entry is the fallback.
              return json({ priceFetchFailed: true, ...financePayload() })
            }
            updateFinanceRecord('stock_holding', id, {
              lastKnownPrice: priceResult.price,
              lastPriceUpdatedAt: priceResult.asOf,
              priceSource: 'cse_api',
              lastPriceHigh: priceResult.high,
              lastPriceLow: priceResult.low,
              lastPriceClose: priceResult.close,
              lastPriceVolume: priceResult.volume,
              lastPriceTurnover: priceResult.turnover,
            })
            return json({ priceFetchFailed: false, ...financePayload() })
          }
          if (action === 'sync_gmail_now') {
            try {
              const result = await syncGmailNow()
              appendAuditLog('gmail_sync_run', { ...result })
              return json({ ok: true, result })
            } catch (error) {
              return json(
                { ok: false, error: safeErrorMessage(error) },
                { status: 502 },
              )
            }
          }
          if (action === 'apply_recommended_safeguards') {
            const applied = applyRecommendedSafeguards()
            return json({
              ...financePayload(),
              appliedSafeguards: applied.applied,
            })
          }
          if (action === 'run_learning_cycle') {
            const learning = runLearningCycle()
            return json({ ...financePayload(), learningCycle: learning })
          }
          if (action === 'apply_learning_candidate') {
            const candidateId =
              typeof body.candidateId === 'string' ? body.candidateId : ''
            const result = applyLearningCandidate(candidateId)
            return json({
              ...financePayload(),
              learningCandidateResult: result,
            })
          }
          if (action === 'set_strategy_override') {
            const result = setStrategyOverride({
              strategyId:
                typeof body.strategyId === 'string' ? body.strategyId : '',
              overrideAction: body.overrideAction,
              multiplier: body.multiplier,
              reason: body.reason,
              reviewAt: body.reviewAt,
              expiresAt: body.expiresAt,
              reviewAfterDays: body.reviewAfterDays,
              expiresAfterDays: body.expiresAfterDays,
            })
            return json({ ...financePayload(), strategyOverrideResult: result })
          }
          if (action === 'apply_strategy_override_recommendations') {
            const applied = applyStrategyOverrideRecommendations()
            return json({
              ...financePayload(),
              strategyOverrideRecommendationResult: applied.result,
            })
          }
          if (action === 'start_sandbox_experiment') {
            const result = startSandboxExperiment({
              strategyIds: body.strategyIds,
              label: body.label,
              reason: body.reason,
              executionMode: body.executionMode,
              durationMinutes: body.durationMinutes,
              tradeCap: body.tradeCap,
              sizeMultiplierCap: body.sizeMultiplierCap,
            })
            return json({
              ...financePayload(),
              sandboxExperimentResult: result,
            })
          }
          if (action === 'stop_sandbox_experiment') {
            const result = stopSandboxExperiment(
              typeof body.experimentId === 'string' ? body.experimentId : '',
              body.reason,
            )
            return json({
              ...financePayload(),
              sandboxExperimentResult: result,
            })
          }
          if (action === 'rollback_sandbox_experiment') {
            const result = rollbackSandboxExperiment(
              typeof body.experimentId === 'string' ? body.experimentId : '',
              body.reason,
            )
            return json({
              ...financePayload(),
              sandboxExperimentResult: result,
            })
          }
          if (action === 'rearm_sandbox_experiment') {
            const result = rearmSandboxExperiment(
              typeof body.experimentId === 'string' ? body.experimentId : '',
            )
            return json({
              ...financePayload(),
              sandboxExperimentResult: result,
            })
          }
          if (action === 'start_validation_run') {
            const result = await startValidationRun({
              stage: body.stage,
              strategies: body.strategies,
              budgets: body.budgets,
              notes: body.notes,
              autoRun: body.autoRun,
            })
            return json({ ...financePayload(), validationRunResult: result })
          }
          if (action === 'run_validation_cycle') {
            if (body.stage !== 'paper' && body.stage !== 'sandbox') {
              return json(
                { ok: false, error: 'stage must be "paper" or "sandbox".' },
                { status: 400 },
              )
            }
            const result = await runValidationCycle(body.stage, {
              force: body.force === true,
            })
            return json(
              { ...financePayload(), validationRunResult: result },
              { status: result.ok ? 200 : 400 },
            )
          }
          if (action === 'stop_validation_run') {
            const result = stopValidationRun(body.stage, body.reason)
            return json({ ...financePayload(), validationRunResult: result })
          }
          if (action === 'finalize_validation_run') {
            const result = finalizeValidationRun(body.stage, body.notes)
            return json({ ...financePayload(), validationRunResult: result })
          }
          return json(
            { ok: false, error: `Unsupported finance action: ${action}` },
            { status: 400 },
          )
        } catch (error) {
          appendAuditLog('finance_api_error', {
            action,
            error: safeErrorMessage(error),
          })
          return json(
            { ok: false, error: safeErrorMessage(error) },
            { status: 400 },
          )
        }
      },
    },
  },
})
