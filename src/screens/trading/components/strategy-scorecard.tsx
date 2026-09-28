import { formatFractionPct, formatUsdt } from '../format-helpers'
import type { FinancePayload } from '../trading-types'

function confidenceTone(confidence: 'low' | 'medium' | 'high') {
  if (confidence === 'high') return 'text-[var(--theme-success)]'
  if (confidence === 'medium') return 'text-[var(--theme-warning)]'
  return 'text-[var(--theme-muted)]'
}

function holdLabel(minutes: number) {
  if (minutes < 60) return `${minutes.toFixed(0)}m`
  return `${(minutes / 60).toFixed(1)}h`
}

export function StrategyScorecard({
  rows,
}: {
  rows: FinancePayload['strategyScorecard']
}) {
  if (rows.length === 0) {
    return (
      <section className="mt-6 rounded-3xl border border-[var(--theme-border)] bg-[var(--theme-panel)]/70 p-5">
        <h2 className="text-lg font-semibold">Per-strategy scorecard</h2>
        <p className="mt-2 text-sm text-[var(--theme-muted)]">
          No closed non-shadow trades yet. Scorecard confidence remains low
          until the campaign produces real, fee-net evidence.
        </p>
      </section>
    )
  }

  return (
    <section className="mt-6 rounded-3xl border border-[var(--theme-border)] bg-[var(--theme-panel)]/70 p-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold">Per-strategy scorecard</h2>
          <p className="mt-1 text-xs text-[var(--theme-muted)]">
            Closed non-shadow trades only; P/L is net of recorded fees.
          </p>
        </div>
        <span className="rounded-full border border-[var(--theme-border)] px-2.5 py-1 text-xs text-[var(--theme-muted)]">
          {rows.length} strateg{rows.length === 1 ? 'y' : 'ies'}
        </span>
      </div>
      <div className="mt-4 overflow-x-auto">
        <table className="w-full min-w-[1180px] text-left text-xs">
          <thead className="text-[var(--theme-muted)]">
            <tr className="border-b border-[var(--theme-border)]">
              <th className="px-2 py-2 font-medium">Strategy</th>
              <th className="px-2 py-2 font-medium">Net P/L</th>
              <th className="px-2 py-2 font-medium">Win rate</th>
              <th className="px-2 py-2 font-medium">Profit factor</th>
              <th className="px-2 py-2 font-medium">Expectancy</th>
              <th className="px-2 py-2 font-medium">Sharpe-like</th>
              <th className="px-2 py-2 font-medium">Max DD</th>
              <th className="px-2 py-2 font-medium">Avg hold</th>
              <th className="px-2 py-2 font-medium">Slippage</th>
              <th className="px-2 py-2 font-medium">Trades</th>
              <th className="px-2 py-2 font-medium">Recent evidence</th>
              <th className="px-2 py-2 font-medium">Modes</th>
              <th className="px-2 py-2 font-medium">Confidence</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr
                key={row.strategyId}
                className="border-b border-[var(--theme-border)]/60 last:border-0"
              >
                <td className="px-2 py-3 font-medium text-[var(--theme-text)]">
                  {row.strategyId}
                </td>
                <td
                  className={`px-2 py-3 ${row.totalPnlQuote >= 0 ? 'text-[var(--theme-success)]' : 'text-[var(--theme-danger)]'}`}
                >
                  {formatUsdt(row.totalPnlQuote)}
                </td>
                <td className="px-2 py-3">{formatFractionPct(row.winRate)}</td>
                <td className="px-2 py-3">{row.profitFactor.toFixed(2)}</td>
                <td className="px-2 py-3">{formatUsdt(row.expectancyQuote)}</td>
                <td className="px-2 py-3">{row.sharpeLikeReturn.toFixed(2)}</td>
                <td className="px-2 py-3">{formatUsdt(row.maxDrawdown)}</td>
                <td className="px-2 py-3">{holdLabel(row.averageHoldingMinutes)}</td>
                <td className="px-2 py-3">
                  {row.averageSlippageQuote == null
                    ? '—'
                    : formatUsdt(row.averageSlippageQuote)}
                </td>
                <td className="px-2 py-3">{row.totalTrades}</td>
                <td className="px-2 py-3">
                  <span
                    className={
                      row.recentSampleSufficient
                        ? 'text-[var(--theme-success)]'
                        : 'text-[var(--theme-warning)]'
                    }
                  >
                    {row.recentTrades}/{row.evidenceWindowDays}d ·{' '}
                    {formatUsdt(row.recentPnlQuote)}
                  </span>
                  <span className="block text-[var(--theme-muted)]">
                    {formatFractionPct(row.recentWinRate)} recent win
                  </span>
                </td>
                <td className="px-2 py-3 text-[var(--theme-muted)]">
                  {Object.entries(row.executionModeCounts)
                    .map(([mode, count]) => `${mode}:${count}`)
                    .join(' · ')}
                </td>
                <td className={`px-2 py-3 font-medium ${confidenceTone(row.confidence)}`}>
                  {row.confidence}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  )
}
