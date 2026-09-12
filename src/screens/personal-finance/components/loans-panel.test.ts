import { describe, expect, it } from 'vitest'
import { payoffComparison, payoffProjection } from './loans-panel'

function loan(over: Partial<Record<string, unknown>> = {}) {
  return {
    id: 'l1',
    lender: 'Bank',
    principal: 1_000_000,
    currentBalance: 1_000_000,
    currency: 'LKR',
    interestRatePct: 12,
    monthlyPayment: 20_000,
    startDate: '2026-01-01',
    status: 'active',
    ...over,
  }
}

describe('payoffProjection', () => {
  it('returns null for a non-active loan', () => {
    expect(payoffProjection(loan({ status: 'paid_off' }))).toBeNull()
  })

  it('returns null when there is no monthly payment or balance', () => {
    expect(payoffProjection(loan({ monthlyPayment: 0 }))).toBeNull()
    expect(payoffProjection(loan({ currentBalance: 0 }))).toBeNull()
  })

  it('flags insufficientPayment when the payment does not cover interest', () => {
    // 1,000,000 at 12%/yr = 10,000/month interest-only; a 5,000 payment never touches principal.
    const result = payoffProjection(loan({ monthlyPayment: 5_000 }))
    expect(result).toEqual({ insufficientPayment: true })
  })

  it('projects months remaining, total interest, and a payoff date for a sufficient payment', () => {
    const result = payoffProjection(loan())
    expect(result?.insufficientPayment).toBe(false)
    if (result?.insufficientPayment === false) {
      expect(result.monthsRemaining).toBeGreaterThan(0)
      expect(result.totalInterest).toBeGreaterThan(0)
      expect(result.payoffDate).toMatch(/^\d{4}-\d{2}-\d{2}$/)
    }
  })

  it('handles a 0% interest loan as straight-line division', () => {
    const result = payoffProjection(
      loan({ interestRatePct: 0, currentBalance: 100_000, monthlyPayment: 25_000 }),
    )
    expect(result).toMatchObject({ insufficientPayment: false, monthsRemaining: 4, totalInterest: 0 })
  })

  it('flags a payoff that runs past the original term', () => {
    const result = payoffProjection(loan({ termMonths: 3 }))
    expect(result?.insufficientPayment).toBe(false)
    if (result?.insufficientPayment === false) {
      expect(result.termComparisonText).toMatch(/longer than the original 3-month term/)
    }
  })

  it('reports staying within term when the payoff is on or ahead of schedule', () => {
    const result = payoffProjection(
      loan({ interestRatePct: 0, currentBalance: 100_000, monthlyPayment: 25_000, termMonths: 12 }),
    )
    expect(result?.insufficientPayment).toBe(false)
    if (result?.insufficientPayment === false) {
      expect(result.termComparisonText).toBe('within the original 12-month term')
    }
  })
})

describe('payoffComparison', () => {
  it('returns null for a non-active loan or one with no payment/balance', () => {
    expect(payoffComparison(loan({ status: 'defaulted' }), 5_000)).toBeNull()
    expect(payoffComparison(loan({ monthlyPayment: 0 }), 5_000)).toBeNull()
  })

  it('an extra payment shortens the payoff and reduces total interest', () => {
    const comparison = payoffComparison(loan(), 10_000)
    expect(comparison).not.toBeNull()
    expect(comparison!.baseline.insufficientPayment).toBe(false)
    expect(comparison!.withExtra.insufficientPayment).toBe(false)
    expect(comparison!.monthsSaved).not.toBeNull()
    expect(comparison!.interestSaved).not.toBeNull()
    expect(comparison!.monthsSaved!).toBeGreaterThan(0)
    expect(comparison!.interestSaved!).toBeGreaterThan(0)
  })

  it('monthsSaved/interestSaved are null when extraPayment is 0', () => {
    const comparison = payoffComparison(loan(), 0)
    expect(comparison!.monthsSaved).toBeNull()
    expect(comparison!.interestSaved).toBeNull()
  })

  it('monthsSaved/interestSaved are null when the baseline payment never covers interest, even with extra', () => {
    // 1,000,000 at 12%/yr = 10,000/month interest-only. Baseline of 5,000
    // never covers it; +10,000 extra is 15,000 total, which DOES — the
    // comparison should require BOTH scenarios to be sufficient, not just
    // the one with extra added.
    const comparison = payoffComparison(loan({ monthlyPayment: 5_000 }), 10_000)
    expect(comparison!.baseline.insufficientPayment).toBe(true)
    expect(comparison!.withExtra.insufficientPayment).toBe(false)
    expect(comparison!.monthsSaved).toBeNull()
    expect(comparison!.interestSaved).toBeNull()
  })
})
