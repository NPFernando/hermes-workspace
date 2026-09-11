import { useState } from 'react'
import {
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import { useFinanceAction } from '../../finance/hooks/use-finance-action'
import { buttonClass, inputClass } from '../shared-styles'
import { formatDateOnly, formatMoney } from '../utils'
import type { PersonalFinancePayload } from '../types'

type NetWorthSnapshot = PersonalFinancePayload['netWorthSnapshots'][number]

export function compareNetWorthSnapshots(
  current: NetWorthSnapshot,
  previous?: NetWorthSnapshot,
): { netWorthLkr: number; cashLkr: number; debtLkr: number } | null {
  if (!previous) return null
  return {
    netWorthLkr: current.netWorthLkr - previous.netWorthLkr,
    cashLkr: current.cashLkr - previous.cashLkr,
    debtLkr: current.debtLkr - previous.debtLkr,
  }
}

export function buildNetWorthTrend(
  snapshots: Array<NetWorthSnapshot>,
): Array<{ snapshotDate: string; netWorthLkr: number; cashLkr: number; debtLkr: number }> {
  return [...snapshots]
    .sort((a, b) => a.snapshotDate.localeCompare(b.snapshotDate))
    .map((snapshot) => ({
      snapshotDate: snapshot.snapshotDate,
      netWorthLkr: snapshot.netWorthLkr,
      cashLkr: snapshot.cashLkr,
      debtLkr: snapshot.debtLkr,
    }))
}

export function buildNetWorthSnapshotsCsv(
  snapshots: Array<NetWorthSnapshot>,
): string {
  const cell = (value: string | number) => `"${String(value).replaceAll('"', '""')}"`
  const rows = snapshots.map((snapshot) =>
    [
      snapshot.snapshotDate,
      snapshot.netWorthLkr,
      snapshot.cashLkr,
      snapshot.debtLkr,
      snapshot.investmentsLkr,
      snapshot.liquidNetWorthLkr,
      snapshot.lockedWealthLkr,
    ].map(cell).join(','),
  )
  return [
    'snapshotDate,netWorthLkr,cashLkr,debtLkr,investmentsLkr,liquidNetWorthLkr,lockedWealthLkr',
    ...rows,
  ].join('\n')
}

export function buildMonthlyNetWorthSummary(
  snapshots: Array<NetWorthSnapshot>,
): Array<{ month: string; snapshotDate: string; netWorthLkr: number; changeLkr: number | null }> {
  const latestByMonth = new Map<string, NetWorthSnapshot>()
  for (const snapshot of [...snapshots].sort((a, b) => a.snapshotDate.localeCompare(b.snapshotDate))) {
    latestByMonth.set(snapshot.snapshotDate.slice(0, 7), snapshot)
  }
  const monthly = Array.from(latestByMonth.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([month, snapshot]) => ({ month, snapshot }))
  return monthly.map(({ month, snapshot }, index) => ({
    month,
    snapshotDate: snapshot.snapshotDate,
    netWorthLkr: snapshot.netWorthLkr,
    changeLkr:
      index === 0
        ? null
        : snapshot.netWorthLkr - monthly[index - 1].snapshot.netWorthLkr,
  }))
}

function signedMoney(value: number): string {
  return `${value >= 0 ? '+' : '-'}${formatMoney(Math.abs(value), 'LKR')}`
}

/** AN-100: manual historical state only; it never auto-captures or rewrites history. */
export function NetWorthSnapshotsPanel({
  payload,
  onPayload,
}: {
  payload: PersonalFinancePayload
  onPayload: (payload: PersonalFinancePayload) => void
}) {
  const [snapshotDate, setSnapshotDate] = useState(
    new Date().toISOString().slice(0, 10),
  )
  const { run, busy, error, setError } = useFinanceAction<PersonalFinancePayload>(onPayload)
  const snapshots = payload.netWorthSnapshots
  const trend = buildNetWorthTrend(snapshots)
  const monthlySummary = buildMonthlyNetWorthSummary(snapshots)
  const first = trend[0]
  const latest = trend[trend.length - 1]
  const totalChange =
    trend.length >= 2
      ? trend[trend.length - 1].netWorthLkr - trend[0].netWorthLkr
      : 0

  async function capture() {
    if (!snapshotDate) {
      setError('Choose a snapshot date.')
      return
    }
    await run({ action: 'capture_net_worth_snapshot', snapshotDate }, 'snapshot')
  }

  function downloadCsv() {
    const blob = new Blob([buildNetWorthSnapshotsCsv(snapshots)], {
      type: 'text/csv;charset=utf-8',
    })
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = url
    link.download = `net-worth-snapshots-${new Date().toISOString().slice(0, 10)}.csv`
    link.click()
    URL.revokeObjectURL(url)
  }

  return (
    <section className="mt-6 rounded-3xl border border-[var(--theme-border)] bg-[var(--theme-panel)]/70 p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold">Net-worth snapshots</h2>
          <p className="mt-1 text-xs text-[var(--theme-muted)]">
            Capture a manual point-in-time record for future trend comparisons. Stock holding values and quote provenance are captured with it; historical values are never inferred.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <input
            type="date"
            value={snapshotDate}
            onChange={(event) => setSnapshotDate(event.target.value)}
            className={inputClass}
            aria-label="Snapshot date"
          />
          <button
            type="button"
            onClick={() => void capture()}
            disabled={busy === 'snapshot'}
            className={buttonClass}
          >
            {busy === 'snapshot' ? 'Capturing…' : 'Capture snapshot'}
          </button>
          <button
            type="button"
            onClick={downloadCsv}
            disabled={snapshots.length === 0}
            className={inputClass}
          >
            Export CSV
          </button>
        </div>
      </div>
      {error && <p className="mt-2 text-xs text-[var(--theme-danger)]">{error}</p>}
      {snapshots.length === 0 ? (
        <p className="mt-3 text-sm text-[var(--theme-muted)]">
          No historical snapshots yet. Capture one after reviewing today&apos;s figures.
        </p>
      ) : (
        <>
          {trend.length >= 2 && (
            <div className="mt-4 grid gap-3 sm:grid-cols-3">
              <div className="rounded-2xl border border-[var(--theme-border)]/70 p-3">
                <p className="text-[11px] text-[var(--theme-muted)]">First → latest</p>
                <p className={totalChange >= 0 ? 'mt-1 text-sm text-[var(--theme-success)]' : 'mt-1 text-sm text-[var(--theme-danger)]'}>
                  {signedMoney(totalChange)}
                </p>
              </div>
              <div className="rounded-2xl border border-[var(--theme-border)]/70 p-3">
                <p className="text-[11px] text-[var(--theme-muted)]">Latest net worth</p>
                <p className="mt-1 text-sm font-medium">{formatMoney(latest.netWorthLkr, 'LKR')}</p>
              </div>
              <div className="rounded-2xl border border-[var(--theme-border)]/70 p-3">
                <p className="text-[11px] text-[var(--theme-muted)]">Points captured</p>
                <p className="mt-1 text-sm font-medium">{trend.length}</p>
              </div>
            </div>
          )}
          {trend.length >= 2 && (
            <div className="mt-4 h-56 w-full">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={trend} margin={{ top: 8, right: 12, left: 0, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="2 4" stroke="var(--theme-border)" opacity={0.4} />
                  <XAxis
                    dataKey="snapshotDate"
                    tick={{ fontSize: 10, fill: 'var(--theme-muted)' }}
                    tickFormatter={(value: string) => formatDateOnly(value)}
                    axisLine={false}
                    tickLine={false}
                  />
                  <YAxis
                    tick={{ fontSize: 10, fill: 'var(--theme-muted)' }}
                    tickFormatter={(value: number) => `${Math.round(value / 1000)}k`}
                    axisLine={false}
                    tickLine={false}
                    width={42}
                  />
                  <Tooltip
                    contentStyle={{
                      background: 'var(--theme-panel)',
                      border: '1px solid var(--theme-border)',
                      borderRadius: 8,
                      fontSize: 11,
                    }}
                    labelFormatter={(value: unknown) => formatDateOnly(String(value))}
                    formatter={(value: number, name: string) => [formatMoney(value, 'LKR'), name]}
                  />
                  <Line type="monotone" dataKey="netWorthLkr" name="Net worth" stroke="var(--theme-accent)" strokeWidth={2} dot={{ r: 3 }} />
                  <Line type="monotone" dataKey="cashLkr" name="Cash" stroke="var(--theme-success)" strokeWidth={1.5} dot={false} />
                  <Line type="monotone" dataKey="debtLkr" name="Debt" stroke="var(--theme-danger)" strokeWidth={1.5} dot={false} />
                </LineChart>
              </ResponsiveContainer>
            </div>
          )}
          <div className="mt-4 grid gap-2">
          {snapshots.slice(0, 12).map((snapshot, index) => {
            const delta = compareNetWorthSnapshots(snapshot, snapshots[index + 1])
            return (
            <div
              key={snapshot.id}
              className="flex flex-wrap items-center justify-between gap-2 rounded-2xl border border-[var(--theme-border)]/70 px-3 py-2 text-xs"
            >
              <span className="font-medium">{formatDateOnly(snapshot.snapshotDate)}</span>
              <span className="text-[var(--theme-muted)]">
                Net worth {formatMoney(snapshot.netWorthLkr, 'LKR')} · Cash {formatMoney(snapshot.cashLkr, 'LKR')} · Debt {formatMoney(snapshot.debtLkr, 'LKR')}
              </span>
              {delta ? (
                <span className={delta.netWorthLkr >= 0 ? 'text-[var(--theme-success)]' : 'text-[var(--theme-danger)]'}>
                  Since {formatDateOnly(snapshots[index + 1].snapshotDate)}: {signedMoney(delta.netWorthLkr)}
                </span>
              ) : (
                <span className="text-[var(--theme-muted)]">Baseline snapshot</span>
              )}
            </div>
            )
          })}
          </div>
          {monthlySummary.length >= 2 && (
            <div className="mt-5 rounded-2xl border border-[var(--theme-border)]/70 p-3">
              <h3 className="text-sm font-semibold">Monthly snapshot summary</h3>
              <p className="mt-1 text-xs text-[var(--theme-muted)]">
                Uses the latest captured point in each month; missing months are not interpolated.
              </p>
              <div className="mt-2 grid gap-1">
                {[...monthlySummary].reverse().slice(0, 12).map((row) => (
                  <div
                    key={row.month}
                    className="flex flex-wrap items-center justify-between gap-2 rounded-xl bg-[color-mix(in_srgb,var(--theme-text)_6%,transparent)] px-3 py-2 text-xs"
                  >
                    <span>{row.month} · {formatDateOnly(row.snapshotDate)}</span>
                    <span>
                      {formatMoney(row.netWorthLkr, 'LKR')} ·{' '}
                      <span className={row.changeLkr === null || row.changeLkr >= 0 ? 'text-[var(--theme-success)]' : 'text-[var(--theme-danger)]'}>
                        {row.changeLkr === null ? 'Baseline' : signedMoney(row.changeLkr)}
                      </span>
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </>
      )}
    </section>
  )
}
