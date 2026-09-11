import { useMemo, useState } from 'react'
import { useFinanceAction } from '../../finance/hooks/use-finance-action'
import { formatLkr, formatMoney } from '../utils'
import { buttonClass, inputClass } from '../shared-styles'
import { numberField, stringField } from '../field-helpers'
import { lastNMonths, monthLabel } from './finance-trends-card'
import type { PersonalFinancePayload } from '../types'

export function buildIncomeHistory(
  months: Array<string>,
  records: Array<Record<string, unknown>>,
): Array<{ month: string; label: string; amount: number }> {
  const totals = new Map<string, number>()
  for (const record of records) {
    if (record.deletedAt || stringField(record, 'transactionType') === 'transfer') continue
    const month = stringField(record, 'dateReceived').slice(0, 7)
    if (!months.includes(month)) continue
    totals.set(month, (totals.get(month) ?? 0) + numberField(record, 'convertedLkrAmount'))
  }
  return months.map((month) => ({
    month,
    label: monthLabel(month),
    amount: totals.get(month) ?? 0,
  }))
}

export type IncomeReliability = {
  score: number
  level: 'low' | 'moderate' | 'high'
  activeMonths: number
  monthsConsidered: number
  averageMonthlyLkr: number
  reasons: Array<string>
}

/** PF-507: recorded-income reliability, not a prediction of future income. */
export function buildIncomeReliability(
  history: Array<{ amount: number }>,
): IncomeReliability {
  const monthsConsidered = history.length
  const active = history.filter((point) => point.amount > 0)
  const activeMonths = active.length
  const averageMonthlyLkr = activeMonths
    ? active.reduce((sum, point) => sum + point.amount, 0) / activeMonths
    : 0
  const variance = activeMonths
    ? active.reduce((sum, point) => sum + (point.amount - averageMonthlyLkr) ** 2, 0) / activeMonths
    : 0
  const relativeVariation = averageMonthlyLkr > 0 ? Math.sqrt(variance) / averageMonthlyLkr : 1
  const coverageScore = Math.round((activeMonths / Math.max(1, monthsConsidered)) * 60)
  const consistencyScore = activeMonths < 2
    ? 0
    : relativeVariation <= 0.1
      ? 30
      : relativeVariation <= 0.25
        ? 20
        : relativeVariation <= 0.5
          ? 10
          : 0
  const latestHasIncome = (history.at(-1)?.amount ?? 0) > 0
  const recencyScore = latestHasIncome ? 10 : 0
  const score = Math.min(100, coverageScore + consistencyScore + recencyScore)
  const level = score >= 75 ? 'high' : score >= 45 ? 'moderate' : 'low'
  return {
    score,
    level,
    activeMonths,
    monthsConsidered,
    averageMonthlyLkr: Math.round(averageMonthlyLkr * 100) / 100,
    reasons: [
      `${activeMonths} of ${monthsConsidered} months contain recorded income`,
      activeMonths > 1
        ? `Month-to-month variation is ${Math.round(relativeVariation * 100)}%`
        : 'More than one recorded month is needed to assess consistency',
      latestHasIncome ? 'The latest month has recorded income' : 'The latest month has no recorded income yet',
    ],
  }
}

