/** StrategyOverridePanel — extracted verbatim from trading-screen.tsx. */
import { useMemo, useState } from 'react'
import { formatDateTime } from '../format-helpers'
import { overrideLifecycleLabel } from '../panel-helpers'
import { csvDateSuffix, downloadCsv } from '../csv'
import { useFinanceAction } from '../../finance/hooks/use-finance-action'
import type { FinancePayload, StrategyCatalogEntry, StrategyOverride } from '../trading-types'

export const AUTO_RESTORE_HEALTHY_RUNS = 2

export function demoTradingSettings(payload: FinancePayload): Record<string, unknown> {
  const dt = payload.settings.demoTrading
  return dt && typeof dt === 'object' && !Array.isArray(dt)
    ? (dt as Record<string, unknown>)
    : {}
}

export function demoTradingLearningPolicy(
  payload: FinancePayload,
): Record<string, unknown> {
  const lp = demoTradingSettings(payload).learningPolicy
  return lp && typeof lp === 'object' && !Array.isArray(lp)
    ? (lp as Record<string, unknown>)
    : {}
}

export function demoTradingRestoreProgress(
  payload: FinancePayload,
): Record<string, { healthyRuns: number } | undefined> {
  const rp = demoTradingSettings(payload).strategyRestoreProgress
  return rp && typeof rp === 'object' && !Array.isArray(rp)
    ? (rp as Record<string, { healthyRuns: number } | undefined>)
    : {}
}

export function StrategyOverridePanel({
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
