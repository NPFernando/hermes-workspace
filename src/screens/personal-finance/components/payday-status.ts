const GRACE_DAYS = 3

function stringField(row: Record<string, unknown>, key: string): string {
  const value = row[key]
  return typeof value === 'string' ? value : ''
}

function optionalNumberField(row: Record<string, unknown>, key: string): number | undefined {
  const value = row[key]
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined
}

export type PaydayStatus =
  | { state: 'not_tracked' }
  | { state: 'paid'; lastPaidDate: string }
  | { state: 'due_soon'; daysUntil: number }
  | { state: 'overdue'; daysOverdue: number }

function startOfDay(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate())
}

/** Clamps to the last real day of the month (e.g. day 31 in Feb -> 28/29). */
function paydayDateFor(year: number, monthIndex: number, dayOfMonth: number): Date {
  const lastDayOfMonth = new Date(year, monthIndex + 1, 0).getDate()
  return new Date(year, monthIndex, Math.min(dayOfMonth, lastDayOfMonth))
}

/**
 * Read-only, deterministic (no AI): tells you whether this month's pay for a
 * job has been logged yet, based on its expectedPaydayDayOfMonth. Mirrors
 * detectRecurringVendors' shape (recurring-bills-insight.tsx) — a pure
 * function consumed by a panel, not a component itself.
 */
export function getPaydayStatus(
  job: Record<string, unknown>,
  incomeRecords: Array<Record<string, unknown>>,
  today: Date = new Date(),
): PaydayStatus {
  const status = stringField(job, 'status') || 'active'
  const monthlyIncomeAmount = optionalNumberField(job, 'monthlyIncomeAmount')
  const paydayDay = optionalNumberField(job, 'expectedPaydayDayOfMonth')
  if (status !== 'active' || monthlyIncomeAmount === undefined || paydayDay === undefined) {
    return { state: 'not_tracked' }
  }

  const jobId = stringField(job, 'id')
  const employerName = stringField(job, 'employerName').trim().toLowerCase()
  const now = startOfDay(today)
  const currentMonthKey = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`

  const matches = incomeRecords.filter((record) => {
    const dateReceived = stringField(record, 'dateReceived')
    if (dateReceived.slice(0, 7) !== currentMonthKey) return false
    const linkedId = stringField(record, 'incomeSourceId')
    if (linkedId) return linkedId === jobId
    // Legacy fallback for income logged before this feature existed.
    return stringField(record, 'sourceName').trim().toLowerCase() === employerName
  })

  if (matches.length > 0) {
    const lastPaidDate = matches
      .map((r) => stringField(r, 'dateReceived'))
      .sort()
      .at(-1)!
    return { state: 'paid', lastPaidDate }
  }

  const payday = paydayDateFor(now.getFullYear(), now.getMonth(), paydayDay)
  const daysDiff = Math.round((payday.getTime() - now.getTime()) / (24 * 60 * 60 * 1000))

  if (daysDiff < -GRACE_DAYS) {
    return { state: 'overdue', daysOverdue: -daysDiff }
  }
  return { state: 'due_soon', daysUntil: daysDiff }
}
