import { useState } from 'react'
import type { FinancePayload } from '../trading-types'

function ageLabel(iso: string | null | undefined): string {
  if (!iso) return 'No cycle recorded'
  const timestamp = Date.parse(iso)
  if (!Number.isFinite(timestamp)) return 'Unknown age'
  const ageMinutes = Math.max(0, Math.round((Date.now() - timestamp) / 60_000))
  if (ageMinutes < 1) return 'Just now'
  if (ageMinutes < 60) return `${ageMinutes}m ago`
  return `${Math.round(ageMinutes / 60)}h ago`
}

function totalCount(counts: Record<string, number>, key: string): number {
  return counts[key] ?? 0
}

function latestAutoRun(
  runs: FinancePayload['validationRuns']['active'],
): FinancePayload['validationRuns']['active'][number] | null {
  let latest: FinancePayload['validationRuns']['active'][number] | null = null
  for (const run of runs) {
    const latestAt = latest?.progress.lastSuccessfulCycleAt
      ? Date.parse(latest.progress.lastSuccessfulCycleAt)
      : Number.NEGATIVE_INFINITY
    const runAt = run.progress.lastSuccessfulCycleAt
      ? Date.parse(run.progress.lastSuccessfulCycleAt)
      : Number.NEGATIVE_INFINITY
    if (!latest || runAt > latestAt) latest = run
  }
  return latest
}

function stageLabel(stage: 'paper' | 'sandbox'): string {
  return stage === 'paper' ? 'Paper' : 'Sandbox'
}

/**
 * Operator-facing view of the persisted automation loop. This intentionally
 * reports engine evidence, not scheduler claims: a successful scheduler tick
 * is not proof that a market cycle completed or that an order was placed.
 */
