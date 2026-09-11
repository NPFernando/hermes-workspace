import { describe, expect, it } from 'vitest'
import { transactionAmountLabel } from './transaction-display'

describe('transactionAmountLabel', () => {
  it('shows original and stored LKR values for foreign-currency rows', () => {
    expect(
      transactionAmountLabel({ amount: 100, currency: ' usd ', convertedLkrAmount: 30_000 }),
    ).toBe('USD 100 (≈ LKR 30,000)')
  })

  it('does not duplicate LKR or invent a conversion', () => {
    expect(transactionAmountLabel({ amount: 30_000, currency: 'LKR', convertedLkrAmount: 30_000 })).toBe('LKR 30,000')
    expect(transactionAmountLabel({ amount: 100, currency: 'AUD' })).toBe('AUD 100')
  })
})
