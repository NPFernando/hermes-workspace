export interface StrategyQuarantineDecision {
  triggered: boolean
  reasons: Array<string>
}

function maxDrawdown(pnls: Array<number>): number {
  let cumulative = 0
  let peak = 0
  let drawdown = 0
  for (const pnl of pnls) {
    cumulative += pnl
    peak = Math.max(peak, cumulative)
    drawdown = Math.max(drawdown, peak - cumulative)
  }
  return drawdown
}

export function evaluateStrategyQuarantine(input: {
  trades: Array<{ pnlQuote: number }>
  lossStreak: number
  lossStreakLimit: number
  minClosedTrades: number
  winRate: number
  lossRateThreshold: number
  totalPnlQuote: number
  maxPnlQuote: number
  dailyPnlQuote: number
  maxDailyLossQuote: number
  maxDrawdownQuote: number
  averageSlippageQuote: number | null
  slippageSamples: number
  maxSlippageQuote: number
  apiErrorCount: number
  apiErrorLimit: number
}): StrategyQuarantineDecision {
  const reasons: Array<string> = []
  const enoughEvidence = input.trades.length >= input.minClosedTrades
  if (
    enoughEvidence &&
    input.lossStreak >= input.lossStreakLimit
  ) {
    reasons.push(`${input.lossStreak} consecutive losses`)
  }
  if (enoughEvidence && input.dailyPnlQuote <= -input.maxDailyLossQuote) {
    reasons.push(`daily loss ${input.dailyPnlQuote.toFixed(2)} USDT`)
  }
  if (enoughEvidence && maxDrawdown(input.trades.map((trade) => trade.pnlQuote)) >= input.maxDrawdownQuote) {
    reasons.push(`drawdown ${maxDrawdown(input.trades.map((trade) => trade.pnlQuote)).toFixed(2)} USDT`)
  }
  if (
    enoughEvidence &&
    input.averageSlippageQuote !== null &&
    input.slippageSamples >= input.minClosedTrades &&
    input.averageSlippageQuote <= input.maxSlippageQuote
  ) {
    reasons.push(`shadow slippage ${input.averageSlippageQuote.toFixed(2)} USDT`)
  }
  if (input.apiErrorCount >= input.apiErrorLimit) {
    reasons.push(`${input.apiErrorCount} exchange/API errors`)
  }
  if (
    enoughEvidence &&
    input.winRate <= input.lossRateThreshold &&
    input.totalPnlQuote <= input.maxPnlQuote
  ) {
    reasons.push(
      `win rate ${(input.winRate * 100).toFixed(1)}% and P&L ${input.totalPnlQuote.toFixed(2)} USDT`,
    )
  }
  return { triggered: reasons.length > 0, reasons }
}
