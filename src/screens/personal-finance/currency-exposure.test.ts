import { describe, expect, it } from 'vitest'
import { currencyExposure } from './currency-exposure'
import type { PersonalFinancePayload } from './types'

function payload(overrides: Partial<PersonalFinancePayload> = {}) {
  return {
    baseCurrency: 'LKR',
    exchangeRates: [
      { base: 'USD', target: 'LKR', rate: 300, date: '2026-09-01' },
      { base: 'USD', target: 'LKR', rate: 280, date: '2026-10-01' },
    ],
    data: {
      income_sources: [
        { status: 'active', monthlyIncomeAmount: 1000, currency: 'USD' },
        { status: 'paused', monthlyIncomeAmount: 999, currency: 'AUD' },
      ],
      stock_holdings: [
        { quantity: 2, lastKnownPrice: 50, currency: 'USD' },
      ],
      fixed_deposits: [
        { principal: 10000, currency: 'LKR', status: 'active' },
        { principal: 9000, currency: 'USD', status: 'withdrawn' },
      ],
    },
    ...overrides,
  } as PersonalFinancePayload
}

describe('currencyExposure', () => {
  it('groups active exposure and converts with the latest dated eligible rate', () => {
    expect(currencyExposure(payload())).toEqual([
      { currency: 'USD', amount: 1100, baseAmount: 330000 },
      { currency: 'LKR', amount: 10000, baseAmount: 10000 },
    ])
  })

  it('leaves the conversion absent when no eligible rate exists', () => {
    const result = currencyExposure(payload({ exchangeRates: [] }))
    expect(result.find((row) => row.currency === 'USD')).toEqual({
      currency: 'USD',
      amount: 1100,
      baseAmount: undefined,
    })
  })

  it('merges legacy currency casing before grouping and conversion', () => {
    const original = payload()
    const result = currencyExposure(payload({
      baseCurrency: ' lkr ',
      exchangeRates: [{ base: ' usd ', target: ' LKR ', rate: 300, date: '2026-09-01' }],
      data: {
        ...original.data,
        income_sources: [{ status: 'active', monthlyIncomeAmount: 100, currency: ' usd ' }],
        stock_holdings: [{ quantity: 1, lastKnownPrice: 50, currency: 'USD' }],
        fixed_deposits: [],
      },
    }))
    expect(result).toEqual([{ currency: 'USD', amount: 150, baseAmount: 45_000 }])
  })

  it('keeps unconvertible currencies visible after valued rows', () => {
    const result = currencyExposure(payload({
      data: {
        ...payload().data,
        income_sources: [
          { status: 'active', monthlyIncomeAmount: 100, currency: 'USD' },
          { status: 'active', monthlyIncomeAmount: 900, currency: 'AUD' },
        ],
      },
    }))
    expect(result.map((row) => row.currency)).toEqual(['USD', 'LKR', 'AUD'])
    expect(result.at(-1)?.baseAmount).toBeUndefined()
  })
})
