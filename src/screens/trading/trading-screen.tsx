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
import { LivePriceTicker } from './components/live-price-ticker'
import { IntelligenceSummaryPanel, NewsResearchPanel } from './components/news-research-panel'
import { GuardEvidencePanel } from './components/guard-evidence-panel'
import { SandboxExperimentPanel } from './components/sandbox-experiment-panel'
import { ValidationRunPanel } from './components/validation-run-panel'
import { SignalSettingsPanel } from './components/signal-settings-panel'
import { TradingControls } from './components/trading-controls'
import { PerformancePanel } from './components/performance-panel'
import { StrategyEligibilityAuditPanel } from './components/strategy-eligibility-audit-panel'
import { PaperDecisionQualityPanel } from './components/paper-decision-quality-panel'
import { SafeguardHistoryPanel } from './components/safeguard-history-panel'
import { formatDateTime, formatFractionPct, formatUsdt } from './format-helpers'
import { csvDateSuffix, downloadCsv } from './csv'
import { ageLabel, budgetRatioBar, msToDuration, overrideLifecycleLabel, toggleTone } from './panel-helpers'
import type { ReactNode } from 'react'

import type {
  DecisionQualityFinding,
  DecisionQualityReport,
  FinancePayload,
  LearningCandidate,
  LearningCandidateStatus,
  LearningConfigPatch,
  LearningCycleResult,
  LearningPolicy,
  LearningReport,
  LearningStabilityAssessment,
  LearningStrategyOverridePatch,
  NextTradingRecommendation,
  PaperDecisionQualityReport,
  ReadinessGateLite,
  SafeguardHistoryEntry,
  SandboxExperiment,
  SandboxExperimentStatus,
  StrategyCatalogEntry,
  StrategyEligibilityAudit,
  StrategyEvidenceWindow,
  StrategyGuardRecommendation,
  StrategyGuardReview,
  StrategyOverride,
  StrategyOverrideHistoryEntry,
  ValidationReconciliation,
  ValidationRun,
  ValidationRunBaseline,
  ValidationRunBudgets,
  ValidationRunEvidence,
  ValidationRunProgress,
  ValidationRunStatus,
  ValidationRunView,
  ValidationStage,
} from './trading-types'

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

const AUTO_RESTORE_HEALTHY_RUNS = 2

function demoTradingSettings(payload: FinancePayload): Record<string, unknown> {
  const dt = payload.settings.demoTrading
  return dt && typeof dt === 'object' && !Array.isArray(dt)
    ? (dt as Record<string, unknown>)
    : {}
}

function demoTradingLearningPolicy(
  payload: FinancePayload,
): Record<string, unknown> {
  const lp = demoTradingSettings(payload).learningPolicy
  return lp && typeof lp === 'object' && !Array.isArray(lp)
    ? (lp as Record<string, unknown>)
    : {}
}

function demoTradingRestoreProgress(
  payload: FinancePayload,
): Record<string, { healthyRuns: number } | undefined> {
  const rp = demoTradingSettings(payload).strategyRestoreProgress
  return rp && typeof rp === 'object' && !Array.isArray(rp)
    ? (rp as Record<string, { healthyRuns: number } | undefined>)
    : {}
}