export function AutomationHealthCard({
  payload,
  onPayload,
}: {
  payload: Pick<
    FinancePayload,
    | 'lastCycleDiagnostics'
    | 'tradingCycleDiagnosticTrends'
    | 'validationRuns'
    | 'userDataStream'
    | 'tradingAccountReconciliation'
  >
  onPayload: (payload: FinancePayload) => void
}) {
  const [busy, setBusy] = useState(false)
  const last = payload.lastCycleDiagnostics
  const paper = payload.tradingCycleDiagnosticTrends.paper
  const sandbox = payload.tradingCycleDiagnosticTrends.sandbox
  const activeAutoRuns = payload.validationRuns.active.filter(
    (run) => run.autoRun,
  )
  const activeAutoRun = latestAutoRun(activeAutoRuns)
  const stream = payload.userDataStream
  const reconciliation = payload.tradingAccountReconciliation
  const lastAt =
    activeAutoRun?.progress.lastSuccessfulCycleAt ??
    last?.ranAt ??
    sandbox.newestAt ??
    paper.newestAt
  const lastTimestamp = lastAt ? Date.parse(lastAt) : Number.NaN
  const staleAfterMinutes = activeAutoRun
    ? (activeAutoRun.cycleIntervalMinutes ?? 20) + 5
    : 30
  const stale =
    !Number.isFinite(lastTimestamp) ||
    Date.now() - lastTimestamp > staleAfterMinutes * 60_000
  const blocked =
    totalCount(paper.statusCounts, 'blocked') +
    totalCount(sandbox.statusCounts, 'blocked')
  const dataErrors =
    totalCount(paper.statusCounts, 'data_error') +
    totalCount(sandbox.statusCounts, 'data_error')
  const hasProblem = stale || last?.status === 'data_error' || dataErrors > 0
  const noEntries = activeAutoRuns.some(
    (run) => run.progress.cyclesRun > 0 && run.progress.tradesOpened === 0,
  )
  const autoRunTradeSummary = activeAutoRuns.length
    ? activeAutoRuns
        .map(
          (run) =>
            `${stageLabel(run.stage)}: ${run.progress.tradesOpened} opened / ${run.progress.tradesClosed} closed`,
        )
        .join(' · ')
    : 'n/a'
  const councilNonActionSummary = activeAutoRuns.length
    ? activeAutoRuns
        .map(
          (run) =>
            `${stageLabel(run.stage)}: ${run.evidence.councilNonActionSignals}`,
        )
        .join(' · ')
    : 'n/a'

  async function reconcile() {
    setBusy(true)
    try {
      const response = await fetch('/api/finance', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'reconcile_trading_account' }),
      })
      if (response.ok) onPayload((await response.json()) as FinancePayload)
    } finally {
      setBusy(false)
    }
  }

  return (
    <section className="mt-6 rounded-3xl border border-[var(--theme-border)] bg-[var(--theme-panel)]/70 p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold">Automation health</h2>
          <p className="mt-1 text-xs text-[var(--theme-muted)]">
            Evidence from completed engine cycles. A scheduled job being marked
            successful does not itself prove a trade or a healthy market
            decision.
          </p>
        </div>
        <span
          className={`rounded-full px-3 py-1 text-xs font-medium ${
            hasProblem && !stale
              ? 'bg-[color-mix(in_srgb,var(--theme-danger)_15%,transparent)] text-[var(--theme-danger)]'
              : stale || last?.status === 'blocked' || noEntries
                ? 'bg-[color-mix(in_srgb,var(--theme-warning)_15%,transparent)] text-[var(--theme-warning)]'
                : 'bg-[color-mix(in_srgb,var(--theme-success)_15%,transparent)] text-[var(--theme-success)]'
          }`}
        >
          {stale
            ? 'Stale / no evidence'
            : hasProblem
              ? 'Attention needed'
              : last?.status === 'blocked'
                ? 'Guarded / no trade'
                : noEntries
                  ? 'No entries yet'
                  : 'Operational'}
        </span>
      </div>
      <div className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
        <Metric label="Last engine cycle" value={ageLabel(lastAt)} />
        <Metric
          label="Scheduler"
          value={
            activeAutoRun
              ? `${activeAutoRun.cycleIntervalMinutes ?? 20}m interval`
              : 'manual'
          }
        />
        <Metric label="Last result" value={last?.status ?? 'Unknown'} />
        <Metric label="Paper cycles" value={String(paper.cycles)} />
        <Metric label="Sandbox cycles" value={String(sandbox.cycles)} />
        <Metric label="Auto-run trades" value={autoRunTradeSummary} />
        <Metric label="Council non-action" value={councilNonActionSummary} />
        <Metric
          label="Blocked / data errors"
          value={`${blocked} / ${dataErrors}`}
        />
        <Metric
          label="Account reconciliation"
          value={
            reconciliation
              ? reconciliation.status.replace('_', ' ')
              : 'not checked'
          }
        />
      </div>
      <div className="mt-3 flex flex-wrap gap-2 text-xs text-[var(--theme-muted)]">
        <span
          className={`rounded-full border px-2.5 py-1 ${stream.connected ? 'border-emerald-500/40 text-emerald-300' : 'border-[var(--theme-border)]'}`}
        >
          Exchange events:{' '}
          {stream.connected
            ? `connected (${stream.environment ?? 'unknown'})`
            : stream.enabled
              ? stream.armed
                ? 'not connected'
                : 'standby'
              : 'disabled'}
        </span>
        {stream.lastEventAt ? (
          <span className="rounded-full border border-[var(--theme-border)] px-2.5 py-1">
            Last exchange event: {ageLabel(stream.lastEventAt)}
          </span>
        ) : null}
        {stream.lastError ? (
          <span className="rounded-full border border-amber-500/40 px-2.5 py-1 text-amber-300">
            Stream: {stream.lastError}
          </span>
        ) : null}
        <span className="rounded-full border border-[var(--theme-border)] px-2.5 py-1">
          Auto-run stages:{' '}
          {activeAutoRuns.length
            ? activeAutoRuns.map((run) => run.stage).join(', ')
            : 'none'}
        </span>
        {last?.reason ? (
          <span className="rounded-full border border-[var(--theme-border)] px-2.5 py-1">
            Last reason: {last.reason}
          </span>
        ) : null}
        <button
          type="button"
          disabled={busy}
          onClick={() => void reconcile()}
          className="rounded-full border border-[var(--theme-border)] px-2.5 py-1 hover:border-[var(--theme-accent)] disabled:opacity-50"
        >
          {busy ? 'Reconciling…' : 'Reconcile account now'}
        </button>
        {reconciliation?.detail ? (
          <span className="rounded-full border border-[var(--theme-border)] px-2.5 py-1">
            Reconciliation: {reconciliation.detail}
          </span>
        ) : null}
      </div>
    </section>
  )
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-2xl border border-[var(--theme-border)]/70 bg-[color-mix(in_srgb,var(--theme-text)_6%,transparent)] p-3">
      <div className="text-[11px] uppercase tracking-[0.12em] text-[var(--theme-muted)]">
        {label}
      </div>
      <div className="mt-1 text-sm font-semibold capitalize">{value}</div>
    </div>
  )
}
