/** Guardian-review evidence panel. Extracted verbatim from trading-screen.tsx. */
import { formatFractionPct, formatUsdt } from '../format-helpers'
import { StatCard } from '../../finance/components/stat-card'
import type { StrategyGuardRecommendation, StrategyGuardReview } from '../trading-types'

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
export function GuardEvidencePanel({ evidence }: { evidence: Array<StrategyGuardReview> }) {
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
