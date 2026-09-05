/**
 * Fixed-weight portfolio rebalancer — a new, structurally different
 * mechanism from both the council (single-symbol signal voting) and the
 * grid (per-symbol range ladder): this operates at the portfolio level
 * across the whole symbol universe, buying underweight assets and selling
 * overweight ones back toward target allocation. From OctoBot's
 * "crypto basket/index trading" (see docs/trading-engine.md).
 *
 * Isolated from every other engine here on purpose: own lock, own settings
 * key (`settings.demoTradingRebalance`), own finance-store kinds. Executes
 * real signed testnet orders via binance-demo-client.ts (host-locked to
 * demo/testnet hosts) — this engine goes straight to testnet_execute per
 * explicit instruction, not paper-first like the grid was.
 */
import { randomUUID } from 'node:crypto'
import { createDemoClientFromEnv } from './binance-demo-client'
import {
  appendAuditLog,
  readFinanceStore,
  writeFinanceStore,
} from './finance-store'
import { executionModeAllowed } from './trading-execution-gate'
import { recordResearchRun } from './research-store'
import type { BinanceExecutionClient } from './binance-demo-client'

export interface RebalanceConfig {
  /**
   * Separate from tradingMode/kill switch: this engine shares the council's
   * global settings.tradingMode (already testnet_execute in production), so
   * without its own flag deployment + a cron tick would arm it immediately
   * with no distinct sign-off step. Off by default.
   */
  enabled: boolean
  symbols: Array<string>
  /** Target weight per symbol, must sum to ~1.0. Defaults to equal-weight across `symbols`. */
  targetWeights?: Record<string, number>
  driftThresholdPct: number
  minRebalanceIntervalMinutes: number
  /** Guardrail: total buy+sell notional this engine will place in a single cycle. */
  maxNotionalPerCycleQuote: number
  /** Skip trades smaller than this (Binance spot min-notional is ~$5). */
  minTradeNotionalQuote: number
}

export const DEFAULT_REBALANCE_CONFIG: RebalanceConfig = {
  enabled: false,
  symbols: ['BTCUSDT', 'ETHUSDT', 'SOLUSDT', 'BNBUSDT', 'XRPUSDT'],
  driftThresholdPct: 0.05,
  minRebalanceIntervalMinutes: 1440,
  maxNotionalPerCycleQuote: 200,
  minTradeNotionalQuote: 5,
}

export function resolveRebalanceConfig(
  settingsOverride: unknown,
): RebalanceConfig {
  const fromSettings =
    settingsOverride && typeof settingsOverride === 'object'
      ? (settingsOverride as Partial<RebalanceConfig>)
      : {}
  return { ...DEFAULT_REBALANCE_CONFIG, ...fromSettings }
}

export function equalTargetWeights(
  symbols: Array<string>,
): Record<string, number> {
  const w = 1 / symbols.length
  return Object.fromEntries(symbols.map((s) => [s, w]))
}

const SR_KIND_REBALANCE_STATE = 'demo_rebalance_state'
const SR_KIND_REBALANCE_TRADE = 'demo_rebalance_trade'
const REBALANCE_TRADE_LOG_CAP = 500

export interface RebalanceState {
  kind: typeof SR_KIND_REBALANCE_STATE
  lastRebalanceAt: string | null
  updatedAt: string
}

export interface RebalanceTrade {
  kind: typeof SR_KIND_REBALANCE_TRADE
  id: string
  symbol: string
  side: 'BUY' | 'SELL'
  notionalQuote: number
  quantity: number
  price: number
  reason: string
  createdAt: string
}

export interface RebalancePlanItem {
  symbol: string
  actualWeight: number
  targetWeight: number
  actualValueQuote: number
  targetValueQuote: number
  diffQuote: number
}

/** Pure planning step — no I/O — so it's directly unit-testable. */
export function planRebalance(
  holdingsValueQuote: Record<string, number>,
  freeQuoteBalance: number,
  targetWeights: Record<string, number>,
): { totalValueQuote: number; items: Array<RebalancePlanItem> } {
  const totalValueQuote =
    freeQuoteBalance +
    Object.values(holdingsValueQuote).reduce((s, v) => s + v, 0)
  const items: Array<RebalancePlanItem> = Object.entries(targetWeights).map(
    ([symbol, targetWeight]) => {
      const actualValueQuote = holdingsValueQuote[symbol] ?? 0
      const actualWeight =
        totalValueQuote > 0 ? actualValueQuote / totalValueQuote : 0
      const targetValueQuote = totalValueQuote * targetWeight
      return {
        symbol,
        actualWeight,
        targetWeight,
        actualValueQuote,
        targetValueQuote,
        diffQuote: targetValueQuote - actualValueQuote,
      }
    },
  )
  return { totalValueQuote, items }
}

