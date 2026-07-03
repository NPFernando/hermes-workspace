/**
 * Automated demo trading engine.
 *
 * One cycle: for each configured symbol, evaluate every enabled strategy on
 * fresh demo-environment candles, then:
 *   - if flat and a strategy says BUY  → open a demo position (MARKET buy)
 *   - if in a position and the owning strategy says SELL (or a stop/target is
 *     hit) → close it (MARKET sell) and fold the realized PnL into the
 *     strategy's score.
 *
 * Runs only while finance `tradingMode === 'testnet_execute'` and the
 * emergency kill switch is off. All execution goes through BinanceDemoClient,
 * which is hard-locked to the demo host, so this can never touch real money.
 *
 * State (open positions + strategy scores) is persisted in the finance store's
 * `strategy_results` array so scores accumulate across restarts and can be
 * used to refine the formulas over time.
 */
import {
  BinanceDemoClient,
  createDemoClientFromEnv,
} from './binance-demo-client'
import {
  STRATEGIES,
  applyTradeOutcome,
  emptyScore,
  getStrategy,
  type Candle,
  type StrategyScore,
} from './trading-strategies'
import {
  readFinanceStore,
  writeFinanceStore,
  appendAuditLog,
} from './finance-store'

const SR_KIND_SCORE = 'demo_strategy_score'
const SR_KIND_POSITION = 'demo_open_position'

export interface EngineConfig {
  symbols: Array<string>
  interval: string
  quotePerTrade: number // USDT to spend per BUY
  enabledStrategies: Array<string>
  stopLossPct: number // e.g. 0.02 = -2%
  takeProfitPct: number // e.g. 0.03 = +3%
}

export const DEFAULT_ENGINE_CONFIG: EngineConfig = {
  symbols: ['BTCUSDT', 'ETHUSDT'],
  interval: '1h',
  quotePerTrade: 25,
  enabledStrategies: STRATEGIES.map((s) => s.id),
  stopLossPct: 0.02,
  takeProfitPct: 0.03,
}

interface OpenPosition {
  id: string
  symbol: string
  strategyId: string
  entryPrice: number
  quantity: number
  entryQuote: number
  openedAt: string
}

export interface CycleAction {
  symbol: string
  strategyId: string
  action: 'OPEN' | 'CLOSE' | 'SKIP'
  reason: string
  price?: number
  pnlQuote?: number
}

export interface CycleResult {
  ran: boolean
  reason?: string
  actions: Array<CycleAction>
  scores: Array<StrategyScore>
  openPositions: number
  ranAt: string
}

// ── strategy_results persistence helpers ─────────────────────────────────────

type SRRow = Record<string, unknown>

function loadScores(rows: Array<SRRow>): Map<string, StrategyScore> {
  const map = new Map<string, StrategyScore>()
  for (const r of rows) {
    if (r.kind === SR_KIND_SCORE && typeof r.strategyId === 'string') {
      map.set(r.strategyId, r as unknown as StrategyScore & SRRow)
    }
  }
  for (const s of STRATEGIES) if (!map.has(s.id)) map.set(s.id, emptyScore(s.id))
  return map
}

function loadPositions(rows: Array<SRRow>): Array<OpenPosition> {
  return rows.filter((r) => r.kind === SR_KIND_POSITION) as unknown as Array<OpenPosition>
}

function persist(scores: Map<string, StrategyScore>, positions: Array<OpenPosition>): void {
  const db = readFinanceStore()
  const others = (db.strategy_results || []).filter(
    (r: SRRow) => r.kind !== SR_KIND_SCORE && r.kind !== SR_KIND_POSITION,
  )
  db.strategy_results = [
    ...others,
    ...[...scores.values()].map((s) => ({ kind: SR_KIND_SCORE, ...s })),
    ...positions.map((p) => ({ kind: SR_KIND_POSITION, ...p })),
  ]
  db.updatedAt = new Date().toISOString()
  writeFinanceStore(db)
}

// ── engine ───────────────────────────────────────────────────────────────────

export interface RunCycleOptions {
  config?: Partial<EngineConfig>
  client?: BinanceDemoClient
  /** Bypass the tradingMode gate (used by the manual "run once" trigger). */
  force?: boolean
}

