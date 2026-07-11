import { useEffect, useMemo, useRef, useState } from 'react'
import { Area, AreaChart, ResponsiveContainer } from 'recharts'
import { DemoTradingPanel } from './demo-trading-panel'
import { GridTradingPanel } from './grid-trading-panel'

type DecisionQualityFinding = {
  severity: 'info' | 'warning' | 'critical'
  title: string
  detail: string
  evidenceCount?: number
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
  source: 'manual'
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
    totalIncomeLkr: number
    totalExpensesLkr: number
    netSavingsLkr: number
    savingsRate: number
    cashBalanceLkr: number
    taxReserveLkr: number
    debtLkr: number
    netWorthLkr: number
    accountCount: number
    goalCount: number
    taxRecordCount: number
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
  learning: LearningReport
  safeguardHistory: Array<SafeguardHistoryEntry>
  strategyCatalog: Array<StrategyCatalogEntry>
  strategyOverrides: {
    active: Array<StrategyOverride>
    history: Array<StrategyOverrideHistoryEntry>
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
    market_prices: Array<Record<string, unknown>>
    news_items: Array<Record<string, unknown>>
    risk_scores: Array<Record<string, unknown>>
  }
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

function formatLkr(value: number): string {
  return `LKR ${Math.round(value).toLocaleString('en-LK')}`
}

function formatPct(value: number): string {
  return `${value.toFixed(1)}%`
}

function formatUsdt(value: number): string {
  return `${value < 0 ? '-' : ''}${Math.abs(value).toFixed(2)} USDT`
}

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

function textValue(row: Record<string, unknown>, key: string): string {
  const value = row[key]
  if (value == null || value === '') return '—'
  if (typeof value === 'number') return value.toLocaleString('en-LK')
  return String(value)
}

function StatCard({
  label,
  value,
  tone = 'neutral',
}: {
  label: string
  value: string
  tone?: 'neutral' | 'good' | 'warn' | 'danger'
}) {
  const toneClass =
    tone === 'good'
      ? 'text-emerald-200 border-emerald-400/25 bg-emerald-500/10'
      : tone === 'warn'
        ? 'text-amber-200 border-amber-400/25 bg-amber-500/10'
        : tone === 'danger'
          ? 'text-red-200 border-red-400/25 bg-red-500/10'
          : 'text-[var(--theme-text)] border-[var(--theme-border)] bg-[var(--theme-panel)]/70'
  return (
    <div className={`rounded-2xl border p-4 shadow-sm ${toneClass}`}>
      <div className="text-xs uppercase tracking-[0.22em] text-[var(--theme-muted)]">
        {label}
      </div>
      <div className="mt-2 text-2xl font-semibold">{value}</div>
    </div>
  )
}

function DataTable({
  title,
  rows,
  columns,
}: {
  title: string
  rows: Array<Record<string, unknown>>
  columns: Array<string>
}) {
  return (
    <section className="rounded-3xl border border-[var(--theme-border)] bg-[var(--theme-panel)]/70 p-5 shadow-sm">
      <div className="mb-3 flex items-center justify-between gap-3">
        <h2 className="text-lg font-semibold text-[var(--theme-text)]">
          {title}
        </h2>
        <span className="rounded-full border border-[var(--theme-border)] px-2.5 py-1 text-xs text-[var(--theme-muted)]">
          {rows.length} records
        </span>
      </div>
      {rows.length === 0 ? (
        <p className="text-sm text-[var(--theme-muted)]">
          No records yet. Add records through /api/finance or future forms; the
          database is initialized and ready.
        </p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[640px] text-left text-sm">
            <thead className="text-xs uppercase tracking-[0.18em] text-[var(--theme-muted)]">
              <tr>
                {columns.map((column) => (
                  <th
                    key={column}
                    className="border-b border-[var(--theme-border)] py-2 pr-4"
                  >
                    {column}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.slice(-8).map((row, index) => (
                <tr
                  key={String(row.id ?? index)}
                  className="text-[var(--theme-text)]"
                >
                  {columns.map((column) => (
                    <td
                      key={column}
                      className="border-b border-[var(--theme-border)]/60 py-2 pr-4"
                    >
                      {textValue(row, column)}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  )
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
            className="rounded-xl border border-[var(--theme-border)] bg-black/10 px-3 py-1.5 text-xs font-medium text-[var(--theme-text)] hover:bg-black/20 disabled:opacity-40"
          >
            Export CSV
          </button>
        </div>
      </div>

      {rows.length === 0 ? (
        <p className="mt-4 rounded-2xl border border-[var(--theme-border)] bg-black/10 p-3 text-sm text-[var(--theme-muted)]">
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
                      <span className="ml-2 rounded-full border border-amber-400/25 bg-amber-500/10 px-2 py-0.5 text-[10px] text-amber-100">
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
  const [busy, setBusy] = useState<string | null>(null)
  const [message, setMessage] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
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
    setBusy(`${strategyId}:${overrideAction}:${multiplier ?? ''}`)
    setMessage(null)
    setError(null)
    try {
      const res = await fetch('/api/finance', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
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
        }),
      })
      const data = (await res.json()) as FinancePayload & {
        error?: string
        strategyOverrideResult?: { message: string }
      }
      if (!res.ok || data.ok === false)
        throw new Error(data.error || `HTTP ${res.status}`)
      onPayload(data)
      setMessage(
        data.strategyOverrideResult?.message ?? 'Strategy override updated.',
      )
    } catch (nextError) {
      setError(
        nextError instanceof Error
          ? nextError.message
          : 'Strategy override update failed',
      )
    } finally {
      setBusy(null)
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
          <label className="flex items-center gap-2 rounded-xl border border-[var(--theme-border)] bg-black/10 px-3 py-1.5 text-xs text-[var(--theme-muted)]">
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
            className="rounded-xl border border-[var(--theme-border)] bg-black/10 px-3 py-1.5 text-xs font-medium text-[var(--theme-text)] hover:bg-black/20 disabled:opacity-40"
          >
            Export CSV
          </button>
        </div>
      </div>

      {(message || error) && (
        <p
          className={`mt-3 rounded-xl border p-2 text-sm ${error ? 'border-red-400/30 bg-red-500/10 text-red-200' : 'border-emerald-400/30 bg-emerald-500/10 text-emerald-100'}`}
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
              className="rounded-2xl border border-[var(--theme-border)]/70 bg-black/10 p-4"
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
                      ? 'border-red-400/30 bg-red-500/10 text-red-100'
                      : override?.mode === 'reduce_size'
                        ? 'border-amber-400/30 bg-amber-500/10 text-amber-100'
                        : 'border-emerald-400/25 bg-emerald-500/10 text-emerald-100'
                  }`}
                >
                  {modeLabel(override)}
                </span>
              </div>
              <p className="mt-2 text-xs leading-5 text-[var(--theme-muted)]">
                {strategy.description}
              </p>
              {override ? (
                <p className="mt-2 text-xs text-[var(--theme-muted)]">
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
                  className="rounded-xl border border-amber-400/30 bg-amber-500/10 px-3 py-2 text-xs font-medium text-amber-100 hover:bg-amber-500/20 disabled:opacity-50"
                >
                  50% size
                </button>
                <button
                  type="button"
                  disabled={disabled}
                  onClick={() =>
                    void setOverride(strategy.id, 'reduce_size', 0.25)
                  }
                  className="rounded-xl border border-amber-400/30 bg-amber-500/10 px-3 py-2 text-xs font-medium text-amber-100 hover:bg-amber-500/20 disabled:opacity-50"
                >
                  25% size
                </button>
                <button
                  type="button"
                  disabled={disabled}
                  onClick={() => void setOverride(strategy.id, 'disabled')}
                  className="rounded-xl border border-red-400/30 bg-red-500/10 px-3 py-2 text-xs font-medium text-red-100 hover:bg-red-500/20 disabled:opacity-50"
                >
                  Disable
                </button>
                <button
                  type="button"
                  disabled={disabled || !override}
                  onClick={() => void setOverride(strategy.id, 'clear')}
                  className="rounded-xl border border-emerald-400/30 bg-emerald-500/10 px-3 py-2 text-xs font-medium text-emerald-100 hover:bg-emerald-500/20 disabled:opacity-40"
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
  const [busy, setBusy] = useState<string | null>(null)
  const [err, setErr] = useState<string | null>(null)
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

  const [atrInput, setAtrInput] = useState(String(atrSizeBaselinePct * 100))
  const [adxInput, setAdxInput] = useState(String(adxThreshold))

  async function post(body: Record<string, unknown>, busyKey: string) {
    setBusy(busyKey)
    setErr(null)
    try {
      const res = await fetch('/api/finance', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      const data = (await res.json()) as FinancePayload & { error?: string }
      if (!res.ok || data.ok === false)
        throw new Error(data.error || `HTTP ${res.status}`)
      onPayload(data)
    } catch (nextError) {
      setErr(nextError instanceof Error ? nextError.message : 'Request failed')
    } finally {
      setBusy(null)
    }
  }

  function setConfig(config: Record<string, unknown>, busyKey: string) {
    void post({ action: 'set_demo_config', config }, busyKey)
  }

  const buttonClass =
    'rounded-xl border px-3 py-1.5 text-xs font-medium transition disabled:opacity-40'
  const toneClass = (tone: 'good' | 'neutral') =>
    tone === 'good'
      ? 'border-emerald-400/40 bg-emerald-500/15 text-emerald-100 hover:bg-emerald-500/25'
      : 'border-[var(--theme-border)] bg-black/10 text-[var(--theme-text)] hover:bg-black/20'
  const inputClass =
    'w-20 rounded-xl border border-[var(--theme-border)] bg-black/10 px-3 py-1.5 text-xs text-[var(--theme-text)] outline-none'

  return (
    <section className="mt-6 rounded-3xl border border-[var(--theme-border)] bg-[var(--theme-panel)]/70 p-5">
      <div>
        <h2 className="text-lg font-semibold">Signal settings</h2>
        <p className="text-xs text-[var(--theme-muted)]">
          Optional council-engine levers built and backtested this session.
          Each is independent and off by default — read the caption before
          turning one on.
        </p>
      </div>

      {err && <p className="mt-3 text-xs text-red-300">{err}</p>}

      <div className="mt-4 grid gap-3 sm:grid-cols-2">
        <div className="rounded-2xl border border-[var(--theme-border)]/70 bg-black/10 p-3">
          <h3 className="text-sm font-semibold">ATR-based position sizing</h3>
          <p className="mt-1 text-xs text-[var(--theme-muted)]">
            Only the 1% baseline improved backtest P&amp;L (-40→-29 quote)
            and drawdown (53%→46%); 2%/4% made both worse.
          </p>
          <div className="mt-2 flex items-center gap-2">
            <input
              type="number"
              value={atrInput}
              onChange={(e) => setAtrInput(e.target.value)}
              className={inputClass}
            />
            <span className="text-xs text-[var(--theme-muted)]">% baseline</span>
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
        </div>

        <div className="rounded-2xl border border-[var(--theme-border)]/70 bg-black/10 p-3">
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
                setConfig(
                  { kellySizingEnabled: !kellySizingEnabled },
                  'kelly',
                )
              }
              className={`${buttonClass} ${toneClass(toggleTone(kellySizingEnabled))}`}
            >
              {busy === 'kelly' ? '...' : kellySizingEnabled ? 'Enabled' : 'Disabled'}
            </button>
          </div>
        </div>

        <div className="rounded-2xl border border-[var(--theme-border)]/70 bg-black/10 p-3">
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
                setConfig(
                  { patternVetoEnabled: !patternVetoEnabled },
                  'veto',
                )
              }
              className={`${buttonClass} ${toneClass(toggleTone(patternVetoEnabled))}`}
            >
              {busy === 'veto' ? '...' : patternVetoEnabled ? 'Enabled' : 'Disabled'}
            </button>
          </div>
        </div>

        <div className="rounded-2xl border border-[var(--theme-border)]/70 bg-black/10 p-3">
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

        <div className="rounded-2xl border border-[var(--theme-border)]/70 bg-black/10 p-3">
          <h3 className="text-sm font-semibold">Fibonacci-extension take-profit</h3>
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
              {busy === 'fib' ? '...' : fibTakeProfitEnabled ? 'Enabled' : 'Disabled'}
            </button>
          </div>
        </div>

        <div className="rounded-2xl border border-[var(--theme-border)]/70 bg-black/10 p-3">
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
  const [busy, setBusy] = useState<string | null>(null)
  const [err, setErr] = useState<string | null>(null)

  async function post(body: Record<string, unknown>, busyKey: string) {
    setBusy(busyKey)
    setErr(null)
    try {
      const res = await fetch('/api/finance', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      const data = (await res.json()) as FinancePayload & { error?: string }
      if (!res.ok || data.ok === false)
        throw new Error(data.error || `HTTP ${res.status}`)
      onPayload(data)
    } catch (nextError) {
      setErr(nextError instanceof Error ? nextError.message : 'Request failed')
    } finally {
      setBusy(null)
    }
  }

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
              ? 'border-emerald-400/30 bg-emerald-500/10 text-emerald-200'
              : 'border-red-400/30 bg-red-500/10 text-red-200'
          }`}
        >
          Cutoff:{' '}
          {cutoffOn
            ? 'ARMED (trading halted)'
            : 'DISARMED (trading can execute)'}
        </span>
      </div>

      {err && (
        <p className="mt-3 rounded-xl border border-red-400/30 bg-red-500/10 p-2 text-sm text-red-200">
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
                    ? 'border-emerald-400/40 bg-emerald-500/15 text-emerald-100'
                    : 'border-[var(--theme-border)] bg-black/10 text-[var(--theme-text)] hover:border-emerald-400/30'
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
            className="rounded-2xl border border-emerald-400/40 bg-emerald-500/15 px-4 py-2 text-sm font-medium text-emerald-100 transition hover:bg-emerald-500/25 disabled:opacity-40"
          >
            {busy === 'cutoff' ? '…' : 'Arm cutoff (safe)'}
          </button>
          <button
            type="button"
            disabled={busy !== null || !cutoffOn}
            onClick={disarmCutoff}
            className="rounded-2xl border border-red-400/40 bg-red-500/15 px-4 py-2 text-sm font-medium text-red-100 transition hover:bg-red-500/25 disabled:opacity-40"
          >
            {busy === 'cutoff' ? '…' : 'Disarm cutoff (enable trading)'}
          </button>
          <button
            type="button"
            disabled={busy !== null}
            onClick={() => void post({ action: 'emergency_stop' }, 'estop')}
            className="rounded-2xl border border-red-400/50 bg-red-600/20 px-4 py-2 text-sm font-semibold text-red-100 transition hover:bg-red-600/30 disabled:opacity-40"
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
  const pct = (value: number) => `${(value * 100).toFixed(1)}%`
  const usdt = (value: number) =>
    `${value < 0 ? '−' : ''}${Math.abs(value).toFixed(2)} USDT`
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

function DecisionQualityPanel({
  report,
  overrides,
  onPayload,
}: {
  report: DecisionQualityReport
  overrides: FinancePayload['strategyOverrides']
  onPayload: (payload: FinancePayload) => void
}) {
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const activeOverrideByStrategy = useMemo(
    () =>
      new Map(
        overrides.active.map((override) => [override.strategyId, override]),
      ),
    [overrides.active],
  )
  const pct = (value: number) => `${(value * 100).toFixed(1)}%`
  const usdt = (value: number) =>
    `${value < 0 ? '−' : ''}${Math.abs(value).toFixed(2)} USDT`
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
      ? 'border-red-400/30 bg-red-500/10 text-red-100'
      : severity === 'warning'
        ? 'border-amber-400/30 bg-amber-500/10 text-amber-100'
        : 'border-[var(--theme-border)] bg-black/10 text-[var(--theme-muted)]'
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
      ? 'border-red-400/30 bg-red-500/10 text-red-100'
      : 'border-amber-400/30 bg-amber-500/10 text-amber-100'

  async function applySafeguards() {
    setBusy(true)
    setError(null)
    setMessage(null)
    try {
      const res = await fetch('/api/finance', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'apply_recommended_safeguards' }),
      })
      const data = (await res.json()) as FinancePayload & {
        error?: string
        appliedSafeguards?: {
          tradingMode: string
          quotePerTrade: number
          liveRecommendationDeferred: boolean
        }
      }
      if (!res.ok || data.ok === false)
        throw new Error(data.error || `HTTP ${res.status}`)
      onPayload(data)
      const applied = data.appliedSafeguards
      setMessage(
        applied
          ? `Applied ${applied.tradingMode} with ${applied.quotePerTrade.toFixed(2)} USDT max trade size${applied.liveRecommendationDeferred ? '; live recommendation deferred until explicit live arming' : ''}.`
          : 'Recommended safeguards applied.',
      )
    } catch (nextError) {
      setError(
        nextError instanceof Error
          ? nextError.message
          : 'Failed to apply safeguards',
      )
    } finally {
      setBusy(false)
    }
  }

  async function applyStrategyRecommendations() {
    setBusy(true)
    setError(null)
    setMessage(null)
    try {
      const res = await fetch('/api/finance', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'apply_strategy_override_recommendations',
        }),
      })
      const data = (await res.json()) as FinancePayload & {
        error?: string
        strategyOverrideRecommendationResult?: {
          applied: Array<{ changed: boolean }>
          skipped: Array<unknown>
        }
      }
      if (!res.ok || data.ok === false)
        throw new Error(data.error || `HTTP ${res.status}`)
      onPayload(data)
      const result = data.strategyOverrideRecommendationResult
      const changed = result?.applied.filter((item) => item.changed).length ?? 0
      const skipped = result?.skipped.length ?? 0
      setMessage(
        `Applied ${changed} strategy override recommendation${changed === 1 ? '' : 's'}; ${skipped} skipped.`,
      )
    } catch (nextError) {
      setError(
        nextError instanceof Error
          ? nextError.message
          : 'Failed to apply strategy recommendations',
      )
    } finally {
      setBusy(false)
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
          className={`mt-3 rounded-xl border p-2 text-sm ${error ? 'border-red-400/30 bg-red-500/10 text-red-200' : 'border-emerald-400/30 bg-emerald-500/10 text-emerald-100'}`}
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
        <div className="rounded-2xl border border-[var(--theme-border)]/70 bg-black/10 p-4">
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
            className="mt-4 rounded-xl border border-emerald-400/30 bg-emerald-500/15 px-4 py-2 text-sm font-medium text-emerald-100 hover:bg-emerald-500/25 disabled:opacity-50"
          >
            {busy ? 'Applying…' : 'Apply recommended safeguards'}
          </button>
          <button
            type="button"
            onClick={applyStrategyRecommendations}
            disabled={busy || overrideRecommendationCount === 0}
            className="ml-2 mt-4 rounded-xl border border-amber-400/30 bg-amber-500/15 px-4 py-2 text-sm font-medium text-amber-100 hover:bg-amber-500/25 disabled:opacity-50"
          >
            {busy
              ? 'Applying…'
              : `Apply strategy overrides${overrideRecommendationCount ? ` (${overrideRecommendationCount})` : ''}`}
          </button>
        </div>

        <div className="rounded-2xl border border-[var(--theme-border)]/70 bg-black/10 p-4">
          <h3 className="text-sm font-semibold">Checks</h3>
          <div className="mt-3 grid grid-cols-2 gap-2 text-xs">
            {checks.map(([label, ok]) => (
              <div
                key={String(label)}
                className={`rounded-xl border px-3 py-2 ${ok ? 'border-emerald-400/25 bg-emerald-500/10 text-emerald-100' : 'border-[var(--theme-border)] bg-black/10 text-[var(--theme-muted)]'}`}
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
              <p className="rounded-2xl border border-emerald-400/25 bg-emerald-500/10 p-3 text-sm text-emerald-100">
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
              <p className="rounded-2xl border border-[var(--theme-border)] bg-black/10 p-3 text-sm text-[var(--theme-muted)]">
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
                    className="rounded-2xl border border-[var(--theme-border)]/70 bg-black/10 p-3 text-sm"
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
  const [busy, setBusy] = useState<'run' | string | null>(null)
  const [message, setMessage] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const latest = report.latestCandidate
  const paperMode = summary.tradingMode === 'paper_trade'
  const testnetMode = summary.tradingMode === 'testnet_execute'
  const canApplyInCurrentMode = paperMode || testnetMode
  const pct = (value: number) => `${(value * 100).toFixed(1)}%`
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
      ? 'border-emerald-400/25 bg-emerald-500/10 text-emerald-100'
      : status === 'proposed'
        ? 'border-amber-400/25 bg-amber-500/10 text-amber-100'
        : status === 'rejected'
          ? 'border-red-400/25 bg-red-500/10 text-red-100'
          : 'border-[var(--theme-border)] bg-black/10 text-[var(--theme-muted)]'
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
    setBusy('run')
    setError(null)
    setMessage(null)
    try {
      const res = await fetch('/api/finance', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'run_learning_cycle' }),
      })
      const data = (await res.json()) as FinancePayload & {
        error?: string
        learningCycle?: LearningCycleResult
      }
      if (!res.ok || data.ok === false)
        throw new Error(data.error || `HTTP ${res.status}`)
      onPayload(data)
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
    } catch (nextError) {
      setError(
        nextError instanceof Error
          ? nextError.message
          : 'Failed to run learning cycle',
      )
    } finally {
      setBusy(null)
    }
  }

  async function applyCandidate(candidateId: string) {
    setBusy(candidateId)
    setError(null)
    setMessage(null)
    try {
      const res = await fetch('/api/finance', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'apply_learning_candidate',
          candidateId,
        }),
      })
      const data = (await res.json()) as FinancePayload & {
        error?: string
        learningCandidateResult?: {
          candidate: LearningCandidate | null
          applied: boolean
          skippedReason: string | null
        }
      }
      if (!res.ok || data.ok === false)
        throw new Error(data.error || `HTTP ${res.status}`)
      onPayload(data)
      const result = data.learningCandidateResult
      setMessage(
        result?.applied && result.candidate
          ? `Applied ${result.candidate.id}: ${patchLabel(result.candidate)}.`
          : (result?.skippedReason ?? 'Learning candidate was not applied.'),
      )
    } catch (nextError) {
      setError(
        nextError instanceof Error
          ? nextError.message
          : 'Failed to apply learning candidate',
      )
    } finally {
      setBusy(null)
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
          className="rounded-xl border border-emerald-400/30 bg-emerald-500/15 px-4 py-2 text-sm font-medium text-emerald-100 hover:bg-emerald-500/25 disabled:opacity-50"
        >
          {busy === 'run' ? 'Running…' : 'Run learning cycle'}
        </button>
      </div>

      {(message || error) && (
        <p
          className={`mt-3 rounded-xl border p-2 text-sm ${error ? 'border-red-400/30 bg-red-500/10 text-red-200' : 'border-emerald-400/30 bg-emerald-500/10 text-emerald-100'}`}
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
        <div className="rounded-2xl border border-[var(--theme-border)]/70 bg-black/10 p-4">
          <h3 className="text-sm font-semibold">Gate checks</h3>
          <div className="mt-3 grid gap-2 text-xs">
            <div
              className={`rounded-xl border px-3 py-2 ${
                report.stability.maxDrawdown <=
                report.stability.maxDrawdownLimit
                  ? 'border-emerald-400/25 bg-emerald-500/10 text-emerald-100'
                  : 'border-red-400/25 bg-red-500/10 text-red-100'
              }`}
            >
              Drawdown {formatUsdt(report.stability.maxDrawdown)} /{' '}
              {formatUsdt(report.stability.maxDrawdownLimit)}
            </div>
            <div
              className={`rounded-xl border px-3 py-2 ${
                report.stability.hasCriticalFinding
                  ? 'border-red-400/25 bg-red-500/10 text-red-100'
                  : 'border-emerald-400/25 bg-emerald-500/10 text-emerald-100'
              }`}
            >
              Critical finding:{' '}
              {report.stability.hasCriticalFinding ? 'yes' : 'no'}
            </div>
            {report.stability.reasons.length === 0 ? (
              <div className="rounded-xl border border-emerald-400/25 bg-emerald-500/10 px-3 py-2 text-emerald-100">
                Conservative gate passed.
              </div>
            ) : (
              report.stability.reasons.map((reason) => (
                <div
                  key={reason}
                  className="rounded-xl border border-[var(--theme-border)] bg-black/10 px-3 py-2 text-[var(--theme-muted)]"
                >
                  {reason}
                </div>
              ))
            )}
          </div>
        </div>

        <div className="rounded-2xl border border-[var(--theme-border)]/70 bg-black/10 p-4">
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
                <div className="rounded-xl border border-[var(--theme-border)] bg-black/10 px-3 py-2 text-[var(--theme-muted)]">
                  Created {formatDateTime(latest.createdAt)}
                </div>
                <div className="rounded-xl border border-[var(--theme-border)] bg-black/10 px-3 py-2 text-[var(--theme-muted)]">
                  Mode {latest.modeAtCreation}
                </div>
                <div className="rounded-xl border border-[var(--theme-border)] bg-black/10 px-3 py-2 text-[var(--theme-muted)]">
                  Patch {patchLabel(latest)}
                </div>
                <div className="rounded-xl border border-[var(--theme-border)] bg-black/10 px-3 py-2 text-[var(--theme-muted)]">
                  Promotion {latest.promotion.eligibleFor}
                </div>
                <div className="rounded-xl border border-[var(--theme-border)] bg-black/10 px-3 py-2 text-[var(--theme-muted)] sm:col-span-2">
                  Validation: {latest.validation.reason}
                </div>
              </div>
              {latest.status === 'proposed' ? (
                <button
                  type="button"
                  onClick={() => void applyCandidate(latest.id)}
                  disabled={busy !== null || !canApplyCandidate(latest)}
                  className="mt-4 rounded-xl border border-emerald-400/30 bg-emerald-500/15 px-4 py-2 text-sm font-medium text-emerald-100 hover:bg-emerald-500/25 disabled:opacity-50"
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
                        className="rounded-xl border border-emerald-400/30 bg-emerald-500/15 px-3 py-1.5 text-xs font-medium text-emerald-100 hover:bg-emerald-500/25 disabled:opacity-50"
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

function budgetTone(percentUsed: number): 'good' | 'warn' | 'danger' {
  if (percentUsed > 100) return 'danger'
  if (percentUsed >= 80) return 'warn'
  return 'good'
}

function BudgetPanel({
  payload,
  onPayload,
}: {
  payload: FinancePayload
  onPayload: (p: FinancePayload) => void
}) {
  const currentMonth = new Date().toISOString().slice(0, 7)
  const [busy, setBusy] = useState<string | null>(null)
  const [err, setErr] = useState<string | null>(null)
  const [budgetMonth, setBudgetMonth] = useState(currentMonth)
  const [budgetCategory, setBudgetCategory] = useState('')
  const [budgetAmount, setBudgetAmount] = useState('')
  const [budgetCurrency, setBudgetCurrency] = useState('LKR')
  const [expenseDate, setExpenseDate] = useState(
    new Date().toISOString().slice(0, 10),
  )
  const [expenseVendor, setExpenseVendor] = useState('')
  const [expenseCategory, setExpenseCategory] = useState('')
  const [expenseAmount, setExpenseAmount] = useState('')
  const [expenseCurrency, setExpenseCurrency] = useState('LKR')

  async function post(body: Record<string, unknown>, busyKey: string) {
    setBusy(busyKey)
    setErr(null)
    try {
      const res = await fetch('/api/finance', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      const data = (await res.json()) as FinancePayload & { error?: string }
      if (!res.ok || data.ok === false)
        throw new Error(data.error || `HTTP ${res.status}`)
      onPayload(data)
      return true
    } catch (nextError) {
      setErr(nextError instanceof Error ? nextError.message : 'Request failed')
      return false
    } finally {
      setBusy(null)
    }
  }

  async function submitBudget() {
    if (!budgetCategory.trim()) {
      setErr('Category is required')
      return
    }
    const ok = await post(
      {
        action: 'add_record',
        kind: 'budget_category',
        payload: {
          month: budgetMonth,
          category: budgetCategory.trim(),
          currency: budgetCurrency,
          budgetAmount: Number(budgetAmount) || 0,
        },
      },
      'budget',
    )
    if (ok) {
      setBudgetCategory('')
      setBudgetAmount('')
    }
  }

  async function submitExpense() {
    if (!expenseVendor.trim() || !expenseCategory.trim()) {
      setErr('Vendor and category are required')
      return
    }
    const ok = await post(
      {
        action: 'add_record',
        kind: 'expense',
        payload: {
          date: expenseDate,
          vendor: expenseVendor.trim(),
          category: expenseCategory.trim(),
          currency: expenseCurrency,
          amount: Number(expenseAmount) || 0,
        },
      },
      'expense',
    )
    if (ok) {
      setExpenseVendor('')
      setExpenseCategory('')
      setExpenseAmount('')
    }
  }

  const inputClass =
    'rounded-xl border border-[var(--theme-border)] bg-black/10 px-3 py-1.5 text-xs text-[var(--theme-text)] outline-none'
  const buttonClass =
    'rounded-xl border border-[var(--theme-border)] bg-black/10 px-3 py-1.5 text-xs font-medium text-[var(--theme-text)] hover:bg-black/20 disabled:opacity-40'

  return (
    <section className="mt-6 rounded-3xl border border-[var(--theme-border)] bg-[var(--theme-panel)]/70 p-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold">Budget vs. actual spending</h2>
          <p className="text-xs text-[var(--theme-muted)]">
            Set a monthly budget per category, log expenses, and see how
            actual spending compares — updates instantly below. Enter budgets
            in LKR; actual spend is always compared in LKR-converted terms.
          </p>
        </div>
      </div>

      <div className="mt-4 grid gap-3 lg:grid-cols-2">
        <div className="rounded-2xl border border-[var(--theme-border)]/70 bg-black/10 p-3">
          <h3 className="text-sm font-semibold">Add a budget</h3>
          <div className="mt-2 flex flex-wrap gap-2">
            <input
              type="month"
              value={budgetMonth}
              onChange={(e) => setBudgetMonth(e.target.value)}
              className={inputClass}
            />
            <input
              type="text"
              placeholder="Category (e.g. Groceries)"
              value={budgetCategory}
              onChange={(e) => setBudgetCategory(e.target.value)}
              className={inputClass}
            />
            <input
              type="number"
              placeholder="Budget amount"
              value={budgetAmount}
              onChange={(e) => setBudgetAmount(e.target.value)}
              className={`${inputClass} w-32`}
            />
            <select
              value={budgetCurrency}
              onChange={(e) => setBudgetCurrency(e.target.value)}
              className={inputClass}
            >
              <option value="LKR">LKR</option>
              <option value="USD">USD</option>
              <option value="AUD">AUD</option>
            </select>
            <button
              type="button"
              disabled={busy === 'budget'}
              onClick={() => void submitBudget()}
              className={buttonClass}
            >
              {busy === 'budget' ? 'Saving...' : 'Add budget'}
            </button>
          </div>
        </div>

        <div className="rounded-2xl border border-[var(--theme-border)]/70 bg-black/10 p-3">
          <h3 className="text-sm font-semibold">Log an expense</h3>
          <div className="mt-2 flex flex-wrap gap-2">
            <input
              type="date"
              value={expenseDate}
              onChange={(e) => setExpenseDate(e.target.value)}
              className={inputClass}
            />
            <input
              type="text"
              placeholder="Vendor"
              value={expenseVendor}
              onChange={(e) => setExpenseVendor(e.target.value)}
              className={inputClass}
            />
            <input
              type="text"
              placeholder="Category"
              value={expenseCategory}
              onChange={(e) => setExpenseCategory(e.target.value)}
              className={inputClass}
            />
            <input
              type="number"
              placeholder="Amount"
              value={expenseAmount}
              onChange={(e) => setExpenseAmount(e.target.value)}
              className={`${inputClass} w-28`}
            />
            <select
              value={expenseCurrency}
              onChange={(e) => setExpenseCurrency(e.target.value)}
              className={inputClass}
            >
              <option value="LKR">LKR</option>
              <option value="USD">USD</option>
              <option value="AUD">AUD</option>
            </select>
            <button
              type="button"
              disabled={busy === 'expense'}
              onClick={() => void submitExpense()}
              className={buttonClass}
            >
              {busy === 'expense' ? 'Saving...' : 'Log expense'}
            </button>
          </div>
        </div>
      </div>

      {err && <p className="mt-3 text-xs text-red-300">{err}</p>}

      <div className="mt-4">
        <h3 className="text-sm font-semibold">
          This month ({currentMonth})
        </h3>
        {payload.budgetVsActual.length === 0 ? (
          <p className="mt-2 text-sm text-[var(--theme-muted)]">
            No budgets set for this month yet — add one above to see how
            actual spending compares.
          </p>
        ) : (
          <div className="mt-2 grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
            {payload.budgetVsActual.map((row) => (
              <StatCard
                key={`${row.month}-${row.category}`}
                label={`${row.category} — ${Math.round(row.percentUsed)}% used`}
                value={`${formatLkr(row.actual)} / ${formatLkr(row.budget)}`}
                tone={budgetTone(row.percentUsed)}
              />
            ))}
          </div>
        )}
      </div>
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
              ? 'border-emerald-400/30 bg-emerald-500/10 text-emerald-100'
              : 'border-[var(--theme-border)] bg-black/10 text-[var(--theme-muted)]'
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
              ? 'text-emerald-300'
              : state && state.changePercent < 0
                ? 'text-red-300'
                : 'text-[var(--theme-muted)]'
          return (
            <div
              key={symbol}
              className="rounded-2xl border border-[var(--theme-border)]/70 bg-black/10 p-3"
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
                          <stop offset="0%" stopColor="#34d399" stopOpacity={0.4} />
                          <stop offset="100%" stopColor="#34d399" stopOpacity={0} />
                        </linearGradient>
                      </defs>
                      <Area
                        type="monotone"
                        dataKey="price"
                        stroke="#34d399"
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

export function FinanceScreen() {
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
  const riskTone = useMemo(() => {
    if (!summary) return 'neutral'
    if (summary.liveTradingEnabled) return 'danger'
    if (summary.emergencyKillSwitch) return 'good'
    return 'warn'
  }, [summary])

  if (loading) {
    return (
      <main className="min-h-dvh bg-[var(--theme-bg)] p-6 text-[var(--theme-muted)]">
        Loading Finance section…
      </main>
    )
  }

  if (error || !payload || !summary) {
    return (
      <main className="min-h-dvh bg-[var(--theme-bg)] p-6 text-red-200">
        <h1 className="text-2xl font-semibold">Finance unavailable</h1>
        <p className="mt-2 text-sm">{error ?? 'No payload returned.'}</p>
      </main>
    )
  }

  return (
    <main className="min-h-dvh overflow-y-auto bg-[var(--theme-bg)] px-4 py-5 text-[var(--theme-text)] md:px-8 md:py-8">
      <section className="rounded-[2rem] border border-[var(--theme-border)] bg-gradient-to-br from-[var(--theme-panel)] via-[var(--theme-panel)] to-emerald-950/20 p-6 shadow-xl">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <p className="text-xs uppercase tracking-[0.28em] text-emerald-200/80">
              Hermes Finance
            </p>
            <h1 className="mt-2 text-3xl font-semibold md:text-4xl">
              Finance, tax, investment monitoring, and controlled trading
            </h1>
            <p className="mt-3 max-w-3xl text-sm leading-6 text-[var(--theme-muted)]">
              Secure local finance database with personal records, tax tracking,
              Binance market observation, risk-scored trading, audit logs, and
              gated real execution with paper-shadow learning.
            </p>
          </div>
          <div className="rounded-2xl border border-emerald-400/25 bg-emerald-500/10 px-4 py-3 text-sm text-emerald-100">
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

      <LivePriceTicker
        symbols={
          Array.isArray(
            (payload.settings.demoTrading as Record<string, unknown> | undefined)
              ?.symbols,
          )
            ? ((
                payload.settings.demoTrading as Record<string, unknown>
              ).symbols as Array<string>)
            : []
        }
      />

      <section className="mt-6 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard
          label="Total income"
          value={formatLkr(summary.totalIncomeLkr)}
          tone="good"
        />
        <StatCard
          label="Total expenses"
          value={formatLkr(summary.totalExpensesLkr)}
          tone={
            summary.totalExpensesLkr > summary.totalIncomeLkr &&
            summary.totalIncomeLkr > 0
              ? 'danger'
              : 'neutral'
          }
        />
        <StatCard
          label="Net savings"
          value={formatLkr(summary.netSavingsLkr)}
          tone={summary.netSavingsLkr >= 0 ? 'good' : 'danger'}
        />
        <StatCard
          label="Savings rate"
          value={formatPct(summary.savingsRate)}
          tone={summary.savingsRate >= 20 ? 'good' : 'warn'}
        />
        <StatCard
          label="Cash balance"
          value={formatLkr(summary.cashBalanceLkr)}
        />
        <StatCard
          label="Tax reserve"
          value={formatLkr(summary.taxReserveLkr)}
        />
        <StatCard label="Net worth" value={formatLkr(summary.netWorthLkr)} />
        <StatCard
          label="Trading safety"
          value={summary.liveTradingEnabled ? 'Live enabled' : 'Live blocked'}
          tone={riskTone}
        />
      </section>

      <BudgetPanel payload={payload} onPayload={setPayload} />

      <TradingControls summary={summary} onPayload={setPayload} />

      <PerformancePanel perf={payload.demoPerformance} />

      <DecisionQualityPanel
        report={payload.decisionQuality}
        overrides={payload.strategyOverrides}
        onPayload={setPayload}
      />

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

      <SignalSettingsPanel
        demoTrading={
          (payload.settings.demoTrading as Record<string, unknown> | undefined) ?? {}
        }
        onPayload={setPayload}
      />

      <section className="mt-6 grid gap-4 lg:grid-cols-[1.1fr_0.9fr]">
        <div className="rounded-3xl border border-[var(--theme-border)] bg-[var(--theme-panel)]/70 p-5">
          <h2 className="text-lg font-semibold">Implementation coverage</h2>
          <div className="mt-4 grid gap-2 sm:grid-cols-2">
            {modules.map((item) => (
              <div
                key={item}
                className="rounded-2xl border border-[var(--theme-border)]/70 bg-black/10 p-3 text-sm text-[var(--theme-muted)]"
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
                className="rounded-2xl border border-[var(--theme-border)]/70 bg-black/10 p-3"
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

      <DemoTradingPanel />
      <GridTradingPanel />

      <section className="mt-6 rounded-3xl border border-[var(--theme-border)] bg-[var(--theme-panel)]/70 p-5">
        <h2 className="text-lg font-semibold">Phased rollout</h2>
        <ol className="mt-4 grid gap-2 lg:grid-cols-5">
          {phases.map((phase) => (
            <li
              key={phase}
              className="rounded-2xl border border-[var(--theme-border)]/70 bg-black/10 p-3 text-sm text-[var(--theme-muted)]"
            >
              {phase}
            </li>
          ))}
        </ol>
      </section>

      <section className="mt-6 grid gap-4">
        <DataTable
          title="Accounts"
          rows={payload.data.finance_accounts}
          columns={['name', 'type', 'currency', 'balance', 'platform']}
        />
        <DataTable
          title="Income records"
          rows={payload.data.income_records}
          columns={[
            'dateReceived',
            'sourceName',
            'incomeType',
            'originalCurrency',
            'originalAmount',
            'convertedLkrAmount',
            'taxable',
          ]}
        />
        <DataTable
          title="Expense records"
          rows={payload.data.expense_records}
          columns={[
            'date',
            'vendor',
            'category',
            'currency',
            'amount',
            'convertedLkrAmount',
            'recurring',
          ]}
        />
        <DataTable
          title="Budget categories"
          rows={payload.data.budget_categories}
          columns={['month', 'category', 'currency', 'budgetAmount']}
        />
        <DataTable
          title="Savings goals"
          rows={payload.data.savings_goals}
          columns={[
            'name',
            'targetAmount',
            'currentAmount',
            'currency',
            'targetDate',
            'status',
          ]}
        />
        <DataTable
          title="Tax records"
          rows={payload.data.tax_records}
          columns={[
            'taxYear',
            'incomeType',
            'convertedLkrAmount',
            'taxPaid',
            'taxDue',
            'requiresConfirmation',
          ]}
        />
        <DataTable
          title="Trading plans"
          rows={payload.data.trading_plans}
          columns={[
            'platform',
            'symbol',
            'assetType',
            'decision',
            'riskLevel',
            'riskScore',
            'status',
            'executionStatus',
          ]}
        />
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
            <div className="mt-3 rounded-2xl border border-amber-500/40 bg-amber-500/10 p-3 text-amber-100">
              <div className="text-xs font-semibold uppercase tracking-[0.16em] text-amber-200">
                Storage mirror warning
              </div>
              <div className="mt-1 space-y-1">
                {payload.storage.health.warnings.map((warning) => (
                  <p key={warning}>{warning}</p>
                ))}
              </div>
              <p className="mt-2 text-xs text-amber-200/80">
                JSON updated:{' '}
                {payload.storage.health.jsonUpdatedAt ?? 'unknown'} · Postgres
                updated: {payload.storage.health.postgresUpdatedAt ?? 'unknown'}
              </p>
              {payload.storage.health.selfHeal.attempted && (
                <p className="mt-1 text-xs text-amber-200/80">
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
