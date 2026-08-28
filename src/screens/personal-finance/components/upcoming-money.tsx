import { getPaydayStatus } from './payday-status'
import { contractExpiryLabel, paydayLabel } from './income-sources-panel'
import { daysUntil, maturityBadge } from './fixed-deposits-panel'
import type { PersonalFinancePayload } from '../types'

const NEUTRAL_TONE = 'border-[var(--theme-border)] bg-black/10 text-[var(--theme-muted)]'

function stringField(row: Record<string, unknown>, key: string): string {
  const value = row[key]
  return typeof value === 'string' ? value : ''
}

type UpcomingEvent = {
  key: string
  name: string
  kindLabel: string
  text: string
  tone: string
  sortKey: number
}

export function UpcomingMoney({ payload }: { payload: PersonalFinancePayload }) {
  const jobs = payload.data.income_sources
  const incomeRecords = payload.data.income_records
  const deposits = payload.data.fixed_deposits

  const events: Array<UpcomingEvent> = []

  for (const job of jobs) {
    const jobId = stringField(job, 'id')
    const name = stringField(job, 'employerName') || 'Income source'

    const status = getPaydayStatus(job, incomeRecords)
    if (status.state === 'due_soon' || status.state === 'overdue') {
      const badge = paydayLabel(job, incomeRecords)
      if (badge && badge.tone !== NEUTRAL_TONE) {
        const sortKey = status.state === 'overdue' ? -status.daysOverdue : status.daysUntil
        events.push({ key: `payday-${jobId}`, name, kindLabel: 'Payday', text: badge.text, tone: badge.tone, sortKey })
      }
    }

    const expiryBadge = contractExpiryLabel(job)
    if (expiryBadge && expiryBadge.tone !== NEUTRAL_TONE) {
      const target = Date.parse(stringField(job, 'contractEndDate'))
      const sortKey = Number.isFinite(target) ? Math.ceil((target - Date.now()) / (24 * 60 * 60 * 1000)) : 0
      events.push({ key: `contract-${jobId}`, name, kindLabel: 'Contract', text: expiryBadge.text, tone: expiryBadge.tone, sortKey })
    }
  }

  for (const fd of deposits) {
    const status = stringField(fd, 'status') || 'active'
    if (status !== 'active') continue
    const maturity = stringField(fd, 'maturityDate')
    const remaining = maturity ? daysUntil(maturity) : null
    if (remaining === null) continue
    const badge = maturityBadge(remaining)
    if (badge.tone === NEUTRAL_TONE) continue
    const fdId = stringField(fd, 'id')
    const name = stringField(fd, 'bankName') || 'Fixed deposit'
    events.push({ key: `fd-${fdId}`, name, kindLabel: 'Fixed deposit', text: badge.text, tone: badge.tone, sortKey: remaining })
  }

  events.sort((a, b) => a.sortKey - b.sortKey)

  if (events.length === 0) return null

  return (
    <section className="mt-6 rounded-3xl border border-[var(--theme-border)] bg-[var(--theme-panel)]/70 p-5">
      <h2 className="text-lg font-semibold text-[var(--theme-text)]">Upcoming money</h2>
      <p className="text-xs text-[var(--theme-muted)]">
        Paydays, fixed deposit maturities, and contract expirations needing attention soon.
      </p>
      <div className="mt-3 grid gap-2">
        {events.map((e) => (
          <div
            key={e.key}
            className="flex items-center justify-between rounded-2xl border border-[var(--theme-border)]/70 bg-black/10 p-3"
          >
            <div>
              <p className="text-sm font-medium text-[var(--theme-text)]">{e.name}</p>
              <p className="text-xs text-[var(--theme-muted)]">{e.kindLabel}</p>
            </div>
            <span className={`rounded-lg border px-2 py-1 text-[10px] uppercase ${e.tone}`}>{e.text}</span>
          </div>
        ))}
      </div>
    </section>
  )
}
