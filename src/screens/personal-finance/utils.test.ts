import { describe, expect, it } from 'vitest'
import { convertWithExchangeRates, formatMoney, normalizeDisplayCurrency } from './utils'

describe('personal finance currency helpers', () => {
  const rates = [
    { base: 'USD', target: 'LKR', rate: 300, date: '2026-09-01' },
    { base: 'USD', target: 'LKR', rate: 299, date: '2026-08-01' },
    { base: 'LKR', target: 'AUD', rate: 0.005, date: '2026-09-01' },
    { base: 'AUD', target: 'LKR', rate: 210, date: '2026-08-01' },
  ]

  it('uses the latest eligible direct rate', () => {
    expect(convertWithExchangeRates(10, 'USD', 'LKR', rates, '2026-09-10')).toBe(3000)
  })

  it('supports inverse and LKR-bridged conversions', () => {
    expect(convertWithExchangeRates(2100, 'LKR', 'AUD', rates, '2026-09-10')).toBe(10.5)
    expect(convertWithExchangeRates(10, 'USD', 'AUD', rates, '2026-09-10')).toBe(15)
  })

  it('does not use future or invalid rates and preserves same-currency values', () => {
    expect(convertWithExchangeRates(10, 'USD', 'LKR', [{ base: 'USD', target: 'LKR', rate: 999, date: '2026-09-11' }], '2026-09-10')).toBeUndefined()
    expect(convertWithExchangeRates(10, 'USD', 'LKR', [{ base: 'USD', target: 'LKR', rate: 0, date: '2026-09-01' }], '2026-09-10')).toBeUndefined()
    expect(convertWithExchangeRates(10, 'LKR', 'LKR', [], '2026-09-10')).toBe(10)
  })

  it('formats money consistently for non-LKR currencies', () => {
    expect(formatMoney(1234.6, 'USD')).toBe('USD 1,235')
    expect(formatMoney(1234.6, ' usd ')).toBe('USD 1,235')
  })

  it('normalizes legacy display currency values', () => {
    expect(normalizeDisplayCurrency(' usd ')).toBe('USD')
    expect(normalizeDisplayCurrency('')).toBe('LKR')
    expect(normalizeDisplayCurrency(null, 'AUD')).toBe('AUD')
  })
})
