import { afterEach, describe, expect, it } from 'vitest'

import { detectDurableFinancePreference } from './finance'

const ON = () => {
  process.env.FINANCE_LEARNED_FACTS_ENABLED = '1'
}
afterEach(() => {
  delete process.env.FINANCE_LEARNED_FACTS_ENABLED
})

describe('detectDurableFinancePreference', () => {
  it('returns null unless FINANCE_LEARNED_FACTS_ENABLED is truthy', () => {
    expect(
      detectDurableFinancePreference('I always keep six months of expenses in cash'),
    ).toBeNull()
  })

  it('captures a first-person durable statement when enabled', () => {
    ON()
    expect(
      detectDurableFinancePreference('I always keep six months of expenses in cash'),
    ).toBe('I always keep six months of expenses in cash')
    expect(detectDurableFinancePreference('I never invest in crypto')).toBe(
      'I never invest in crypto',
    )
    expect(
      detectDurableFinancePreference('My rule is to rebalance once a quarter'),
    ).toBe('My rule is to rebalance once a quarter')
  })

  it('ignores plain questions and non-durable phrasing', () => {
    ON()
    expect(detectDurableFinancePreference('Am I overspending this month?')).toBeNull()
    expect(
      detectDurableFinancePreference('I always keep six months in cash — right?'),
    ).toBeNull() // ends with a question mark
    expect(detectDurableFinancePreference('How much did I spend on food')).toBeNull()
    expect(detectDurableFinancePreference('too short')).toBeNull()
  })
})
