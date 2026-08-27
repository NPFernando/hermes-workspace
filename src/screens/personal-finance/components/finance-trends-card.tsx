import { useMemo } from 'react'
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import { formatLkr } from '../utils'
import type { PersonalFinancePayload } from '../types'

const MONTHS_BACK = 6

export function monthLabel(month: string): string {
  const [year, mon] = month.split('-')
  const date = new Date(Number(year), Number(mon) - 1, 1)
  return date.toLocaleDateString('en-US', { month: 'short' })
}

export function lastNMonths(n: number, now: Date = new Date()): Array<string> {
  const months: Array<string> = []
  for (let i = n - 1; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1)
    months.push(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`)
  }
  return months
}

function numberField(row: Record<string, unknown>, key: string): number {
  const value = row[key]
  return typeof value === 'number' && Number.isFinite(value) ? value : 0
}

function stringField(row: Record<string, unknown>, key: string): string {
  const value = row[key]
  return typeof value === 'string' ? value : ''
}

export type TrendPoint = { month: string; label: string; income: number; expense: number }

export function buildTrendData(
  months: Array<string>,
  incomeRecords: Array<Record<string, unknown>>,
  expenseRecords: Array<Record<string, unknown>>,
): Array<TrendPoint> {
  const incomeByMonth = new Map<string, number>()
  const expenseByMonth = new Map<string, number>()
  for (const row of incomeRecords) {
    const month = stringField(row, 'dateReceived').slice(0, 7)
    incomeByMonth.set(month, (incomeByMonth.get(month) ?? 0) + numberField(row, 'convertedLkrAmount'))
  }
  for (const row of expenseRecords) {
    const month = stringField(row, 'date').slice(0, 7)
    expenseByMonth.set(month, (expenseByMonth.get(month) ?? 0) + numberField(row, 'convertedLkrAmount'))
  }
  return months.map((month) => ({
    month,
    label: monthLabel(month),
    income: incomeByMonth.get(month) ?? 0,
    expense: expenseByMonth.get(month) ?? 0,
  }))
}

export type CategoryTotal = { category: string; amount: number }

export function buildCategoryData(
  currentMonth: string,
  expenseRecords: Array<Record<string, unknown>>,
): Array<CategoryTotal> {
  const totals = new Map<string, number>()
  for (const row of expenseRecords) {
    if (stringField(row, 'date').slice(0, 7) !== currentMonth) continue
    const category = stringField(row, 'category') || 'Other'
    totals.set(category, (totals.get(category) ?? 0) + numberField(row, 'convertedLkrAmount'))
  }
  return Array.from(totals.entries())
    .map(([category, amount]) => ({ category, amount }))
    .sort((a, b) => b.amount - a.amount)
    .slice(0, 8)
}

export function FinanceTrendsCard({ payload }: { payload: PersonalFinancePayload }) {
  const months = useMemo(() => lastNMonths(MONTHS_BACK), [])

  const trendData = useMemo(
    () => buildTrendData(months, payload.data.income_records, payload.data.expense_records),
    [payload, months],
  )

  const categoryData = useMemo(
    () => buildCategoryData(months[months.length - 1], payload.data.expense_records),
    [payload, months],
  )

  const hasTrendData = trendData.some((d) => d.income > 0 || d.expense > 0)
  const hasCategoryData = categoryData.length > 0

  return (
    <section className="mt-6 grid gap-4 lg:grid-cols-2">
      <div className="rounded-3xl border border-[var(--theme-border)] bg-[var(--theme-panel)]/70 p-5">
        <h2 className="text-lg font-semibold text-[var(--theme-text)]">Income vs. expense</h2>
        <p className="text-xs text-[var(--theme-muted)]">Last {MONTHS_BACK} months, LKR-converted totals.</p>
        {hasTrendData ? (
          <div className="mt-3 h-[220px] w-full">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={trendData} margin={{ top: 4, right: 4, left: -20, bottom: 0 }}>
                <defs>
                  <linearGradient id="pfIncome" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="#34d399" stopOpacity={0.4} />
                    <stop offset="100%" stopColor="#34d399" stopOpacity={0} />
                  </linearGradient>
                  <linearGradient id="pfExpense" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="#f87171" stopOpacity={0.35} />
                    <stop offset="100%" stopColor="#f87171" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="2 4" stroke="var(--theme-border)" opacity={0.4} />
                <XAxis dataKey="label" tick={{ fontSize: 10, fill: 'var(--theme-muted)' }} axisLine={false} tickLine={false} />
                <YAxis
                  tick={{ fontSize: 10, fill: 'var(--theme-muted)' }}
                  axisLine={false}
                  tickLine={false}
                  width={44}
                  tickFormatter={(v: number) => (v >= 1000 ? `${Math.round(v / 1000)}k` : String(v))}
                />
                <Tooltip
                  contentStyle={{ background: 'var(--theme-panel)', border: '1px solid var(--theme-border)', borderRadius: 8, fontSize: 11 }}
                  formatter={(value: number, name: string) => [formatLkr(value), name]}
                />
                <Area type="monotone" dataKey="income" name="Income" stroke="#34d399" fill="url(#pfIncome)" strokeWidth={1.6} dot={false} />
                <Area type="monotone" dataKey="expense" name="Expense" stroke="#f87171" fill="url(#pfExpense)" strokeWidth={1.6} dot={false} />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        ) : (
          <p className="mt-4 text-sm text-[var(--theme-muted)]">Not enough dated records yet to chart a trend.</p>
        )}
      </div>

      <div className="rounded-3xl border border-[var(--theme-border)] bg-[var(--theme-panel)]/70 p-5">
        <h2 className="text-lg font-semibold text-[var(--theme-text)]">Spending by category</h2>
        <p className="text-xs text-[var(--theme-muted)]">This month, LKR-converted totals.</p>
        {hasCategoryData ? (
          <div className="mt-3 h-[220px] w-full">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={categoryData} layout="vertical" margin={{ top: 4, right: 12, left: 8, bottom: 0 }}>
                <CartesianGrid strokeDasharray="2 4" stroke="var(--theme-border)" opacity={0.4} horizontal={false} />
                <XAxis
                  type="number"
                  tick={{ fontSize: 10, fill: 'var(--theme-muted)' }}
                  axisLine={false}
                  tickLine={false}
                  tickFormatter={(v: number) => (v >= 1000 ? `${Math.round(v / 1000)}k` : String(v))}
                />
                <YAxis
                  type="category"
                  dataKey="category"
                  tick={{ fontSize: 10, fill: 'var(--theme-muted)' }}
                  axisLine={false}
                  tickLine={false}
                  width={90}
                />
                <Tooltip
                  contentStyle={{ background: 'var(--theme-panel)', border: '1px solid var(--theme-border)', borderRadius: 8, fontSize: 11 }}
                  formatter={(value: number) => formatLkr(value)}
                />
                <Bar dataKey="amount" fill="#38bdf8" radius={[0, 4, 4, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        ) : (
          <p className="mt-4 text-sm text-[var(--theme-muted)]">No expenses logged this month yet.</p>
        )}
      </div>
    </section>
  )
}
