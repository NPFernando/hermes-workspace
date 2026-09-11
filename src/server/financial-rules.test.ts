import { describe, expect, it } from 'vitest'
import { validateFinancialRules } from './financial-rules'

describe('validateFinancialRules', () => {
  it('normalizes configured thresholds and omits cleared values', () => {
    expect(
      validateFinancialRules({
        monthlyInvestmentTargetLkr: '25000',
        largeTransactionThresholdLkr: 100000.456,
        discretionarySpendingThresholdLkr: '',
        investmentAllocationTargetPct: 20.5,
      }),
    ).toEqual({
      ok: true,
      rules: {
        monthlyInvestmentTargetLkr: 25000,
        largeTransactionThresholdLkr: 100000.46,
        investmentAllocationTargetPct: 20.5,
      },
      errors: [],
    })
  })

  it('rejects negative and out-of-range values without silently applying them', () => {
    const result = validateFinancialRules({
      monthlyInvestmentTargetLkr: -1,
      investmentAllocationTargetPct: 101,
    })
    expect(result.ok).toBe(false)
    expect(result.rules).toEqual({})
    expect(result.errors).toHaveLength(2)
  })
})
