import { randomUUID } from 'node:crypto'
import {
  createDemoClientFromEnv,
  floorToStep,
} from './binance-demo-client'
import { appendAuditLog, readFinanceStore, writeFinanceStore } from './finance-store'
import type { BinanceExecutionClient } from './binance-demo-client'

const SYMBOLS = ['BTCUSDT', 'ETHUSDT'] as const
const MAX_ROUND_TRIPS = 20
const MAX_QUOTE_PER_ROUND_TRIP = 10

export interface TestnetProbeFill {
  index: number
  symbol: (typeof SYMBOLS)[number]
  quoteRequested: number
  buyQuote: number
  sellQuote: number
  feesQuote: number
  buySlippagePct: number
  sellSlippagePct: number
  buyOrderId: number
  sellOrderId: number
  completedAt: string
}

export interface TestnetExecutionProbeReport {
  id: string
  startedAt: string
  completedAt: string
  executionMode: 'testnet'
  roundTripsRequested: number
  roundTripsCompleted: number
  quotePerRoundTrip: number
  status: 'completed' | 'stopped' | 'unavailable'
  feesQuote: number
  averageSlippagePct: number | null
  fills: Array<TestnetProbeFill>
  error: string | null
  detail: string
}

export interface TestnetProbeSummary {
  latest: TestnetExecutionProbeReport | null
  history: Array<TestnetExecutionProbeReport>
  aggregate: {
    completedRoundTrips: number
    feesQuote: number
    completedRuns: number
  }
}

export function testnetExecutionProbeSummary(
  value: unknown,
): TestnetProbeSummary | null {
  if (!value || typeof value !== 'object') return null
  const record = value as Record<string, unknown>
  const history = Array.isArray(record.history)
    ? (record.history as Array<TestnetExecutionProbeReport>)
    : []
  const latest =
    record.latest && typeof record.latest === 'object'
      ? (record.latest as TestnetExecutionProbeReport)
      : history[0] ?? null
  return {
    latest,
    history,
    aggregate: {
      completedRoundTrips: history.reduce(
        (sum, report) =>
          sum + (report.status === 'completed' ? report.roundTripsCompleted : 0),
        0,
      ),
      feesQuote: history.reduce(
        (sum, report) =>
          sum + (report.status === 'completed' ? report.feesQuote : 0),
        0,
      ),
      completedRuns: history.filter((report) => report.status === 'completed')
        .length,
    },
  }
}

function feeInQuote(
  fills: Array<{
    price: number
    qty: number
    commission: number
    commissionAsset: string
  }>,
  quoteAsset: string,
  baseAsset: string,
): number {
  return fills.reduce((sum, fill) => {
    if (fill.commissionAsset === quoteAsset) return sum + fill.commission
    if (fill.commissionAsset === baseAsset)
      return sum + fill.commission * fill.price
    return sum
  }, 0)
}

function averageSlippage(fills: Array<TestnetProbeFill>): number | null {
  if (!fills.length) return null
  return (
    fills.reduce(
      (sum, fill) => sum + Math.abs(fill.buySlippagePct) + Math.abs(fill.sellSlippagePct),
      0,
    ) /
    (fills.length * 2)
  )
}

function persist(report: TestnetExecutionProbeReport): void {
  const db = readFinanceStore()
  const settings = db.settings as Record<string, unknown>
  const previous =
    settings.testnetExecutionProbe &&
    typeof settings.testnetExecutionProbe === 'object'
      ? (settings.testnetExecutionProbe as Record<string, unknown>)
      : {}
  settings.testnetExecutionProbe = {
    ...previous,
    latest: report,
    history: [
      report,
      ...((Array.isArray(previous.history) ? previous.history : []) as Array<
        TestnetExecutionProbeReport
      >),
    ].slice(0, 10),
  }
  writeFinanceStore(db)
}

