import { describe, expect, it } from 'vitest'
import { evaluateCapitalProtection } from './trading-capital-rules'

describe('capital protection rules', () => {
  const base = {
    executionMode: 'live',
    totalRealizedPnlQuote: 0,
    allocationCapUsdt: 25,
  }

  it('pauses live entries after a loss for manual review', () => {
    expect(
      evaluateCapitalProtection({ ...base, dailyPnlQuote: -1 }),
    ).toMatchObject({
      action: 'pause_after_loss_manual_review',
      newEntriesAllowed: false,
      manualReviewRequired: true,
    })
  })

  it('locks profits by reducing new exposure', () => {
    expect(
      evaluateCapitalProtection({
        ...base,
        dailyPnlQuote: 6,
        totalRealizedPnlQuote: 6,
      }),
    ).toMatchObject({
      action: 'lock_profit_reduce_exposure',
      reduceExposure: true,
      exposureMultiplier: 0.5,
    })
  })

  it('only recommends withdrawal; it never authorizes one', () => {
    const result = evaluateCapitalProtection({
      ...base,
      dailyPnlQuote: 12,
      totalRealizedPnlQuote: 12,
    })
    expect(result.withdrawalEligible).toBe(true)
    expect(result.recommendedWithdrawalQuote).toBe(1)
  })
})