export function maxDrift(items: Array<RebalancePlanItem>): number {
  return items.reduce(
    (m, i) => Math.max(m, Math.abs(i.actualWeight - i.targetWeight)),
    0,
  )
}

/**
 * Orders trades sells-first (raises free quote balance before buys spend
 * it — same convention grid-paper-engine.ts uses), largest-drift-first, and
 * stops once maxNotionalPerCycleQuote is reached. Skips anything below
 * minTradeNotionalQuote. Pure — no I/O.
 */
export function buildTradePlan(
  items: Array<RebalancePlanItem>,
  config: RebalanceConfig,
): Array<{ symbol: string; side: 'BUY' | 'SELL'; notionalQuote: number }> {
  const sells = items
    .filter((i) => i.diffQuote < -config.minTradeNotionalQuote)
    .sort((a, b) => a.diffQuote - b.diffQuote)
    .map((i) => ({
      symbol: i.symbol,
      side: 'SELL' as const,
      notionalQuote: -i.diffQuote,
    }))
  const buys = items
    .filter((i) => i.diffQuote > config.minTradeNotionalQuote)
    .sort((a, b) => b.diffQuote - a.diffQuote)
    .map((i) => ({
      symbol: i.symbol,
      side: 'BUY' as const,
      notionalQuote: i.diffQuote,
    }))

  const ordered = [...sells, ...buys]
  const plan: Array<{
    symbol: string
    side: 'BUY' | 'SELL'
    notionalQuote: number
  }> = []
  let spent = 0
  for (const trade of ordered) {
    if (spent >= config.maxNotionalPerCycleQuote) break
    const notional = Math.min(
      trade.notionalQuote,
      config.maxNotionalPerCycleQuote - spent,
    )
    if (notional < config.minTradeNotionalQuote) continue
    plan.push({
      symbol: trade.symbol,
      side: trade.side,
      notionalQuote: notional,
    })
    spent += notional
  }
  return plan
}

let rebalanceCycleInProgress = false

export interface RebalanceCycleResult {
  ran: boolean
  reason?: string
  trades: Array<RebalanceTrade>
  /** Per-symbol drift snapshot from the cycle that just ran, for UI display. */
  plan?: Array<RebalancePlanItem>
}

export interface RebalanceCycleOptions {
  client?: BinanceExecutionClient
}

