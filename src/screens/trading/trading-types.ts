/**
 * Shared type definitions for the Trading section UI.
 *
 * Extracted verbatim from trading-screen.tsx (2026-09-10) to shrink that
 * 4.9k-line file and give the per-panel component files a common import
 * point. No shape changes — every field is exactly as it was inline.
 */

export type DecisionQualityFinding = {
  severity: 'info' | 'warning' | 'critical'
  title: string
  detail: string
  evidenceCount?: number
}

export type PaperDecisionQualityReport = {
  sampleCount: number
  coveredSampleCount: number
  abstainedSampleCount: number
  coverage: number
  abstentionRate: number
  directionalHitRate: number | null
  averageAdverseMovePct: number | null
  worstAdverseMovePct: number | null
  calibrationBuckets: Array<{
    label: string
    sampleCount: number
    directionalHitRate: number | null
  }>
}

export type DecisionQualityReport = {
  checkedAt: string
  status:
    | 'insufficient_data'
    | 'degraded'
    | 'improving'
    | 'ready_for_testnet'
    | 'ready_for_manual_live_review'
  sample: {
    totalClosedTrades: number
    realClosedTrades: number
    shadowClosedTrades: number
    shadowDecisionCount: number
    pairedShadowTrades: number
    openPositions: number
    openShadowPositions: number
  }
  metrics: {
    totalTrades: number
    winRate: number
    profitFactor: number
    avgProfitLossPerTrade: number
    avgProfit: number
    avgLoss: number
    sharpeRatio: number
    maxDrawdown: number
    totalFeesQuote: number
    totalPnlQuote: number
    recentWinRate: number
    recentPnlQuote: number
    shadowWinRate: number
    shadowVsActualAvgSlippageQuote: number
    maxLossStreak: number
  }
  byStrategy: Array<{
    strategyId: string
    trades: number
    winRate: number
    totalPnlQuote: number
    avgPnlQuote: number
    score: number
    lossStreak: number
    recommendation: 'keep' | 'reduce_size' | 'cooldown' | 'disable_until_review'
  }>
  findings: Array<DecisionQualityFinding>
  recommendedAdjustments: {
    recommendedMode: 'paper_trade' | 'testnet_execute' | 'live_manual_approval'
    pauseLive: boolean
    positionSizeMultiplier: number
    maxQuotePerTrade: number
    reasons: Array<string>
  }
  validations: {
    enoughPaperData: boolean
    enoughShadowData: boolean
    enoughDataForTestnet: boolean
    enoughDataForLiveManual: boolean
    canIncreaseRisk: boolean
  }
}

export type SafeguardHistoryEntry = {
  id: string
  appliedAt: string
  status: DecisionQualityReport['status']
  recommendedMode: DecisionQualityReport['recommendedAdjustments']['recommendedMode']
  appliedTradingMode: string
  executionAccount: string
  liveTradingEnabled: boolean
  baseQuotePerTrade: number
  previousQuotePerTrade: number
  appliedQuotePerTrade: number
  positionSizeMultiplier: number
  pauseLive: boolean
  liveRecommendationDeferred: boolean
  reasonSummary: string
}

export type LearningPolicy = {
  enabled: boolean
  autoApplyModes: Array<'paper_trade' | 'testnet_execute'>
  candidateMinBacktestFolds: number
  stabilityGate: 'conservative'
  livePromotionRequiresApproval: boolean
}

export type LearningStabilityAssessment = {
  passed: boolean
  closedTrades: number
  evidenceDays: number
  profitFactor: number
  totalPnlQuote: number
  maxDrawdown: number
  maxDrawdownLimit: number
  hasCriticalFinding: boolean
  reasons: Array<string>
}

export type LearningConfigPatch = {
  quotePerTrade?: number
}

export type LearningStrategyOverridePatch = {
  strategyId: string
  overrideAction: 'disabled' | 'reduce_size'
  multiplier: number | null
  reason: string
}

export type LearningCandidateStatus =
  | 'proposed'
  | 'paper_applied'
  | 'testnet_applied'
  | 'testnet_ready'
  | 'live_review_ready'
  | 'rejected'
  | 'expired'

