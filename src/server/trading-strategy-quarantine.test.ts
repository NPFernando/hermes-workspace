import { describe, expect, it } from 'vitest'
import { evaluateStrategyQuarantine } from './trading-strategy-quarantine'

const base = {
  trades: [{ pnlQuote: 1 }, { pnlQuote: -0.5 }, { pnlQuote: -0.5 }],
  lossStreak: 2,
  lossStreakLimit: 3,
  minClosedTrades: 3,
  winRate: 0.33,
  lossRateThreshold: 0.4,
  totalPnlQuote: 0,
  maxPnlQuote: 0,
  dailyPnlQuote: 0,
  maxDailyLossQuote: 10,
  maxDrawdownQuote: 10,
  averageSlippageQuote: null,
  slippageSamples: 0,
  maxSlippageQuote: -0.5,
  apiErrorCount: 0,
  apiErrorLimit: 3,
}

describe('strategy quarantine triggers', () => {
  it('quarantines after repeated API failures even without trade evidence', () => {
    expect(
      evaluateStrategyQuarantine({
        ...base,
        trades: [],
        apiErrorCount: 3,
      }).reasons,
    ).toContain('3 exchange/API errors')
  })

  it('reports loss, drawdown, and abnormal slippage triggers', () => {
    const result = evaluateStrategyQuarantine({
      ...base,
      lossStreak: 3,
      dailyPnlQuote: -11,
      maxDrawdownQuote: 0.5,
      averageSlippageQuote: -0.6,
      slippageSamples: 3,
    })
    expect(result.triggered).toBe(true)
    expect(result.reasons).toHaveLength(5)
  })
})
