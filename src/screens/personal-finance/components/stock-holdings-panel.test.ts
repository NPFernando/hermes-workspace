import { describe, expect, it } from 'vitest'
import {
  buildStockAllocation,
  buildStockConcentrationAlerts,
} from './stock-holdings-panel'

describe('buildStockAllocation', () => {
  it('groups symbols and calculates percentages separately by currency', () => {
    const rows = buildStockAllocation([
      {
        symbol: 'jkh.n0000',
        companyName: 'John Keells',
        currency: 'LKR',
        quantity: 10,
        buyPrice: 100,
        lastKnownPrice: 120,
      },
      {
        symbol: 'JKH.N0000',
        currency: 'LKR',
        quantity: 5,
        buyPrice: 110,
      },
      {
        symbol: 'ABC',
        currency: 'USD',
        quantity: 2,
        buyPrice: 50,
        lastKnownPrice: 60,
      },
    ])

    expect(rows).toHaveLength(2)
    expect(rows[0]).toMatchObject({
      currency: 'LKR',
      symbol: 'JKH.N0000',
      value: 1750,
      cost: 1550,
      percent: 100,
      usesBuyPriceFallback: true,
    })
    expect(rows[1]).toMatchObject({
      currency: 'USD',
      symbol: 'ABC',
      value: 120,
      percent: 100,
      usesBuyPriceFallback: false,
    })
  })

  it('ignores empty or non-positive positions without inventing value', () => {
    expect(
      buildStockAllocation([
        { symbol: 'ZERO', currency: 'LKR', quantity: 0, buyPrice: 100 },
        { symbol: 'NO_PRICE', currency: 'LKR', quantity: 2, buyPrice: 0 },
      ]),
    ).toEqual([])
  })
})

describe('buildStockConcentrationAlerts', () => {
  it('raises transparent warning and critical thresholds per currency', () => {
    const allocation = buildStockAllocation([
      { symbol: 'JKH', currency: 'LKR', quantity: 3, buyPrice: 100 },
      { symbol: 'COMB', currency: 'LKR', quantity: 1, buyPrice: 100 },
      { symbol: 'ABC', currency: 'USD', quantity: 1, buyPrice: 50 },
    ])
    expect(buildStockConcentrationAlerts(allocation)).toMatchObject([
      { symbol: 'ABC', currency: 'USD', level: 'critical', percent: 100 },
      { symbol: 'JKH', currency: 'LKR', level: 'critical', percent: 75 },
    ])
  })

  it('does not alert a diversified portfolio below the warning threshold', () => {
    const allocation = buildStockAllocation([
      { symbol: 'A', currency: 'LKR', quantity: 1, buyPrice: 100 },
      { symbol: 'B', currency: 'LKR', quantity: 1, buyPrice: 100 },
      { symbol: 'C', currency: 'LKR', quantity: 1, buyPrice: 100 },
    ])
    expect(buildStockConcentrationAlerts(allocation)).toEqual([])
  })
})
