import { useState } from 'react'
import {
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import { formatLkr } from '../utils'
import type { PersonalFinancePayload } from '../types'

function shortDate(iso: string): string {
  const d = new Date(iso)
  return Number.isNaN(d.getTime())
    ? iso
    : d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}

/**
 * Net-worth trend over time, from the daily `net_worth_snapshots` the
 * snapshot cron writes. Hidden until there are at least two points to draw
 * a line between.
 */
export function NetWorthHistoryCard({
  payload,
}: {
  payload: PersonalFinancePayload
}) {
  const history = payload.netWorthHistory
  const forecast = payload.netWorthForecast
  const [view, setView] = useState<'total' | 'breakdown'>('total')
  if (history.length < 2) return null

  const base = payload.baseCurrency
  const data: Array<{
    date: string
    label: string
    value: number | null
    cash: number | null
    investments: number | null
    debt: number | null
    projected: number | null
  }> = history.map((point) => ({
    date: point.date,
    label: shortDate(point.date),
    value: Math.round(point.netWorthBase),
    cash: Math.round(point.cashBase),
    investments: Math.round(point.investmentsBase),
    debt: Math.round(point.debtBase),
    projected: null,
  }))
  const first = data[0].value ?? 0
  const last = data[data.length - 1].value ?? 0
  const delta = last - first
  const pct = first !== 0 ? (delta / Math.abs(first)) * 100 : 0

  // Extend the chart with a dashed projection — same view ('total' only,
  // it's a single savings-driven number, not a cash/investments/debt split).
  // The last real point doubles as `projected`'s starting value so the
  // dashed line visually picks up exactly where the solid one ends, instead
  // of leaving a gap.
  if (forecast.hasData && view === 'total') {
    data[data.length - 1] = { ...data[data.length - 1], projected: last }
    for (const point of forecast.points) {
      data.push({
        date: point.month,
        label: point.month,
        value: null,
        cash: null,
        investments: null,
        debt: null,
        projected: Math.round(point.projectedNetWorthBase),
      })
    }
  }

  return (
    <section className="mt-4 rounded-3xl border border-[var(--theme-border)] bg-[var(--theme-panel)]/70 p-5">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-sm font-semibold text-[var(--theme-text)]">
          Net worth over time
        </h2>
        <div className="flex items-center gap-3">
          <p className="text-xs text-[var(--theme-muted)]">
            {data.length} days ·{' '}
            <span
              className={
                delta >= 0
                  ? 'text-[var(--theme-success)]'
                  : 'text-[var(--theme-danger)]'
              }
            >
              {delta >= 0 ? '+' : ''}
              {formatLkr(delta, base)} ({pct >= 0 ? '+' : ''}
              {pct.toFixed(1)}%)
            </span>
          </p>
          <div className="flex overflow-hidden rounded-lg border border-[var(--theme-border)] text-[10px]">
            {(['total', 'breakdown'] as const).map((v) => (
              <button
                key={v}
                type="button"
                onClick={() => setView(v)}
                className={`px-2 py-0.5 font-medium capitalize ${view === v ? 'bg-[color-mix(in_srgb,var(--theme-accent)_25%,transparent)] text-[var(--theme-accent)]' : 'text-[var(--theme-muted)]'}`}
              >
                {v}
              </button>
            ))}
          </div>
        </div>
      </div>
      <div className="mt-3 h-56 w-full">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart
            data={data}
            margin={{ top: 8, right: 12, bottom: 4, left: 4 }}
          >
            <CartesianGrid
              strokeDasharray="3 3"
              stroke="var(--theme-border)"
              vertical={false}
            />
            <XAxis
              dataKey="label"
              tick={{ fontSize: 11, fill: 'var(--theme-muted)' }}
              minTickGap={24}
            />
            <YAxis
              width={72}
              tick={{ fontSize: 11, fill: 'var(--theme-muted)' }}
              tickFormatter={(v: number) => formatLkr(v, base)}
            />
            <Tooltip
              formatter={(v: number) => formatLkr(v, base)}
              labelFormatter={(
                _label: unknown,
                entries: ReadonlyArray<{ payload?: { date?: string } }> | undefined,
              ) => entries?.[0]?.payload?.date ?? ''}
              contentStyle={{
                background: 'var(--theme-panel)',
                border: '1px solid var(--theme-border)',
                borderRadius: 12,
                fontSize: 12,
              }}
            />
            {view === 'total' ? (
              <>
                <Line
                  type="monotone"
                  dataKey="value"
                  name="Net worth"
                  stroke="var(--theme-accent)"
                  strokeWidth={2}
                  dot={false}
                  connectNulls={false}
                />
                {forecast.hasData && (
                  <Line
                    type="monotone"
                    dataKey="projected"
                    name="Projected"
                    stroke="var(--theme-muted)"
                    strokeWidth={2}
                    strokeDasharray="4 4"
                    dot={false}
                    connectNulls
                  />
                )}
              </>
            ) : (
              <>
                <Legend wrapperStyle={{ fontSize: 11 }} />
                <Line
                  type="monotone"
                  dataKey="cash"
                  name="Cash"
                  stroke="var(--theme-success)"
                  strokeWidth={2}
                  dot={false}
                />
                <Line
                  type="monotone"
                  dataKey="investments"
                  name="Investments"
                  stroke="var(--theme-accent)"
                  strokeWidth={2}
                  dot={false}
                />
                <Line
                  type="monotone"
                  dataKey="debt"
                  name="Debt"
                  stroke="var(--theme-danger)"
                  strokeWidth={2}
                  dot={false}
                />
              </>
            )}
          </LineChart>
        </ResponsiveContainer>
      </div>
      {view === 'total' && forecast.hasData && (
        <>
          <p className="mt-2 text-xs text-[var(--theme-muted)]">
            Dashed line: projected {forecast.points.length} months ahead at{' '}
            {formatLkr(forecast.monthlyDeltaBase, base)}/month (avg. of the last{' '}
            {forecast.monthsOfHistoryUsed} complete month
            {forecast.monthsOfHistoryUsed === 1 ? '' : 's'} of savings) — cash
            flow only, doesn't project market/property/interest growth.
          </p>
          {forecast.accountBreakdown.length > 0 && (
            <div className="mt-3 overflow-x-auto">
              <p className="text-xs font-medium text-[var(--theme-text)]">
                Where the projected growth lands
              </p>
              <table className="mt-1 w-full text-xs">
                <thead>
                  <tr className="text-[var(--theme-muted)]">
                    <th className="text-left font-normal">Account</th>
                    <th className="text-right font-normal">Now</th>
                    <th className="text-right font-normal">
                      At +{forecast.points.length}mo
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {forecast.accountBreakdown.map((a) => {
                    const projected = a.type === 'bank' || a.type === 'cash'
                    return (
                      <tr key={a.accountId}>
                        <td className="text-[var(--theme-text)]">
                          {a.accountName}
                          {!projected && (
                            <span className="ml-1 text-[var(--theme-muted)]">
                              (not projected)
                            </span>
                          )}
                        </td>
                        <td className="text-right text-[var(--theme-muted)]">
                          {formatLkr(a.currentBalanceBase, base)}
                        </td>
                        <td className="text-right text-[var(--theme-text)]">
                          {formatLkr(a.projectedBalanceBase, base)}
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
              <p className="mt-1 text-xs text-[var(--theme-muted)]">
                New savings are assumed to land in bank/cash accounts,
                split by their current balance share — everything else stays
                at today's balance since this model doesn't project market,
                property, or debt movement.
              </p>
            </div>
          )}
        </>
      )}
    </section>
  )
}