export function IncomeHistoryCard({
  payload,
  onPayload,
}: {
  payload: PersonalFinancePayload
  onPayload: (payload: PersonalFinancePayload) => void
}) {
  const { run: post, busy, error } = useFinanceAction<PersonalFinancePayload>(onPayload)
  const [employerName, setEmployerName] = useState('')
  const [effectiveDate, setEffectiveDate] = useState(new Date().toISOString().slice(0, 10))
  const [amount, setAmount] = useState('')
  const [currency, setCurrency] = useState('LKR')
  const [salaryReason, setSalaryReason] = useState('')
  const months = useMemo(() => lastNMonths(12), [])
  const history = useMemo(
    () => buildIncomeHistory(months, payload.data.income_records),
    [months, payload.data.income_records],
  )
  const maxAmount = Math.max(...history.map((point) => point.amount), 0)
  const hasHistory = history.some((point) => point.amount > 0)
  const reliability = useMemo(() => buildIncomeReliability(history), [history])
  const salaryHistory = payload.salaryHistory ?? []

  async function addSalaryChange() {
    const result = await post(
      {
        action: 'add_salary_history',
        employerName,
        effectiveDate,
        amount: Number(amount),
        currency,
        reason: salaryReason,
      },
      'salary-history',
    )
    if (result) {
      setEmployerName('')
      setAmount('')
      setSalaryReason('')
    }
  }

  return (
    <section className="mt-6 rounded-3xl border border-[var(--theme-border)] bg-[var(--theme-panel)]/70 p-5">
      <h2 className="text-lg font-semibold">Income history</h2>
      <p className="mt-1 text-xs text-[var(--theme-muted)]">
        Recorded income by month, converted to LKR. This reflects posted income events, not a forecast.
      </p>
      {!hasHistory ? (
        <p className="mt-3 text-sm text-[var(--theme-muted)]">
          Add income records to build your history.
        </p>
      ) : (
        <div className="mt-4 grid gap-2">
          {history.map((point) => (
            <div key={point.month} className="grid grid-cols-[2.5rem_1fr_auto] items-center gap-2 text-xs">
              <span className="text-[var(--theme-muted)]">{point.label}</span>
              <div className="h-2 overflow-hidden rounded-full bg-[color-mix(in_srgb,var(--theme-text)_12%,transparent)]">
                <div
                  className="h-full rounded-full bg-[var(--theme-success)]"
                  style={{ width: `${maxAmount > 0 ? (point.amount / maxAmount) * 100 : 0}%` }}
                />
              </div>
              <span className="min-w-24 text-right font-medium">{formatLkr(point.amount)}</span>
            </div>
          ))}
        </div>
      )}
      <div className="mt-4 rounded-2xl border border-[var(--theme-border)] p-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <p className="text-xs font-semibold text-[var(--theme-text)]">Recorded income reliability</p>
            <p className="text-[10px] text-[var(--theme-muted)]">Evidence coverage and consistency over the last 12 months</p>
          </div>
          <span className="rounded-full border border-[var(--theme-border)] px-2 py-1 text-[10px] capitalize text-[var(--theme-muted)]">
            {reliability.level} · {reliability.score}/100
          </span>
        </div>
        <p className="mt-2 text-xs text-[var(--theme-muted)]">
          {reliability.activeMonths} active months · average {formatLkr(reliability.averageMonthlyLkr)} per recorded month
        </p>
        <ul className="mt-2 space-y-1 text-[10px] text-[var(--theme-muted)]">
          {reliability.reasons.map((reason) => <li key={reason}>• {reason}</li>)}
        </ul>
      </div>
      <div className="mt-4 rounded-2xl border border-[var(--theme-border)] p-3">
        <p className="text-xs font-semibold text-[var(--theme-text)]">Salary-rate history</p>
        <p className="mt-1 text-[10px] text-[var(--theme-muted)]">
          Record effective salary changes separately from individual income payments.
        </p>
        <div className="mt-2 flex flex-wrap gap-2">
          <input value={employerName} onChange={(event) => setEmployerName(event.target.value)} placeholder="Employer" className={inputClass} />
          <input type="date" value={effectiveDate} onChange={(event) => setEffectiveDate(event.target.value)} className={inputClass} aria-label="Salary effective date" />
          <input type="number" min="0" step="any" value={amount} onChange={(event) => setAmount(event.target.value)} placeholder="Salary amount" className={`${inputClass} w-36`} />
          <select value={currency} onChange={(event) => setCurrency(event.target.value)} className={inputClass} aria-label="Salary currency">
            <option>LKR</option><option>AUD</option><option>USD</option>
          </select>
          <input value={salaryReason} onChange={(event) => setSalaryReason(event.target.value)} placeholder="Reason (optional)" className={`${inputClass} min-w-40`} />
          <button type="button" disabled={busy === 'salary-history' || !employerName.trim() || !amount} onClick={() => void addSalaryChange()} className={buttonClass}>
            {busy === 'salary-history' ? 'Saving…' : 'Add change'}
          </button>
        </div>
        {error && <p className="mt-2 text-xs text-[var(--theme-danger)]">{error}</p>}
        {salaryHistory.length > 0 && (
          <div className="mt-3 grid gap-2">
            {salaryHistory.map((entry) => (
              <div key={entry.id} className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-[var(--theme-border)]/70 p-2 text-xs">
                <span className="font-medium">{entry.employerName}</span>
                <span>{formatMoney(entry.amount, entry.currency)}</span>
                <span className="text-[var(--theme-muted)]">effective {entry.effectiveDate}</span>
                {entry.reason && <span className="text-[var(--theme-muted)]">{entry.reason}</span>}
              </div>
            ))}
          </div>
        )}
      </div>
    </section>
  )
}
