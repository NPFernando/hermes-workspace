import { useMemo } from 'react'
import { formatLkr } from '../utils'
import { numberField, stringField } from '../field-helpers'
import type { PersonalFinancePayload } from '../types'

export type RecurringVendor = {
  vendor: string
  category: string
  monthsSeen: number
  averageAmount: number
}

/**
 * Read-only insight, no writes: groups expenses by vendor (case-insensitive)
 * and flags any vendor appearing with a similar amount (within 20%) in 2+
 * of the last `monthsBack` distinct months — the shape of a recurring bill
 * (rent, subscriptions, utilities), without touching the existing manual
 * `recurring` boolean field a user can already set per-record.
 */
export function detectRecurringVendors(
  expenseRecords: Array<Record<string, unknown>>,
  monthsBack = 3,
): Array<RecurringVendor> {
  const cutoff = new Date()
  cutoff.setMonth(cutoff.getMonth() - monthsBack)
  const cutoffMonth = `${cutoff.getFullYear()}-${String(cutoff.getMonth() + 1).padStart(2, '0')}`

  type Bucket = {
    category: string
    entries: Array<{ month: string; amount: number }>
  }
  const byVendor = new Map<string, Bucket>()

  for (const row of expenseRecords) {
    const date = stringField(row, 'date')
    const month = date.slice(0, 7)
    if (!month || month < cutoffMonth) continue
    const vendorKey = stringField(row, 'vendor').trim().toLowerCase()
    if (!vendorKey) continue
    const amount =
      numberField(row, 'convertedLkrAmount') || numberField(row, 'amount')
    const bucket = byVendor.get(vendorKey) ?? {
      category: stringField(row, 'category') || 'Other',
      entries: [],
    }
    bucket.entries.push({ month, amount })
    byVendor.set(vendorKey, bucket)
  }

  const results: Array<RecurringVendor> = []
  for (const [vendorKey, bucket] of byVendor) {
    const distinctMonths = new Set(bucket.entries.map((e) => e.month))
    if (distinctMonths.size < 2) continue
    const amounts = bucket.entries.map((e) => e.amount)
    const avg = amounts.reduce((sum, a) => sum + a, 0) / amounts.length
    const withinTolerance = amounts.every(
      (a) => avg > 0 && Math.abs(a - avg) / avg <= 0.2,
    )
    if (!withinTolerance) continue
    results.push({
      vendor: vendorKey,
      category: bucket.category,
      monthsSeen: distinctMonths.size,
      averageAmount: avg,
    })
  }

  return results.sort((a, b) => b.monthsSeen - a.monthsSeen)
}

export function RecurringBillsInsight({
  payload,
}: {
  payload: PersonalFinancePayload
}) {
  const recurring = useMemo(
    () => detectRecurringVendors(payload.data.expense_records),
    [payload],
  )
  if (recurring.length === 0) return null

  return (
    <section className="mt-6 rounded-3xl border border-[var(--theme-border)] bg-[var(--theme-panel)]/70 p-5">
      <h2 className="text-lg font-semibold text-[var(--theme-text)]">
        Likely recurring bills
      </h2>
      <p className="text-xs text-[var(--theme-muted)]">
        Detected from repeated vendors with a similar amount over the last 3
        months — informational only, nothing is changed automatically.
      </p>
      <div className="mt-3 flex flex-wrap gap-2">
        {recurring.map((r) => (
          <span
            key={r.vendor}
            className="rounded-xl border border-[var(--theme-border)]/70 bg-[color-mix(in_srgb,var(--theme-text)_8%,transparent)] px-3 py-1.5 text-xs text-[var(--theme-text)]"
          >
            <span className="capitalize">{r.vendor}</span> · {r.category} · ~
            {formatLkr(r.averageAmount)} · {r.monthsSeen} months
          </span>
        ))}
      </div>
    </section>
  )
}
