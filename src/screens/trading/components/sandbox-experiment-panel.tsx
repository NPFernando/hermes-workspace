/** Sandbox strategy-experiment panel. Extracted verbatim from trading-screen.tsx. */
import { useState } from 'react'
import { formatDateTime } from '../format-helpers'
import { useFinanceAction } from '../../finance/hooks/use-finance-action'
import { StatCard } from '../../finance/components/stat-card'
import type { FinancePayload, SandboxExperiment, SandboxExperimentStatus, StrategyCatalogEntry } from '../trading-types'

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
export function SandboxExperimentPanel({
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
