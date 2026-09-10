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
import {
  StrategyOverridePanel,
  demoTradingLearningPolicy,
  demoTradingRestoreProgress,
} from './components/strategy-override-panel'
import { DecisionQualityPanel } from './components/decision-quality-panel'
import { SelfImprovementPanel } from './components/self-improvement-panel'
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