export async function runTradingCycle(options: RunCycleOptions = {}): Promise<CycleResult> {
  const ranAt = new Date().toISOString()
  const config = { ...DEFAULT_ENGINE_CONFIG, ...options.config }
  const db = readFinanceStore()

  if (db.settings.emergencyKillSwitch) {
    return { ran: false, reason: 'emergency kill switch is active', actions: [], scores: [], openPositions: 0, ranAt }
  }
  if (!options.force && db.settings.tradingMode !== 'testnet_execute') {
    return {
      ran: false,
      reason: `tradingMode is "${db.settings.tradingMode}", not "testnet_execute"`,
      actions: [], scores: [], openPositions: 0, ranAt,
    }
  }

  let client = options.client
  if (!client) {
    const built = createDemoClientFromEnv()
    if (!built.client) {
      return { ran: false, reason: built.reason || 'demo client unavailable', actions: [], scores: [], openPositions: 0, ranAt }
    }
    client = built.client
  }

  const rows = (db.strategy_results || []) as Array<SRRow>
  const scores = loadScores(rows)
  let positions = loadPositions(rows)
  const actions: Array<CycleAction> = []

  for (const symbol of config.symbols) {
    let candles: Array<Candle>
    let price: number
    try {
      candles = await client.getKlines(symbol, config.interval, 100)
      price = candles.length ? candles[candles.length - 1].close : await client.getPrice(symbol)
    } catch (err) {
      actions.push({ symbol, strategyId: '-', action: 'SKIP', reason: `market data error: ${(err as Error).message}` })
      continue
    }

    // 1. Manage existing positions for this symbol (exit rules first).
    const held = positions.filter((p) => p.symbol === symbol)
    for (const pos of held) {
      const strat = getStrategy(pos.strategyId)
      const decision = strat?.evaluate(candles) ?? { signal: 'HOLD' as const, confidence: 0, reason: 'strategy gone' }
      const changePct = (price - pos.entryPrice) / pos.entryPrice
      const hitStop = changePct <= -config.stopLossPct
      const hitTarget = changePct >= config.takeProfitPct
      const stratExit = decision.signal === 'SELL'
      if (hitStop || hitTarget || stratExit) {
        try {
          const order = await client.placeOrder({ symbol, side: 'SELL', type: 'MARKET', quantity: pos.quantity })
          const exitQuote = order.cummulativeQuoteQty || price * pos.quantity
          const pnlQuote = exitQuote - pos.entryQuote
          const reason = hitStop ? `stop-loss ${(changePct * 100).toFixed(2)}%`
            : hitTarget ? `take-profit ${(changePct * 100).toFixed(2)}%`
            : `strategy exit: ${decision.reason}`
          scores.set(pos.strategyId, applyTradeOutcome(scores.get(pos.strategyId) ?? emptyScore(pos.strategyId), pnlQuote, pos.entryQuote))
          positions = positions.filter((p) => p.id !== pos.id)
          actions.push({ symbol, strategyId: pos.strategyId, action: 'CLOSE', reason, price: order.avgPrice || price, pnlQuote })
          appendAuditLog('demo_trade_close', { symbol, strategyId: pos.strategyId, pnlQuote, reason })
        } catch (err) {
          actions.push({ symbol, strategyId: pos.strategyId, action: 'SKIP', reason: `close failed: ${(err as Error).message}` })
        }
      }
    }

    // 2. Look for new entries (only if flat on this symbol).
    const stillHeld = positions.some((p) => p.symbol === symbol)
    if (!stillHeld) {
      // Rank enabled strategies by score, then by signal confidence.
      const ranked = STRATEGIES
        .filter((s) => config.enabledStrategies.includes(s.id))
        .map((s) => ({ strat: s, decision: s.evaluate(candles), score: scores.get(s.id)?.score ?? 0 }))
        .filter((r) => r.decision.signal === 'BUY')
        .sort((a, b) => b.score - a.score || b.decision.confidence - a.decision.confidence)
      const best = ranked[0]
      if (best) {
        try {
          const order = await client.placeOrder({ symbol, side: 'BUY', type: 'MARKET', quoteOrderQty: config.quotePerTrade })
          if (order.executedQty > 0) {
            positions.push({
              id: `pos_${symbol}_${Date.now()}`,
              symbol,
              strategyId: best.strat.id,
              entryPrice: order.avgPrice || price,
              quantity: order.executedQty,
              entryQuote: order.cummulativeQuoteQty || config.quotePerTrade,
              openedAt: new Date().toISOString(),
            })
            actions.push({ symbol, strategyId: best.strat.id, action: 'OPEN', reason: best.decision.reason, price: order.avgPrice || price })
            appendAuditLog('demo_trade_open', { symbol, strategyId: best.strat.id, quote: config.quotePerTrade })
          }
        } catch (err) {
          actions.push({ symbol, strategyId: best.strat.id, action: 'SKIP', reason: `open failed: ${(err as Error).message}` })
        }
      } else {
        actions.push({ symbol, strategyId: '-', action: 'SKIP', reason: 'no BUY signal' })
      }
    }
  }

  persist(scores, positions)
  return { ran: true, actions, scores: [...scores.values()], openPositions: positions.length, ranAt }
}

/** Read-only snapshot of scores + open positions for the API/UI. */
export function getEngineState(): { scores: Array<StrategyScore>; positions: Array<OpenPosition> } {
  const db = readFinanceStore()
  const rows = (db.strategy_results || []) as Array<SRRow>
  return {
    scores: [...loadScores(rows).values()],
    positions: loadPositions(rows),
  }
}
