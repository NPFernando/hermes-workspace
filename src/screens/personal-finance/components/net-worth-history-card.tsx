import {
  CartesianGrid,
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
  if (history.length < 2) return null

  const base = payload.baseCurrency
  const data = history.map((point) => ({
    date: point.date,
    label: shortDate(point.date),
    value: Math.round(point.netWorthBase),
  }))
  const first = data[0].value
  const last = data[data.length - 1].value
  const delta = last - first
  const pct = first !== 0 ? (delta / Math.abs(first)) * 100 : 0

  return (
    <section className="mt-4 rounded-3xl border border-[var(--theme-border)] bg-[var(--theme-panel)]/70 p-5">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-sm font-semibold text-[var(--theme-text)]">
          Net worth over time
        </h2>
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
            <Line
              type="monotone"
              dataKey="value"
              stroke="var(--theme-accent)"
              strokeWidth={2}
              dot={false}
            />
          </LineChart>
        </ResponsiveContainer>
      </div>
    </section>
  )
}
