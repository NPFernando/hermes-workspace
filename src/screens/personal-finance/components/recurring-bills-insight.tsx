import { useFinanceAction } from '../../finance/hooks/use-finance-action'
import { formatLkr } from '../utils'
import { numberField, stringField } from '../field-helpers'
import type { PersonalFinancePayload } from '../types'

function todayIso(): string {
  return new Date().toISOString().slice(0, 10)
}

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
  onPayload,
}: {
  payload: PersonalFinancePayload
  onPayload: (p: PersonalFinancePayload) => void
}) {
  // PF review item 7: computed server-side now (was `detectRecurringVendors`
  // here + a Python port in the digest cron). `detectRecurringVendors` stays
  // exported for its unit test.
  const recurring = payload.recurringBills
  const fx = payload.fxToBase
  const { run, busy } = useFinanceAction<PersonalFinancePayload>(onPayload)
  if (recurring.length === 0) return null

  const logThisMonth = (bill: (typeof recurring)[number], key = `log-${bill.vendor}`) =>
    run(
      {
        action: 'add_record',
        kind: 'expense',
        payload: {
          date: todayIso(),
          vendor: bill.displayVendor,
          category: bill.category,
          // averageAmount is already LKR (convertedLkrAmount) — post it as LKR.
          currency: 'LKR',
          amount: Math.round(bill.averageAmount),
          convertedLkrAmount: Math.round(bill.averageAmount),
          recurring: true,
          notes: 'Logged from recurring-bills suggestion',
        },
      },
      key,
    )

  const unlogged = recurring.filter((r) => !r.loggedThisMonth)

  async function logAll() {
    // Sequential so each write sees the previous — the last payload wins.
    for (const bill of recurring.filter((r) => !r.loggedThisMonth)) {
      await logThisMonth(bill, 'log-all')
    }
  }

  return (
    <section className="mt-6 rounded-3xl border border-[var(--theme-border)] bg-[var(--theme-panel)]/70 p-5">
      <h2 className="text-lg font-semibold text-[var(--theme-text)]">
        Likely recurring bills
      </h2>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-xs text-[var(--theme-muted)]">
          Detected from repeated vendors with a similar amount over the last 3
          months. Nothing is logged automatically.
        </p>
        {unlogged.length > 1 && (
          <button
            type="button"
            onClick={() => void logAll()}
            disabled={busy === 'log-all'}
            className="rounded-lg border border-[var(--theme-border)] bg-[color-mix(in_srgb,var(--theme-text)_12%,transparent)] px-2 py-0.5 text-xs font-medium text-[var(--theme-text)] hover:bg-[color-mix(in_srgb,var(--theme-text)_20%,transparent)] disabled:opacity-50"
          >
            {busy === 'log-all'
              ? 'Adding…'
              : `Log all ${unlogged.length} for this month`}
          </button>
        )}
      </div>
      <div className="mt-3 flex flex-col gap-2">
        {recurring.map((r) => {
          const driftPct =
            r.drift !== null && Math.abs(r.drift) >= 0.15
              ? Math.round(r.drift * 100)
              : null
          return (
          <div
            key={r.vendor}
            className="flex flex-wrap items-center gap-x-2 gap-y-1 rounded-xl border border-[var(--theme-border)]/70 bg-[color-mix(in_srgb,var(--theme-text)_8%,transparent)] px-3 py-1.5 text-xs text-[var(--theme-text)]"
          >
            <span className="capitalize font-medium">{r.displayVendor}</span>
            <span className="text-[var(--theme-muted)]">
              {r.category} · ~
              {formatLkr(r.averageAmount * fx, payload.baseCurrency)} ·{' '}
              {r.monthsSeen} months
            </span>
            {driftPct !== null && (
              <span
                className={
                  driftPct > 0
                    ? 'text-[var(--theme-warning)]'
                    : 'text-[var(--theme-success)]'
                }
              >
                {driftPct > 0 ? '▲' : '▼'} {Math.abs(driftPct)}% vs usual this
                month
              </span>
            )}
            {r.sustainedPriceHike && (
              <span
                className="text-[var(--theme-warning)]"
                title="Risen every month for the last few months — a drift-vs-average check alone wouldn't catch a bill creeping up gradually."
              >
                📈 up {r.priceHikeStreak} months running
              </span>
            )}
            {r.loggedThisMonth ? (
              <span className="text-[var(--theme-success)]">
                ✓ logged this month
              </span>
            ) : (
              <button
                type="button"
                onClick={() => void logThisMonth(r)}
                disabled={busy === `log-${r.vendor}`}
                className="rounded-lg border border-[var(--theme-border)] bg-[color-mix(in_srgb,var(--theme-text)_12%,transparent)] px-2 py-0.5 font-medium text-[var(--theme-text)] hover:bg-[color-mix(in_srgb,var(--theme-text)_20%,transparent)] disabled:opacity-50"
              >
                {busy === `log-${r.vendor}` ? 'Adding…' : 'Log this month'}
              </button>
            )}
          </div>
          )
        })}
      </div>
    </section>
  )
}