export async function runTestnetExecutionProbe(input: {
  roundTrips?: number
  quotePerRoundTrip?: number
  client?: BinanceExecutionClient
} = {}): Promise<TestnetExecutionProbeReport> {
  const startedAt = new Date().toISOString()
  const roundTrips = Math.min(
    MAX_ROUND_TRIPS,
    Math.max(1, Math.floor(input.roundTrips ?? MAX_ROUND_TRIPS)),
  )
  const quotePerRoundTrip = Math.min(
    MAX_QUOTE_PER_ROUND_TRIP,
    Math.max(1, input.quotePerRoundTrip ?? MAX_QUOTE_PER_ROUND_TRIP),
  )
  const built = input.client ? { client: input.client } : createDemoClientFromEnv()
  const baseReport = {
    id: `testnet_probe_${Date.now()}_${randomUUID().slice(0, 8)}`,
    startedAt,
    executionMode: 'testnet' as const,
    roundTripsRequested: roundTrips,
    roundTripsCompleted: 0,
    quotePerRoundTrip,
    feesQuote: 0,
    averageSlippagePct: null,
    fills: [] as Array<TestnetProbeFill>,
    error: null as string | null,
  }
  if (!built.client || built.client.environment !== 'testnet') {
    const report: TestnetExecutionProbeReport = {
      ...baseReport,
      completedAt: new Date().toISOString(),
      status: 'unavailable',
      detail: 'Testnet client unavailable; production clients are refused.',
      error: 'Binance testnet client unavailable',
    }
    persist(report)
    return report
  }

  const client = built.client
  try {
    const account = await client.getAccount()
    if (!account.canTrade) throw new Error('Binance testnet account reports canTrade=false')
    const usdt = account.balances.find((balance) => balance.asset === 'USDT')?.free ?? 0
    if (usdt < quotePerRoundTrip) {
      throw new Error(`testnet USDT balance ${usdt.toFixed(4)} is below probe size`)
    }
    for (let index = 0; index < roundTrips; index += 1) {
      const symbol = SYMBOLS[index % SYMBOLS.length]
      const baseAsset = symbol.slice(0, -4)
      const filters = client.getSymbolFilters
        ? await client.getSymbolFilters(symbol)
        : { stepSize: 0, minQty: 0, minNotional: 0 }
      const referenceBuy = await client.getPrice(symbol)
      let quantity = quotePerRoundTrip / referenceBuy
      if (filters.stepSize > 0) quantity = floorToStep(quantity, filters.stepSize)
      if (
        quantity <= 0 ||
        (filters.minQty > 0 && quantity < filters.minQty) ||
        (filters.minNotional > 0 && quantity * referenceBuy < filters.minNotional)
      ) {
        throw new Error(`${symbol} probe size is below Binance symbol minimums`)
      }
      const buy = await client.placeOrder({
        symbol,
        side: 'BUY',
        type: 'MARKET',
        quantity,
        newClientOrderId: `probe-buy-${Date.now()}-${index}`,
      })
      if (buy.executedQty <= 0) throw new Error(`${symbol} testnet buy did not fill`)

      const afterBuy = await client.getAccount()
      const freeBase = afterBuy.balances.find((balance) => balance.asset === baseAsset)?.free ?? 0
      quantity = Math.min(buy.executedQty, freeBase || buy.executedQty)
      if (filters.stepSize > 0) quantity = floorToStep(quantity, filters.stepSize)
      const referenceSell = await client.getPrice(symbol)
      if (
        quantity <= 0 ||
        (filters.minQty > 0 && quantity < filters.minQty) ||
        (filters.minNotional > 0 && quantity * referenceSell < filters.minNotional)
      ) {
        throw new Error(`${symbol} bought quantity is not sellable after commission`)
      }
      const sell = await client.placeOrder({
        symbol,
        side: 'SELL',
        type: 'MARKET',
        quantity,
        newClientOrderId: `probe-sell-${Date.now()}-${index}`,
      })
      if (sell.executedQty <= 0) throw new Error(`${symbol} testnet sell did not fill`)
      const buyQuote = buy.cummulativeQuoteQty
      const sellQuote = sell.cummulativeQuoteQty
      const feesQuote =
        feeInQuote(buy.fills, 'USDT', baseAsset) +
        feeInQuote(sell.fills, 'USDT', baseAsset)
      baseReport.fills.push({
        index,
        symbol,
        quoteRequested: quotePerRoundTrip,
        buyQuote,
        sellQuote,
        feesQuote,
        buySlippagePct: referenceBuy > 0 ? (buy.avgPrice - referenceBuy) / referenceBuy : 0,
        sellSlippagePct: referenceSell > 0 ? (referenceSell - sell.avgPrice) / referenceSell : 0,
        buyOrderId: buy.orderId,
        sellOrderId: sell.orderId,
        completedAt: new Date().toISOString(),
      })
      baseReport.roundTripsCompleted += 1
      baseReport.feesQuote += feesQuote
    }
    const report: TestnetExecutionProbeReport = {
      ...baseReport,
      completedAt: new Date().toISOString(),
      status: 'completed',
      averageSlippagePct: averageSlippage(baseReport.fills),
      detail: 'Testnet execution round trips completed; results are isolated from strategy P&L.',
    }
    persist(report)
    appendAuditLog('testnet_execution_probe_completed', {
      id: report.id,
      roundTripsCompleted: report.roundTripsCompleted,
      feesQuote: report.feesQuote,
      averageSlippagePct: report.averageSlippagePct,
    })
    return report
  } catch (error) {
    const report: TestnetExecutionProbeReport = {
      ...baseReport,
      completedAt: new Date().toISOString(),
      status: 'stopped',
      averageSlippagePct: averageSlippage(baseReport.fills),
      error: error instanceof Error ? error.message : String(error),
      detail: 'Probe stopped at the first failed step; review testnet balances and the partial fill record.',
    }
    persist(report)
    appendAuditLog('testnet_execution_probe_stopped', {
      id: report.id,
      roundTripsCompleted: report.roundTripsCompleted,
      error: report.error,
    })
    return report
  }
}