export type LearningCandidate = {
  kind: 'learning_candidate'
  id: string
  status: LearningCandidateStatus
  source: 'decision_quality'
  createdAt: string
  updatedAt: string
  appliedAt: string | null
  expiresAt: string | null
  fingerprint: string
  modeAtCreation: string
  reason: string
  configPatch: LearningConfigPatch
  strategyOverrides: Array<LearningStrategyOverridePatch>
  metrics: {
    closedTrades: number
    totalPnlQuote: number
    profitFactor: number
    winRate: number
    recentPnlQuote: number
    maxDrawdown: number
    maxLossStreak: number
  }
  validation: {
    method: 'closed_trade_evidence'
    minBacktestFolds: number
    passed: boolean
    reason: string
  }
  promotion: {
    eligibleFor: 'paper' | 'testnet_review' | 'live_review'
    requiresApproval: boolean
  }
}

export type LearningReport = {
  checkedAt: string
  policy: LearningPolicy
  stability: LearningStabilityAssessment
  latestCandidate: LearningCandidate | null
  candidates: Array<LearningCandidate>
}

export type LearningCycleResult = LearningReport & {
  generatedCandidate: LearningCandidate | null
  appliedCandidate: LearningCandidate | null
  skippedReason: string | null
}

export type StrategyCatalogEntry = {
  id: string
  name: string
  description: string
}

export type StrategyEligibilityAudit = {
  generatedAt: string
  executionMode: string
  interval: string
  asOfMs: number
  councilThreshold: number
  symbols: Array<{
    symbol: string
    candles: number
    latestPrice: number | null
    strategies: Array<{
      strategyId: string
      name: string
      signal: 'BUY' | 'SELL' | 'HOLD'
      confidence: number
      reason: string
      minCandles: number
      active: boolean
      overrideMode: 'disabled' | 'reduce_size' | null
      dataAvailable: boolean
      dataIssues: Array<string>
      regime: string | null
      muted: boolean
      councilEligible: boolean
      exclusionReason: string | null
    }>
    council: {
      signal: 'BUY' | 'SELL' | 'HOLD'
      net: number
      threshold: number
      leadStrategyId: string | null
      eligible: boolean
      reasons: Array<string>
      participatingStrategyIds: Array<string>
    }
  }>
}

export type StrategyOverride = {
  id: string
  strategyId: string
  mode: 'disabled' | 'reduce_size'
  multiplier: number
  reason: string
  createdAt: string
  updatedAt: string
  reviewAt: string | null
  expiresAt: string | null
  source: 'manual' | 'automatic' | 'experiment'
}

export type StrategyOverrideHistoryEntry = {
  id: string
  strategyId: string
  action: 'disabled' | 'reduced_size' | 'cleared' | 'updated'
  previousMode: 'disabled' | 'reduce_size' | null
  mode: 'disabled' | 'reduce_size' | null
  previousMultiplier: number | null
  multiplier: number | null
  previousReviewAt: string | null
  reviewAt: string | null
  previousExpiresAt: string | null
  expiresAt: string | null
  reason: string
  at: string
  activeOverrideId: string | null
}

export type SandboxExperimentStatus =
  | 'active'
  | 'stopped'
  | 'expired'
  | 'trade_cap_reached'
  | 'rolled_back'

export type SandboxExperiment = {
  id: string
  label: string
  reason: string
  strategyIds: Array<string>
  executionMode: 'paper' | 'testnet'
  durationMinutes: number | null
  tradeCap: number | null
  sizeMultiplierCap: number
  status: SandboxExperimentStatus
  startedAt: string
  updatedAt: string
  endsAt: string | null
  endedAt: string | null
  rolledBackAt: string | null
  tradesObserved: number
  createdAt: string
}

export type ValidationStage = 'paper' | 'sandbox'
export type ValidationRunStatus = 'active' | 'completed' | 'stopped' | 'expired'

export type ReadinessGateLite = {
  id: string
  label: string
  pass: boolean
  detail: string
  evidenceAgeMs: number | null
}

