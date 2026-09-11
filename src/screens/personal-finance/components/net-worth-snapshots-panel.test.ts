import { describe, expect, it } from 'vitest'
import {
  buildNetWorthSnapshotsCsv,
  buildMonthlyNetWorthSummary,
  buildNetWorthTrend,
  compareNetWorthSnapshots,
} from './net-worth-snapshots-panel'

const current = {
  id: 'current',
  snapshotDate: '2026-09-10',
  netWorthLkr: 150_000,
  cashLkr: 100_000,
  debtLkr: 20_000,
  investmentsLkr: 50_000,
  liquidNetWorthLkr: 80_000,
  lockedWealthLkr: 70_000,
  source: 'manual',
  createdAt: '2026-09-10T00:00:00.000Z',
}

describe('compareNetWorthSnapshots', () => {
  it('returns changes from the prior captured point', () => {
    expect(
      compareNetWorthSnapshots(current, {
        ...current,
        id: 'previous',
        snapshotDate: '2026-09-01',
        netWorthLkr: 125_000,
        cashLkr: 90_000,
        debtLkr: 25_000,
      }),
    ).toEqual({ netWorthLkr: 25_000, cashLkr: 10_000, debtLkr: -5_000 })
  })

  it('does not infer a change without a prior snapshot', () => {
    expect(compareNetWorthSnapshots(current)).toBeNull()
  })
})

describe('buildNetWorthTrend', () => {
  it('orders chart points from oldest to newest', () => {
    expect(
      buildNetWorthTrend([
        { ...current, snapshotDate: '2026-09-10' },
        { ...current, snapshotDate: '2026-09-01', netWorthLkr: 125_000 },
      ]).map((point) => point.snapshotDate),
    ).toEqual(['2026-09-01', '2026-09-10'])
  })
})

describe('buildNetWorthSnapshotsCsv', () => {
  it('exports stable headers and quoted values', () => {
    expect(buildNetWorthSnapshotsCsv([current])).toBe(
      'snapshotDate,netWorthLkr,cashLkr,debtLkr,investmentsLkr,liquidNetWorthLkr,lockedWealthLkr\n"2026-09-10","150000","100000","20000","50000","80000","70000"',
    )
  })
})

describe('buildMonthlyNetWorthSummary', () => {
  it('uses the latest point per month without filling missing months', () => {
    expect(
      buildMonthlyNetWorthSummary([
        { ...current, snapshotDate: '2026-09-03', netWorthLkr: 120_000 },
        { ...current, snapshotDate: '2026-09-20', netWorthLkr: 130_000 },
        { ...current, snapshotDate: '2026-11-02', netWorthLkr: 150_000 },
      ]),
    ).toEqual([
      { month: '2026-09', snapshotDate: '2026-09-20', netWorthLkr: 130_000, changeLkr: null },
      { month: '2026-11', snapshotDate: '2026-11-02', netWorthLkr: 150_000, changeLkr: 20_000 },
    ])
  })
})
