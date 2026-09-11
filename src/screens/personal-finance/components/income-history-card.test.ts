import { describe, expect, it } from 'vitest'
import { buildIncomeReliability } from './income-history-card'

describe('buildIncomeReliability', () => {
  it('scores complete consistent recent income as high evidence', () => {
    const result = buildIncomeReliability(
      Array.from({ length: 12 }, () => ({ amount: 100_000 })),
    )
    expect(result).toMatchObject({
      score: 100,
      level: 'high',
      activeMonths: 12,
      averageMonthlyLkr: 100_000,
    })
  })

  it('makes sparse or stale history visibly low evidence', () => {
    const result = buildIncomeReliability([
      { amount: 0 },
      { amount: 0 },
      { amount: 80_000 },
      { amount: 0 },
    ])
    expect(result.level).toBe('low')
    expect(result.activeMonths).toBe(1)
    expect(result.reasons).toContain('The latest month has no recorded income yet')
  })
})
