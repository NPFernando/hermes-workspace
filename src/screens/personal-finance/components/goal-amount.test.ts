import { describe, expect, it } from 'vitest'
import { formatGoalAmount, goalCurrency } from './goal-amount'

describe('goal amount formatting', () => {
  it('uses the stored currency and normalizes legacy casing', () => {
    const goal = { currency: ' usd ' }
    expect(goalCurrency(goal)).toBe('USD')
    expect(formatGoalAmount(goal, 1250)).toBe('USD 1,250')
  })

  it('defaults missing currency to LKR', () => {
    expect(formatGoalAmount({}, 1250)).toBe('LKR 1,250')
  })
})
