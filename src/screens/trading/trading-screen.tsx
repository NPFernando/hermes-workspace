import { useEffect, useMemo, useRef, useState } from 'react'
import { Area, AreaChart, ResponsiveContainer } from 'recharts'
import { useFinanceAction } from '../finance/hooks/use-finance-action'
import { StatCard } from '../finance/components/stat-card'
import { TradingSummaryStrip } from './components/trading-summary-strip'
import { AccountOverviewCard } from './components/account-overview-card'
import { RebalanceCard } from './components/rebalance-card'
import { LlmSignalCard } from './components/llm-signal-card'
import { DemoTradingPanel } from './demo-trading-panel'
import { GridTradingPanel } from './grid-trading-panel'
import { TradingLedgerPanel } from './components/trading-ledger-panel'
import { LiveReadinessCard } from './components/live-readiness-card'
import { formatFractionPct, formatUsdt } from './format-helpers'
import type { ReactNode } from 'react'

type DecisionQualityFinding = {
  severity: 'info' | 'warning' | 'critical'
  title: string
  detail: string
  evidenceCount?: number
}

type PaperDecisionQualityReport = {
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

type DecisionQualityReport = {
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

type SafeguardHistoryEntry = {
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

type LearningPolicy = {
  enabled: boolean
  autoApplyModes: Array<'paper_trade' | 'testnet_execute'>
  candidateMinBacktestFolds: number
  stabilityGate: 'conservative'
  livePromotionRequiresApproval: boolean
}

type LearningStabilityAssessment = {
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

type LearningConfigPatch = {
  quotePerTrade?: number
}

type LearningStrategyOverridePatch = {
  strategyId: string
  overrideAction: 'disabled' | 'reduce_size'
  multiplier: number | null
  reason: string
}

type LearningCandidateStatus =
  | 'proposed'
  | 'paper_applied'
  | 'testnet_applied'
  | 'testnet_ready'
  | 'live_review_ready'
  | 'rejected'
  | 'expired'

type LearningCandidate = {
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

type LearningReport = {
  checkedAt: string
  policy: LearningPolicy
  stability: LearningStabilityAssessment
  latestCandidate: LearningCandidate | null
  candidates: Array<LearningCandidate>
}

type LearningCycleResult = LearningReport & {
  generatedCandidate: LearningCandidate | null
  appliedCandidate: LearningCandidate | null
  skippedReason: string | null
}

type StrategyCatalogEntry = {
  id: string
  name: string
  description: string
}

type StrategyEligibilityAudit = {
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

type StrategyOverride = {
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

type StrategyOverrideHistoryEntry = {
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

type SandboxExperimentStatus =
  | 'active'
  | 'stopped'
  | 'expired'
  | 'trade_cap_reached'
  | 'rolled_back'

type SandboxExperiment = {
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

type ValidationStage = 'paper' | 'sandbox'
type ValidationRunStatus = 'active' | 'completed' | 'stopped' | 'expired'

type ReadinessGateLite = {
  id: string
  label: string
  pass: boolean
  detail: string
  evidenceAgeMs: number | null
}

type ValidationRunBudgets = {
  maxDurationMs: number
  maxCycles: number
  maxTrades: number
  maxExposureQuote: number
}

type ValidationRunBaseline = {
  equityQuote: number | null
  openPositions: number
  recordedAt: string
}

type ValidationRunProgress = {
  cyclesRun: number
  tradesOpened: number
  tradesClosed: number
  lastCycleAt: string | null
  lastCycleRan: boolean | null
  lastCycleReason: string | null
  currentExposureQuote: number
}

type ValidationRunEvidence = {
  ledgerRecordIds: Array<string>
  realizedPnlQuote: number
  feesQuote: number
  avgSlippageQuote: number | null
  shadowComparisonsSampled: number
  errors: Array<{ at: string; message: string }>
}

type ValidationRun = {
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

type ValidationRunView = ValidationRun & {
  liveReadinessImpact: ReadinessGateLite | null
}

type ValidationReconciliation = {
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

type StrategyEvidenceWindow = {
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

type StrategyGuardRecommendation =
  | 'insufficient_evidence'
  | 'monitor'
  | 'reduce_size_candidate'
  | 'disable_candidate'
  | 'recovered'

type StrategyGuardReview = {
  strategyId: string
  allTime: { trades: number; winRate: number; totalPnlQuote: number }
  window: StrategyEvidenceWindow
  recommendation: StrategyGuardRecommendation
  reason: string
  hasActiveGuardOrExperiment: boolean
}

type NextTradingRecommendation = {
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

type FinancePayload = {
  ok: boolean
  checkedAt: number
  storage: {
    active: string
    fallback: string
    jsonPath: string
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
      status:
        | 'healthy'
        | 'json_primary'
        | 'postgres_unavailable'
        | 'postgres_behind'
        | 'mirror_mismatch'
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

function NextRecommendationCard({
  recommendation,
}: {
  recommendation: NextTradingRecommendation
}) {
  const accent =
    recommendation.decision === 'live_requires_manual_review'
      ? 'amber'
      : recommendation.decision === 'sandbox_evidence_only'
        ? 'sky'
        : 'emerald'

  const accentClass =
    accent === 'amber'
      ? 'border-[color-mix(in_srgb,var(--theme-warning)_30%,transparent)] bg-[color-mix(in_srgb,var(--theme-warning)_10%,transparent)] text-[var(--theme-warning)]'
      : accent === 'sky'
        ? 'border-[color-mix(in_srgb,var(--theme-accent-secondary)_30%,transparent)] bg-[color-mix(in_srgb,var(--theme-accent-secondary)_10%,transparent)] text-[var(--theme-accent-secondary)]'
        : 'border-[color-mix(in_srgb,var(--theme-success)_30%,transparent)] bg-[color-mix(in_srgb,var(--theme-success)_10%,transparent)] text-[var(--theme-success)]'

  return (
    <section className="mt-6 rounded-3xl border border-[var(--theme-border)] bg-[var(--theme-panel)]/70 p-5">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-[var(--theme-muted)]">
            Next execution recommendation
          </p>
          <h2 className="mt-1 text-xl font-semibold">
            {recommendation.decision === 'stay_paper_only'
              ? 'Stay in paper mode'
              : recommendation.decision === 'sandbox_evidence_only'
                ? 'Stay in sandbox evidence mode'
                : 'Require manual live review'}
          </h2>
          <p className="mt-2 max-w-3xl text-sm leading-6 text-[var(--theme-muted)]">
            {recommendation.summary}
          </p>
        </div>
        <div className={`rounded-2xl border px-4 py-3 text-sm font-medium ${accentClass}`}>
          Current mode: <strong>{recommendation.currentMode}</strong>
        </div>
      </div>

      <div className="mt-4 grid gap-3 md:grid-cols-[1.2fr_0.8fr]">
        <div className="rounded-2xl border border-[var(--theme-border)]/70 bg-[color-mix(in_srgb,var(--theme-text)_7%,transparent)] p-3 text-sm text-[var(--theme-muted)]">
          <div className="font-medium text-[var(--theme-text)]">Recommended next action</div>
          <div className="mt-1 leading-6">{recommendation.nextAction}</div>
        </div>
        <div className="rounded-2xl border border-[var(--theme-border)]/70 bg-[color-mix(in_srgb,var(--theme-text)_7%,transparent)] p-3 text-sm text-[var(--theme-muted)]">
          <div className="font-medium text-[var(--theme-text)]">Safe sandbox caps</div>
          <div className="mt-1">
            {recommendation.safeSandboxCaps.durationMinutes} min ·{' '}
            {recommendation.safeSandboxCaps.maxCycles} cycles ·{' '}
            {recommendation.safeSandboxCaps.maxTrades} trades ·{' '}
            ${recommendation.safeSandboxCaps.maxExposureUsdt} max exposure
          </div>
          <div className="mt-2 text-xs uppercase tracking-[0.12em] text-[var(--theme-muted)]">
            {recommendation.requiresExplicitApproval
              ? 'Explicit approval required'
              : 'No approval required'}
          </div>
        </div>
      </div>
    </section>
  )
}

const modules = [
  'Accounts, income, expenses, transfers, liabilities',
  'Budgets, cash-flow, recurring bills, low-balance alerts',
  'Savings goals, tax reserve, monthly progress tracking',
  'Tax records with LKR conversion and confirmation flags',
  'Binance market observation, paper trading, testnet, and gated live spot',
  'IBKR parked as a future feature and no longer blocks finance work',
  'News, sentiment, risk scoring, decision logging',
  'Paper/testnet/live Binance modes with emergency stop and shadow paper tracking',
]

const phases = [
  'Phase 1: finance records and secure local database — active',
  'Phase 2: Binance-first market observation and trading engine — active',
  'Phase 3: news and risk engine — data model ready',
  'Phase 4: paper trading and shadow learning loop — active',
  'Phase 5+: Binance testnet/live modes — gated by explicit approval',
]

function formatDateTime(value: string): string {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  return date.toLocaleString()
}

function overrideLifecycleLabel(
  override: Pick<StrategyOverride, 'reviewAt' | 'expiresAt'>,
): string {
  const review = override.reviewAt
    ? `Review ${formatDateTime(override.reviewAt)}`
    : null
  const expires = override.expiresAt
    ? `Expires ${formatDateTime(override.expiresAt)}`
    : null
  return [review, expires].filter(Boolean).join(' · ')
}

function DashboardGroup({
  title,
  description,
  children,
}: {
  title: string
  description: string
  children: ReactNode
}) {
  return (
    <section className="mt-8">
      <div className="mb-3 px-1">
        <h2 className="text-xl font-semibold">{title}</h2>
        <p className="mt-1 text-sm text-[var(--theme-muted)]">{description}</p>
      </div>
      <div className="space-y-4">{children}</div>
    </section>
  )
}

function AdvancedDashboardGroup({
  title,
  description,
  children,
}: {
  title: string
  description: string
  children: ReactNode
}) {
  return (
    <details className="mt-8 group">
      <summary className="cursor-pointer list-none rounded-2xl border border-[var(--theme-border)] bg-[var(--theme-panel)]/70 px-4 py-3 transition hover:bg-[color-mix(in_srgb,var(--theme-text)_8%,transparent)]">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <h2 className="text-lg font-semibold">{title}</h2>
            <p className="mt-1 text-sm text-[var(--theme-muted)]">
              {description}
            </p>
          </div>
          <span className="text-xs text-[var(--theme-muted)] group-open:hidden">
            Expand
          </span>
          <span className="hidden text-xs text-[var(--theme-muted)] group-open:inline">
            Collapse
          </span>
        </div>
      </summary>
      <div className="space-y-4 pt-1">{children}</div>
    </details>
  )
}

type CsvValue = string | number | boolean | null | undefined

function csvValue(value: CsvValue): string {
  if (value == null) return ''
  const text = String(value)
  return /[",\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text
}

function downloadCsv(filename: string, rows: Array<Record<string, CsvValue>>) {
  if (rows.length === 0 || typeof document === 'undefined') return
  const headers = Object.keys(rows[0])
  const csv = [
    headers.map(csvValue).join(','),
    ...rows.map((row) =>
      headers.map((header) => csvValue(row[header])).join(','),
    ),
  ].join('\n')
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = filename
  document.body.appendChild(link)
  link.click()
  link.remove()
  URL.revokeObjectURL(url)
}

function csvDateSuffix() {
  return new Date().toISOString().slice(0, 10)
}

function SafeguardHistoryPanel({
  rows,
}: {
  rows: Array<SafeguardHistoryEntry>
}) {
  function exportRows() {
    downloadCsv(
      `finance-safeguard-history-${csvDateSuffix()}.csv`,
      rows.map((row) => ({
        id: row.id,
        appliedAt: row.appliedAt,
        status: row.status,
        recommendedMode: row.recommendedMode,
        appliedTradingMode: row.appliedTradingMode,
        executionAccount: row.executionAccount,
        liveTradingEnabled: row.liveTradingEnabled,
        baseQuotePerTrade: row.baseQuotePerTrade,
        previousQuotePerTrade: row.previousQuotePerTrade,
        appliedQuotePerTrade: row.appliedQuotePerTrade,
        positionSizeMultiplier: row.positionSizeMultiplier,
        pauseLive: row.pauseLive,
        liveRecommendationDeferred: row.liveRecommendationDeferred,
        reasonSummary: row.reasonSummary,
      })),
    )
  }

  return (
    <section className="mt-6 rounded-3xl border border-[var(--theme-border)] bg-[var(--theme-panel)]/70 p-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold">Safeguard history</h2>
          <p className="text-xs text-[var(--theme-muted)]">
            Applied decision-quality adjustments and the mode/size they
            enforced.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <span className="rounded-full border border-[var(--theme-border)] px-2.5 py-1 text-xs text-[var(--theme-muted)]">
            {rows.length} records
          </span>
          <button
            type="button"
            disabled={rows.length === 0}
            onClick={exportRows}
            className="rounded-xl border border-[var(--theme-border)] bg-[color-mix(in_srgb,var(--theme-text)_8%,transparent)] px-3 py-1.5 text-xs font-medium text-[var(--theme-text)] hover:bg-[color-mix(in_srgb,var(--theme-text)_16%,transparent)] disabled:opacity-40"
          >
            Export CSV
          </button>
        </div>
      </div>

      {rows.length === 0 ? (
        <p className="mt-4 rounded-2xl border border-[var(--theme-border)] bg-[color-mix(in_srgb,var(--theme-text)_8%,transparent)] p-3 text-sm text-[var(--theme-muted)]">
          No safeguards have been applied yet.
        </p>
      ) : (
        <div className="mt-4 overflow-x-auto">
          <table className="w-full min-w-[900px] text-left text-sm">
            <thead className="text-xs uppercase tracking-[0.18em] text-[var(--theme-muted)]">
              <tr>
                <th className="border-b border-[var(--theme-border)] py-2 pr-4">
                  Applied
                </th>
                <th className="border-b border-[var(--theme-border)] py-2 pr-4">
                  Status
                </th>
                <th className="border-b border-[var(--theme-border)] py-2 pr-4">
                  Mode
                </th>
                <th className="border-b border-[var(--theme-border)] py-2 pr-4">
                  Account
                </th>
                <th className="border-b border-[var(--theme-border)] py-2 pr-4">
                  Size
                </th>
                <th className="border-b border-[var(--theme-border)] py-2 pr-4">
                  Multiplier
                </th>
                <th className="border-b border-[var(--theme-border)] py-2 pr-4">
                  Live
                </th>
                <th className="border-b border-[var(--theme-border)] py-2 pr-4">
                  Reason
                </th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.id} className="align-top text-[var(--theme-text)]">
                  <td className="whitespace-nowrap border-b border-[var(--theme-border)]/60 py-2 pr-4">
                    {formatDateTime(row.appliedAt)}
                  </td>
                  <td className="whitespace-nowrap border-b border-[var(--theme-border)]/60 py-2 pr-4 capitalize">
                    {row.status.replace(/_/g, ' ')}
                  </td>
                  <td className="whitespace-nowrap border-b border-[var(--theme-border)]/60 py-2 pr-4">
                    {row.appliedTradingMode}
                    {row.liveRecommendationDeferred ? (
                      <span className="ml-2 rounded-full border border-[color-mix(in_srgb,var(--theme-warning)_25%,transparent)] bg-[color-mix(in_srgb,var(--theme-warning)_10%,transparent)] px-2 py-0.5 text-[10px] text-[var(--theme-warning)]">
                        live deferred
                      </span>
                    ) : null}
                  </td>
                  <td className="whitespace-nowrap border-b border-[var(--theme-border)]/60 py-2 pr-4">
                    {row.executionAccount}
                  </td>
                  <td className="whitespace-nowrap border-b border-[var(--theme-border)]/60 py-2 pr-4">
                    {formatUsdt(row.appliedQuotePerTrade)}
                    <span className="block text-xs text-[var(--theme-muted)]">
                      base {formatUsdt(row.baseQuotePerTrade)}
                    </span>
                  </td>
                  <td className="whitespace-nowrap border-b border-[var(--theme-border)]/60 py-2 pr-4">
                    {row.positionSizeMultiplier.toFixed(2)}x
                  </td>
                  <td className="whitespace-nowrap border-b border-[var(--theme-border)]/60 py-2 pr-4">
                    {row.liveTradingEnabled
                      ? 'enabled'
                      : row.pauseLive
                        ? 'paused'
                        : 'off'}
                  </td>
                  <td className="max-w-[360px] border-b border-[var(--theme-border)]/60 py-2 pr-4 text-xs text-[var(--theme-muted)]">
                    {row.reasonSummary}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  )
}

function StrategyOverridePanel({
  catalog,
  state,
  onPayload,
}: {
  catalog: Array<StrategyCatalogEntry>
  state: FinancePayload['strategyOverrides']
  onPayload: (payload: FinancePayload) => void
}) {
  const { run, busy, error } = useFinanceAction<
    FinancePayload & { strategyOverrideResult?: { message: string } }
  >(onPayload)
  const [message, setMessage] = useState<string | null>(null)
  const [expiresAfterDays, setExpiresAfterDays] = useState(7)
  const activeByStrategy = useMemo(
    () =>
      new Map(state.active.map((override) => [override.strategyId, override])),
    [state.active],
  )

  function exportHistory() {
    downloadCsv(
      `finance-strategy-override-history-${csvDateSuffix()}.csv`,
      [...state.history].reverse().map((row) => ({
        id: row.id,
        at: row.at,
        strategyId: row.strategyId,
        action: row.action,
        previousMode: row.previousMode,
        mode: row.mode,
        previousMultiplier: row.previousMultiplier,
        multiplier: row.multiplier,
        previousReviewAt: row.previousReviewAt,
        reviewAt: row.reviewAt,
        previousExpiresAt: row.previousExpiresAt,
        expiresAt: row.expiresAt,
        reason: row.reason,
        activeOverrideId: row.activeOverrideId,
      })),
    )
  }

  async function setOverride(
    strategyId: string,
    overrideAction: 'disabled' | 'reduce_size' | 'clear',
    multiplier?: number,
  ) {
    if (overrideAction === 'clear') {
      const confirmed = window.confirm(`Re-enable ${strategyId}?`)
      if (!confirmed) return
    }
    setMessage(null)
    const data = await run(
      {
        action: 'set_strategy_override',
        strategyId,
        overrideAction,
        multiplier,
        ...(overrideAction === 'clear'
          ? {}
          : {
              reviewAfterDays: Math.max(1, Math.floor(expiresAfterDays / 2)),
              expiresAfterDays,
            }),
        reason:
          overrideAction === 'disabled'
            ? 'Manual disable from Finance UI.'
            : overrideAction === 'reduce_size'
              ? `Manual ${multiplier?.toFixed(2) ?? '0.50'}x size reduction from Finance UI.`
              : 'Manual re-enable from Finance UI.',
      },
      `${strategyId}:${overrideAction}:${multiplier ?? ''}`,
    )
    if (data) {
      setMessage(
        data.strategyOverrideResult?.message ?? 'Strategy override updated.',
      )
    }
  }

  const modeLabel = (override: StrategyOverride | undefined) => {
    if (!override) return 'normal'
    if (override.mode === 'disabled') return 'disabled'
    return `${override.multiplier.toFixed(2)}x size`
  }

  return (
    <section className="mt-6 rounded-3xl border border-[var(--theme-border)] bg-[var(--theme-panel)]/70 p-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold">Strategy overrides</h2>
          <p className="text-xs text-[var(--theme-muted)]">
            Manual controls applied before any strategy can lead a new entry.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <label className="flex items-center gap-2 rounded-xl border border-[var(--theme-border)] bg-[color-mix(in_srgb,var(--theme-text)_8%,transparent)] px-3 py-1.5 text-xs text-[var(--theme-muted)]">
            Duration
            <select
              value={expiresAfterDays}
              onChange={(event) =>
                setExpiresAfterDays(Number(event.target.value))
              }
              className="bg-transparent text-[var(--theme-text)] outline-none"
            >
              <option value={3}>3 days</option>
              <option value={7}>7 days</option>
              <option value={14}>14 days</option>
              <option value={30}>30 days</option>
            </select>
          </label>
          <span className="rounded-full border border-[var(--theme-border)] px-2.5 py-1 text-xs text-[var(--theme-muted)]">
            {state.active.length} active
          </span>
          <button
            type="button"
            disabled={state.history.length === 0}
            onClick={exportHistory}
            className="rounded-xl border border-[var(--theme-border)] bg-[color-mix(in_srgb,var(--theme-text)_8%,transparent)] px-3 py-1.5 text-xs font-medium text-[var(--theme-text)] hover:bg-[color-mix(in_srgb,var(--theme-text)_16%,transparent)] disabled:opacity-40"
          >
            Export CSV
          </button>
        </div>
      </div>

      {(message || error) && (
        <p
          className={`mt-3 rounded-xl border p-2 text-sm ${error ? 'border-[color-mix(in_srgb,var(--theme-danger)_30%,transparent)] bg-[color-mix(in_srgb,var(--theme-danger)_10%,transparent)] text-[var(--theme-danger)]' : 'border-[color-mix(in_srgb,var(--theme-success)_30%,transparent)] bg-[color-mix(in_srgb,var(--theme-success)_10%,transparent)] text-[var(--theme-success)]'}`}
        >
          {error ?? message}
        </p>
      )}

      <div className="mt-4 grid gap-3 lg:grid-cols-2">
        {catalog.map((strategy) => {
          const override = activeByStrategy.get(strategy.id)
          const disabled = busy !== null
          return (
            <div
              key={strategy.id}
              className="rounded-2xl border border-[var(--theme-border)]/70 bg-[color-mix(in_srgb,var(--theme-text)_8%,transparent)] p-4"
            >
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div>
                  <h3 className="text-sm font-semibold">{strategy.name}</h3>
                  <p className="mt-1 text-xs text-[var(--theme-muted)]">
                    {strategy.id}
                  </p>
                </div>
                <span
                  className={`rounded-full border px-2.5 py-1 text-xs ${
                    override?.mode === 'disabled'
                      ? 'border-[color-mix(in_srgb,var(--theme-danger)_30%,transparent)] bg-[color-mix(in_srgb,var(--theme-danger)_10%,transparent)] text-[var(--theme-danger)]'
                      : override?.mode === 'reduce_size'
                        ? 'border-[color-mix(in_srgb,var(--theme-warning)_30%,transparent)] bg-[color-mix(in_srgb,var(--theme-warning)_10%,transparent)] text-[var(--theme-warning)]'
                        : 'border-[color-mix(in_srgb,var(--theme-success)_25%,transparent)] bg-[color-mix(in_srgb,var(--theme-success)_10%,transparent)] text-[var(--theme-success)]'
                  }`}
                >
                  {modeLabel(override)}
                  {override?.source === 'automatic' ? ' · auto' : ''}
                  {override?.source === 'experiment' ? ' · experiment' : ''}
                </span>
              </div>
              <p className="mt-2 text-xs leading-5 text-[var(--theme-muted)]">
                {strategy.description}
              </p>
              {override ? (
                <p className="mt-2 text-xs text-[var(--theme-muted)]">
              {override.source === 'automatic' ? 'Automatic guard · ' : ''}
              {override.source === 'experiment' ? 'Sandbox experiment · ' : ''}
              {override.reason} ·{' '}
              Updated {formatDateTime(override.updatedAt)}
                  {overrideLifecycleLabel(override)
                    ? ` · ${overrideLifecycleLabel(override)}`
                    : ''}
                </p>
              ) : null}
              <div className="mt-4 flex flex-wrap gap-2">
                <button
                  type="button"
                  disabled={disabled}
                  onClick={() =>
                    void setOverride(strategy.id, 'reduce_size', 0.5)
                  }
                  className="rounded-xl border border-[color-mix(in_srgb,var(--theme-warning)_30%,transparent)] bg-[color-mix(in_srgb,var(--theme-warning)_10%,transparent)] px-3 py-2 text-xs font-medium text-[var(--theme-warning)] hover:bg-[color-mix(in_srgb,var(--theme-warning)_20%,transparent)] disabled:opacity-50"
                >
                  50% size
                </button>
                <button
                  type="button"
                  disabled={disabled}
                  onClick={() =>
                    void setOverride(strategy.id, 'reduce_size', 0.25)
                  }
                  className="rounded-xl border border-[color-mix(in_srgb,var(--theme-warning)_30%,transparent)] bg-[color-mix(in_srgb,var(--theme-warning)_10%,transparent)] px-3 py-2 text-xs font-medium text-[var(--theme-warning)] hover:bg-[color-mix(in_srgb,var(--theme-warning)_20%,transparent)] disabled:opacity-50"
                >
                  25% size
                </button>
                <button
                  type="button"
                  disabled={disabled}
                  onClick={() => void setOverride(strategy.id, 'disabled')}
                  className="rounded-xl border border-[color-mix(in_srgb,var(--theme-danger)_30%,transparent)] bg-[color-mix(in_srgb,var(--theme-danger)_10%,transparent)] px-3 py-2 text-xs font-medium text-[var(--theme-danger)] hover:bg-[color-mix(in_srgb,var(--theme-danger)_20%,transparent)] disabled:opacity-50"
                >
                  Disable
                </button>
                <button
                  type="button"
                  disabled={disabled || !override}
                  onClick={() => void setOverride(strategy.id, 'clear')}
                  className="rounded-xl border border-[color-mix(in_srgb,var(--theme-success)_30%,transparent)] bg-[color-mix(in_srgb,var(--theme-success)_10%,transparent)] px-3 py-2 text-xs font-medium text-[var(--theme-success)] hover:bg-[color-mix(in_srgb,var(--theme-success)_20%,transparent)] disabled:opacity-40"
                >
                  Re-enable
                </button>
              </div>
            </div>
          )
        })}
      </div>

      <div className="mt-5 overflow-x-auto">
        <table className="w-full min-w-[960px] text-left text-sm">
          <thead className="text-xs uppercase tracking-[0.18em] text-[var(--theme-muted)]">
            <tr>
              <th className="border-b border-[var(--theme-border)] py-2 pr-4">
                Time
              </th>
              <th className="border-b border-[var(--theme-border)] py-2 pr-4">
                Strategy
              </th>
              <th className="border-b border-[var(--theme-border)] py-2 pr-4">
                Action
              </th>
              <th className="border-b border-[var(--theme-border)] py-2 pr-4">
                Multiplier
              </th>
              <th className="border-b border-[var(--theme-border)] py-2 pr-4">
                Review
              </th>
              <th className="border-b border-[var(--theme-border)] py-2 pr-4">
                Expires
              </th>
              <th className="border-b border-[var(--theme-border)] py-2 pr-4">
                Reason
              </th>
            </tr>
          </thead>
          <tbody>
            {state.history.length === 0 ? (
              <tr>
                <td
                  colSpan={7}
                  className="border-b border-[var(--theme-border)]/60 py-3 pr-4 text-sm text-[var(--theme-muted)]"
                >
                  No override history yet.
                </td>
              </tr>
            ) : (
              [...state.history]
                .reverse()
                .slice(0, 8)
                .map((row) => (
                  <tr
                    key={row.id}
                    className="align-top text-[var(--theme-text)]"
                  >
                    <td className="whitespace-nowrap border-b border-[var(--theme-border)]/60 py-2 pr-4">
                      {formatDateTime(row.at)}
                    </td>
                    <td className="whitespace-nowrap border-b border-[var(--theme-border)]/60 py-2 pr-4">
                      {row.strategyId}
                    </td>
                    <td className="whitespace-nowrap border-b border-[var(--theme-border)]/60 py-2 pr-4">
                      {row.action.replace(/_/g, ' ')}
                    </td>
                    <td className="whitespace-nowrap border-b border-[var(--theme-border)]/60 py-2 pr-4">
                      {row.multiplier ? `${row.multiplier.toFixed(2)}x` : '-'}
                    </td>
                    <td className="whitespace-nowrap border-b border-[var(--theme-border)]/60 py-2 pr-4">
                      {row.reviewAt ? formatDateTime(row.reviewAt) : '-'}
                    </td>
                    <td className="whitespace-nowrap border-b border-[var(--theme-border)]/60 py-2 pr-4">
                      {row.expiresAt ? formatDateTime(row.expiresAt) : '-'}
                    </td>
                    <td className="max-w-[360px] border-b border-[var(--theme-border)]/60 py-2 pr-4 text-xs text-[var(--theme-muted)]">
                      {row.reason}
                    </td>
                  </tr>
                ))
            )}
          </tbody>
        </table>
      </div>
    </section>
  )
}

const GUARD_RECOMMENDATION_LABEL: Record<StrategyGuardRecommendation, string> = {
  insufficient_evidence: 'Insufficient evidence',
  monitor: 'Monitor',
  reduce_size_candidate: 'Reduce-size candidate',
  disable_candidate: 'Disable candidate',
  recovered: 'Recovered',
}

function guardRecommendationTone(
  recommendation: StrategyGuardRecommendation,
): 'good' | 'warn' | 'danger' | 'neutral' {
  if (recommendation === 'disable_candidate') return 'danger'
  if (recommendation === 'reduce_size_candidate') return 'warn'
  if (recommendation === 'recovered') return 'good'
  return 'neutral'
}

/**
 * Evidence-driven guard review: shows a bounded recent window (separate
 * from the all-time score) per enabled strategy, an explicit insufficient-
 * evidence gate, and a recommendation the operator can act on via the
 * strategy override buttons above or a sandbox experiment below.
 */
function GuardEvidencePanel({ evidence }: { evidence: Array<StrategyGuardReview> }) {
  const pct = formatFractionPct
  const usdt = formatUsdt
  return (
    <section className="mt-6 rounded-3xl border border-[var(--theme-border)] bg-[var(--theme-panel)]/70 p-5">
      <div>
        <h2 className="text-lg font-semibold">Guard evidence review</h2>
        <p className="text-xs text-[var(--theme-muted)]">
          Recent-window evidence per enabled strategy, separate from its
          all-time score — never recommends acting below the configured
          minimum sample.
        </p>
      </div>
      {evidence.length === 0 ? (
        <p className="mt-4 text-sm text-[var(--theme-muted)]">
          No enabled strategies to review.
        </p>
      ) : (
        <div className="mt-4 grid gap-3 lg:grid-cols-2">
          {evidence.map((entry) => (
            <div
              key={entry.strategyId}
              className="rounded-2xl border border-[var(--theme-border)]/70 bg-[color-mix(in_srgb,var(--theme-text)_8%,transparent)] p-4"
            >
              <div className="flex flex-wrap items-start justify-between gap-2">
                <h3 className="text-sm font-semibold">{entry.strategyId}</h3>
                <StatCard
                  label="Recommendation"
                  value={GUARD_RECOMMENDATION_LABEL[entry.recommendation]}
                  tone={guardRecommendationTone(entry.recommendation)}
                />
              </div>
              <p className="mt-2 text-xs leading-5 text-[var(--theme-muted)]">
                {entry.reason}
              </p>
              <div className="mt-3 grid grid-cols-2 gap-2 text-xs text-[var(--theme-muted)] sm:grid-cols-4">
                <div>
                  <div className="uppercase tracking-[0.16em]">Window</div>
                  <div className="text-[var(--theme-text)]">
                    {entry.window.windowDays}d · {entry.window.closedTrades} trades
                  </div>
                </div>
                <div>
                  <div className="uppercase tracking-[0.16em]">Win rate</div>
                  <div className="text-[var(--theme-text)]">
                    {pct(entry.window.winRate)}
                  </div>
                </div>
                <div>
                  <div className="uppercase tracking-[0.16em]">Realized</div>
                  <div className="text-[var(--theme-text)]">
                    {usdt(entry.window.realizedPnlQuote)}
                  </div>
                </div>
                <div>
                  <div className="uppercase tracking-[0.16em]">All-time</div>
                  <div className="text-[var(--theme-text)]">
                    {entry.allTime.trades} trades · {pct(entry.allTime.winRate)}
                  </div>
                </div>
              </div>
              <p className="mt-2 text-xs text-[var(--theme-muted)]">
                Recovered {entry.window.recoveredTrades} · forced-close{' '}
                {entry.window.forcedCloseTrades} in this window
                {entry.hasActiveGuardOrExperiment
                  ? ' · guard/experiment currently active'
                  : ''}
              </p>
            </div>
          ))}
        </div>
      )}
    </section>
  )
}

const EXPERIMENT_STATUS_LABEL: Record<SandboxExperimentStatus, string> = {
  active: 'Active',
  stopped: 'Stopped',
  expired: 'Expired',
  trade_cap_reached: 'Trade cap reached',
  rolled_back: 'Rolled back',
}

function experimentStatusTone(
  status: SandboxExperimentStatus,
): 'good' | 'warn' | 'danger' | 'neutral' {
  if (status === 'active') return 'good'
  if (status === 'expired' || status === 'trade_cap_reached') return 'warn'
  if (status === 'rolled_back') return 'neutral'
  return 'neutral'
}

/**
 * Bounded, sandbox-only (paper/testnet) size-reduction experiments.
 * Start requires a finite time and/or trade budget — never unbounded — and
 * is rejected server-side over an existing manual override or another
 * active experiment on the same strategy. Stop/rollback restore the exact
 * pre-experiment override baseline; re-arm starts a fresh experiment with
 * the same parameters after review.
 */
function SandboxExperimentPanel({
  catalog,
  state,
  onPayload,
}: {
  catalog: Array<StrategyCatalogEntry>
  state: FinancePayload['sandboxExperiments']
  onPayload: (payload: FinancePayload) => void
}) {
  const { run, busy, error } = useFinanceAction<
    FinancePayload & {
      sandboxExperimentResult?: { message: string }
    }
  >(onPayload)
  const [message, setMessage] = useState<string | null>(null)
  const [selectedStrategyId, setSelectedStrategyId] = useState(
    catalog[0]?.id ?? '',
  )
  const [executionMode, setExecutionMode] = useState<'paper' | 'testnet'>(
    'testnet',
  )
  const [durationHours, setDurationHours] = useState(24)
  const [tradeCap, setTradeCap] = useState(10)
  const [sizeMultiplierCap, setSizeMultiplierCap] = useState(0.5)
  const [reason, setReason] = useState('')

  async function submit(
    action:
      | 'start_sandbox_experiment'
      | 'stop_sandbox_experiment'
      | 'rollback_sandbox_experiment'
      | 'rearm_sandbox_experiment',
    body: Record<string, unknown>,
    busyKey: string,
  ) {
    setMessage(null)
    const data = await run({ action, ...body }, busyKey)
    if (data) {
      setMessage(
        data.sandboxExperimentResult?.message ??
          'Sandbox experiment updated.',
      )
    }
  }

  async function startExperiment() {
    if (!selectedStrategyId) return
    await submit(
      'start_sandbox_experiment',
      {
        strategyIds: [selectedStrategyId],
        executionMode,
        durationMinutes: durationHours > 0 ? durationHours * 60 : undefined,
        tradeCap: tradeCap > 0 ? tradeCap : undefined,
        sizeMultiplierCap,
        reason: reason.trim() || undefined,
      },
      'start',
    )
  }

  async function stopExperiment(id: string) {
    const confirmed = window.confirm('Stop this experiment and restore its baseline now?')
    if (!confirmed) return
    await submit('stop_sandbox_experiment', { experimentId: id }, `stop:${id}`)
  }

  async function rollbackExperiment(id: string) {
    await submit(
      'rollback_sandbox_experiment',
      { experimentId: id },
      `rollback:${id}`,
    )
  }

  async function rearmExperiment(id: string) {
    await submit('rearm_sandbox_experiment', { experimentId: id }, `rearm:${id}`)
  }

  function budgetLabel(experiment: SandboxExperiment): string {
    const parts: Array<string> = []
    if (experiment.endsAt) parts.push(`ends ${formatDateTime(experiment.endsAt)}`)
    if (experiment.tradeCap != null)
      parts.push(`${experiment.tradesObserved}/${experiment.tradeCap} trades`)
    return parts.join(' · ') || 'no budget set'
  }

  return (
    <section className="mt-6 rounded-3xl border border-[var(--theme-border)] bg-[var(--theme-panel)]/70 p-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold">Sandbox experiments</h2>
          <p className="text-xs text-[var(--theme-muted)]">
            Finite-duration/trade-cap, paper/testnet-only size-reduction
            trials with a recorded baseline and automatic rollback.
          </p>
        </div>
        <span className="rounded-full border border-[var(--theme-border)] px-2.5 py-1 text-xs text-[var(--theme-muted)]">
          {state.active.length} active
        </span>
      </div>

      {(message || error) && (
        <p
          className={`mt-3 rounded-xl border p-2 text-sm ${error ? 'border-[color-mix(in_srgb,var(--theme-danger)_30%,transparent)] bg-[color-mix(in_srgb,var(--theme-danger)_10%,transparent)] text-[var(--theme-danger)]' : 'border-[color-mix(in_srgb,var(--theme-success)_30%,transparent)] bg-[color-mix(in_srgb,var(--theme-success)_10%,transparent)] text-[var(--theme-success)]'}`}
        >
          {error ?? message}
        </p>
      )}

      <div className="mt-4 grid gap-2 rounded-2xl border border-[var(--theme-border)]/70 bg-[color-mix(in_srgb,var(--theme-text)_8%,transparent)] p-4 sm:grid-cols-2 lg:grid-cols-6">
        <label className="flex flex-col gap-1 text-xs text-[var(--theme-muted)]">
          Strategy
          <select
            value={selectedStrategyId}
            onChange={(event) => setSelectedStrategyId(event.target.value)}
            className="rounded-xl border border-[var(--theme-border)] bg-transparent px-2 py-1.5 text-[var(--theme-text)] outline-none"
          >
            {catalog.map((strategy) => (
              <option key={strategy.id} value={strategy.id}>
                {strategy.name}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1 text-xs text-[var(--theme-muted)]">
          Mode
          <select
            value={executionMode}
            onChange={(event) =>
              setExecutionMode(event.target.value as 'paper' | 'testnet')
            }
            className="rounded-xl border border-[var(--theme-border)] bg-transparent px-2 py-1.5 text-[var(--theme-text)] outline-none"
          >
            <option value="testnet">Testnet</option>
            <option value="paper">Paper</option>
          </select>
        </label>
        <label className="flex flex-col gap-1 text-xs text-[var(--theme-muted)]">
          Duration (hours, 0=none)
          <input
            type="number"
            min={0}
            value={durationHours}
            onChange={(event) => setDurationHours(Number(event.target.value))}
            className="rounded-xl border border-[var(--theme-border)] bg-transparent px-2 py-1.5 text-[var(--theme-text)] outline-none"
          />
        </label>
        <label className="flex flex-col gap-1 text-xs text-[var(--theme-muted)]">
          Trade cap (0=none)
          <input
            type="number"
            min={0}
            value={tradeCap}
            onChange={(event) => setTradeCap(Number(event.target.value))}
            className="rounded-xl border border-[var(--theme-border)] bg-transparent px-2 py-1.5 text-[var(--theme-text)] outline-none"
          />
        </label>
        <label className="flex flex-col gap-1 text-xs text-[var(--theme-muted)]">
          Size cap
          <select
            value={sizeMultiplierCap}
            onChange={(event) => setSizeMultiplierCap(Number(event.target.value))}
            className="rounded-xl border border-[var(--theme-border)] bg-transparent px-2 py-1.5 text-[var(--theme-text)] outline-none"
          >
            <option value={1}>1.00x (track only)</option>
            <option value={0.5}>0.50x</option>
            <option value={0.25}>0.25x</option>
            <option value={0.1}>0.10x</option>
          </select>
        </label>
        <label className="flex flex-col gap-1 text-xs text-[var(--theme-muted)]">
          Reason
          <input
            type="text"
            value={reason}
            onChange={(event) => setReason(event.target.value)}
            placeholder="Optional"
            className="rounded-xl border border-[var(--theme-border)] bg-transparent px-2 py-1.5 text-[var(--theme-text)] outline-none"
          />
        </label>
        <div className="lg:col-span-6">
          <button
            type="button"
            disabled={busy !== null || !selectedStrategyId}
            onClick={() => void startExperiment()}
            className="rounded-xl border border-[color-mix(in_srgb,var(--theme-success)_30%,transparent)] bg-[color-mix(in_srgb,var(--theme-success)_10%,transparent)] px-3 py-2 text-xs font-medium text-[var(--theme-success)] hover:bg-[color-mix(in_srgb,var(--theme-success)_20%,transparent)] disabled:opacity-50"
          >
            Start experiment
          </button>
        </div>
      </div>

      <div className="mt-5">
        <h3 className="text-sm font-semibold">Active</h3>
        {state.active.length === 0 ? (
          <p className="mt-2 text-xs text-[var(--theme-muted)]">
            No active sandbox experiments.
          </p>
        ) : (
          <div className="mt-2 grid gap-3 lg:grid-cols-2">
            {state.active.map((experiment) => (
              <div
                key={experiment.id}
                className="rounded-2xl border border-[var(--theme-border)]/70 bg-[color-mix(in_srgb,var(--theme-text)_8%,transparent)] p-4"
              >
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <h4 className="text-sm font-semibold">{experiment.label}</h4>
                  <StatCard
                    label="Status"
                    value={EXPERIMENT_STATUS_LABEL[experiment.status]}
                    tone={experimentStatusTone(experiment.status)}
                  />
                </div>
                <p className="mt-2 text-xs text-[var(--theme-muted)]">
                  {experiment.strategyIds.join(', ')} · {experiment.executionMode} ·{' '}
                  {experiment.sizeMultiplierCap.toFixed(2)}x cap
                </p>
                <p className="mt-1 text-xs text-[var(--theme-muted)]">
                  {budgetLabel(experiment)}
                </p>
                <p className="mt-1 text-xs text-[var(--theme-muted)]">
                  {experiment.reason}
                </p>
                <div className="mt-3 flex flex-wrap gap-2">
                  <button
                    type="button"
                    disabled={busy !== null}
                    onClick={() => void stopExperiment(experiment.id)}
                    className="rounded-xl border border-[color-mix(in_srgb,var(--theme-warning)_30%,transparent)] bg-[color-mix(in_srgb,var(--theme-warning)_10%,transparent)] px-3 py-2 text-xs font-medium text-[var(--theme-warning)] hover:bg-[color-mix(in_srgb,var(--theme-warning)_20%,transparent)] disabled:opacity-50"
                  >
                    Stop &amp; roll back
                  </button>
                  <button
                    type="button"
                    disabled={busy !== null}
                    onClick={() => void rollbackExperiment(experiment.id)}
                    className="rounded-xl border border-[color-mix(in_srgb,var(--theme-danger)_30%,transparent)] bg-[color-mix(in_srgb,var(--theme-danger)_10%,transparent)] px-3 py-2 text-xs font-medium text-[var(--theme-danger)] hover:bg-[color-mix(in_srgb,var(--theme-danger)_20%,transparent)] disabled:opacity-50"
                  >
                    Emergency rollback
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="mt-5">
        <h3 className="text-sm font-semibold">History</h3>
        {state.history.length === 0 ? (
          <p className="mt-2 text-xs text-[var(--theme-muted)]">
            No ended sandbox experiments yet.
          </p>
        ) : (
          <div className="mt-2 overflow-x-auto">
            <table className="w-full min-w-[900px] text-left text-sm">
              <thead className="text-xs uppercase tracking-[0.18em] text-[var(--theme-muted)]">
                <tr>
                  <th className="border-b border-[var(--theme-border)] py-2 pr-4">Label</th>
                  <th className="border-b border-[var(--theme-border)] py-2 pr-4">Status</th>
                  <th className="border-b border-[var(--theme-border)] py-2 pr-4">Strategies</th>
                  <th className="border-b border-[var(--theme-border)] py-2 pr-4">Ended</th>
                  <th className="border-b border-[var(--theme-border)] py-2 pr-4">Trades</th>
                  <th className="border-b border-[var(--theme-border)] py-2 pr-4">Actions</th>
                </tr>
              </thead>
              <tbody>
                {[...state.history]
                  .reverse()
                  .slice(0, 8)
                  .map((experiment) => (
                    <tr key={experiment.id} className="align-top text-[var(--theme-text)]">
                      <td className="whitespace-nowrap border-b border-[var(--theme-border)]/60 py-2 pr-4">
                        {experiment.label}
                      </td>
                      <td className="whitespace-nowrap border-b border-[var(--theme-border)]/60 py-2 pr-4">
                        {EXPERIMENT_STATUS_LABEL[experiment.status]}
                      </td>
                      <td className="whitespace-nowrap border-b border-[var(--theme-border)]/60 py-2 pr-4">
                        {experiment.strategyIds.join(', ')}
                      </td>
                      <td className="whitespace-nowrap border-b border-[var(--theme-border)]/60 py-2 pr-4">
                        {experiment.endedAt ? formatDateTime(experiment.endedAt) : '-'}
                      </td>
                      <td className="whitespace-nowrap border-b border-[var(--theme-border)]/60 py-2 pr-4">
                        {experiment.tradesObserved}
                      </td>
                      <td className="whitespace-nowrap border-b border-[var(--theme-border)]/60 py-2 pr-4">
                        <div className="flex flex-wrap gap-2">
                          <button
                            type="button"
                            disabled={busy !== null}
                            onClick={() => void rollbackExperiment(experiment.id)}
                            title="Idempotent — safe to confirm even if already rolled back."
                            className="rounded-lg border border-[var(--theme-border)] px-2 py-1 text-xs hover:bg-[color-mix(in_srgb,var(--theme-text)_16%,transparent)] disabled:opacity-40"
                          >
                            Confirm rollback
                          </button>
                          <button
                            type="button"
                            disabled={busy !== null}
                            onClick={() => void rearmExperiment(experiment.id)}
                            className="rounded-lg border border-[color-mix(in_srgb,var(--theme-success)_30%,transparent)] bg-[color-mix(in_srgb,var(--theme-success)_10%,transparent)] px-2 py-1 text-xs text-[var(--theme-success)] hover:bg-[color-mix(in_srgb,var(--theme-success)_20%,transparent)]"
                          >
                            Re-arm
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </section>
  )
}

const VALIDATION_STATUS_LABEL: Record<ValidationRunStatus, string> = {
  active: 'Active',
  completed: 'Completed',
  stopped: 'Stopped',
  expired: 'Expired',
}

function validationStatusTone(
  status: ValidationRunStatus,
): 'good' | 'warn' | 'danger' | 'neutral' {
  if (status === 'active') return 'good'
  if (status === 'expired') return 'warn'
  if (status === 'stopped') return 'danger'
  return 'neutral'
}

function msToDuration(ms: number): string {
  if (!Number.isFinite(ms) || ms <= 0) return '0m'
  const totalMinutes = Math.floor(ms / 60_000)
  const days = Math.floor(totalMinutes / 1440)
  const hours = Math.floor((totalMinutes % 1440) / 60)
  const minutes = totalMinutes % 60
  const parts: Array<string> = []
  if (days) parts.push(`${days}d`)
  if (hours) parts.push(`${hours}h`)
  if (!days && minutes) parts.push(`${minutes}m`)
  return parts.join(' ') || '<1m'
}

function ageLabel(iso: string | null): string {
  if (!iso) return 'never'
  const ageMs = Date.now() - new Date(iso).getTime()
  if (!Number.isFinite(ageMs) || ageMs < 0) return 'just now'
  if (ageMs < 60_000) return `${Math.round(ageMs / 1000)}s ago`
  return `${msToDuration(ageMs)} ago`
}

/** One four-way ratio bar (time/cycles/trades/exposure) — "stage
 * completion" is simply the highest of the four, since any one budget
 * hitting its cap ends the run regardless of the others. */
function budgetRatioBar(label: string, used: number, max: number) {
  const pct = max > 0 ? Math.min(100, Math.round((used / max) * 100)) : 0
  return (
    <div key={label} className="flex flex-col gap-1">
      <div className="flex items-center justify-between text-[11px] text-[var(--theme-muted)]">
        <span>{label}</span>
        <span>{pct}%</span>
      </div>
      <div className="h-1.5 w-full overflow-hidden rounded-full bg-[color-mix(in_srgb,var(--theme-text)_12%,transparent)]">
        <div
          className={`h-full rounded-full ${pct >= 100 ? 'bg-[var(--theme-warning)]' : 'bg-[var(--theme-accent)]'}`}
          style={{ width: `${pct}%` }}
        />
      </div>
    </div>
  )
}

function ReadinessImpactBadge({ gate }: { gate: ReadinessGateLite | null }) {
  if (!gate) {
    return (
      <span className="rounded-full border border-[var(--theme-border)] px-2 py-0.5 text-[11px] text-[var(--theme-muted)]">
        readiness: unknown
      </span>
    )
  }
  return (
    <span
      title={gate.detail}
      className={`rounded-full border px-2 py-0.5 text-[11px] ${
        gate.pass
          ? 'border-[color-mix(in_srgb,var(--theme-success)_30%,transparent)] bg-[color-mix(in_srgb,var(--theme-success)_10%,transparent)] text-[var(--theme-success)]'
          : 'border-[color-mix(in_srgb,var(--theme-warning)_30%,transparent)] bg-[color-mix(in_srgb,var(--theme-warning)_10%,transparent)] text-[var(--theme-warning)]'
      }`}
    >
      readiness: {gate.pass ? 'passing' : 'blocked'}
    </span>
  )
}

function validationStageLabel(stage: ValidationStage): string {
  return stage === 'paper' ? 'Paper execution' : 'Sandbox / testnet execution'
}

function validationRecommendationLabel(
  recommendation: ValidationReconciliation['recommendation'],
): string {
  if (recommendation === 'continue_collecting') return 'Continue collecting'
  if (recommendation === 'review_reversible_control') {
    return 'Review reversible control'
  }
  return 'Keep unchanged'
}

/**
 * Controlled paper/sandbox evidence-collection runs. Exactly one active run
 * per stage; starting one requires explicit, bounded time/cycle/trade/
 * exposure budgets (no "unlimited" option) and is rejected server-side on
 * live mode, an out-of-range/missing budget, a stage/tradingMode mismatch,
 * or an already-active run for that stage. "Run cycle" attributes one
 * `runTradingCycle()` call (same gates as the main "Run cycle" button,
 * narrowed to this run's selected strategies) to the run's evidence.
 */
function ValidationRunPanel({
  catalog,
  state,
  reconciliation,
  diagnostics,
  trends,
  onPayload,
}: {
  catalog: Array<StrategyCatalogEntry>
  state: FinancePayload['validationRuns']
  reconciliation: FinancePayload['validationReconciliation']
  diagnostics: FinancePayload['lastCycleDiagnostics']
  trends: FinancePayload['tradingCycleDiagnosticTrends']
  onPayload: (payload: FinancePayload) => void
}) {
  const { run, busy, error } = useFinanceAction<
    FinancePayload & {
      validationRunResult?: { message: string }
    }
  >(onPayload)
  const [message, setMessage] = useState<string | null>(null)
  const [stage, setStage] = useState<ValidationStage>('sandbox')
  const [selectedStrategyIds, setSelectedStrategyIds] = useState<Array<string>>(
    [],
  )
  const [durationHours, setDurationHours] = useState(24)
  const [maxCycles, setMaxCycles] = useState(20)
  const [maxTrades, setMaxTrades] = useState(15)
  const [maxExposureQuote, setMaxExposureQuote] = useState(100)
  const [notes, setNotes] = useState('')
  const [autoRun, setAutoRun] = useState(false)

  const activeByStage = new Map(state.active.map((r) => [r.stage, r]))
  const activeRun = activeByStage.get(stage) ?? null
  const activeReconciliation =
    reconciliation.active.find((item) => item.stage === stage) ?? null
  const activePaperRun = activeByStage.get('paper') ?? null
  const latestCompletedRun = state.history[0]
  const latestCompletedTrend = trends[latestCompletedRun.stage]
  const latestCompletedAt =
    latestCompletedRun.endedAt ||
    latestCompletedRun.updatedAt ||
    latestCompletedRun.createdAt
  const completedPaperRun = state.history.some(
    (validationRun) => validationRun.stage === 'paper',
  )
  const stageNextAction = activeRun
    ? stage === 'paper'
      ? 'Continue the bounded paper run until its checkpoint; zero trades or low samples are incomplete evidence.'
      : 'Continue the bounded sandbox run and reconcile fills, attribution, account state, and risk before any expansion.'
    : stage === 'sandbox'
      ? activePaperRun
        ? 'Sandbox is blocked while the paper run is active. Review and finalize paper evidence first.'
        : completedPaperRun
          ? 'Review the completed paper checkpoint before starting a separate sandbox run.'
          : 'Start and complete a paper run before using sandbox/testnet.'
      : 'Start a bounded paper run with the selected strategies and automatic cycles only when ready.'

  useEffect(() => {
    if (selectedStrategyIds.length > 0) return
    const preferred = new Set(['sma_crossover', 'rsi_reversion'])
    const enabledDefaults = catalog
      .map((strategy) => strategy.id)
      .filter((id) => preferred.has(id))
    if (enabledDefaults.length > 0) setSelectedStrategyIds(enabledDefaults)
  }, [catalog, selectedStrategyIds.length])

  async function submit(
    action:
      | 'start_validation_run'
      | 'run_validation_cycle'
      | 'stop_validation_run'
      | 'finalize_validation_run',
    body: Record<string, unknown>,
    busyKey: string,
  ) {
    setMessage(null)
    const data = await run({ action, ...body }, busyKey)
    if (data) {
      setMessage(data.validationRunResult?.message ?? 'Validation run updated.')
    }
  }

  async function startRun() {
    if (selectedStrategyIds.length === 0) return
    await submit(
      'start_validation_run',
      {
        stage,
        strategies: selectedStrategyIds,
        budgets: {
          maxDurationMs: Math.max(1, durationHours) * 60 * 60_000,
          maxCycles,
          maxTrades,
          maxExposureQuote,
        },
        notes: notes.trim() || undefined,
        autoRun,
      },
      'start',
    )
  }

  async function runCycle() {
    await submit('run_validation_cycle', { stage }, `cycle:${stage}`)
  }

  async function stopRun() {
    const reason = window.prompt('Reason for stopping this validation run?') ?? ''
    await submit('stop_validation_run', { stage, reason }, `stop:${stage}`)
  }

  async function finalizeRun() {
    const finalNotes = window.prompt('Any final notes for this run?') ?? undefined
    await submit(
      'finalize_validation_run',
      { stage, notes: finalNotes },
      `finalize:${stage}`,
    )
  }

  function toggleStrategy(id: string) {
    setSelectedStrategyIds((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id],
    )
  }

  return (
    <section className="mt-6 rounded-3xl border border-[var(--theme-border)] bg-[var(--theme-panel)]/70 p-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold">
            Evidence checkpoint and validation runs
          </h2>
          <p className="text-xs text-[var(--theme-muted)]">
            Review the latest paper or sandbox evidence first, then manage
            bounded runs toward the gated-readiness checks below.
          </p>
        </div>
        <div className="flex gap-1 rounded-full border border-[var(--theme-border)] p-1 text-xs">
          {(['paper', 'sandbox'] as Array<ValidationStage>).map((s) => (
            <button
              key={s}
              type="button"
              onClick={() => setStage(s)}
              className={`rounded-full px-3 py-1 ${
                stage === s
                  ? 'bg-[var(--theme-accent)] text-[var(--theme-panel)]'
                  : 'text-[var(--theme-muted)]'
              }`}
            >
              {s === 'paper' ? 'Paper' : 'Sandbox (testnet)'}
            </button>
          ))}
        </div>
      </div>

      {(message || error) && (
        <p
          className={`mt-3 rounded-xl border p-2 text-sm ${error ? 'border-[color-mix(in_srgb,var(--theme-danger)_30%,transparent)] bg-[color-mix(in_srgb,var(--theme-danger)_10%,transparent)] text-[var(--theme-danger)]' : 'border-[color-mix(in_srgb,var(--theme-success)_30%,transparent)] bg-[color-mix(in_srgb,var(--theme-success)_10%,transparent)] text-[var(--theme-success)]'}`}
        >
          {error ?? message}
        </p>
      )}

      <div className="mt-4 rounded-2xl border border-[color-mix(in_srgb,var(--theme-accent)_30%,transparent)] bg-[color-mix(in_srgb,var(--theme-accent)_8%,transparent)] p-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <p className="text-[11px] uppercase tracking-[0.18em] text-[var(--theme-muted)]">
              Current evidence stage
            </p>
            <h3 className="mt-1 text-base font-semibold">
              {validationStageLabel(stage)}
            </h3>
          </div>
          <span className="rounded-full border border-[var(--theme-border)] px-2.5 py-1 text-xs text-[var(--theme-muted)]">
            {activeRun ? 'run active' : 'no active run'}
          </span>
        </div>
        <p className="mt-2 text-sm text-[var(--theme-text)]">
          <span className="font-medium">Next safe action:</span>{' '}
          {stageNextAction}
        </p>
        <p className="mt-1 text-xs text-[var(--theme-muted)]">
          Evidence is stage-separated and bounded. It does not authorize live
          trading or prove profitability by itself.
        </p>
      </div>

      {state.history.length > 0 && (
        <div className="mt-4 rounded-2xl border border-[color-mix(in_srgb,var(--theme-accent)_30%,transparent)] bg-[color-mix(in_srgb,var(--theme-accent)_8%,transparent)] p-4">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <p className="text-[11px] uppercase tracking-[0.18em] text-[var(--theme-muted)]">
                Latest completed checkpoint
              </p>
              <h3 className="mt-1 text-base font-semibold">
                {validationStageLabel(latestCompletedRun.stage)}
              </h3>
              <p className="mt-1 text-xs text-[var(--theme-muted)]">
                {formatDateTime(latestCompletedAt)}{' '}
                · {latestCompletedRun.strategies.join(', ')}
              </p>
            </div>
            <ReadinessImpactBadge gate={latestCompletedRun.readinessImpact} />
          </div>

          <div className="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-5">
            <StatCard
              label="Cycles"
              value={`${latestCompletedRun.progress.cyclesRun}/${latestCompletedRun.budgets.maxCycles}`}
              tone="neutral"
            />
            <StatCard
              label="Closed trades"
              value={`${latestCompletedRun.progress.tradesClosed}/${latestCompletedRun.budgets.maxTrades}`}
              tone={latestCompletedRun.progress.tradesClosed > 0 ? 'good' : 'warn'}
            />
            <StatCard
              label="Exposure"
              value={formatUsdt(latestCompletedRun.progress.currentExposureQuote)}
              tone={
                latestCompletedRun.progress.currentExposureQuote > 0
                  ? 'warn'
                  : 'neutral'
              }
            />
            <StatCard
              label="Realized P&L"
              value={formatUsdt(latestCompletedRun.evidence.realizedPnlQuote)}
              tone={
                latestCompletedRun.evidence.realizedPnlQuote > 0
                  ? 'good'
                  : latestCompletedRun.evidence.realizedPnlQuote < 0
                    ? 'danger'
                    : 'neutral'
              }
            />
            <StatCard
              label="Errors"
              value={String(latestCompletedRun.evidence.errors.length)}
              tone={latestCompletedRun.evidence.errors.length > 0 ? 'danger' : 'good'}
            />
          </div>

          <p className="mt-3 rounded-xl border border-[color-mix(in_srgb,var(--theme-warning)_25%,transparent)] bg-[color-mix(in_srgb,var(--theme-warning)_8%,transparent)] px-3 py-2 text-xs text-[var(--theme-warning)]">
            {latestCompletedRun.progress.tradesClosed === 0
              ? 'Incomplete evidence: this checkpoint produced no closed trades, so it cannot establish profitability or readiness.'
              : latestCompletedRun.readinessImpact?.detail ??
                'Review the checkpoint before changing stage or strategy controls.'}
          </p>

          <details className="mt-3 rounded-xl border border-[var(--theme-border)]/70 p-3">
            <summary className="cursor-pointer text-sm font-semibold">
              Decision trends · last 100 {latestCompletedRun.stage} cycles
            </summary>
            {latestCompletedTrend.cycles === 0 ? (
              <p className="mt-2 text-xs text-[var(--theme-muted)]">
                No persisted diagnostic history for this stage yet.
              </p>
            ) : (
              <div className="mt-3 grid gap-2 text-xs text-[var(--theme-muted)] sm:grid-cols-2">
                <p>
                  <span className="font-medium text-[var(--theme-text)]">
                    Council:
                  </span>{' '}
                  {Object.entries(latestCompletedTrend.councilCounts)
                    .map(([key, value]) => `${key} ${value}`)
                    .join(' · ')}
                </p>
                <p>
                  <span className="font-medium text-[var(--theme-text)]">
                    Actions:
                  </span>{' '}
                  {Object.entries(latestCompletedTrend.actionCounts)
                    .map(([key, value]) => `${key} ${value}`)
                    .join(' · ')}
                </p>
                <div className="sm:col-span-2">
                  <span className="font-medium text-[var(--theme-text)]">
                    Recurring reasons:
                  </span>
                  <div className="mt-1 space-y-1">
                    {latestCompletedTrend.reasonCounts
                      .slice(0, 5)
                      .map((reasonEntry) => (
                        <p key={reasonEntry.reason}>
                          <span className="font-medium">
                            {reasonEntry.count}×
                          </span>{' '}
                          {reasonEntry.reason}
                        </p>
                      ))}
                  </div>
                </div>
                <p className="sm:col-span-2">
                  Window:{' '}
                  {latestCompletedTrend.oldestAt
                    ? `${formatDateTime(latestCompletedTrend.oldestAt)} → ${formatDateTime(latestCompletedTrend.newestAt ?? latestCompletedTrend.oldestAt)}`
                    : 'not available'}
                </p>
              </div>
            )}
          </details>
        </div>
      )}

      {activeReconciliation && (
        <div className="mt-4 rounded-2xl border border-[var(--theme-border)]/70 bg-[color-mix(in_srgb,var(--theme-text)_8%,transparent)] p-4 text-xs">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <strong>Evidence reconciliation</strong>
            <span className="text-[var(--theme-accent)]">
              {validationRecommendationLabel(activeReconciliation.recommendation)}
            </span>
          </div>
          <p className="mt-2 text-[var(--theme-muted)]">
            {activeReconciliation.attributedTradeCount} linked trade(s) ·{' '}
            {activeReconciliation.attributedLedgerCount} ledger record(s) ·
            realized {formatUsdt(activeReconciliation.realizedPnlQuote)} ·
            fees {formatUsdt(activeReconciliation.feesQuote)} ·{' '}
            {activeReconciliation.openPositionCount} open position(s)
          </p>
          {activeReconciliation.warnings.length > 0 && (
            <p className="mt-2 text-[var(--theme-warning)]">
              {activeReconciliation.warnings.join(' · ')}
            </p>
          )}

          {diagnostics && (
            <details className="mt-4 rounded-2xl border border-[var(--theme-border)]/70 bg-[color-mix(in_srgb,var(--theme-text)_6%,transparent)] p-4">
              <summary className="cursor-pointer text-sm font-semibold">
                Last cycle decision diagnostics
              </summary>
              <p className="mt-2 text-xs text-[var(--theme-muted)]">
                {diagnostics.status === 'completed'
                  ? 'Read-only snapshot of why each watched symbol acted or stayed on HOLD.'
                  : diagnostics.reason ?? 'Cycle did not complete.'}{' '}
                · {ageLabel(diagnostics.ranAt)}
              </p>
              <div className="mt-3 grid gap-3 lg:grid-cols-2">
                {diagnostics.symbols.map((item) => (
                  <div
                    key={item.symbol}
                    className="rounded-xl border border-[var(--theme-border)]/70 p-3 text-xs"
                  >
                    <div className="flex flex-wrap justify-between gap-2">
                      <strong>{item.symbol}</strong>
                      <span className="text-[var(--theme-accent)]">
                        {item.finalAction ?? 'NO ACTION'} · council {item.councilSignal}
                      </span>
                    </div>
                    <p className="mt-1 text-[var(--theme-muted)]">
                      {item.candles} candles
                      {item.latestPrice == null
                        ? ''
                        : ` · price ${item.latestPrice.toFixed(4)}`}
                      {item.finalReason ? ` · ${item.finalReason}` : ''}
                    </p>
                    <div className="mt-2 space-y-1">
                      {item.strategySignals.map((signal) => (
                        <p key={signal.strategyId}>
                          <span className="font-medium">{signal.strategyId}</span>{' '}
                          {signal.signal} ({Math.round(signal.confidence * 100)}%) ·{' '}
                          {signal.reason}
                        </p>
                      ))}
                    </div>
                    {item.councilReasons.length > 0 && (
                      <p className="mt-2 text-[var(--theme-muted)]">
                        Council: {item.councilReasons.join(' · ')}
                      </p>
                    )}

                  </div>
                ))}
              </div>
            </details>
          )}
            <p className="mt-2 text-[11px] text-[var(--theme-muted)]">
              Evaluated {ageLabel(activeReconciliation.evaluatedAt)} · baseline{' '}
              {activeReconciliation.baselineEquityQuote == null
                ? 'n/a'
                : `${formatUsdt(activeReconciliation.baselineEquityQuote)} USDT`}
            </p>
        </div>
      )}

      {activeRun ? (
        <div className="mt-4 rounded-2xl border border-[var(--theme-border)]/70 bg-[color-mix(in_srgb,var(--theme-text)_8%,transparent)] p-4">
          <div className="flex flex-wrap items-start justify-between gap-2">
            <div>
              <h4 className="text-sm font-semibold">
                {activeRun.strategies.join(', ')}
              </h4>
              <p className="mt-1 text-xs text-[var(--theme-muted)]">
                started {formatDateTime(activeRun.createdAt)} · last cycle{' '}
                {ageLabel(activeRun.progress.lastCycleAt)}
                {activeRun.autoRun ? ' · automatic cycles enabled' : ''}
                {activeRun.progress.lastCycleReason
                  ? ` (${activeRun.progress.lastCycleReason})`
                  : ''}
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <StatCard
                label="Status"
                value={VALIDATION_STATUS_LABEL[activeRun.status]}
                tone={validationStatusTone(activeRun.status)}
              />
              <ReadinessImpactBadge gate={activeRun.liveReadinessImpact} />
            </div>
          </div>
          <p className="mt-3 rounded-xl border border-[color-mix(in_srgb,var(--theme-warning)_25%,transparent)] bg-[color-mix(in_srgb,var(--theme-warning)_8%,transparent)] px-3 py-2 text-xs text-[var(--theme-warning)]">
            {stageNextAction}
          </p>

          <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            {budgetRatioBar(
              'Time',
              Date.now() - new Date(activeRun.createdAt).getTime(),
              activeRun.budgets.maxDurationMs,
            )}
            {budgetRatioBar(
              'Cycles',
              activeRun.progress.cyclesRun,
              activeRun.budgets.maxCycles,
            )}
            {budgetRatioBar(
              'Trades',
              activeRun.progress.tradesClosed,
              activeRun.budgets.maxTrades,
            )}
            {budgetRatioBar(
              'Exposure',
              activeRun.progress.currentExposureQuote,
              activeRun.budgets.maxExposureQuote,
            )}
          </div>

          <div className="mt-4 grid gap-2 text-xs text-[var(--theme-muted)] sm:grid-cols-2 lg:grid-cols-4">
            <p>
              Realized P&amp;L:{' '}
              <span className="text-[var(--theme-text)]">
                {formatUsdt(activeRun.evidence.realizedPnlQuote)}
              </span>
            </p>
            <p>
              Fees:{' '}
              <span className="text-[var(--theme-text)]">
                {formatUsdt(activeRun.evidence.feesQuote)}
              </span>
            </p>
            <p>
              Avg slippage:{' '}
              <span className="text-[var(--theme-text)]">
                {activeRun.evidence.avgSlippageQuote == null
                  ? 'n/a'
                  : `${formatUsdt(activeRun.evidence.avgSlippageQuote)} (${activeRun.evidence.shadowComparisonsSampled} sampled)`}
              </span>
            </p>
            <p>
              Ledger records:{' '}
              <span className="text-[var(--theme-text)]">
                {activeRun.evidence.ledgerRecordIds.length}
              </span>
            </p>
          </div>

          {activeRun.evidence.errors.length > 0 && (
            <details className="mt-3 text-xs text-[var(--theme-muted)]">
              <summary className="cursor-pointer">
                {activeRun.evidence.errors.length} recorded bail/block event(s)
              </summary>
              <ul className="mt-2 space-y-1">
                {activeRun.evidence.errors.slice(-10).map((e, i) => (
                  <li key={`${e.at}-${i}`}>
                    {formatDateTime(e.at)} — {e.message}
                  </li>
                ))}
              </ul>
            </details>
          )}

          <div className="mt-4 flex flex-wrap gap-2">
            <button
              type="button"
              disabled={busy !== null}
              onClick={() => void runCycle()}
              className="rounded-xl border border-[color-mix(in_srgb,var(--theme-accent)_30%,transparent)] bg-[color-mix(in_srgb,var(--theme-accent)_10%,transparent)] px-3 py-2 text-xs font-medium text-[var(--theme-accent)] hover:bg-[color-mix(in_srgb,var(--theme-accent)_20%,transparent)] disabled:opacity-50"
            >
              Run cycle now
            </button>
            <button
              type="button"
              disabled={busy !== null}
              onClick={() => void finalizeRun()}
              className="rounded-xl border border-[color-mix(in_srgb,var(--theme-success)_30%,transparent)] bg-[color-mix(in_srgb,var(--theme-success)_10%,transparent)] px-3 py-2 text-xs font-medium text-[var(--theme-success)] hover:bg-[color-mix(in_srgb,var(--theme-success)_20%,transparent)] disabled:opacity-50"
            >
              Finalize
            </button>
            <button
              type="button"
              disabled={busy !== null}
              onClick={() => void stopRun()}
              className="rounded-xl border border-[color-mix(in_srgb,var(--theme-danger)_30%,transparent)] bg-[color-mix(in_srgb,var(--theme-danger)_10%,transparent)] px-3 py-2 text-xs font-medium text-[var(--theme-danger)] hover:bg-[color-mix(in_srgb,var(--theme-danger)_20%,transparent)] disabled:opacity-50"
            >
              Stop
            </button>
          </div>
        </div>
      ) : (
        <div className="mt-4 grid gap-3 rounded-2xl border border-[var(--theme-border)]/70 bg-[color-mix(in_srgb,var(--theme-text)_8%,transparent)] p-4">
          <p className="text-xs text-[var(--theme-muted)]">
            No active {stage === 'paper' ? 'paper' : 'sandbox (testnet)'}{' '}
            validation run. Select strategies and bounded budgets to start
            one — every field below is required (no unbounded option).
          </p>
          <div className="flex flex-wrap gap-2">
            {catalog.map((strategy) => (
              <label
                key={strategy.id}
                className="flex items-center gap-1.5 rounded-full border border-[var(--theme-border)] px-2.5 py-1 text-xs text-[var(--theme-muted)]"
              >
                <input
                  type="checkbox"
                  checked={selectedStrategyIds.includes(strategy.id)}
                  onChange={() => toggleStrategy(strategy.id)}
                />
                {strategy.name}
              </label>
            ))}
          </div>
          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
            <label className="flex flex-col gap-1 text-xs text-[var(--theme-muted)]">
              Duration (hours)
              <input
                type="number"
                min={1}
                value={durationHours}
                onChange={(event) => setDurationHours(Number(event.target.value))}
                className="rounded-xl border border-[var(--theme-border)] bg-transparent px-2 py-1.5 text-[var(--theme-text)] outline-none"
              />
            </label>
            <label className="flex flex-col gap-1 text-xs text-[var(--theme-muted)]">
              Max cycles
              <input
                type="number"
                min={1}
                value={maxCycles}
                onChange={(event) => setMaxCycles(Number(event.target.value))}
                className="rounded-xl border border-[var(--theme-border)] bg-transparent px-2 py-1.5 text-[var(--theme-text)] outline-none"
              />
            </label>
            <label className="flex flex-col gap-1 text-xs text-[var(--theme-muted)]">
              Max closed trades
              <input
                type="number"
                min={1}
                value={maxTrades}
                onChange={(event) => setMaxTrades(Number(event.target.value))}
                className="rounded-xl border border-[var(--theme-border)] bg-transparent px-2 py-1.5 text-[var(--theme-text)] outline-none"
              />
            </label>
            <label className="flex flex-col gap-1 text-xs text-[var(--theme-muted)]">
              Max exposure (USDT)
              <input
                type="number"
                min={0.01}
                value={maxExposureQuote}
                onChange={(event) =>
                  setMaxExposureQuote(Number(event.target.value))
                }
                className="rounded-xl border border-[var(--theme-border)] bg-transparent px-2 py-1.5 text-[var(--theme-text)] outline-none"
              />
            </label>
          </div>
          <label className="flex flex-col gap-1 text-xs text-[var(--theme-muted)]">
            Notes (optional)
            <input
              type="text"
              value={notes}
              onChange={(event) => setNotes(event.target.value)}
              className="rounded-xl border border-[var(--theme-border)] bg-transparent px-2 py-1.5 text-[var(--theme-text)] outline-none"
            />
          </label>
          <label className="flex items-start gap-2 text-xs text-[var(--theme-muted)]">
            <input
              type="checkbox"
              checked={autoRun}
              onChange={(event) => setAutoRun(event.target.checked)}
              className="mt-0.5"
            />
            <span>
              Advance automatically every 20 minutes using the existing
              trading-cycle safety gates. Stop or expiry still ends the run.
            </span>
          </label>
          <div>
            <button
              type="button"
              disabled={busy !== null || selectedStrategyIds.length === 0}
              onClick={() => void startRun()}
              className="rounded-xl border border-[color-mix(in_srgb,var(--theme-success)_30%,transparent)] bg-[color-mix(in_srgb,var(--theme-success)_10%,transparent)] px-3 py-2 text-xs font-medium text-[var(--theme-success)] hover:bg-[color-mix(in_srgb,var(--theme-success)_20%,transparent)] disabled:opacity-50"
            >
              Start {stage} validation run
            </button>
          </div>
        </div>
      )}

      <div className="mt-5">
        <h3 className="text-sm font-semibold">History</h3>
        {state.history.length === 0 ? (
          <p className="mt-2 text-xs text-[var(--theme-muted)]">
            No ended validation runs yet.
          </p>
        ) : (
          <div className="mt-2 overflow-x-auto">
            <table className="w-full min-w-[900px] text-left text-sm">
              <thead className="text-xs uppercase tracking-[0.18em] text-[var(--theme-muted)]">
                <tr>
                  <th className="border-b border-[var(--theme-border)] py-2 pr-4">Stage</th>
                  <th className="border-b border-[var(--theme-border)] py-2 pr-4">Strategies</th>
                  <th className="border-b border-[var(--theme-border)] py-2 pr-4">Status</th>
                  <th className="border-b border-[var(--theme-border)] py-2 pr-4">Cycles</th>
                  <th className="border-b border-[var(--theme-border)] py-2 pr-4">Trades</th>
                  <th className="border-b border-[var(--theme-border)] py-2 pr-4">Realized P&amp;L</th>
                  <th className="border-b border-[var(--theme-border)] py-2 pr-4">Readiness</th>
                  <th className="border-b border-[var(--theme-border)] py-2 pr-4">Ended</th>
                </tr>
              </thead>
              <tbody>
                {[...state.history]
                  .slice(0, 10)
                  .map((r) => (
                    <tr key={r.id} className="align-top text-[var(--theme-text)]">
                      <td className="whitespace-nowrap border-b border-[var(--theme-border)]/60 py-2 pr-4">
                        {r.stage}
                      </td>
                      <td className="whitespace-nowrap border-b border-[var(--theme-border)]/60 py-2 pr-4">
                        {r.strategies.join(', ')}
                      </td>
                      <td className="whitespace-nowrap border-b border-[var(--theme-border)]/60 py-2 pr-4">
                        {VALIDATION_STATUS_LABEL[r.status]}
                        {r.endReason ? ` · ${r.endReason}` : ''}
                      </td>
                      <td className="whitespace-nowrap border-b border-[var(--theme-border)]/60 py-2 pr-4">
                        {r.progress.cyclesRun}/{r.budgets.maxCycles}
                      </td>
                      <td className="whitespace-nowrap border-b border-[var(--theme-border)]/60 py-2 pr-4">
                        {r.progress.tradesClosed}/{r.budgets.maxTrades}
                      </td>
                      <td className="whitespace-nowrap border-b border-[var(--theme-border)]/60 py-2 pr-4">
                        {formatUsdt(r.evidence.realizedPnlQuote)}
                      </td>
                      <td className="whitespace-nowrap border-b border-[var(--theme-border)]/60 py-2 pr-4">
                        <ReadinessImpactBadge gate={r.readinessImpact} />
                      </td>
                      <td className="whitespace-nowrap border-b border-[var(--theme-border)]/60 py-2 pr-4">
                        {r.endedAt ? formatDateTime(r.endedAt) : '—'}
                      </td>
                    </tr>
                  ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </section>
  )
}

function toggleTone(enabled: boolean): 'good' | 'neutral' {
  return enabled ? 'good' : 'neutral'
}

function SignalSettingsPanel({
  demoTrading,
  onPayload,
}: {
  demoTrading: Record<string, unknown>
  onPayload: (p: FinancePayload) => void
}) {
  const {
    run: post,
    busy,
    error: err,
  } = useFinanceAction<FinancePayload>(onPayload)
  const atrSizeBaselinePct =
    typeof demoTrading.atrSizeBaselinePct === 'number'
      ? demoTrading.atrSizeBaselinePct
      : 0
  const kellySizingEnabled = demoTrading.kellySizingEnabled === true
  const patternVetoEnabled = demoTrading.patternVetoEnabled === true
  const adxThreshold =
    typeof demoTrading.adxThreshold === 'number' ? demoTrading.adxThreshold : 0
  const fibTakeProfitEnabled = demoTrading.fibTakeProfitEnabled === true
  const longShortSentimentEnabled =
    demoTrading.longShortSentimentEnabled === true
  // Defaults to true (see EngineConfig.noLossExitMode's doc comment in
  // demo-trading-engine.ts) — only false once explicitly toggled off, since
  // an unset key from settings.demoTrading means "use the engine default".
  const noLossExitMode = demoTrading.noLossExitMode !== false
  const strategyGuardEnabled = demoTrading.strategyGuardEnabled === true
  const strategyGuardMinClosedTrades =
    typeof demoTrading.strategyGuardMinClosedTrades === 'number'
      ? demoTrading.strategyGuardMinClosedTrades
      : 5
  const strategyGuardLossRateThreshold =
    typeof demoTrading.strategyGuardLossRateThreshold === 'number'
      ? demoTrading.strategyGuardLossRateThreshold
      : 0.4
  const strategyGuardMaxPnlQuote =
    typeof demoTrading.strategyGuardMaxPnlQuote === 'number'
      ? demoTrading.strategyGuardMaxPnlQuote
      : 0
  const strategyGuardAction =
    demoTrading.strategyGuardAction === 'disabled' ? 'disabled' : 'reduce_size'

  const [atrInput, setAtrInput] = useState(String(atrSizeBaselinePct * 100))
  const [adxInput, setAdxInput] = useState(String(adxThreshold))
  const [guardMinTradesInput, setGuardMinTradesInput] = useState(
    String(strategyGuardMinClosedTrades),
  )
  const [guardLossRateInput, setGuardLossRateInput] = useState(
    String(strategyGuardLossRateThreshold * 100),
  )

  function setConfig(config: Record<string, unknown>, busyKey: string) {
    void post({ action: 'set_demo_config', config }, busyKey)
  }

  const buttonClass =
    'rounded-xl border px-3 py-1.5 text-xs font-medium transition disabled:opacity-40'
  const toneClass = (tone: 'good' | 'neutral') =>
    tone === 'good'
      ? 'border-[color-mix(in_srgb,var(--theme-success)_40%,transparent)] bg-[color-mix(in_srgb,var(--theme-success)_15%,transparent)] text-[var(--theme-success)] hover:bg-[color-mix(in_srgb,var(--theme-success)_25%,transparent)]'
      : 'border-[var(--theme-border)] bg-[color-mix(in_srgb,var(--theme-text)_8%,transparent)] text-[var(--theme-text)] hover:bg-[color-mix(in_srgb,var(--theme-text)_16%,transparent)]'
  const inputClass =
    'w-20 rounded-xl border border-[var(--theme-border)] bg-[color-mix(in_srgb,var(--theme-text)_8%,transparent)] px-3 py-1.5 text-xs text-[var(--theme-text)] outline-none'

  return (
    <section className="mt-6 rounded-3xl border border-[var(--theme-border)] bg-[var(--theme-panel)]/70 p-5">
      <div>
        <h2 className="text-lg font-semibold">Signal settings</h2>
        <p className="text-xs text-[var(--theme-muted)]">
          Optional council-engine levers built and backtested this session. Each
          is independent and off by default — read the caption before turning
          one on.
        </p>
      </div>

      {err && <p className="mt-3 text-xs text-[var(--theme-danger)]">{err}</p>}

      <div className="mt-4 grid gap-3 sm:grid-cols-2">
        <div className="rounded-2xl border border-[var(--theme-border)]/70 bg-[color-mix(in_srgb,var(--theme-text)_8%,transparent)] p-3">
          <h3 className="text-sm font-semibold">ATR-based position sizing</h3>
          <p className="mt-1 text-xs text-[var(--theme-muted)]">
            Only the 1% baseline improved backtest P&amp;L (-40→-29 quote) and
            drawdown (53%→46%); 2%/4% made both worse.
          </p>
          <div className="mt-2 flex items-center gap-2">
            <input
              type="number"
              value={atrInput}
              onChange={(e) => setAtrInput(e.target.value)}
              className={inputClass}
            />
            <span className="text-xs text-[var(--theme-muted)]">
              % baseline
            </span>
            <button
              type="button"
              disabled={busy === 'atr'}
              onClick={() =>
                setConfig(
                  { atrSizeBaselinePct: (Number(atrInput) || 0) / 100 },
                  'atr',
                )
              }
              className={`${buttonClass} ${toneClass(toggleTone(atrSizeBaselinePct > 0))}`}
            >
              {busy === 'atr' ? '...' : 'Save'}
            </button>
          </div>

          <div className="rounded-2xl border border-[color-mix(in_srgb,var(--theme-warning)_30%,transparent)] bg-[color-mix(in_srgb,var(--theme-warning)_8%,transparent)] p-3 sm:col-span-2">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <h3 className="text-sm font-semibold">
                  Automatic sandbox strategy guard
                </h3>
                <p className="mt-1 max-w-3xl text-xs text-[var(--theme-muted)]">
                  After enough closed trades, automatically reduces size or
                  disables an enabled strategy when its win rate and P&amp;L are
                  weak. It only affects future paper/testnet entries, expires
                  after 7 days, and can be cleared from Strategy overrides.
                </p>
              </div>
              <button
                type="button"
                disabled={busy === 'strategy-guard'}
                onClick={() =>
                  setConfig(
                    { strategyGuardEnabled: !strategyGuardEnabled },
                    'strategy-guard',
                  )
                }
                className={`${buttonClass} ${toneClass(toggleTone(strategyGuardEnabled))}`}
              >
                {busy === 'strategy-guard'
                  ? '...'
                  : strategyGuardEnabled
                    ? 'Enabled'
                    : 'Disabled'}
              </button>
            </div>
            <div className="mt-3 flex flex-wrap items-center gap-2 text-xs">
              <label className="flex items-center gap-2 text-[var(--theme-muted)]">
                Minimum trades
                <input
                  type="number"
                  min={3}
                  max={200}
                  value={guardMinTradesInput}
                  onChange={(event) => setGuardMinTradesInput(event.target.value)}
                  className={inputClass}
                />
              </label>
              <label className="flex items-center gap-2 text-[var(--theme-muted)]">
                Max win rate
                <input
                  type="number"
                  min={0}
                  max={100}
                  value={guardLossRateInput}
                  onChange={(event) => setGuardLossRateInput(event.target.value)}
                  className={inputClass}
                />
                %
              </label>
              <select
                value={strategyGuardAction}
                onChange={(event) =>
                  setConfig(
                    { strategyGuardAction: event.target.value },
                    'strategy-guard-action',
                  )
                }
                className="rounded-xl border border-[var(--theme-border)] bg-[var(--theme-panel)] px-3 py-1.5 text-xs text-[var(--theme-text)]"
              >
                <option value="reduce_size">Reduce to 50%</option>
                <option value="disabled">Disable until review</option>
              </select>
              <button
                type="button"
                disabled={busy === 'strategy-guard-thresholds'}
                onClick={() =>
                  setConfig(
                    {
                      strategyGuardMinClosedTrades:
                        guardMinTradesInput.trim() === ''
                          ? 5
                          : Number(guardMinTradesInput),
                      strategyGuardLossRateThreshold:
                        (guardLossRateInput.trim() === ''
                          ? 40
                          : Number(guardLossRateInput)) / 100,
                    },
                    'strategy-guard-thresholds',
                  )
                }
                className={`${buttonClass} ${toneClass('neutral')}`}
              >
                {busy === 'strategy-guard-thresholds' ? '...' : 'Save thresholds'}
              </button>
              <span className="text-[var(--theme-muted)]">
                Also requires total P&amp;L ≤{' '}
                {formatUsdt(strategyGuardMaxPnlQuote)}.
              </span>
            </div>
          </div>
        </div>

        <div className="rounded-2xl border border-[var(--theme-border)]/70 bg-[color-mix(in_srgb,var(--theme-text)_8%,transparent)] p-3">
          <h3 className="text-sm font-semibold">Kelly-criterion sizing</h3>
          <p className="mt-1 text-xs text-[var(--theme-muted)]">
            Safe to enable — self-gates behind 30 closed trades per strategy
            before it changes anything; only ever shrinks size.
          </p>
          <div className="mt-2">
            <button
              type="button"
              disabled={busy === 'kelly'}
              onClick={() =>
                setConfig({ kellySizingEnabled: !kellySizingEnabled }, 'kelly')
              }
              className={`${buttonClass} ${toneClass(toggleTone(kellySizingEnabled))}`}
            >
              {busy === 'kelly'
                ? '...'
                : kellySizingEnabled
                  ? 'Enabled'
                  : 'Disabled'}
            </button>
          </div>
        </div>

        <div className="rounded-2xl border border-[var(--theme-border)]/70 bg-[color-mix(in_srgb,var(--theme-text)_8%,transparent)] p-3">
          <h3 className="text-sm font-semibold">Pattern-bucket veto</h3>
          <p className="mt-1 text-xs text-[var(--theme-muted)]">
            Safe to enable — self-gates behind 20 samples in a strategy/RSI/
            volatility bucket with a 65%+ loss rate before it blocks anything.
          </p>
          <div className="mt-2">
            <button
              type="button"
              disabled={busy === 'veto'}
              onClick={() =>
                setConfig({ patternVetoEnabled: !patternVetoEnabled }, 'veto')
              }
              className={`${buttonClass} ${toneClass(toggleTone(patternVetoEnabled))}`}
            >
              {busy === 'veto'
                ? '...'
                : patternVetoEnabled
                  ? 'Enabled'
                  : 'Disabled'}
            </button>
          </div>
        </div>

        <div className="rounded-2xl border border-[var(--theme-border)]/70 bg-[color-mix(in_srgb,var(--theme-text)_8%,transparent)] p-3">
          <h3 className="text-sm font-semibold">ADX trend-strength gate</h3>
          <p className="mt-1 text-xs text-[var(--theme-muted)]">
            Caution: one backtest showed threshold 25 flip -40→+15 quote, but
            it's non-monotonic (30 dropped to -18) — no walk-forward done.
          </p>
          <div className="mt-2 flex items-center gap-2">
            <input
              type="number"
              value={adxInput}
              onChange={(e) => setAdxInput(e.target.value)}
              className={inputClass}
            />
            <span className="text-xs text-[var(--theme-muted)]">
              threshold (0=off)
            </span>
            <button
              type="button"
              disabled={busy === 'adx'}
              onClick={() =>
                setConfig({ adxThreshold: Number(adxInput) || 0 }, 'adx')
              }
              className={`${buttonClass} ${toneClass(toggleTone(adxThreshold > 0))}`}
            >
              {busy === 'adx' ? '...' : 'Save'}
            </button>
          </div>
        </div>

        <div className="rounded-2xl border border-[var(--theme-border)]/70 bg-[color-mix(in_srgb,var(--theme-text)_8%,transparent)] p-3">
          <h3 className="text-sm font-semibold">
            Fibonacci-extension take-profit
          </h3>
          <p className="mt-1 text-xs text-[var(--theme-muted)]">
            Roughly halves losses vs. the fixed-% take-profit in backtest, but
            stays net-negative overall — an improvement, not a standalone edge.
          </p>
          <div className="mt-2">
            <button
              type="button"
              disabled={busy === 'fib'}
              onClick={() =>
                setConfig(
                  { fibTakeProfitEnabled: !fibTakeProfitEnabled },
                  'fib',
                )
              }
              className={`${buttonClass} ${toneClass(toggleTone(fibTakeProfitEnabled))}`}
            >
              {busy === 'fib'
                ? '...'
                : fibTakeProfitEnabled
                  ? 'Enabled'
                  : 'Disabled'}
            </button>
          </div>
        </div>

        <div className="rounded-2xl border border-[var(--theme-border)]/70 bg-[color-mix(in_srgb,var(--theme-text)_8%,transparent)] p-3">
          <h3 className="text-sm font-semibold">Long/short sentiment</h3>
          <p className="mt-1 text-xs text-[var(--theme-muted)]">
            No backtest possible yet (Binance only retains ~30 days) — a live,
            unvalidated bet, not a proven signal.
          </p>
          <div className="mt-2">
            <button
              type="button"
              disabled={busy === 'sentiment'}
              onClick={() =>
                setConfig(
                  { longShortSentimentEnabled: !longShortSentimentEnabled },
                  'sentiment',
                )
              }
              className={`${buttonClass} ${toneClass(toggleTone(longShortSentimentEnabled))}`}
            >
              {busy === 'sentiment'
                ? '...'
                : longShortSentimentEnabled
                  ? 'Enabled'
                  : 'Disabled'}
            </button>
          </div>
        </div>

        <div className="rounded-2xl border border-[var(--theme-border)]/70 bg-[color-mix(in_srgb,var(--theme-text)_8%,transparent)] p-3">
          <h3 className="text-sm font-semibold">
            Patient hold (don't realize losses)
          </h3>
          <p className="mt-1 text-xs text-[var(--theme-muted)]">
            Sandbox/testnet only — while a position is underwater, this skips
            stop-loss, trailing-stop, max-hold, and strategy-exit sells so the
            engine keeps holding (and researching) until it can close at
            breakeven or a profit instead of locking in a loss. Guardian
            safety limits (dust/unsellable close, daily loss halt, max open
            positions) stay active regardless. Never enable this for real
            money — a losing position can never be forced to recover.
          </p>
          <div className="mt-2">
            <button
              type="button"
              disabled={busy === 'no-loss'}
              onClick={() =>
                setConfig({ noLossExitMode: !noLossExitMode }, 'no-loss')
              }
              className={`${buttonClass} ${toneClass(toggleTone(noLossExitMode))}`}
            >
              {busy === 'no-loss'
                ? '...'
                : noLossExitMode
                  ? 'Enabled'
                  : 'Disabled'}
            </button>
          </div>
        </div>
      </div>
    </section>
  )
}

const SELECTABLE_MODES: Array<{ id: string; label: string; hint: string }> = [
  {
    id: 'observe_only',
    label: 'Observe only',
    hint: 'No trading — market data only',
  },
  {
    id: 'paper_trade',
    label: 'Paper trade',
    hint: 'Simulated; no orders placed',
  },
  {
    id: 'testnet_execute',
    label: 'Testnet execute',
    hint: 'Fake-money orders on Binance testnet',
  },
  {
    id: 'live_manual_approval',
    label: 'Live manual',
    hint: 'Real Binance spot; 10 USDT cap + paper shadow',
  },
]

function TradingControls({
  summary,
  onPayload,
}: {
  summary: FinancePayload['summary']
  onPayload: (p: FinancePayload) => void
}) {
  const {
    run: post,
    busy,
    error: err,
  } = useFinanceAction<FinancePayload>(onPayload)

  const cutoffOn = summary.emergencyKillSwitch

  function disarmCutoff() {
    const confirmed = window.confirm(
      'Disarm the emergency safety cutoff?\n\nThis lets the engine place orders in the selected Binance mode, including real-money live mode if it is armed. ' +
        'Only do this deliberately — you can re-arm it at any time.',
    )
    if (!confirmed) return
    void post(
      {
        action: 'set_kill_switch',
        engaged: false,
        approval: 'I_UNDERSTAND_DISABLE_SAFETY_CUTOFF',
      },
      'cutoff',
    )
  }

  function selectMode(modeId: string) {
    if (modeId === 'live_manual_approval') {
      const confirmed = window.confirm(
        'Arm Binance live manual mode?\n\nThis can place real spot orders after the cutoff is disarmed. Orders are capped and mirrored to paper shadow tracking.',
      )
      if (!confirmed) return
      void post(
        {
          action: 'arm_live_binance',
          approval: 'I_APPROVE_BINANCE_LIVE_TRADING',
          livePerOrderCapUsdt: 10,
        },
        'mode-live_manual_approval',
      )
      return
    }
    if (modeId === 'observe_only') {
      void post(
        { action: 'set_trading_mode', mode: 'observe_only' },
        `mode-${modeId}`,
      )
      return
    }
    const account = modeId === 'testnet_execute' ? 'binance_testnet' : 'paper'
    void post({ action: 'set_execution_account', account }, `mode-${modeId}`)
  }

  return (
    <section className="mt-6 rounded-3xl border border-[var(--theme-border)] bg-[var(--theme-panel)]/70 p-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-lg font-semibold">Trading controls</h2>
        <span
          className={`rounded-full border px-3 py-1 text-xs font-medium ${
            cutoffOn
              ? 'border-[color-mix(in_srgb,var(--theme-success)_30%,transparent)] bg-[color-mix(in_srgb,var(--theme-success)_10%,transparent)] text-[var(--theme-success)]'
              : 'border-[color-mix(in_srgb,var(--theme-danger)_30%,transparent)] bg-[color-mix(in_srgb,var(--theme-danger)_10%,transparent)] text-[var(--theme-danger)]'
          }`}
        >
          Cutoff:{' '}
          {cutoffOn
            ? 'ARMED (trading halted)'
            : 'DISARMED (trading can execute)'}
        </span>
      </div>

      {err && (
        <p className="mt-3 rounded-xl border border-[color-mix(in_srgb,var(--theme-danger)_30%,transparent)] bg-[color-mix(in_srgb,var(--theme-danger)_10%,transparent)] p-2 text-sm text-[var(--theme-danger)]">
          {err}
        </p>
      )}

      <div className="mt-4">
        <div className="text-xs uppercase tracking-[0.2em] text-[var(--theme-muted)]">
          Trading mode
        </div>
        <div className="mt-2 flex flex-wrap gap-2">
          {SELECTABLE_MODES.map((mode) => {
            const active = summary.tradingMode === mode.id
            return (
              <button
                key={mode.id}
                type="button"
                disabled={busy !== null}
                onClick={() => selectMode(mode.id)}
                className={`rounded-2xl border px-3.5 py-2 text-left text-sm transition disabled:opacity-50 ${
                  active
                    ? 'border-[color-mix(in_srgb,var(--theme-success)_40%,transparent)] bg-[color-mix(in_srgb,var(--theme-success)_15%,transparent)] text-[var(--theme-success)]'
                    : 'border-[var(--theme-border)] bg-[color-mix(in_srgb,var(--theme-text)_8%,transparent)] text-[var(--theme-text)] hover:border-[color-mix(in_srgb,var(--theme-success)_30%,transparent)]'
                }`}
              >
                <div className="font-medium">
                  {mode.label}
                  {active ? ' ✓' : ''}
                </div>
                <div className="text-xs text-[var(--theme-muted)]">
                  {mode.hint}
                </div>
              </button>
            )
          })}
        </div>
        <p className="mt-2 text-xs text-[var(--theme-muted)]">
          Active provider: Binance. IBKR is tracked as a future feature. Live
          mode still needs the cutoff disarmed before any order can execute.
        </p>
      </div>

      <div className="mt-5 border-t border-[var(--theme-border)]/60 pt-4">
        <div className="text-xs uppercase tracking-[0.2em] text-[var(--theme-muted)]">
          Emergency safety cutoff
        </div>
        <p className="mt-1 text-xs text-[var(--theme-muted)]">
          Master switch — while ARMED the engine cannot place any order,
          regardless of mode.
        </p>
        <div className="mt-3 flex flex-wrap gap-2">
          <button
            type="button"
            disabled={busy !== null || cutoffOn}
            onClick={() =>
              void post({ action: 'set_kill_switch', engaged: true }, 'cutoff')
            }
            className="rounded-2xl border border-[color-mix(in_srgb,var(--theme-success)_40%,transparent)] bg-[color-mix(in_srgb,var(--theme-success)_15%,transparent)] px-4 py-2 text-sm font-medium text-[var(--theme-success)] transition hover:bg-[color-mix(in_srgb,var(--theme-success)_25%,transparent)] disabled:opacity-40"
          >
            {busy === 'cutoff' ? '…' : 'Arm cutoff (safe)'}
          </button>
          <button
            type="button"
            disabled={busy !== null || !cutoffOn}
            onClick={disarmCutoff}
            className="rounded-2xl border border-[color-mix(in_srgb,var(--theme-danger)_40%,transparent)] bg-[color-mix(in_srgb,var(--theme-danger)_15%,transparent)] px-4 py-2 text-sm font-medium text-[var(--theme-danger)] transition hover:bg-[color-mix(in_srgb,var(--theme-danger)_25%,transparent)] disabled:opacity-40"
          >
            {busy === 'cutoff' ? '…' : 'Disarm cutoff (enable trading)'}
          </button>
          <button
            type="button"
            disabled={busy !== null}
            onClick={() => void post({ action: 'emergency_stop' }, 'estop')}
            className="rounded-2xl border border-[color-mix(in_srgb,var(--theme-danger)_50%,transparent)] bg-[color-mix(in_srgb,var(--theme-danger)_20%,transparent)] px-4 py-2 text-sm font-semibold text-[var(--theme-danger)] transition hover:bg-[color-mix(in_srgb,var(--theme-danger)_30%,transparent)] disabled:opacity-40"
          >
            {busy === 'estop' ? '…' : 'EMERGENCY STOP'}
          </button>
        </div>
      </div>
    </section>
  )
}

function PerformancePanel({
  perf,
}: {
  perf: FinancePayload['demoPerformance']
}) {
  if (perf.totalTrades === 0) {
    return (
      <section className="mt-6 rounded-3xl border border-[var(--theme-border)] bg-[var(--theme-panel)]/70 p-5">
        <h2 className="text-lg font-semibold">Strategy performance</h2>
        <p className="mt-2 text-sm text-[var(--theme-muted)]">
          No closed demo trades yet — win rate, profit factor, and fee-net P/L
          appear here once the engine completes trades.
        </p>
      </section>
    )
  }

  const pct = formatFractionPct
  const usdt = formatUsdt
  const num = (value: number) => value.toFixed(2)

  return (
    <section className="mt-6 rounded-3xl border border-[var(--theme-border)] bg-[var(--theme-panel)]/70 p-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-lg font-semibold">Strategy performance</h2>
        <span className="rounded-full border border-[var(--theme-border)] px-2.5 py-1 text-xs text-[var(--theme-muted)]">
          {perf.totalTrades} closed trade{perf.totalTrades === 1 ? '' : 's'}
        </span>
      </div>
      <div className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard
          label="Win rate"
          value={pct(perf.winRate)}
          tone={
            perf.winRate >= 0.5
              ? 'good'
              : perf.winRate >= 0.35
                ? 'warn'
                : 'danger'
          }
        />
        <StatCard
          label="Profit factor"
          value={num(perf.profitFactor)}
          tone={
            perf.profitFactor >= 1.5
              ? 'good'
              : perf.profitFactor >= 1
                ? 'warn'
                : 'danger'
          }
        />
        <StatCard
          label="Avg P/L / trade"
          value={usdt(perf.avgProfitLossPerTrade)}
          tone={perf.avgProfitLossPerTrade >= 0 ? 'good' : 'danger'}
        />
        <StatCard
          label="Sharpe ratio"
          value={num(perf.sharpeRatio)}
          tone={
            perf.sharpeRatio >= 1
              ? 'good'
              : perf.sharpeRatio >= 0
                ? 'warn'
                : 'danger'
          }
        />
        <StatCard label="Avg win" value={usdt(perf.avgProfit)} tone="good" />
        <StatCard label="Avg loss" value={usdt(perf.avgLoss)} tone="danger" />
        <StatCard
          label="Max drawdown"
          value={usdt(perf.maxDrawdown)}
          tone={perf.maxDrawdown > 0 ? 'warn' : 'neutral'}
        />
        <StatCard
          label="Fees paid"
          value={usdt(perf.totalFeesQuote)}
          tone="neutral"
        />
      </div>
    </section>
  )
}

function StrategyEligibilityAuditPanel({
  audit,
}: {
  audit: StrategyEligibilityAudit
}) {
  const hasSnapshot = audit.symbols.length > 0 && audit.asOfMs > 0
  return (
    <details className="rounded-3xl border border-[var(--theme-border)] bg-[var(--theme-panel)]/70 p-5">
      <summary className="cursor-pointer list-none">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="text-lg font-semibold">Strategy eligibility audit</h2>
            <p className="mt-1 text-sm text-[var(--theme-muted)]">
              Read-only replay of every registered strategy against the latest{' '}
              {audit.interval} market window. It does not enable strategies or
              authorize orders.
            </p>
          </div>
          <span className="rounded-full border border-[var(--theme-border)] px-2.5 py-1 text-xs text-[var(--theme-muted)]">
            {hasSnapshot ? `${audit.symbols.length} symbol(s)` : 'warming up'}
          </span>
        </div>
      </summary>
      {!hasSnapshot ? (
        <p className="mt-4 rounded-xl border border-[color-mix(in_srgb,var(--theme-warning)_25%,transparent)] bg-[color-mix(in_srgb,var(--theme-warning)_8%,transparent)] px-3 py-2 text-sm text-[var(--theme-warning)]">
          Market snapshot is warming up. Refresh this section after the
          background market cache completes.
        </p>
      ) : (
        <div className="mt-4 space-y-4">
          <p className="text-xs text-[var(--theme-muted)]">
            Council threshold: {audit.councilThreshold.toFixed(2)} · execution:{' '}
            {audit.executionMode} · market data as of{' '}
            {new Date(audit.asOfMs).toLocaleTimeString()}
          </p>
          {audit.symbols.map((item) => (
            <section
              key={item.symbol}
              className="rounded-2xl border border-[var(--theme-border)]/70 p-4"
            >
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <h3 className="font-semibold">{item.symbol}</h3>
                  <p className="text-xs text-[var(--theme-muted)]">
                    {item.candles} candles · price{' '}
                    {item.latestPrice == null
                      ? 'unavailable'
                      : item.latestPrice.toFixed(4)}
                  </p>
                </div>
                <span className="rounded-full border border-[var(--theme-border)] px-2.5 py-1 text-xs font-semibold">
                  Council {item.council.signal} · net {item.council.net.toFixed(3)}
                </span>
              </div>
              <div className="mt-3 grid gap-2 md:grid-cols-2">
                {item.strategies.map((strategy) => (
                  <div
                    key={strategy.strategyId}
                    className="rounded-xl border border-[var(--theme-border)]/60 p-3 text-xs"
                  >
                    <div className="flex justify-between gap-2">
                      <span className="font-medium">
                        {strategy.name}
                        {!strategy.active ? ' · disabled' : ''}
                        {strategy.overrideMode === 'disabled'
                          ? ' · override'
                          : ''}
                      </span>
                      <span
                        className={
                          strategy.signal === 'BUY'
                            ? 'text-[var(--theme-success)]'
                            : strategy.signal === 'SELL'
                              ? 'text-[var(--theme-danger)]'
                              : 'text-[var(--theme-muted)]'
                        }
                      >
                        {strategy.signal} {Math.round(strategy.confidence * 100)}%
                      </span>
                    </div>
                    <p className="mt-1 text-[var(--theme-muted)]">
                      {strategy.reason}
                    </p>
                    <p className="mt-1 text-[var(--theme-muted)]">
                      {strategy.dataAvailable
                        ? `${item.candles} candles · minimum ${strategy.minCandles}`
                        : strategy.dataIssues.join('; ')}
                    </p>
                    <p className="mt-1 text-[var(--theme-muted)]">
                      {strategy.regime
                        ? `${strategy.muted ? 'Muted' : 'Regime'}: ${strategy.regime}`
                        : 'Regime switching off'}
                      {' · '}
                      {strategy.councilEligible
                        ? 'eligible for council'
                        : strategy.exclusionReason ?? 'not eligible'}
                    </p>
                  </div>
                ))}
              </div>
              <p className="mt-3 text-xs text-[var(--theme-muted)]">
                Participating:{' '}
                {item.council.participatingStrategyIds.join(', ') || 'none'} ·{' '}
                {item.council.eligible
                  ? `eligible with lead ${item.council.leadStrategyId ?? 'n/a'}`
                  : `below ${item.council.threshold.toFixed(2)} threshold`}
              </p>
            </section>
          ))}
        </div>
      )}
    </details>
  )
}

function PaperDecisionQualityPanel({
  report,
}: {
  report: PaperDecisionQualityReport
}) {
  const rate = (value: number | null) =>
    value == null ? '—' : `${(value * 100).toFixed(1)}%`
  const adverseMove = (value: number | null) =>
    value == null ? '—' : `${value.toFixed(2)}%`
  const hasCoverage = report.coveredSampleCount > 0
  const evidenceMessage =
    report.sampleCount === 0
      ? 'No paper decisions have been recorded, so there is no execution activity to evaluate.'
      : !hasCoverage
        ? 'No eligible outcomes yet. Decisions remain abstained until the outcome horizon and candles provide coverage.'
        : report.coveredSampleCount < 5
          ? 'Evidence is still limited; use these paper-only measurements for observation, not execution changes.'
          : 'Evidence is observational only and does not authorize or trigger execution.'

  return (
    <section className="mt-6 rounded-3xl border border-[var(--theme-border)] bg-[var(--theme-panel)]/70 p-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold">Paper decision quality</h2>
          <p className="text-xs text-[var(--theme-muted)]">
            Read-only directional evidence from the paper decision journal.
          </p>
        </div>
        <span className="rounded-full border border-[var(--theme-border)] px-2.5 py-1 text-xs text-[var(--theme-muted)]">
          No execution
        </span>
      </div>

      <p className="mt-3 rounded-2xl border border-[var(--theme-border)] bg-[color-mix(in_srgb,var(--theme-text)_8%,transparent)] p-3 text-sm text-[var(--theme-muted)]">
        {evidenceMessage}
      </p>

      <div className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
        <StatCard
          label="Sample"
          value={`${report.coveredSampleCount} covered / ${report.sampleCount}`}
          tone={hasCoverage ? 'good' : 'warn'}
        />
        <StatCard label="Coverage" value={rate(report.coverage)} />
        <StatCard
          label="Abstention"
          value={`${rate(report.abstentionRate)} · ${report.abstainedSampleCount}`}
          tone={report.abstainedSampleCount > 0 ? 'warn' : 'neutral'}
        />
        <StatCard
          label="Directional hit rate"
          value={rate(report.directionalHitRate)}
        />
        <StatCard
          label="Average adverse move"
          value={adverseMove(report.averageAdverseMovePct)}
          tone={report.averageAdverseMovePct == null ? 'neutral' : 'warn'}
        />
        <StatCard
          label="Worst adverse move"
          value={adverseMove(report.worstAdverseMovePct)}
          tone={report.worstAdverseMovePct == null ? 'neutral' : 'danger'}
        />
      </div>

      <div className="mt-4">
        <h3 className="text-sm font-semibold">
          Calibration by score magnitude
        </h3>
        <div className="mt-2 grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
          {report.calibrationBuckets.map((bucket) => (
            <div
              key={bucket.label}
              className="rounded-2xl border border-[var(--theme-border)]/70 bg-[color-mix(in_srgb,var(--theme-text)_8%,transparent)] p-3"
            >
              <div className="text-xs text-[var(--theme-muted)]">
                Score {bucket.label}
              </div>
              <div className="mt-1 text-sm font-semibold">
                {rate(bucket.directionalHitRate)}
              </div>
              <div className="mt-1 text-xs text-[var(--theme-muted)]">
                {bucket.sampleCount} covered samples
              </div>
            </div>
          ))}
        </div>
      </div>
    </section>
  )
}

function DecisionQualityPanel({
  report,
  overrides,
  onPayload,
}: {
  report: DecisionQualityReport
  overrides: FinancePayload['strategyOverrides']
  onPayload: (payload: FinancePayload) => void
}) {
  const {
    run,
    isBusy: busy,
    error,
  } = useFinanceAction<
    FinancePayload & {
      appliedSafeguards?: {
        tradingMode: string
        quotePerTrade: number
        liveRecommendationDeferred: boolean
      }
      strategyOverrideRecommendationResult?: {
        applied: Array<{ changed: boolean }>
        skipped: Array<unknown>
      }
    }
  >(onPayload)
  const [message, setMessage] = useState<string | null>(null)
  const activeOverrideByStrategy = useMemo(
    () =>
      new Map(
        overrides.active.map((override) => [override.strategyId, override]),
      ),
    [overrides.active],
  )
  const pct = formatFractionPct
  const usdt = formatUsdt
  const statusTone =
    report.status === 'ready_for_manual_live_review' ||
    report.status === 'ready_for_testnet'
      ? 'good'
      : report.status === 'improving'
        ? 'warn'
        : report.status === 'degraded'
          ? 'danger'
          : 'neutral'
  const statusLabel = report.status.replace(/_/g, ' ')
  const findingTone = (severity: DecisionQualityFinding['severity']) =>
    severity === 'critical'
      ? 'border-[color-mix(in_srgb,var(--theme-danger)_30%,transparent)] bg-[color-mix(in_srgb,var(--theme-danger)_10%,transparent)] text-[var(--theme-danger)]'
      : severity === 'warning'
        ? 'border-[color-mix(in_srgb,var(--theme-warning)_30%,transparent)] bg-[color-mix(in_srgb,var(--theme-warning)_10%,transparent)] text-[var(--theme-warning)]'
        : 'border-[var(--theme-border)] bg-[color-mix(in_srgb,var(--theme-text)_8%,transparent)] text-[var(--theme-muted)]'
  const checks: Array<[string, boolean]> = [
    ['Paper data', report.validations.enoughPaperData],
    ['Shadow data', report.validations.enoughShadowData],
    ['Testnet ready', report.validations.enoughDataForTestnet],
    ['Live review ready', report.validations.enoughDataForLiveManual],
    ['Increase risk', report.validations.canIncreaseRisk],
    ['Live paused', report.recommendedAdjustments.pauseLive],
  ]
  const overrideRecommendationCount = report.byStrategy.filter(
    (strategy) => strategy.recommendation !== 'keep',
  ).length
  const overrideLabel = (override: StrategyOverride) =>
    override.mode === 'disabled'
      ? 'override: disabled'
      : `override: ${override.multiplier.toFixed(2)}x size`
  const overrideTone = (override: StrategyOverride) =>
    override.mode === 'disabled'
      ? 'border-[color-mix(in_srgb,var(--theme-danger)_30%,transparent)] bg-[color-mix(in_srgb,var(--theme-danger)_10%,transparent)] text-[var(--theme-danger)]'
      : 'border-[color-mix(in_srgb,var(--theme-warning)_30%,transparent)] bg-[color-mix(in_srgb,var(--theme-warning)_10%,transparent)] text-[var(--theme-warning)]'

  async function applySafeguards() {
    setMessage(null)
    const data = await run({ action: 'apply_recommended_safeguards' })
    if (data) {
      const applied = data.appliedSafeguards
      setMessage(
        applied
          ? `Applied ${applied.tradingMode} with ${applied.quotePerTrade.toFixed(2)} USDT max trade size${applied.liveRecommendationDeferred ? '; live recommendation deferred until explicit live arming' : ''}.`
          : 'Recommended safeguards applied.',
      )
    }
  }

  async function applyStrategyRecommendations() {
    setMessage(null)
    const data = await run({
      action: 'apply_strategy_override_recommendations',
    })
    if (data) {
      const result = data.strategyOverrideRecommendationResult
      const changed = result?.applied.filter((item) => item.changed).length ?? 0
      const skipped = result?.skipped.length ?? 0
      setMessage(
        `Applied ${changed} strategy override recommendation${changed === 1 ? '' : 's'}; ${skipped} skipped.`,
      )
    }
  }

  return (
    <section className="mt-6 rounded-3xl border border-[var(--theme-border)] bg-[var(--theme-panel)]/70 p-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold">Decision validation</h2>
          <p className="text-xs text-[var(--theme-muted)]">
            Checks closed trades, strategy scores, guardian blocks, and
            paper-shadow comparisons before increasing risk.
          </p>
        </div>
        <span className="rounded-full border border-[var(--theme-border)] px-2.5 py-1 text-xs capitalize text-[var(--theme-muted)]">
          {statusLabel}
        </span>
      </div>
      {(message || error) && (
        <p
          className={`mt-3 rounded-xl border p-2 text-sm ${error ? 'border-[color-mix(in_srgb,var(--theme-danger)_30%,transparent)] bg-[color-mix(in_srgb,var(--theme-danger)_10%,transparent)] text-[var(--theme-danger)]' : 'border-[color-mix(in_srgb,var(--theme-success)_30%,transparent)] bg-[color-mix(in_srgb,var(--theme-success)_10%,transparent)] text-[var(--theme-success)]'}`}
        >
          {error ?? message}
        </p>
      )}

      <div className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard
          label="Validation status"
          value={statusLabel}
          tone={statusTone}
        />
        <StatCard
          label="Closed trades"
          value={`${report.sample.realClosedTrades}`}
          tone={report.validations.enoughPaperData ? 'good' : 'warn'}
        />
        <StatCard
          label="Recent P/L"
          value={usdt(report.metrics.recentPnlQuote)}
          tone={report.metrics.recentPnlQuote >= 0 ? 'good' : 'danger'}
        />
        <StatCard
          label="Shadow pairs"
          value={`${report.sample.pairedShadowTrades}`}
          tone={report.validations.enoughShadowData ? 'good' : 'warn'}
        />
        <StatCard
          label="Win rate"
          value={pct(report.metrics.winRate)}
          tone={
            report.metrics.winRate >= 0.5
              ? 'good'
              : report.metrics.winRate >= 0.35
                ? 'warn'
                : 'danger'
          }
        />
        <StatCard
          label="Profit factor"
          value={report.metrics.profitFactor.toFixed(2)}
          tone={
            report.metrics.profitFactor >= 1.5
              ? 'good'
              : report.metrics.profitFactor >= 1
                ? 'warn'
                : 'danger'
          }
        />
        <StatCard
          label="Max loss streak"
          value={`${report.metrics.maxLossStreak}`}
          tone={
            report.metrics.maxLossStreak >= 3
              ? 'danger'
              : report.metrics.maxLossStreak >= 2
                ? 'warn'
                : 'neutral'
          }
        />
        <StatCard
          label="Next max size"
          value={usdt(report.recommendedAdjustments.maxQuotePerTrade)}
          tone={report.recommendedAdjustments.pauseLive ? 'warn' : 'good'}
        />
      </div>

      <div className="mt-4 grid gap-4 lg:grid-cols-2">
        <div className="rounded-2xl border border-[var(--theme-border)]/70 bg-[color-mix(in_srgb,var(--theme-text)_8%,transparent)] p-4">
          <h3 className="text-sm font-semibold">Recommended adjustment</h3>
          <div className="mt-2 text-sm text-[var(--theme-text)]">
            Mode:{' '}
            <strong>{report.recommendedAdjustments.recommendedMode}</strong>
            {' · '}
            Size multiplier:{' '}
            <strong>
              {report.recommendedAdjustments.positionSizeMultiplier.toFixed(2)}x
            </strong>
            {' · '}
            Live:{' '}
            <strong>
              {report.recommendedAdjustments.pauseLive
                ? 'paused'
                : 'manual review allowed'}
            </strong>
          </div>
          <ul className="mt-3 space-y-1 text-xs text-[var(--theme-muted)]">
            {report.recommendedAdjustments.reasons.map((reason) => (
              <li key={reason}>{reason}</li>
            ))}
          </ul>
          <button
            type="button"
            onClick={applySafeguards}
            disabled={busy}
            className="mt-4 rounded-xl border border-[color-mix(in_srgb,var(--theme-success)_30%,transparent)] bg-[color-mix(in_srgb,var(--theme-success)_15%,transparent)] px-4 py-2 text-sm font-medium text-[var(--theme-success)] hover:bg-[color-mix(in_srgb,var(--theme-success)_25%,transparent)] disabled:opacity-50"
          >
            {busy ? 'Applying…' : 'Apply recommended safeguards'}
          </button>
          <button
            type="button"
            onClick={applyStrategyRecommendations}
            disabled={busy || overrideRecommendationCount === 0}
            className="ml-2 mt-4 rounded-xl border border-[color-mix(in_srgb,var(--theme-warning)_30%,transparent)] bg-[color-mix(in_srgb,var(--theme-warning)_15%,transparent)] px-4 py-2 text-sm font-medium text-[var(--theme-warning)] hover:bg-[color-mix(in_srgb,var(--theme-warning)_25%,transparent)] disabled:opacity-50"
          >
            {busy
              ? 'Applying…'
              : `Apply strategy overrides${overrideRecommendationCount ? ` (${overrideRecommendationCount})` : ''}`}
          </button>
        </div>

        <div className="rounded-2xl border border-[var(--theme-border)]/70 bg-[color-mix(in_srgb,var(--theme-text)_8%,transparent)] p-4">
          <h3 className="text-sm font-semibold">Checks</h3>
          <div className="mt-3 grid grid-cols-2 gap-2 text-xs">
            {checks.map(([label, ok]) => (
              <div
                key={String(label)}
                className={`rounded-xl border px-3 py-2 ${ok ? 'border-[color-mix(in_srgb,var(--theme-success)_25%,transparent)] bg-[color-mix(in_srgb,var(--theme-success)_10%,transparent)] text-[var(--theme-success)]' : 'border-[var(--theme-border)] bg-[color-mix(in_srgb,var(--theme-text)_8%,transparent)] text-[var(--theme-muted)]'}`}
              >
                {label}: {ok ? 'yes' : 'no'}
              </div>
            ))}
          </div>
        </div>
      </div>

      <div className="mt-4 grid gap-4 lg:grid-cols-2">
        <div>
          <h3 className="text-sm font-semibold">Findings</h3>
          <div className="mt-2 space-y-2">
            {report.findings.length === 0 ? (
              <p className="rounded-2xl border border-[color-mix(in_srgb,var(--theme-success)_25%,transparent)] bg-[color-mix(in_srgb,var(--theme-success)_10%,transparent)] p-3 text-sm text-[var(--theme-success)]">
                No validation issues found in the current sample.
              </p>
            ) : (
              report.findings.map((finding) => (
                <div
                  key={`${finding.severity}-${finding.title}`}
                  className={`rounded-2xl border p-3 text-sm ${findingTone(finding.severity)}`}
                >
                  <div className="font-medium">{finding.title}</div>
                  <div className="mt-1 text-xs opacity-90">
                    {finding.detail}
                  </div>
                </div>
              ))
            )}
          </div>
        </div>

        <div>
          <h3 className="text-sm font-semibold">Strategy validation</h3>
          <div className="mt-2 space-y-2">
            {report.byStrategy.length === 0 ? (
              <p className="rounded-2xl border border-[var(--theme-border)] bg-[color-mix(in_srgb,var(--theme-text)_8%,transparent)] p-3 text-sm text-[var(--theme-muted)]">
                No strategy has enough outcomes yet.
              </p>
            ) : (
              report.byStrategy.slice(0, 5).map((strategy) => {
                const override = activeOverrideByStrategy.get(
                  strategy.strategyId,
                )
                return (
                  <div
                    key={strategy.strategyId}
                    className="rounded-2xl border border-[var(--theme-border)]/70 bg-[color-mix(in_srgb,var(--theme-text)_8%,transparent)] p-3 text-sm"
                  >
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <span className="font-medium">{strategy.strategyId}</span>
                      <div className="flex flex-wrap justify-end gap-1.5">
                        <span className="rounded-full border border-[var(--theme-border)] px-2 py-0.5 text-[10px] text-[var(--theme-muted)]">
                          {strategy.recommendation}
                        </span>
                        {override ? (
                          <span
                            className={`rounded-full border px-2 py-0.5 text-[10px] ${overrideTone(override)}`}
                          >
                            {overrideLabel(override)}
                          </span>
                        ) : null}
                      </div>
                    </div>
                    <div className="mt-1 text-xs text-[var(--theme-muted)]">
                      {strategy.trades} trades · {pct(strategy.winRate)} win ·{' '}
                      {usdt(strategy.totalPnlQuote)} total · streak{' '}
                      {strategy.lossStreak}
                    </div>
                    {override ? (
                      <div className="mt-2 text-xs text-[var(--theme-muted)]">
                        Updated {formatDateTime(override.updatedAt)}
                        {overrideLifecycleLabel(override)
                          ? ` · ${overrideLifecycleLabel(override)}`
                          : ''}
                        {override.reason ? ` · ${override.reason}` : ''}
                      </div>
                    ) : null}
                  </div>
                )
              })
            )}
          </div>
        </div>
      </div>
    </section>
  )
}

function SelfImprovementPanel({
  report,
  summary,
  onPayload,
}: {
  report: LearningReport
  summary: FinancePayload['summary']
  onPayload: (payload: FinancePayload) => void
}) {
  const { run, busy, error } = useFinanceAction<
    FinancePayload & {
      learningCycle?: LearningCycleResult
      learningCandidateResult?: {
        candidate: LearningCandidate | null
        applied: boolean
        skippedReason: string | null
      }
    }
  >(onPayload)
  const [message, setMessage] = useState<string | null>(null)
  const latest = report.latestCandidate
  const paperMode = summary.tradingMode === 'paper_trade'
  const testnetMode = summary.tradingMode === 'testnet_execute'
  const canApplyInCurrentMode = paperMode || testnetMode
  const pct = formatFractionPct
  const statusLabel = (status: LearningCandidateStatus) =>
    status.replace(/_/g, ' ')
  const candidateTone = (
    status: LearningCandidateStatus,
  ): 'neutral' | 'good' | 'warn' | 'danger' =>
    status === 'paper_applied' ||
    status === 'testnet_applied' ||
    status === 'testnet_ready' ||
    status === 'live_review_ready'
      ? 'good'
      : status === 'proposed'
        ? 'warn'
        : status === 'rejected'
          ? 'danger'
          : 'neutral'
  const candidateClass = (status: LearningCandidateStatus) =>
    status === 'paper_applied' ||
    status === 'testnet_applied' ||
    status === 'testnet_ready' ||
    status === 'live_review_ready'
      ? 'border-[color-mix(in_srgb,var(--theme-success)_25%,transparent)] bg-[color-mix(in_srgb,var(--theme-success)_10%,transparent)] text-[var(--theme-success)]'
      : status === 'proposed'
        ? 'border-[color-mix(in_srgb,var(--theme-warning)_25%,transparent)] bg-[color-mix(in_srgb,var(--theme-warning)_10%,transparent)] text-[var(--theme-warning)]'
        : status === 'rejected'
          ? 'border-[color-mix(in_srgb,var(--theme-danger)_25%,transparent)] bg-[color-mix(in_srgb,var(--theme-danger)_10%,transparent)] text-[var(--theme-danger)]'
          : 'border-[var(--theme-border)] bg-[color-mix(in_srgb,var(--theme-text)_8%,transparent)] text-[var(--theme-muted)]'
  const patchLabel = (candidate: LearningCandidate) => {
    const parts: Array<string> = []
    if (candidate.configPatch.quotePerTrade !== undefined) {
      parts.push(`size ${formatUsdt(candidate.configPatch.quotePerTrade)}`)
    }
    if (candidate.strategyOverrides.length > 0) {
      parts.push(
        `${candidate.strategyOverrides.length} strategy override${
          candidate.strategyOverrides.length === 1 ? '' : 's'
        }`,
      )
    }
    return parts.length ? parts.join(' · ') : 'review only'
  }
  const canApplyCandidate = (candidate: LearningCandidate) =>
    candidate.status === 'proposed' && canApplyInCurrentMode

  async function runLearningCycle() {
    setMessage(null)
    const data = await run({ action: 'run_learning_cycle' }, 'run')
    if (data) {
      const cycle = data.learningCycle
      if (cycle?.appliedCandidate) {
        setMessage(
          `Applied ${cycle.appliedCandidate.id}: ${patchLabel(
            cycle.appliedCandidate,
          )}.`,
        )
      } else if (cycle?.generatedCandidate) {
        setMessage(
          `Generated ${statusLabel(cycle.generatedCandidate.status)} candidate ${cycle.generatedCandidate.id}.`,
        )
      } else {
        setMessage(cycle?.skippedReason ?? 'Learning cycle completed.')
      }
    }
  }

  async function applyCandidate(candidateId: string) {
    setMessage(null)
    const data = await run(
      { action: 'apply_learning_candidate', candidateId },
      candidateId,
    )
    if (data) {
      const result = data.learningCandidateResult
      setMessage(
        result?.applied && result.candidate
          ? `Applied ${result.candidate.id}: ${patchLabel(result.candidate)}.`
          : (result?.skippedReason ?? 'Learning candidate was not applied.'),
      )
    }
  }

  return (
    <section className="mt-6 rounded-3xl border border-[var(--theme-border)] bg-[var(--theme-panel)]/70 p-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold">Self-improvement loop</h2>
          <p className="text-xs text-[var(--theme-muted)]">
            Closed-trade evidence, paper-only risk reduction, and explicit
            review packages for higher-risk modes.
          </p>
        </div>
        <button
          type="button"
          onClick={runLearningCycle}
          disabled={busy !== null}
          className="rounded-xl border border-[color-mix(in_srgb,var(--theme-success)_30%,transparent)] bg-[color-mix(in_srgb,var(--theme-success)_15%,transparent)] px-4 py-2 text-sm font-medium text-[var(--theme-success)] hover:bg-[color-mix(in_srgb,var(--theme-success)_25%,transparent)] disabled:opacity-50"
        >
          {busy === 'run' ? 'Running…' : 'Run learning cycle'}
        </button>
      </div>

      {(message || error) && (
        <p
          className={`mt-3 rounded-xl border p-2 text-sm ${error ? 'border-[color-mix(in_srgb,var(--theme-danger)_30%,transparent)] bg-[color-mix(in_srgb,var(--theme-danger)_10%,transparent)] text-[var(--theme-danger)]' : 'border-[color-mix(in_srgb,var(--theme-success)_30%,transparent)] bg-[color-mix(in_srgb,var(--theme-success)_10%,transparent)] text-[var(--theme-success)]'}`}
        >
          {error ?? message}
        </p>
      )}

      <div className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard
          label="Policy"
          value={report.policy.enabled ? 'Enabled' : 'Disabled'}
          tone={report.policy.enabled ? 'good' : 'danger'}
        />
        <StatCard
          label="Auto apply"
          value={
            report.policy.autoApplyModes.length === 0
              ? 'Manual'
              : report.policy.autoApplyModes
                  .map((m) => (m === 'paper_trade' ? 'Paper' : 'Testnet'))
                  .join(' + ')
          }
          tone={report.policy.autoApplyModes.length > 0 ? 'good' : 'warn'}
        />
        <StatCard
          label="Stability"
          value={report.stability.passed ? 'Passed' : 'Waiting'}
          tone={report.stability.passed ? 'good' : 'warn'}
        />
        <StatCard
          label="Latest"
          value={latest ? statusLabel(latest.status) : 'None'}
          tone={latest ? candidateTone(latest.status) : 'neutral'}
        />
        <StatCard
          label="Closed trades"
          value={`${report.stability.closedTrades}`}
          tone={report.stability.closedTrades >= 30 ? 'good' : 'warn'}
        />
        <StatCard
          label="Evidence days"
          value={report.stability.evidenceDays.toFixed(1)}
          tone={report.stability.evidenceDays >= 14 ? 'good' : 'warn'}
        />
        <StatCard
          label="Profit factor"
          value={report.stability.profitFactor.toFixed(2)}
          tone={report.stability.profitFactor >= 1.3 ? 'good' : 'warn'}
        />
        <StatCard
          label="Net P/L"
          value={formatUsdt(report.stability.totalPnlQuote)}
          tone={report.stability.totalPnlQuote > 0 ? 'good' : 'danger'}
        />
      </div>

      <div className="mt-4 grid gap-4 lg:grid-cols-[0.9fr_1.1fr]">
        <div className="rounded-2xl border border-[var(--theme-border)]/70 bg-[color-mix(in_srgb,var(--theme-text)_8%,transparent)] p-4">
          <h3 className="text-sm font-semibold">Gate checks</h3>
          <div className="mt-3 grid gap-2 text-xs">
            <div
              className={`rounded-xl border px-3 py-2 ${
                report.stability.maxDrawdown <=
                report.stability.maxDrawdownLimit
                  ? 'border-[color-mix(in_srgb,var(--theme-success)_25%,transparent)] bg-[color-mix(in_srgb,var(--theme-success)_10%,transparent)] text-[var(--theme-success)]'
                  : 'border-[color-mix(in_srgb,var(--theme-danger)_25%,transparent)] bg-[color-mix(in_srgb,var(--theme-danger)_10%,transparent)] text-[var(--theme-danger)]'
              }`}
            >
              Drawdown {formatUsdt(report.stability.maxDrawdown)} /{' '}
              {formatUsdt(report.stability.maxDrawdownLimit)}
            </div>
            <div
              className={`rounded-xl border px-3 py-2 ${
                report.stability.hasCriticalFinding
                  ? 'border-[color-mix(in_srgb,var(--theme-danger)_25%,transparent)] bg-[color-mix(in_srgb,var(--theme-danger)_10%,transparent)] text-[var(--theme-danger)]'
                  : 'border-[color-mix(in_srgb,var(--theme-success)_25%,transparent)] bg-[color-mix(in_srgb,var(--theme-success)_10%,transparent)] text-[var(--theme-success)]'
              }`}
            >
              Critical finding:{' '}
              {report.stability.hasCriticalFinding ? 'yes' : 'no'}
            </div>
            {report.stability.reasons.length === 0 ? (
              <div className="rounded-xl border border-[color-mix(in_srgb,var(--theme-success)_25%,transparent)] bg-[color-mix(in_srgb,var(--theme-success)_10%,transparent)] px-3 py-2 text-[var(--theme-success)]">
                Conservative gate passed.
              </div>
            ) : (
              report.stability.reasons.map((reason) => (
                <div
                  key={reason}
                  className="rounded-xl border border-[var(--theme-border)] bg-[color-mix(in_srgb,var(--theme-text)_8%,transparent)] px-3 py-2 text-[var(--theme-muted)]"
                >
                  {reason}
                </div>
              ))
            )}
          </div>
        </div>

        <div className="rounded-2xl border border-[var(--theme-border)]/70 bg-[color-mix(in_srgb,var(--theme-text)_8%,transparent)] p-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h3 className="text-sm font-semibold">Latest candidate</h3>
            {latest ? (
              <span
                className={`rounded-full border px-2.5 py-1 text-xs capitalize ${candidateClass(latest.status)}`}
              >
                {statusLabel(latest.status)}
              </span>
            ) : null}
          </div>
          {latest ? (
            <>
              <p className="mt-2 text-sm text-[var(--theme-text)]">
                {latest.reason}
              </p>
              <div className="mt-3 grid gap-2 text-xs sm:grid-cols-2">
                <div className="rounded-xl border border-[var(--theme-border)] bg-[color-mix(in_srgb,var(--theme-text)_8%,transparent)] px-3 py-2 text-[var(--theme-muted)]">
                  Created {formatDateTime(latest.createdAt)}
                </div>
                <div className="rounded-xl border border-[var(--theme-border)] bg-[color-mix(in_srgb,var(--theme-text)_8%,transparent)] px-3 py-2 text-[var(--theme-muted)]">
                  Mode {latest.modeAtCreation}
                </div>
                <div className="rounded-xl border border-[var(--theme-border)] bg-[color-mix(in_srgb,var(--theme-text)_8%,transparent)] px-3 py-2 text-[var(--theme-muted)]">
                  Patch {patchLabel(latest)}
                </div>
                <div className="rounded-xl border border-[var(--theme-border)] bg-[color-mix(in_srgb,var(--theme-text)_8%,transparent)] px-3 py-2 text-[var(--theme-muted)]">
                  Promotion {latest.promotion.eligibleFor}
                </div>
                <div className="rounded-xl border border-[var(--theme-border)] bg-[color-mix(in_srgb,var(--theme-text)_8%,transparent)] px-3 py-2 text-[var(--theme-muted)] sm:col-span-2">
                  Validation: {latest.validation.reason}
                </div>
              </div>
              {latest.status === 'proposed' ? (
                <button
                  type="button"
                  onClick={() => void applyCandidate(latest.id)}
                  disabled={busy !== null || !canApplyCandidate(latest)}
                  className="mt-4 rounded-xl border border-[color-mix(in_srgb,var(--theme-success)_30%,transparent)] bg-[color-mix(in_srgb,var(--theme-success)_15%,transparent)] px-4 py-2 text-sm font-medium text-[var(--theme-success)] hover:bg-[color-mix(in_srgb,var(--theme-success)_25%,transparent)] disabled:opacity-50"
                >
                  {busy === latest.id
                    ? 'Applying…'
                    : paperMode
                      ? 'Apply paper candidate'
                      : testnetMode
                        ? 'Apply testnet candidate'
                        : 'Paper or testnet mode required'}
                </button>
              ) : null}
            </>
          ) : (
            <p className="mt-2 text-sm text-[var(--theme-muted)]">
              No learning candidates yet.
            </p>
          )}
        </div>
      </div>

      {report.candidates.length > 0 && (
        <div className="mt-4 overflow-x-auto">
          <table className="w-full min-w-[920px] text-left text-sm">
            <thead className="text-xs uppercase tracking-[0.18em] text-[var(--theme-muted)]">
              <tr>
                <th className="border-b border-[var(--theme-border)] py-2 pr-4">
                  Created
                </th>
                <th className="border-b border-[var(--theme-border)] py-2 pr-4">
                  Status
                </th>
                <th className="border-b border-[var(--theme-border)] py-2 pr-4">
                  Evidence
                </th>
                <th className="border-b border-[var(--theme-border)] py-2 pr-4">
                  Patch
                </th>
                <th className="border-b border-[var(--theme-border)] py-2 pr-4">
                  Validation
                </th>
                <th className="border-b border-[var(--theme-border)] py-2 pr-4">
                  Action
                </th>
              </tr>
            </thead>
            <tbody>
              {report.candidates.slice(0, 6).map((candidate) => (
                <tr
                  key={candidate.id}
                  className="align-top text-[var(--theme-text)]"
                >
                  <td className="whitespace-nowrap border-b border-[var(--theme-border)]/60 py-2 pr-4">
                    {formatDateTime(candidate.createdAt)}
                  </td>
                  <td className="border-b border-[var(--theme-border)]/60 py-2 pr-4">
                    <span
                      className={`rounded-full border px-2 py-0.5 text-xs capitalize ${candidateClass(candidate.status)}`}
                    >
                      {statusLabel(candidate.status)}
                    </span>
                  </td>
                  <td className="border-b border-[var(--theme-border)]/60 py-2 pr-4 text-xs text-[var(--theme-muted)]">
                    {candidate.metrics.closedTrades} trades ·{' '}
                    {pct(candidate.metrics.winRate)} win ·{' '}
                    {formatUsdt(candidate.metrics.totalPnlQuote)}
                  </td>
                  <td className="border-b border-[var(--theme-border)]/60 py-2 pr-4 text-xs text-[var(--theme-muted)]">
                    {patchLabel(candidate)}
                  </td>
                  <td className="border-b border-[var(--theme-border)]/60 py-2 pr-4 text-xs text-[var(--theme-muted)]">
                    {candidate.validation.passed ? 'passed' : 'waiting'} ·{' '}
                    {candidate.validation.minBacktestFolds} folds
                  </td>
                  <td className="border-b border-[var(--theme-border)]/60 py-2 pr-4">
                    {candidate.status === 'proposed' ? (
                      <button
                        type="button"
                        onClick={() => void applyCandidate(candidate.id)}
                        disabled={
                          busy !== null || !canApplyCandidate(candidate)
                        }
                        className="rounded-xl border border-[color-mix(in_srgb,var(--theme-success)_30%,transparent)] bg-[color-mix(in_srgb,var(--theme-success)_15%,transparent)] px-3 py-1.5 text-xs font-medium text-[var(--theme-success)] hover:bg-[color-mix(in_srgb,var(--theme-success)_25%,transparent)] disabled:opacity-50"
                      >
                        {busy === candidate.id
                          ? 'Applying…'
                          : canApplyInCurrentMode
                            ? 'Apply'
                            : 'Paper/testnet only'}
                      </button>
                    ) : (
                      <span className="text-xs text-[var(--theme-muted)]">
                        {candidate.promotion.requiresApproval
                          ? 'Review'
                          : 'Done'}
                      </span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  )
}

const LIVE_PRICE_HISTORY_LIMIT = 60
const LIVE_PRICE_RECONNECT_DELAY_MS = 5000

interface LivePriceState {
  price: number
  changePercent: number
  history: Array<{ t: number; price: number }>
}

const LIVE_PRICE_FLUSH_INTERVAL_MS = 1000

function LivePriceTicker({ symbols }: { symbols: Array<string> }) {
  const [prices, setPrices] = useState<Map<string, LivePriceState>>(new Map())
  const [connected, setConnected] = useState(false)
  // Binance can fire @ticker updates several times a second per symbol —
  // buffer incoming ticks in a ref and flush to React state on a fixed
  // interval so the UI re-renders at most once a second, not on every frame.
  const bufferRef = useRef<Map<string, LivePriceState>>(new Map())
  const dirtyRef = useRef(false)

  useEffect(() => {
    if (symbols.length === 0) return
    let socket: WebSocket | null = null
    let reconnectTimer: ReturnType<typeof setTimeout> | null = null
    let stopped = false

    function connect() {
      const streams = symbols.map((s) => `${s.toLowerCase()}@ticker`).join('/')
      socket = new WebSocket(
        `wss://stream.binance.com:9443/stream?streams=${streams}`,
      )
      socket.onopen = () => setConnected(true)
      socket.onclose = () => {
        setConnected(false)
        if (!stopped)
          reconnectTimer = setTimeout(connect, LIVE_PRICE_RECONNECT_DELAY_MS)
      }
      socket.onerror = () => {
        socket?.close()
      }
      socket.onmessage = (event) => {
        try {
          const parsed = JSON.parse(event.data as string) as {
            data?: { s?: string; c?: string; P?: string }
          }
          const d = parsed.data
          if (!d?.s || !d.c) return
          const symbol = d.s
          const price = Number(d.c)
          const changePercent = Number(d.P ?? 0)
          if (!Number.isFinite(price)) return
          const existing = bufferRef.current.get(symbol)
          const history = [
            ...(existing?.history ?? []),
            { t: Date.now(), price },
          ].slice(-LIVE_PRICE_HISTORY_LIMIT)
          bufferRef.current.set(symbol, { price, changePercent, history })
          dirtyRef.current = true
        } catch {
          // malformed frame — skip, never crash the ticker
        }
      }
    }

    connect()
    const flushTimer = setInterval(() => {
      if (!dirtyRef.current) return
      dirtyRef.current = false
      setPrices(new Map(bufferRef.current))
    }, LIVE_PRICE_FLUSH_INTERVAL_MS)

    return () => {
      stopped = true
      clearInterval(flushTimer)
      if (reconnectTimer) clearTimeout(reconnectTimer)
      socket?.close()
    }
  }, [symbols])

  if (symbols.length === 0) return null

  return (
    <section className="mt-6 rounded-3xl border border-[var(--theme-border)] bg-[var(--theme-panel)]/70 p-5">
      <div className="flex items-center justify-between gap-3">
        <h2 className="text-lg font-semibold">Live prices</h2>
        <span
          className={`rounded-full border px-2.5 py-1 text-xs ${
            connected
              ? 'border-[color-mix(in_srgb,var(--theme-success)_30%,transparent)] bg-[color-mix(in_srgb,var(--theme-success)_10%,transparent)] text-[var(--theme-success)]'
              : 'border-[var(--theme-border)] bg-[color-mix(in_srgb,var(--theme-text)_8%,transparent)] text-[var(--theme-muted)]'
          }`}
        >
          {connected ? 'Live' : 'Connecting...'}
        </span>
      </div>
      <p className="mt-1 text-xs text-[var(--theme-muted)]">
        Direct from Binance's public market stream, for your own monitoring —
        the engine itself still runs on its own 5/15-minute cycle.
      </p>
      <div className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
        {symbols.map((symbol) => {
          const state = prices.get(symbol)
          const changeTone =
            state && state.changePercent > 0
              ? 'text-[var(--theme-success)]'
              : state && state.changePercent < 0
                ? 'text-[var(--theme-danger)]'
                : 'text-[var(--theme-muted)]'
          return (
            <div
              key={symbol}
              className="rounded-2xl border border-[var(--theme-border)]/70 bg-[color-mix(in_srgb,var(--theme-text)_8%,transparent)] p-3"
            >
              <div className="flex items-center justify-between">
                <span className="text-sm font-semibold">{symbol}</span>
                <span className={`text-xs ${changeTone}`}>
                  {state
                    ? `${state.changePercent > 0 ? '+' : ''}${state.changePercent.toFixed(2)}%`
                    : '...'}
                </span>
              </div>
              <div className="mt-1 text-lg font-semibold">
                {state ? formatUsdt(state.price) : '...'}
              </div>
              <div className="mt-2 h-10 w-full">
                {state && state.history.length > 1 ? (
                  <ResponsiveContainer width="100%" height="100%">
                    <AreaChart data={state.history}>
                      <defs>
                        <linearGradient
                          id={`spark-${symbol}`}
                          x1="0"
                          y1="0"
                          x2="0"
                          y2="1"
                        >
                          <stop
                            offset="0%"
                            stopColor="var(--theme-success)"
                            stopOpacity={0.4}
                          />
                          <stop
                            offset="100%"
                            stopColor="var(--theme-success)"
                            stopOpacity={0}
                          />
                        </linearGradient>
                      </defs>
                      <Area
                        type="monotone"
                        dataKey="price"
                        stroke="var(--theme-success)"
                        strokeWidth={1.5}
                        fill={`url(#spark-${symbol})`}
                        isAnimationActive={false}
                        dot={false}
                      />
                    </AreaChart>
                  </ResponsiveContainer>
                ) : null}
              </div>
            </div>
          )
        })}
      </div>
    </section>
  )
}

type NewsResearchItem = {
  id: string
  sourceName: string
  sourceUrl: string | null
  publishDate: string | null
  relatedSymbol: string
  summary: string
}

type NewsIngestion = {
  fetched: number
  stored: number
}

type IntelligenceRefresh = {
  researchOnly: boolean
  composite: {
    symbol: string
    score: number | null
    label: 'positive' | 'neutral' | 'negative' | 'mixed' | 'unknown'
    confidence: number
    freshness: number
    sourceIds: Array<string>
    disagreement: boolean
    blockers: Array<string>
    observedAt: string
  }
  stored: {
    stored: boolean
    risk: {
      riskLevel: string
      riskScore: number
    }
  }
}

const DEFAULT_NEWS_SYMBOLS = ['BTCUSDT', 'ETHUSDT', 'SOLUSDT']
const BINANCE_SYMBOL_PATTERN = /^[A-Z0-9]{5,20}$/

function normalizeBinanceSymbol(value: string): string {
  return value.trim().toUpperCase()
}

function safeExternalUrl(value: unknown): string | null {
  if (typeof value !== 'string') return null
  try {
    const url = new URL(value)
    return url.protocol === 'https:' || url.protocol === 'http:'
      ? url.toString()
      : null
  } catch {
    return null
  }
}

function normalizedNewsItem(
  value: Record<string, unknown>,
): NewsResearchItem | null {
  const summary = typeof value.summary === 'string' ? value.summary.trim() : ''
  const sourceName =
    typeof value.sourceName === 'string' ? value.sourceName.trim() : ''
  const relatedSymbol =
    typeof value.relatedSymbol === 'string'
      ? normalizeBinanceSymbol(value.relatedSymbol)
      : ''
  if (!summary || !sourceName || !BINANCE_SYMBOL_PATTERN.test(relatedSymbol))
    return null
  const publishDate =
    typeof value.publishDate === 'string' ? value.publishDate : null
  return {
    id:
      typeof value.id === 'string'
        ? value.id
        : `${relatedSymbol}:${sourceName}:${summary}`,
    sourceName,
    sourceUrl: safeExternalUrl(value.sourceUrl),
    publishDate:
      publishDate && !Number.isNaN(Date.parse(publishDate))
        ? publishDate
        : null,
    relatedSymbol,
    summary,
  }
}

function formatNewsTime(value: string | null): string {
  if (!value) return 'Publication time unavailable'
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(new Date(value))
}

function NewsResearchPanel({
  payload,
  onPayload,
}: {
  payload: FinancePayload
  onPayload: (payload: FinancePayload) => void
}) {
  const configuredSymbols = Array.isArray(
    (payload.settings.demoTrading as Record<string, unknown> | undefined)
      ?.symbols,
  )
    ? (
        (payload.settings.demoTrading as Record<string, unknown>)
          .symbols as Array<unknown>
      )
        .filter((value): value is string => typeof value === 'string')
        .map(normalizeBinanceSymbol)
        .filter((value) => BINANCE_SYMBOL_PATTERN.test(value))
    : []
  const symbols = Array.from(
    new Set([...configuredSymbols, ...DEFAULT_NEWS_SYMBOLS]),
  )
  const [symbolInput, setSymbolInput] = useState(symbols[0] ?? 'BTCUSDT')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [result, setResult] = useState<NewsIngestion | null>(null)
  const symbol = normalizeBinanceSymbol(symbolInput)
  const isValidSymbol = BINANCE_SYMBOL_PATTERN.test(symbol)
  const newsItems = payload.data.news_items
    .map(normalizedNewsItem)
    .filter(
      (item): item is NewsResearchItem =>
        item !== null && item.relatedSymbol === symbol,
    )
    .sort(
      (left, right) =>
        (right.publishDate ? Date.parse(right.publishDate) : 0) -
        (left.publishDate ? Date.parse(left.publishDate) : 0),
    )
    .slice(0, 6)

  async function fetchNews() {
    if (!isValidSymbol) {
      setError(
        'Enter a Binance spot symbol using 5–20 letters or numbers, for example BTCUSDT.',
      )
      return
    }
    setBusy(true)
    setError(null)
    setResult(null)
    try {
      const response = await fetch('/api/finance', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'fetch_news', symbol }),
      })
      const data = (await response.json()) as FinancePayload & {
        error?: string
        newsIngestion?: NewsIngestion
      }
      if (!response.ok || data.ok === false) {
        throw new Error(data.error || `HTTP ${response.status}`)
      }
      onPayload(data)
      setResult(data.newsIngestion ?? { fetched: 0, stored: 0 })
    } catch (nextError) {
      setError(
        nextError instanceof Error
          ? nextError.message
          : 'News research request failed',
      )
    } finally {
      setBusy(false)
    }
  }

  return (
    <section
      className="mt-6 rounded-3xl border border-[color-mix(in_srgb,var(--theme-accent-secondary)_25%,transparent)] bg-[var(--theme-panel)]/70 p-5"
      aria-label="Trading news research"
    >
      <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-[color-mix(in_srgb,var(--theme-accent-secondary)_80%,transparent)]">
            Research only
          </p>
          <h2 className="mt-1 text-lg font-semibold">News Research</h2>
          <p className="mt-1 max-w-2xl text-sm text-[var(--theme-muted)]">
            Fetches public Google News RSS for a Binance spot symbol. This does
            not create plans, orders, or executions.
          </p>
        </div>
        <div className="flex flex-wrap items-end gap-2">
          <label className="grid gap-1 text-xs font-medium text-[var(--theme-muted)]">
            Binance symbol
            <input
              list="finance-news-symbols"
              value={symbolInput}
              onChange={(event) => setSymbolInput(event.target.value)}
              className="w-36 rounded-xl border border-[var(--theme-border)] bg-[color-mix(in_srgb,var(--theme-text)_8%,transparent)] px-3 py-2 text-sm text-[var(--theme-text)]"
              aria-invalid={!isValidSymbol}
              aria-describedby="finance-news-symbol-help"
              placeholder="BTCUSDT"
            />
          </label>
          <datalist id="finance-news-symbols">
            {symbols.map((option) => (
              <option key={option} value={option} />
            ))}
          </datalist>
          <button
            type="button"
            onClick={() => void fetchNews()}
            disabled={busy || !isValidSymbol}
            className="rounded-xl bg-[color-mix(in_srgb,var(--theme-accent-secondary)_20%,transparent)] px-4 py-2 text-sm font-semibold text-[var(--theme-accent-secondary)] transition-colors hover:bg-[color-mix(in_srgb,var(--theme-accent-secondary)_30%,transparent)] disabled:cursor-not-allowed disabled:opacity-50"
          >
            {busy ? 'Fetching…' : 'Fetch news'}
          </button>
        </div>
      </div>
      <p
        id="finance-news-symbol-help"
        className="mt-2 text-xs text-[var(--theme-muted)]"
      >
        Choose a configured symbol or enter a 5–20 character Binance spot
        symbol.
      </p>
      {error && (
        <p
          className="mt-3 rounded-xl border border-[color-mix(in_srgb,var(--theme-danger)_30%,transparent)] bg-[color-mix(in_srgb,var(--theme-danger)_10%,transparent)] px-3 py-2 text-sm text-[var(--theme-danger)]"
          role="alert"
        >
          {error}
        </p>
      )}
      {result && (
        <p
          className="mt-3 rounded-xl border border-[color-mix(in_srgb,var(--theme-success)_25%,transparent)] bg-[color-mix(in_srgb,var(--theme-success)_10%,transparent)] px-3 py-2 text-sm text-[var(--theme-success)]"
          role="status"
        >
          Research refreshed for {symbol}: fetched {result.fetched}, stored{' '}
          {result.stored} new item{result.stored === 1 ? '' : 's'}.
        </p>
      )}
      <div className="mt-4 space-y-2" aria-live="polite">
        {newsItems.length === 0 ? (
          <p className="rounded-2xl border border-[var(--theme-border)]/70 bg-[color-mix(in_srgb,var(--theme-text)_8%,transparent)] p-3 text-sm text-[var(--theme-muted)]">
            No normalized news items stored for {symbol}. Fetch research to
            refresh this list.
          </p>
        ) : (
          newsItems.map((item) => (
            <article
              key={item.id}
              className="rounded-2xl border border-[var(--theme-border)]/70 bg-[color-mix(in_srgb,var(--theme-text)_8%,transparent)] p-3"
            >
              <p className="text-sm leading-5 text-[var(--theme-text)]">
                {item.summary}
              </p>
              <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-[var(--theme-muted)]">
                <span>{item.sourceName}</span>
                <time dateTime={item.publishDate ?? undefined}>
                  {formatNewsTime(item.publishDate)}
                </time>
                {item.sourceUrl && (
                  <a
                    href={item.sourceUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-[var(--theme-accent-secondary)] underline underline-offset-2 hover:text-[var(--theme-accent-secondary)]"
                  >
                    Open publisher
                  </a>
                )}
              </div>
            </article>
          ))
        )}
      </div>
    </section>
  )
}

function IntelligenceSummaryPanel({
  onPayload,
}: {
  onPayload: (payload: FinancePayload) => void
}) {
  const [symbol, setSymbol] = useState(DEFAULT_NEWS_SYMBOLS[0])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [intelligence, setIntelligence] = useState<IntelligenceRefresh | null>(
    null,
  )

  async function refresh() {
    setBusy(true)
    setError(null)
    try {
      const response = await fetch('/api/finance', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'refresh_intelligence', symbol }),
      })
      const data = (await response.json()) as FinancePayload & {
        error?: string
        intelligence?: IntelligenceRefresh
      }
      if (!response.ok || data.ok === false)
        throw new Error(data.error || `HTTP ${response.status}`)
      onPayload(data)
      setIntelligence(data.intelligence ?? null)
    } catch (nextError) {
      setError(
        nextError instanceof Error
          ? nextError.message
          : 'Intelligence refresh failed',
      )
    } finally {
      setBusy(false)
    }
  }

  const composite = intelligence?.composite
  return (
    <section
      className="mt-6 rounded-3xl border border-[color-mix(in_srgb,var(--theme-accent)_25%,transparent)] bg-[var(--theme-panel)]/70 p-5"
      aria-label="Intelligence summary"
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-[color-mix(in_srgb,var(--theme-accent)_80%,transparent)]">
            Research only
          </p>
          <h2 className="mt-1 text-lg font-semibold">Intelligence Summary</h2>
          <p className="mt-1 text-sm text-[var(--theme-muted)]">
            Derived from stored news. It does not create plans, orders, or
            executions.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <select
            value={symbol}
            onChange={(event) =>
              setSymbol(normalizeBinanceSymbol(event.target.value))
            }
            className="rounded-xl border border-[var(--theme-border)] bg-[color-mix(in_srgb,var(--theme-text)_8%,transparent)] px-3 py-2 text-sm text-[var(--theme-text)]"
            aria-label="Intelligence symbol"
          >
            {DEFAULT_NEWS_SYMBOLS.map((option) => (
              <option key={option} value={option}>
                {option}
              </option>
            ))}
          </select>
          <button
            type="button"
            onClick={() => void refresh()}
            disabled={busy}
            className="rounded-xl bg-[color-mix(in_srgb,var(--theme-accent)_20%,transparent)] px-4 py-2 text-sm font-semibold text-[var(--theme-accent)] transition-colors hover:bg-[color-mix(in_srgb,var(--theme-accent)_30%,transparent)] disabled:cursor-not-allowed disabled:opacity-50"
          >
            {busy ? 'Refreshing…' : 'Refresh'}
          </button>
        </div>
      </div>
      {error && (
        <p className="mt-3 text-sm text-[var(--theme-danger)]" role="alert">
          {error}
        </p>
      )}
      {composite ? (
        <div className="mt-4 grid gap-2 text-sm sm:grid-cols-2 xl:grid-cols-4">
          <p>
            Sentiment: <strong>{composite.label}</strong> (
            {composite.score ?? 'unavailable'})
          </p>
          <p>
            Confidence:{' '}
            <strong>{Math.round(composite.confidence * 100)}%</strong>
          </p>
          <p>
            Freshness: <strong>{Math.round(composite.freshness * 100)}%</strong>
          </p>
          <p>
            Research risk: <strong>{intelligence.stored.risk.riskLevel}</strong>
          </p>
          <p className="sm:col-span-2">
            Evidence: {composite.sourceIds.length} stored source
            {composite.sourceIds.length === 1 ? '' : 's'}
          </p>
          <p className="sm:col-span-2">
            Updated: {formatDateTime(composite.observedAt)}
          </p>
          {composite.blockers.length > 0 && (
            <p className="sm:col-span-2 text-[var(--theme-warning)]">
              Caution: {composite.blockers.join('; ')}.
            </p>
          )}
        </div>
      ) : (
        <p className="mt-4 text-sm text-[var(--theme-muted)]">
          Refresh to summarize the latest stored research for this symbol.
        </p>
      )}
    </section>
  )
}

export function TradingScreen() {
  const [payload, setPayload] = useState<FinancePayload | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let cancelled = false
    async function load() {
      setLoading(true)
      try {
        const response = await fetch('/api/finance', { cache: 'no-store' })
        if (!response.ok)
          throw new Error(`Finance API returned HTTP ${response.status}`)
        const data = (await response.json()) as FinancePayload
        if (!cancelled) {
          setPayload(data)
          setError(null)
        }
      } catch (nextError) {
        if (!cancelled)
          setError(
            nextError instanceof Error
              ? nextError.message
              : 'Finance API failed',
          )
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    void load()
    return () => {
      cancelled = true
    }
  }, [])

  const summary = payload?.summary

  if (loading) {
    return (
      <main className="min-h-dvh bg-[var(--theme-bg)] p-6 text-[var(--theme-muted)]">
        Loading Trading section…
      </main>
    )
  }

  if (error || !payload || !summary) {
    return (
      <main className="min-h-dvh bg-[var(--theme-bg)] p-6 text-[var(--theme-danger)]">
        <h1 className="text-2xl font-semibold">Trading unavailable</h1>
        <p className="mt-2 text-sm">{error ?? 'No payload returned.'}</p>
      </main>
    )
  }

  return (
    <main className="min-h-dvh overflow-y-auto bg-[var(--theme-bg)] px-4 py-5 text-[var(--theme-text)] md:px-8 md:py-8">
      <section className="rounded-[2rem] border border-[var(--theme-border)] bg-gradient-to-br from-[var(--theme-panel)] via-[var(--theme-panel)] to-emerald-950/20 p-6 shadow-xl">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <p className="text-xs uppercase tracking-[0.28em] text-[color-mix(in_srgb,var(--theme-success)_80%,transparent)]">
              Hermes Trading Engine
            </p>
            <h1 className="mt-2 text-3xl font-semibold md:text-4xl">
              Staged Binance trading — paper first, sandbox next, live only
              with explicit approval
            </h1>
            <p className="mt-3 max-w-3xl text-sm leading-6 text-[var(--theme-muted)]">
              Council, grid, rebalance, and LLM signal engines share risk
              controls, audit logs, paper validation, Binance sandbox
              verification, and gated real-money execution. Existing
              compatibility routes may still use the legacy “demo” name
              internally.
            </p>
          </div>
          <div className="rounded-2xl border border-[color-mix(in_srgb,var(--theme-success)_25%,transparent)] bg-[color-mix(in_srgb,var(--theme-success)_10%,transparent)] px-4 py-3 text-sm text-[var(--theme-success)]">
            Mode: <strong>{summary.tradingMode}</strong>
            <br />
            Account: <strong>{summary.executionAccount}</strong>
            <br />
            Kill switch:{' '}
            <strong>
              {summary.emergencyKillSwitch ? 'active' : 'inactive'}
            </strong>
          </div>
        </div>
      </section>

      <NextRecommendationCard recommendation={payload.nextRecommendation} />
      <AccountOverviewCard />
      <DashboardGroup
        title="Current account and safety"
        description="See the account state first, then confirm the active mode and emergency protection."
      >
        <LiveReadinessCard
          payload={payload}
          onPayload={(next) => setPayload(next as FinancePayload)}
        />
        <TradingSummaryStrip />
        <TradingControls summary={summary} onPayload={setPayload} />
      </DashboardGroup>

      <DashboardGroup
        title="Market and performance"
        description="Review live market context, research, and the results produced by the engines."
      >
        <LivePriceTicker
          symbols={
            Array.isArray(
              (
                payload.settings.demoTrading as
                  | Record<string, unknown>
                  | undefined
              )?.symbols,
            )
              ? ((payload.settings.demoTrading as Record<string, unknown>)
                  .symbols as Array<string>)
              : []
          }
        />
        <NewsResearchPanel payload={payload} onPayload={setPayload} />
        <IntelligenceSummaryPanel onPayload={setPayload} />
        <PerformancePanel perf={payload.demoPerformance} />
        <StrategyEligibilityAuditPanel audit={payload.strategyEligibilityAudit} />
        <PaperDecisionQualityPanel report={payload.paperDecisionQuality} />
        <DecisionQualityPanel
          report={payload.decisionQuality}
          overrides={payload.strategyOverrides}
          onPayload={setPayload}
        />
      </DashboardGroup>

      <DashboardGroup
        title="Evidence and readiness"
        description="Collect stage-separated evidence and understand what is still required before promotion."
      >
        <ValidationRunPanel
          catalog={payload.strategyCatalog}
          state={payload.validationRuns}
          reconciliation={payload.validationReconciliation}
          diagnostics={payload.lastCycleDiagnostics}
          trends={payload.tradingCycleDiagnosticTrends}
          onPayload={setPayload}
        />
      </DashboardGroup>

      <AdvancedDashboardGroup
        title="Advanced strategy and engine controls"
        description="Manage learning, safeguards, strategy overrides, experiments, and signal settings when you need them."
      >
        <SelfImprovementPanel
          report={payload.learning}
          summary={summary}
          onPayload={setPayload}
        />
        <SafeguardHistoryPanel rows={payload.safeguardHistory} />
        <StrategyOverridePanel
          catalog={payload.strategyCatalog}
          state={payload.strategyOverrides}
          onPayload={setPayload}
        />
        <GuardEvidencePanel evidence={payload.guardEvidence} />
        <SandboxExperimentPanel
          catalog={payload.strategyCatalog}
          state={payload.sandboxExperiments}
          onPayload={setPayload}
        />
        <SignalSettingsPanel
          demoTrading={
            (payload.settings.demoTrading as
              | Record<string, unknown>
              | undefined) ?? {}
          }
          onPayload={setPayload}
        />
      </AdvancedDashboardGroup>

      <section className="mt-6 grid gap-4 lg:grid-cols-[1.1fr_0.9fr]">
        <div className="rounded-3xl border border-[var(--theme-border)] bg-[var(--theme-panel)]/70 p-5">
          <h2 className="text-lg font-semibold">Implementation coverage</h2>
          <div className="mt-4 grid gap-2 sm:grid-cols-2">
            {modules.map((item) => (
              <div
                key={item}
                className="rounded-2xl border border-[var(--theme-border)]/70 bg-[color-mix(in_srgb,var(--theme-text)_8%,transparent)] p-3 text-sm text-[var(--theme-muted)]"
              >
                {item}
              </div>
            ))}
          </div>
        </div>
        <div className="rounded-3xl border border-[var(--theme-border)] bg-[var(--theme-panel)]/70 p-5">
          <h2 className="text-lg font-semibold">Alerts and controls</h2>
          <div className="mt-4 space-y-2">
            {payload.alerts.map((alert) => (
              <div
                key={`${alert.title}-${alert.detail}`}
                className="rounded-2xl border border-[var(--theme-border)]/70 bg-[color-mix(in_srgb,var(--theme-text)_8%,transparent)] p-3"
              >
                <div className="text-sm font-medium">{alert.title}</div>
                <div className="text-xs text-[var(--theme-muted)]">
                  {alert.detail}
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      <DashboardGroup
        title="Engine activity and ledger"
        description="Inspect engine-specific activity, open positions, and the complete normalized trading history."
      >
        <DemoTradingPanel />
        <GridTradingPanel />
        <RebalanceCard />
        <LlmSignalCard />
        <TradingLedgerPanel />
      </DashboardGroup>

      <section className="mt-6 rounded-3xl border border-[var(--theme-border)] bg-[var(--theme-panel)]/70 p-5">
        <h2 className="text-lg font-semibold">Phased rollout</h2>
        <ol className="mt-4 grid gap-2 lg:grid-cols-5">
          {phases.map((phase) => (
            <li
              key={phase}
              className="rounded-2xl border border-[var(--theme-border)]/70 bg-[color-mix(in_srgb,var(--theme-text)_8%,transparent)] p-3 text-sm text-[var(--theme-muted)]"
            >
              {phase}
            </li>
          ))}
        </ol>
      </section>

      <section className="mt-6 rounded-3xl border border-[var(--theme-border)] bg-[var(--theme-panel)]/70 p-5 text-sm text-[var(--theme-muted)]">
        <h2 className="text-lg font-semibold text-[var(--theme-text)]">
          Security and storage
        </h2>
        <p className="mt-2">Database: {payload.paths.database}</p>
        <p>
          Storage: {payload.storage.active}
          {payload.storage.postgres.enabled
            ? ` · Postgres ${payload.storage.postgres.database}${payload.storage.postgres.snapshotAvailable ? ' snapshot ready' : ' snapshot pending'}`
            : ''}
        </p>
        {payload.storage.health &&
          payload.storage.health.warnings.length > 0 && (
            <div className="mt-3 rounded-2xl border border-[color-mix(in_srgb,var(--theme-warning)_40%,transparent)] bg-[color-mix(in_srgb,var(--theme-warning)_10%,transparent)] p-3 text-[var(--theme-warning)]">
              <div className="text-xs font-semibold uppercase tracking-[0.16em] text-[var(--theme-warning)]">
                Storage mirror warning
              </div>
              <div className="mt-1 space-y-1">
                {payload.storage.health.warnings.map((warning) => (
                  <p key={warning}>{warning}</p>
                ))}
              </div>
              <p className="mt-2 text-xs text-[color-mix(in_srgb,var(--theme-warning)_80%,transparent)]">
                JSON updated:{' '}
                {payload.storage.health.jsonUpdatedAt ?? 'unknown'} · Postgres
                updated: {payload.storage.health.postgresUpdatedAt ?? 'unknown'}
              </p>
              {payload.storage.health.selfHeal.attempted && (
                <p className="mt-1 text-xs text-[color-mix(in_srgb,var(--theme-warning)_80%,transparent)]">
                  Self-heal:{' '}
                  {payload.storage.health.selfHeal.succeeded
                    ? 'resolved'
                    : 'still unhealthy'}{' '}
                  after {payload.storage.health.selfHeal.attempts} attempt(s)
                </p>
              )}
            </div>
          )}
        <p>Audit log: {payload.paths.auditLog}</p>
        <p>Secrets: {payload.paths.secretStorage}</p>
        <p className="mt-3">
          Tax outputs are estimates only and must be confirmed against official
          sources before filing. Binance is the active trading provider; IBKR is
          future work. Withdrawals, leverage, margin, and futures are disabled
          in policy.
        </p>
      </section>
    </main>
  )
}
