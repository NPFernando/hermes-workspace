import { formatLkr } from '../utils'
import type { PersonalFinancePayload } from '../types'

function monthLabel(month: string): string {
  const date = new Date(`${month}-01T00:00:00Z`)
  return date.toLocaleDateString(undefined, { month: 'short', year: 'numeric', timeZone: 'UTC' })
}

export function CashFlowForecastCard({ payload }: { payload: PersonalFinancePayload }) {
  const forecast = payload.cashFlowForecast
  const amount = (value: number) => formatLkr(value * payload.fxToBase, payload.baseCurrency)

  return (
    <section className="mt-6 rounded-3xl border border-[var(--theme-border)] bg-[var(--theme-panel)]/70 p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold text-[var(--theme-text)]">Cash-flow forecast</h2>
          <p className="mt-1 text-xs text-[var(--theme-muted)]">A conservative view based on recent history and pending scheduled transactions.</p>
        </div>
        <div className="rounded-2xl border border-[var(--theme-success)]/40 bg-[var(--theme-success)]/10 px-4 py-3">
          <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-[var(--theme-muted)]">Safe to spend</p>
          <p className="mt-1 text-xl font-semibold text-[var(--theme-success)]">{amount(forecast.safeToSpendLkr)}</p>
        </div>
      </div>
      <div className="mt-4 grid gap-2 text-xs sm:grid-cols-3">
        {[
          ['Avg income', forecast.averageMonthlyIncomeLkr],
          ['Avg expenses', forecast.averageMonthlyExpenseLkr],
          ['Recurring bills', forecast.recurringMonthlyLkr],
        ].map(([label, value]) => (
          <div key={label} className="rounded-xl bg-[color-mix(in_srgb,var(--theme-text)_6%,transparent)] p-3">
            <span className="text-[var(--theme-muted)]">{label}</span>
            <p className="mt-1 font-medium">{amount(value as number)}/mo</p>
          </div>
        ))}
      </div>
      <div className="mt-4 overflow-x-auto">
        <table className="w-full min-w-[32rem] text-left text-xs">
          <thead className="text-[var(--theme-muted)]"><tr><th className="pb-2 font-medium">Month</th><th className="pb-2 font-medium">Income</th><th className="pb-2 font-medium">Expenses</th><th className="pb-2 font-medium">Ending cash</th></tr></thead>
          <tbody>{forecast.months.map((row) => <tr key={row.month} className="border-t border-[var(--theme-border)]">
            <td className="py-2 font-medium">{monthLabel(row.month)}</td><td className="py-2 text-[var(--theme-success)]">{amount(row.expectedIncomeLkr)}</td><td className="py-2 text-[var(--theme-danger)]">{amount(row.expectedExpenseLkr)}</td><td className={`py-2 ${row.endingCashLkr < 0 ? 'text-[var(--theme-danger)]' : ''}`}>{amount(row.endingCashLkr)}</td>
          </tr>)}</tbody>
        </table>
      </div>
      {forecast.alerts.length > 0 && <div className="mt-3 grid gap-2">{forecast.alerts.map((alert) => <p key={alert.detail} className={`text-xs ${alert.level === 'critical' ? 'text-[var(--theme-danger)]' : 'text-[var(--theme-warning)]'}`}>{alert.detail}</p>)}</div>}
    </section>
  )
}
