import { describe, expect, it } from 'vitest'
import { fxRateScenario } from './fx-rate-scenario'

const entries = [
  { id: 'usd', totalReturnLkr: 10_000, insufficientHistory: false },
  { id: 'missing', totalReturnLkr: 0, insufficientHistory: true },
  { id: 'lkr', totalReturnLkr: 2_000, insufficientHistory: false },
]
const holdings = [
  {
    id: 'usd',
    currency: 'USD',
    quantity: 2,
    buyPrice: 100,
    lastKnownPrice: 150,
  },
  {
    id: 'missing',
    currency: 'EUR',
    quantity: 3,
    buyPrice: 50,
    lastKnownPrice: 60,
  },
  {
    id: 'lkr',
    currency: 'LKR',
    quantity: 1,
    buyPrice: 100,
    lastKnownPrice: 200,
  },
]

describe('fxRateScenario', () => {
  it('projects FX-only rate moves while holding asset prices constant', () => {
    const result = fxRateScenario(
      12_000,
      entries,
      holdings,
      [{ base: 'USD', target: 'LKR', rate: 300, date: '2026-09-01' }],
      10,
    )
    expect(result).toEqual({
      exposedMarketValueLkr: 90_000,
      currencyMoveLkr: 9_000,
      projectedReturnLkr: 21_000,
    })
  })

  it('uses inverse rates and supports weakening scenarios', () => {
    const result = fxRateScenario(
      1_000,
      [entries[0]],
      [holdings[0]],
      [{ base: 'LKR', target: 'USD', rate: 1 / 300, date: '2026-09-01' }],
      -10,
    )
    expect(result).toMatchObject({
      exposedMarketValueLkr: 90_000,
      currencyMoveLkr: -9_000,
      projectedReturnLkr: -8_000,
    })
  })

  it('returns no projection without a rate-backed included foreign holding', () => {
    expect(fxRateScenario(0, [entries[1]], holdings, [], 10)).toBeNull()
    expect(fxRateScenario(0, [entries[2]], holdings, [], 10)).toBeNull()
  })
})