function StrategyOverridePanel({
  catalog,
  state,
  autoRestore,
  restoreProgress,
  onPayload,
}: {
  catalog: Array<StrategyCatalogEntry>
  state: FinancePayload['strategyOverrides']
  autoRestore: boolean
  restoreProgress: Record<string, { healthyRuns: number } | undefined>
  onPayload: (payload: FinancePayload) => void
}) {
  const { run, busy, error } = useFinanceAction<
    FinancePayload & { strategyOverrideResult?: { message: string } }
  >(onPayload)
  const [message, setMessage] = useState<string | null>(null)
  const [expiresAfterDays, setExpiresAfterDays] = useState(7)

  async function toggleAutoRestore(next: boolean) {
    setMessage(null)
    const data = await run(
      {
        action: 'set_demo_config',
        config: { learningPolicy: { autoRestore: next } },
      },
      `auto_restore:${next}`,
    )
    if (data)
      setMessage(
        next
          ? 'Auto-restore on — throttled strategies ease back up as their win rate recovers.'
          : 'Auto-restore off — throttles now clear only manually or at expiry.',
      )
  }
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
          <label
            className="flex items-center gap-2 rounded-xl border border-[var(--theme-border)] bg-[color-mix(in_srgb,var(--theme-text)_8%,transparent)] px-3 py-1.5 text-xs text-[var(--theme-muted)]"
            title="When on, automatic throttles ease back up one step per day as a strategy's win rate recovers past the hysteresis band."
          >
            <input
              type="checkbox"
              checked={autoRestore}
              disabled={busy !== null}
              onChange={(event) =>
                void toggleAutoRestore(event.target.checked)
              }
            />
            Auto-restore
          </label>
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
              {override?.source === 'automatic' &&
              autoRestore &&
              (restoreProgress[strategy.id]?.healthyRuns ?? 0) > 0 ? (
                <p className="mt-1.5 inline-flex items-center gap-1 rounded-full border border-[color-mix(in_srgb,var(--theme-success)_30%,transparent)] bg-[color-mix(in_srgb,var(--theme-success)_10%,transparent)] px-2 py-0.5 text-[11px] text-[var(--theme-success)]">
                  ↑ recovering —{' '}
                  {Math.min(
                    restoreProgress[strategy.id]?.healthyRuns ?? 0,
                    AUTO_RESTORE_HEALTHY_RUNS,
                  )}
                  /{AUTO_RESTORE_HEALTHY_RUNS} healthy runs
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

const TRADING_PAYLOAD_POLL_MS = 60_000

export function TradingScreen() {
  const [payload, setPayload] = useState<FinancePayload | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [refreshedAt, setRefreshedAt] = useState<number | null>(null)

  useEffect(() => {
    let cancelled = false
    async function load(isInitial: boolean) {
      if (isInitial) setLoading(true)
      try {
        const response = await fetch('/api/finance', { cache: 'no-store' })
        if (!response.ok)
          throw new Error(`Finance API returned HTTP ${response.status}`)
        const data = (await response.json()) as FinancePayload
        if (!cancelled) {
          setPayload(data)
          setError(null)
          setRefreshedAt(Date.now())
        }
      } catch (nextError) {
        // A failed *background* refresh keeps the last good payload on screen
        // rather than blanking the dashboard; only the initial load surfaces
        // the hard error state.
        if (!cancelled && isInitial)
          setError(
            nextError instanceof Error
              ? nextError.message
              : 'Finance API failed',
          )
      } finally {
        if (!cancelled && isInitial) setLoading(false)
      }
    }

    void load(true)
    let timer: ReturnType<typeof setInterval> | null = null
    const start = () => {
      if (timer === null && document.visibilityState === 'visible')
        timer = setInterval(() => void load(false), TRADING_PAYLOAD_POLL_MS)
    }
    const stop = () => {
      if (timer !== null) {
        clearInterval(timer)
        timer = null
      }
    }
    const onVisibility = () => {
      if (document.visibilityState === 'visible') {
        void load(false)
        start()
      } else {
        stop()
      }
    }
    start()
    document.addEventListener('visibilitychange', onVisibility)
    return () => {
      cancelled = true
      stop()
      document.removeEventListener('visibilitychange', onVisibility)
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
            {refreshedAt !== null ? (
              <>
                <br />
                <span className="text-xs text-[var(--theme-muted)]">
                  Auto-refresh 60s · updated{' '}
                  {new Date(refreshedAt).toLocaleTimeString()}
                </span>
              </>
            ) : null}
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
          autoRestore={demoTradingLearningPolicy(payload).autoRestore === true}
          restoreProgress={demoTradingRestoreProgress(payload)}
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
                Storage warning
              </div>
              <div className="mt-1 space-y-1">
                {payload.storage.health.warnings.map((warning) => (
                  <p key={warning}>{warning}</p>
                ))}
              </div>
              <p className="mt-2 text-xs text-[color-mix(in_srgb,var(--theme-warning)_80%,transparent)]">
                Postgres updated:{' '}
                {payload.storage.health.postgresUpdatedAt ?? 'unknown'}
              </p>
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
