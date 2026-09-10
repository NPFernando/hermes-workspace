/** PerformancePanel — extracted verbatim from trading-screen.tsx. */
import { formatFractionPct, formatUsdt } from '../format-helpers'
import { StatCard } from '../../finance/components/stat-card'
import type { FinancePayload } from '../trading-types'

export function PerformancePanel({
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