export type ValidationRunBudgets = {
  maxDurationMs: number
  maxCycles: number
  maxTrades: number
  maxExposureQuote: number
}

export type ValidationRunBaseline = {
  equityQuote: number | null
  openPositions: number
  recordedAt: string
}

export type ValidationRunProgress = {
  cyclesRun: number
  tradesOpened: number
  tradesClosed: number
  lastCycleAt: string | null
  lastCycleRan: boolean | null
  lastCycleReason: string | null
  currentExposureQuote: number
}

export type ValidationRunEvidence = {
  ledgerRecordIds: Array<string>
  realizedPnlQuote: number
  feesQuote: number
  avgSlippageQuote: number | null
  shadowComparisonsSampled: number
  errors: Array<{ at: string; message: string }>
}

export type ValidationRun = {
  id: string
  stage: ValidationStage
  executionMode: 'paper' | 'testnet'
  strategies: Array<string>
  autoRun: boolean
  status: ValidationRunStatus
  budgets: ValidationRunBudgets
  baseline: ValidationRunBaseline
  progress: ValidationRunProgress
  evidence: ValidationRunEvidence
  readinessImpact: ReadinessGateLite | null
  createdAt: string
  updatedAt: string
  endedAt: string | null
  endReason: string | null
  notes: string
}

export type ValidationRunView = ValidationRun & {
  liveReadinessImpact: ReadinessGateLite | null
}

export type ValidationReconciliation = {
  runId: string
  stage: ValidationStage
  status: ValidationRunStatus
  baselineEquityQuote: number | null
  currentExposureQuote: number
  attributedTradeCount: number
  attributedLedgerCount: number
  realizedPnlQuote: number
  feesQuote: number
  openPositionCount: number
  warnings: Array<string>
  recommendation:
    | 'continue_collecting'
    | 'keep_unchanged'
    | 'review_reversible_control'
  evaluatedAt: string
}

export type StrategyEvidenceWindow = {
  strategyId: string
  windowDays: number
  windowStart: string
  windowEnd: string
  closedTrades: number
  wins: number
  losses: number
  winRate: number
  lossRate: number
  realizedPnlQuote: number
  avgWinQuote: number
  avgLossQuote: number
  recoveredTrades: number
  forcedCloseTrades: number
  sufficientSample: boolean
}

export type StrategyGuardRecommendation =
  | 'insufficient_evidence'
  | 'monitor'
  | 'reduce_size_candidate'
  | 'disable_candidate'
  | 'recovered'

export type StrategyGuardReview = {
  strategyId: string
  allTime: { trades: number; winRate: number; totalPnlQuote: number }
  window: StrategyEvidenceWindow
  recommendation: StrategyGuardRecommendation
  reason: string
  hasActiveGuardOrExperiment: boolean
}

export type NextTradingRecommendation = {
  decision:
    | 'stay_paper_only'
    | 'sandbox_evidence_only'
    | 'live_requires_manual_review'
  currentMode: string
  liveTradingEnabled: boolean
  requiresExplicitApproval: boolean
  summary: string
  nextAction: string
  safeSandboxCaps: {
    durationMinutes: number
    maxCycles: number
    maxTrades: number
    maxExposureUsdt: number
  }
}

