import { describe, expect, it } from 'vitest'
import { selectAnalyticsDailyPeriod } from './analytics-normalizers'

describe('selectAnalyticsDailyPeriod', () => {
  it('sorts dates and keeps only the selected trailing window', () => {
    const daily = [
      { day: '2026-09-03' },
      { day: '2026-09-01' },
      { day: '2026-09-04' },
      { day: '2026-09-02' },
      { day: '2026-09-05' },
      { day: '2026-09-06' },
      { day: '2026-09-07' },
      { day: '2026-09-08' },
      { day: '2026-09-09' },
    ] as never

    expect(
      selectAnalyticsDailyPeriod(daily, 7).map((entry) => entry.day),
    ).toEqual([
      '2026-09-03',
      '2026-09-04',
      '2026-09-05',
      '2026-09-06',
      '2026-09-07',
      '2026-09-08',
      '2026-09-09',
    ])
  })
})