async function runRebalanceCycleInner(
  options: RebalanceCycleOptions,
): Promise<RebalanceCycleResult> {
  const db = readFinanceStore()
  const settings = db.settings as Record<string, unknown>
  const config = resolveRebalanceConfig(settings.demoTradingRebalance)
  const gate = executionModeAllowed(
    settings,
    config,
    'rebalance engine is disabled (settings.demoTradingRebalance.enabled)',
  )
  if (!gate.allowed) return { ran: false, reason: gate.reason, trades: [] }

  const targetWeights =
    config.targetWeights ?? equalTargetWeights(config.symbols)

  let client = options.client
  if (!client) {
    const created = createDemoClientFromEnv()
    if (!created.client)
      return { ran: false, reason: created.reason, trades: [] }
    client = created.client
  }

  const rows = db.strategy_results
  const existingState = rows.find((r) => r.kind === SR_KIND_REBALANCE_STATE) as
    | RebalanceState
    | undefined
  const lastRebalanceAt = existingState?.lastRebalanceAt
    ? new Date(existingState.lastRebalanceAt)
    : null
  const elapsedMinutes = lastRebalanceAt
    ? (Date.now() - lastRebalanceAt.getTime()) / 60_000
    : Infinity

  const account = await client.getAccount()
  const freeQuoteBalance =
    account.balances.find((b) => b.asset === 'USDT')?.free ?? 0

  const holdingsValueQuote: Record<string, number> = {}
  const priceBySymbol: Record<string, number> = {}
  for (const symbol of config.symbols) {
    const asset = symbol.replace(/USDT$/, '')
    const qty = account.balances.find((b) => b.asset === asset)?.free ?? 0
    const price = await client.getPrice(symbol)
    priceBySymbol[symbol] = price
    holdingsValueQuote[symbol] = qty * price
  }

  const { items } = planRebalance(
    holdingsValueQuote,
    freeQuoteBalance,
    targetWeights,
  )
  const drift = maxDrift(items)
  const timeTriggered = elapsedMinutes >= config.minRebalanceIntervalMinutes
  const driftTriggered = drift >= config.driftThresholdPct

  if (!timeTriggered && !driftTriggered) {
    return { ran: true, trades: [], plan: items }
  }

  const tradePlan = buildTradePlan(items, config)
  const trades: Array<RebalanceTrade> = []

  for (const t of tradePlan) {
    try {
      if (t.side === 'BUY') {
        const order = await client.placeOrder({
          symbol: t.symbol,
          side: 'BUY',
          type: 'MARKET',
          quoteOrderQty: t.notionalQuote,
        })
        trades.push({
          kind: SR_KIND_REBALANCE_TRADE,
          id: randomUUID(),
          symbol: t.symbol,
          side: 'BUY',
          notionalQuote: order.cummulativeQuoteQty,
          quantity: order.executedQty,
          price: order.avgPrice,
          reason: driftTriggered ? 'drift threshold' : 'scheduled interval',
          createdAt: new Date(order.transactTime).toISOString(),
        })
      } else {
        const price = priceBySymbol[t.symbol]
        // See docs/tsconfig-strictness-rollout.md — real Record-lookup
        // risk the current lax tsconfig (missing noUncheckedIndexedAccess)
        // doesn't reflect in `price`'s type.

        const quantity =
          price !== undefined && price > 0 ? t.notionalQuote / price : 0
        if (quantity <= 0) continue
        const order = await client.placeOrder({
          symbol: t.symbol,
          side: 'SELL',
          type: 'MARKET',
          quantity,
        })
        trades.push({
          kind: SR_KIND_REBALANCE_TRADE,
          id: randomUUID(),
          symbol: t.symbol,
          side: 'SELL',
          notionalQuote: order.cummulativeQuoteQty,
          quantity: order.executedQty,
          price: order.avgPrice,
          reason: driftTriggered ? 'drift threshold' : 'scheduled interval',
          createdAt: new Date(order.transactTime).toISOString(),
        })
      }
    } catch (err) {
      appendAuditLog('rebalance_order_failed', {
        symbol: t.symbol,
        side: t.side,
        notionalQuote: t.notionalQuote,
        error: err instanceof Error ? err.message : String(err),
      })
    }
  }

  const newState: RebalanceState = {
    kind: SR_KIND_REBALANCE_STATE,
    lastRebalanceAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  }
  const existingTrades = rows.filter(
    (r) => r.kind === SR_KIND_REBALANCE_TRADE,
  ) as unknown as Array<RebalanceTrade>
  const others = rows.filter(
    (r) =>
      r.kind !== SR_KIND_REBALANCE_STATE && r.kind !== SR_KIND_REBALANCE_TRADE,
  )
  const mergedTrades = [...existingTrades, ...trades].slice(
    -REBALANCE_TRADE_LOG_CAP,
  )
  db.strategy_results = [
    ...others,
    { ...newState },
    ...mergedTrades.map((t) => ({ ...t })),
  ]
  db.updatedAt = new Date().toISOString()
  writeFinanceStore(db)

  if (trades.length > 0) {
    appendAuditLog('rebalance_cycle_executed', {
      trades: trades.map((t) => ({
        symbol: t.symbol,
        side: t.side,
        notionalQuote: t.notionalQuote,
      })),
      drift,
      triggeredBy: driftTriggered ? 'drift' : 'interval',
    })
    await recordResearchRun({
      engine: 'rebalance',
      runType: 'sanity',
      config: { targetWeights, driftThresholdPct: config.driftThresholdPct },
      result: {
        drift,
        trades: trades.length,
        totalNotional: trades.reduce((s, t) => s + t.notionalQuote, 0),
      },
      notes: 'live rebalance cycle',
    })
  }

  return { ran: true, trades, plan: items }
}

export async function runRebalanceCycle(
  options: RebalanceCycleOptions = {},
): Promise<RebalanceCycleResult> {
  if (rebalanceCycleInProgress) {
    return { ran: false, reason: 'already in progress', trades: [] }
  }
  rebalanceCycleInProgress = true
  try {
    return await runRebalanceCycleInner(options)
  } finally {
    rebalanceCycleInProgress = false
  }
}

/** Uncapped counterpart of `getRebalanceState()`'s trade log — every
 * executed rebalance order (not just the most recent 50 used for display),
 * for the read-only trading ledger. */
export function getAllRebalanceTrades(): Array<RebalanceTrade> {
  const db = readFinanceStore()
  const rows = db.strategy_results
  return rows.filter(
    (r) => r.kind === SR_KIND_REBALANCE_TRADE,
  ) as unknown as Array<RebalanceTrade>
}

export function getRebalanceState(): {
  config: RebalanceConfig
  state: RebalanceState | null
  trades: Array<RebalanceTrade>
} {
  const db = readFinanceStore()
  const settings = db.settings as Record<string, unknown>
  const rows = db.strategy_results
  return {
    config: resolveRebalanceConfig(settings.demoTradingRebalance),
    state:
      (rows.find((r) => r.kind === SR_KIND_REBALANCE_STATE) as
        | RebalanceState
        | undefined) ?? null,
    trades: (
      rows.filter(
        (r) => r.kind === SR_KIND_REBALANCE_TRADE,
      ) as unknown as Array<RebalanceTrade>
    )
      .slice(-50)
      .reverse(),
  }
}
