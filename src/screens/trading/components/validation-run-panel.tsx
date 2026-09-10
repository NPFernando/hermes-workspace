/** Paper/sandbox validation-run panel + its status/readiness helpers.
 * Extracted verbatim from trading-screen.tsx. */
import { useEffect, useState } from 'react'
import { formatDateTime, formatUsdt } from '../format-helpers'
import { ageLabel, budgetRatioBar } from '../panel-helpers'
import { useFinanceAction } from '../../finance/hooks/use-finance-action'
import { StatCard } from '../../finance/components/stat-card'
import type { FinancePayload, ReadinessGateLite, StrategyCatalogEntry, ValidationReconciliation, ValidationRunStatus, ValidationStage } from '../trading-types'

export const VALIDATION_STATUS_LABEL: Record<ValidationRunStatus, string> = {
  active: 'Active',
  completed: 'Completed',
  stopped: 'Stopped',
  expired: 'Expired',
}

export function validationStatusTone(
  status: ValidationRunStatus,
): 'good' | 'warn' | 'danger' | 'neutral' {
  if (status === 'active') return 'good'
  if (status === 'expired') return 'warn'
  if (status === 'stopped') return 'danger'
  return 'neutral'
}

/** One four-way ratio bar (time/cycles/trades/exposure) — "stage
 * completion" is simply the highest of the four, since any one budget
 * hitting its cap ends the run regardless of the others. */

export function ReadinessImpactBadge({ gate }: { gate: ReadinessGateLite | null }) {
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

export function validationStageLabel(stage: ValidationStage): string {
  return stage === 'paper' ? 'Paper execution' : 'Sandbox / testnet execution'
}

export function validationRecommendationLabel(
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
export function ValidationRunPanel({
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
