/** DecisionQualityPanel — extracted verbatim from trading-screen.tsx. */
import { useMemo, useState } from 'react'
import { formatDateTime, formatFractionPct, formatUsdt } from '../format-helpers'
import { overrideLifecycleLabel } from '../panel-helpers'
import { useFinanceAction } from '../../finance/hooks/use-finance-action'
import { StatCard } from '../../finance/components/stat-card'
import type { DecisionQualityFinding, DecisionQualityReport, FinancePayload, StrategyOverride } from '../trading-types'

export function DecisionQualityPanel({
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