export type FinancePayload = {
  ok: boolean
  checkedAt: number
  storage: {
    active: string
    auditPath: string
    postgres: {
      enabled: boolean
      available: boolean
      database: string
      snapshotAvailable: boolean
      reason?: string
      lastWriteError?: string
    }
    health?: {
      status: 'healthy' | 'postgres_unavailable' | 'json_primary'
      warnings: Array<string>
      postgresUpdatedAt: string | null
      rowCounts: {
        postgres: Record<string, number>
      }
    }
  }
  paths: Record<string, string>
  security: Record<string, boolean>
  connectors: Record<string, Record<string, unknown>>
  summary: {
    openPlans: number
    blockedPlans: number
    tradingMode: string
    liveTradingEnabled: boolean
    emergencyKillSwitch: boolean
    primaryTradingProvider: string
    executionAccount: string
    paperShadowEnabled: boolean
    livePerOrderCapUsdt: number
    liveBinanceApproved: boolean
    ibkrStatus: string
  }
  nextRecommendation: NextTradingRecommendation
  budgetVsActual: Array<{
    category: string
    month: string
    currency: string
    budget: number
    actual: number
    variance: number
    percentUsed: number
    overBudget: boolean
  }>
  tradingPerformance: {
    winRate: number
    avgProfit: number
    avgLoss: number
    avgProfitLossPerTrade: number
    profitFactor: number
    sharpeRatio: number
    maxDrawdown: number
    predictionAccuracy: number
    totalTrades: number
  }
  demoPerformance: {
    totalTrades: number
    winRate: number
    profitFactor: number
    avgProfitLossPerTrade: number
    avgProfit: number
    avgLoss: number
    sharpeRatio: number
    maxDrawdown: number
    totalFeesQuote: number
  }
  decisionQuality: DecisionQualityReport
  paperDecisionQuality: PaperDecisionQualityReport
  learning: LearningReport
  safeguardHistory: Array<SafeguardHistoryEntry>
  strategyCatalog: Array<StrategyCatalogEntry>
  strategyEligibilityAudit: StrategyEligibilityAudit
  strategyOverrides: {
    active: Array<StrategyOverride>
    history: Array<StrategyOverrideHistoryEntry>
  }
  sandboxExperiments: {
    active: Array<SandboxExperiment>
    history: Array<SandboxExperiment>
  }
  validationRuns: {
    active: Array<ValidationRunView>
    history: Array<ValidationRun>
  }
  validationReconciliation: {
    active: Array<ValidationReconciliation>
    history: Array<ValidationReconciliation>
  }
  lastCycleDiagnostics?: {
    ranAt: string
    executionMode?: string
    status: 'completed' | 'blocked' | 'data_error'
    reason: string | null
    symbols: Array<{
      symbol: string
      candles: number
      latestPrice: number | null
      strategySignals: Array<{
        strategyId: string
        signal: 'BUY' | 'SELL' | 'HOLD'
        confidence: number
        reason: string
      }>
      councilSignal: 'BUY' | 'SELL' | 'HOLD'
      councilNet: number
      councilReasons: Array<string>
      finalAction: 'OPEN' | 'CLOSE' | 'SKIP' | 'BLOCKED' | 'HOLD_FOR_RECOVERY' | null
      finalReason: string | null
    }>
  } | null
  tradingCycleDiagnosticTrends: Record<
    'paper' | 'sandbox',
    {
      stage: string
      cycles: number
      oldestAt: string | null
      newestAt: string | null
      statusCounts: Record<string, number>
      actionCounts: Record<string, number>
      councilCounts: Record<string, number>
      strategySignalCounts: Record<string, Record<string, number>>
      reasonCounts: Array<{ reason: string; count: number }>
    }
  >
  guardEvidence: Array<StrategyGuardReview>
  liveReadiness: {
    live: {
      allPassed: boolean
      blockers: Array<string>
      gates: Array<{
        id: string
        label: string
        pass: boolean
        detail: string
        evidenceAgeMs: number | null
      }>
      computedAt: string
    }
    stored: {
      snapshot: { allPassed: boolean; blockers: Array<string> } | null
      approval: { status: string; expiresAt: string | null } | null
    }
  }
  alerts: Array<{
    level: 'info' | 'warning' | 'critical'
    title: string
    detail: string
  }>
  settings: Record<string, unknown>
  data: {
    finance_accounts: Array<Record<string, unknown>>
    income_records: Array<Record<string, unknown>>
    expense_records: Array<Record<string, unknown>>
    budget_categories: Array<Record<string, unknown>>
    savings_goals: Array<Record<string, unknown>>
    tax_records: Array<Record<string, unknown>>
    trading_plans: Array<Record<string, unknown>>
    assets: Array<Record<string, unknown>>
    news_items: Array<Record<string, unknown>>
  }
}
