import { describe, expect, it } from 'vitest'
import { getPaydayStatus } from './payday-status'

const baseJob = {
  id: 'job-1',
  employerName: 'Acme Corp',
  status: 'active',
  monthlyIncomeAmount: 150000,
  expectedPaydayDayOfMonth: 15,
}

describe('getPaydayStatus', () => {
  it('returns not_tracked when the job has no expectedPaydayDayOfMonth', () => {
    const job = { ...baseJob, expectedPaydayDayOfMonth: undefined }
    expect(getPaydayStatus(job, [])).toEqual({ state: 'not_tracked' })
  })

  it('returns not_tracked when the job has no monthlyIncomeAmount', () => {
    const job = { ...baseJob, monthlyIncomeAmount: undefined }
    expect(getPaydayStatus(job, [])).toEqual({ state: 'not_tracked' })
  })

  it('returns not_tracked for an ended job', () => {
    const job = { ...baseJob, status: 'ended' }
    expect(getPaydayStatus(job, [])).toEqual({ state: 'not_tracked' })
  })

  it('returns paid when a linked income record exists this month (incomeSourceId match)', () => {
    const today = new Date(2026, 7, 20) // 2026-08-20
    const records = [{ dateReceived: '2026-08-15', incomeSourceId: 'job-1', sourceName: 'Someone Else' }]
    expect(getPaydayStatus(baseJob, records, today)).toEqual({ state: 'paid', lastPaidDate: '2026-08-15' })
  })

  it('returns paid via legacy sourceName fallback when incomeSourceId is absent', () => {
    const today = new Date(2026, 7, 20)
    const records = [{ dateReceived: '2026-08-15', sourceName: 'Acme Corp' }]
    expect(getPaydayStatus(baseJob, records, today)).toEqual({ state: 'paid', lastPaidDate: '2026-08-15' })
  })

  it('does not match a record explicitly linked to a different job', () => {
    const today = new Date(2026, 7, 20)
    const records = [{ dateReceived: '2026-08-15', incomeSourceId: 'job-2', sourceName: 'Acme Corp' }]
    expect(getPaydayStatus(baseJob, records, today).state).not.toBe('paid')
  })

  it('returns due_soon when payday is a few days away and nothing logged yet', () => {
    const today = new Date(2026, 7, 13) // 2026-08-13, payday is the 15th
    expect(getPaydayStatus(baseJob, [], today)).toEqual({ state: 'due_soon', daysUntil: 2 })
  })

  it('returns due_soon within the grace period just after payday', () => {
    const today = new Date(2026, 7, 17) // 2 days after the 15th
    expect(getPaydayStatus(baseJob, [], today)).toEqual({ state: 'due_soon', daysUntil: -2 })
  })

  it('returns overdue once more than 3 days past payday with nothing logged', () => {
    const today = new Date(2026, 7, 20) // 5 days after the 15th
    expect(getPaydayStatus(baseJob, [], today)).toEqual({ state: 'overdue', daysOverdue: 5 })
  })

  it('clamps a payday beyond the month length (e.g. 31 in February)', () => {
    const job = { ...baseJob, expectedPaydayDayOfMonth: 31 }
    const today = new Date(2026, 1, 28) // 2026-02-28 (2026 is not a leap year)
    expect(getPaydayStatus(job, [], today)).toEqual({ state: 'due_soon', daysUntil: 0 })
  })

  it('ignores income records from a different month', () => {
    const today = new Date(2026, 7, 20)
    const records = [{ dateReceived: '2026-07-15', incomeSourceId: 'job-1' }]
    expect(getPaydayStatus(baseJob, records, today)).toEqual({ state: 'overdue', daysOverdue: 5 })
  })
})
