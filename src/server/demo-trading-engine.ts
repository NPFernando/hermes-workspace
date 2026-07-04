/**
 * Automated demo trading engine — VT-Capital concepts folded in.
 *
 * One cycle per symbol:
 *   1. every enabled strategy evaluates fresh demo candles
 *   2. the COUNCIL combines their signals, weighted by each strategy's
 *      accumulated score (proven formulas count more)
 *   3. a BUY verdict must then pass the GUARDIAN risk layer (position cap,
 *      per-trade cap, daily-loss halt, loss-streak cooldown, balance floor)
 *   4. open positions close on stop-loss / take-profit / owner-strategy SELL
 *      / strong council SELL; realized PnL updates the owner's score and is
 *      appended to a persistent trade log for refinement
 *
 * Runs only while finance `tradingMode === 'testnet_execute'` and the
 * emergency kill switch is off. All execution goes through BinanceDemoClient,
 * which is hard-locked to the demo host, so this can never touch real money.
 */
import {
  BinanceDemoClient,
  createDemoClientFromEnv,
} from './binance-demo-client'
import {
  STRATEGIES,
  applyTradeOutcome,
  councilVote,
  emptyScore,
  getStrategy,
  scaledQuoteSize,
  type Candle,
  type CouncilMember,
  type StrategyScore,
} from './trading-strategies'
import {
  DEFAULT_GUARDIAN_CONFIG,
  checkOrderProposal,
  cooldownUntil,
  dayKey,
  weekKey,
  type GuardianBlock,
  type GuardianConfig,
} from './trading-guardian'
import {
  readFinanceStore,
  writeFinanceStore,
  appendAuditLog,
} from './finance-store'

const SR_KIND_SCORE = 'demo_strategy_score'
const SR_KIND_POSITION = 'demo_open_position'
const SR_KIND_TRADE = 'demo_trade_log'
const SR_KIND_BLOCK = 'demo_guardian_block'
const TRADE_LOG_CAP = 200
const BLOCK_LOG_CAP = 50

export interface EngineConfig {
  symbols: Array<string>
  interval: string
  quotePerTrade: number
  enabledStrategies: Array<string>
  stopLossPct: number
  takeProfitPct: number
  /** Council net-vote threshold to act. */
  councilThreshold: number
  guardian: GuardianConfig
}

export const DEFAULT_ENGINE_CONFIG: EngineConfig = {
  symbols: ['BTCUSDT', 'ETHUSDT'],
  interval: '1h',
  quotePerTrade: 25,
  enabledStrategies: STRATEGIES.map((s) => s.id),
  stopLossPct: 0.02,
  takeProfitPct: 0.03,
  councilThreshold: 0.6,
  guardian: DEFAULT_GUARDIAN_CONFIG,
}

interface OpenPosition {
  id: string
  symbol: string
  strategyId: string
  entryPrice: number
  quantity: number
  entryQuote: number
  /** Buy-side commission in quote currency, carried so it can be netted at close. */
  entryFeeQuote: number
  openedAt: string
}

export interface TradeLogEntry {
  id: string
  symbol: string
  strategyId: string
  entryPrice: number
  exitPrice: number
  quantity: number
  entryQuote: number
  exitQuote: number
  /** Net P/L after subtracting buy + sell commissions. */
  pnlQuote: number
  /** Total round-trip commission (buy + sell) in quote currency. */
  feesQuote: number
  reason: string
  openedAt: string
  closedAt: string
}

export interface CycleAction {
  symbol: string
  strategyId: string
  action: 'OPEN' | 'CLOSE' | 'SKIP' | 'BLOCKED'
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
  dailyPnlQuote: number
  ranAt: string
}

// ── strategy_results persistence helpers ─────────────────────────────────────

type SRRow = Record<string, unknown>

function loadScores(rows: Array<SRRow>): Map<string, StrategyScore> {
  const map = new Map<string, StrategyScore>()
  for (const r of rows) {
    if (r.kind === SR_KIND_SCORE && typeof r.strategyId === 'string') {
      map.set(r.strategyId, { ...emptyScore(r.strategyId), ...(r as object) } as StrategyScore)
    }
  }
  for (const s of STRATEGIES) if (!map.has(s.id)) map.set(s.id, emptyScore(s.id))
  return map
}

function loadOfKind<T>(rows: Array<SRRow>, kind: string): Array<T> {
  return rows.filter((r) => r.kind === kind) as unknown as Array<T>
}

interface PersistInput {
  scores: Map<string, StrategyScore>
  positions: Array<OpenPosition>
  trades: Array<TradeLogEntry>
  blocks: Array<SRRow>
}

function persist(input: PersistInput): void {
  const db = readFinanceStore()
  const others = (db.strategy_results || []).filter(
    (r: SRRow) =>
      r.kind !== SR_KIND_SCORE &&
      r.kind !== SR_KIND_POSITION &&
      r.kind !== SR_KIND_TRADE &&
      r.kind !== SR_KIND_BLOCK,
  )
  db.strategy_results = [
    ...others,
    ...[...input.scores.values()].map((s) => ({ kind: SR_KIND_SCORE, ...s })),
    ...input.positions.map((p) => ({ kind: SR_KIND_POSITION, ...p })),
    ...input.trades.slice(-TRADE_LOG_CAP).map((t) => ({ kind: SR_KIND_TRADE, ...t })),
    ...input.blocks.slice(-BLOCK_LOG_CAP),
  ]
  db.updatedAt = new Date().toISOString()
  writeFinanceStore(db)
}

function realizedToday(trades: Array<TradeLogEntry>, now = new Date()): number {
  const today = dayKey(now)
  return trades
    .filter((t) => dayKey(t.closedAt) === today)
    .reduce((sum, t) => sum + t.pnlQuote, 0)
}

function realizedWeekly(trades: Array<TradeLogEntry>, now = new Date()): number {
  const thisWeek = weekKey(now)
  return trades
    .filter((t) => weekKey(t.closedAt) === thisWeek)
    .reduce((sum, t) => sum + t.pnlQuote, 0)
}

/**
 * Mark-to-market unrealized PnL of all open positions (negative = net loss).
 * NOTE: if a position's live price can't be fetched we fall back to its entry
 * price (~0 contribution). That is NOT conservative — it under-counts that
 * position's loss, so the open-drawdown halt can under-fire. Acceptable here
 * because the demo client's getPrice effectively never fails; revisit before
 * wiring this to a live price feed.
 */
async function openUnrealizedQuote(
  positions: Array<OpenPosition>,
  client: BinanceDemoClient,
): Promise<number> {
  let total = 0
  for (const pos of positions) {
    let mark = pos.entryPrice
    try {
      mark = await client.getPrice(pos.symbol)
    } catch {
      // keep entryPrice fallback (see note above)
    }
    total += mark * pos.quantity - pos.entryQuote
  }
  return total
}

/**
 * Total commission for a filled order expressed in quote currency (USDT).
 * Commission charged in the quote asset is counted as-is; commission charged in
 * the base asset (Binance spot/testnet default) or another asset is valued at
 * the fill price. First-order correction so realized P/L stops ignoring fees —
 * without it, a 0.5% take-profit against ~0.2% round-trip fees would report a
 * win rate and profit factor materially higher than reality.
 */
function orderFeeQuote(
  fills: Array<{ price: number; commission: number; commissionAsset: string }>,
  fallbackPrice: number,
): number {
  return fills.reduce((sum, fill) => {
    if (fill.commissionAsset === 'USDT') return sum + fill.commission
    return sum + fill.commission * (fill.price || fallbackPrice)
  }, 0)
}

/** Engine config = defaults ⊕ finance settings.demoTrading ⊕ per-call overrides. */
export function resolveEngineConfig(
  settingsOverride: unknown,
  callOverride?: Partial<EngineConfig>,
): EngineConfig {
  const fromSettings =
    settingsOverride && typeof settingsOverride === 'object'
      ? (settingsOverride as Partial<EngineConfig>)
      : {}
  return {
    ...DEFAULT_ENGINE_CONFIG,
    ...fromSettings,
    ...callOverride,
    guardian: {
      ...DEFAULT_GUARDIAN_CONFIG,
      ...(fromSettings.guardian ?? {}),
      ...(callOverride?.guardian ?? {}),
    },
  }
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
  const db = readFinanceStore()
  const config = resolveEngineConfig((db.settings as Record<string, unknown>).demoTrading, options.config)

  const rows = (db.strategy_results || []) as Array<SRRow>
  const scores = loadScores(rows)
  let positions = loadOfKind<OpenPosition>(rows, SR_KIND_POSITION)
  const trades = loadOfKind<TradeLogEntry>(rows, SR_KIND_TRADE)
  const blocks = rows.filter((r) => r.kind === SR_KIND_BLOCK)
  const dailyPnlQuote = realizedToday(trades)

  const bail = (reason: string): CycleResult => ({
    ran: false, reason, actions: [], scores: [...scores.values()],
    openPositions: positions.length, dailyPnlQuote, ranAt,
  })

  if (db.settings.emergencyKillSwitch) return bail('emergency kill switch is active')
  if (!options.force && !['testnet_execute', 'paper_trade'].includes(db.settings.tradingMode)) {
    return bail(`tradingMode is "${db.settings.tradingMode}", not "testnet_execute" or "paper_trade"`)
  }

  let client = options.client
  if (!client) {
    const built = createDemoClientFromEnv()
    if (!built.client) return bail(built.reason || 'demo client unavailable')
    client = built.client
  }

  // One account read per cycle: quote balance feeds the guardian floor check.
  let quoteBalance = 0
  try {
    const account = await client.getAccount()
    quoteBalance = account.balances.find((b) => b.asset === 'USDT')?.free ?? 0
  } catch (err) {
    return bail(`account read failed: ${(err as Error).message}`)
  }

  // Cycle-start mark-to-market of open positions. Computed once and reused for
  // every entry check this cycle (like realized PnL) — a conservative snapshot,
  // since entries opened mid-cycle start at ~0 unrealized and exits only reduce
  // the drawdown.
  const openUnrealizedPnlQuote = await openUnrealizedQuote(positions, client)

  const actions: Array<CycleAction> = []

  const recordBlocks = (symbol: string, strategyId: string, verdictBlocks: Array<GuardianBlock>) => {
    for (const b of verdictBlocks) {
      blocks.push({ kind: SR_KIND_BLOCK, symbol, strategyId, rule: b.rule, detail: b.detail, at: new Date().toISOString() })
      actions.push({ symbol, strategyId, action: 'BLOCKED', reason: `${b.rule}: ${b.detail}` })
    }
    appendAuditLog('demo_guardian_block', { symbol, strategyId, blocks: verdictBlocks })
  }

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

    // Council opinion for this symbol (used for entries AND collective exits).
    const members: Array<CouncilMember> = STRATEGIES
      .filter((s) => config.enabledStrategies.includes(s.id))
      .map((s) => ({ strategyId: s.id, decision: s.evaluate(candles), score: scores.get(s.id)?.score ?? 0 }))
    const vote = councilVote(members, config.councilThreshold)

    // 1. Manage existing positions (exits first).
    const held = positions.filter((p) => p.symbol === symbol)
    for (const pos of held) {
      const ownerDecision = getStrategy(pos.strategyId)?.evaluate(candles)
      const changePct = (price - pos.entryPrice) / pos.entryPrice
      const hitStop = changePct <= -config.stopLossPct
      const hitTarget = changePct >= config.takeProfitPct
      const ownerExit = ownerDecision?.signal === 'SELL'
      const councilExit = vote.signal === 'SELL'
      if (hitStop || hitTarget || ownerExit || councilExit) {
        try {
          const order = await client.placeOrder({ symbol, side: 'SELL', type: 'MARKET', quantity: pos.quantity })
          const exitQuote = order.cummulativeQuoteQty || price * pos.quantity
          const feesQuote = pos.entryFeeQuote + orderFeeQuote(order.fills, order.avgPrice || price)
          const pnlQuote = exitQuote - pos.entryQuote - feesQuote
          const reason = hitStop ? `stop-loss ${(changePct * 100).toFixed(2)}%`
            : hitTarget ? `take-profit ${(changePct * 100).toFixed(2)}%`
            : ownerExit ? `strategy exit: ${ownerDecision!.reason}`
            : `council exit (net ${vote.net.toFixed(2)})`

          let nextScore = applyTradeOutcome(
            scores.get(pos.strategyId) ?? emptyScore(pos.strategyId),
            pnlQuote,
            pos.entryQuote,
          )
          if (nextScore.lossStreak >= config.guardian.lossStreakLimit) {
            nextScore = { ...nextScore, cooldownUntil: cooldownUntil(config.guardian) }
          }
          scores.set(pos.strategyId, nextScore)

          trades.push({
            id: `trade_${symbol}_${Date.now()}`,
            symbol,
            strategyId: pos.strategyId,
            entryPrice: pos.entryPrice,
            exitPrice: order.avgPrice || price,
            quantity: pos.quantity,
            entryQuote: pos.entryQuote,
            exitQuote,
            pnlQuote,
            feesQuote,
            reason,
            openedAt: pos.openedAt,
            closedAt: new Date().toISOString(),
          })
          positions = positions.filter((p) => p.id !== pos.id)
          actions.push({ symbol, strategyId: pos.strategyId, action: 'CLOSE', reason, price: order.avgPrice || price, pnlQuote })
          appendAuditLog('demo_trade_close', { symbol, strategyId: pos.strategyId, pnlQuote, reason })
        } catch (err) {
          actions.push({ symbol, strategyId: pos.strategyId, action: 'SKIP', reason: `close failed: ${(err as Error).message}` })
        }
      }
    }

    // 2. Entries: council BUY + guardian approval, only if flat on the symbol.
    const stillHeld = positions.some((p) => p.symbol === symbol)
    if (!stillHeld && vote.signal === 'BUY' && vote.leadStrategyId) {
      const leadScore = scores.get(vote.leadStrategyId) ?? emptyScore(vote.leadStrategyId)
      const proposedQuote = scaledQuoteSize(config.quotePerTrade, leadScore.score)
      const verdict = checkOrderProposal(
        { symbol, strategyId: vote.leadStrategyId, quoteAmount: proposedQuote },
        {
          openPositions: positions.length,
          quoteBalance,
          dailyPnlQuote: realizedToday(trades),
          weeklyPnlQuote: realizedWeekly(trades),
          openUnrealizedPnlQuote,
          strategyLossStreak: leadScore.lossStreak ?? 0,
          strategyCooldownUntil: leadScore.cooldownUntil,
        },
        config.guardian,
      )
      if (!verdict.allowed) {
        recordBlocks(symbol, vote.leadStrategyId, verdict.blocks)
      } else {
        try {
          const order = await client.placeOrder({ symbol, side: 'BUY', type: 'MARKET', quoteOrderQty: verdict.approvedQuote })
          if (order.executedQty > 0) {
            const spent = order.cummulativeQuoteQty || verdict.approvedQuote
            quoteBalance -= spent
            positions.push({
              id: `pos_${symbol}_${Date.now()}`,
              symbol,
              strategyId: vote.leadStrategyId,
              entryPrice: order.avgPrice || price,
              quantity: order.executedQty,
              entryQuote: spent,
              entryFeeQuote: orderFeeQuote(order.fills, order.avgPrice || price),
              openedAt: new Date().toISOString(),
            })
            actions.push({
              symbol,
              strategyId: vote.leadStrategyId,
              action: 'OPEN',
              reason: `council BUY (net ${vote.net.toFixed(2)}): ${vote.reasons.join('; ')}`,
              price: order.avgPrice || price,
            })
            appendAuditLog('demo_trade_open', { symbol, strategyId: vote.leadStrategyId, quote: verdict.approvedQuote, vote: vote.net })
          }
        } catch (err) {
          actions.push({ symbol, strategyId: vote.leadStrategyId, action: 'SKIP', reason: `open failed: ${(err as Error).message}` })
        }
      }
    } else if (!stillHeld) {
      actions.push({ symbol, strategyId: '-', action: 'SKIP', reason: `council: ${vote.signal} (net ${vote.net.toFixed(2)})` })
    }
  }

  persist({ scores, positions, trades, blocks })
  return {
    ran: true,
    actions,
    scores: [...scores.values()],
    openPositions: positions.length,
    dailyPnlQuote: realizedToday(trades),
    ranAt,
  }
}

/** Read-only snapshot for the API/UI. */
export function getEngineState(): {
  scores: Array<StrategyScore>
  positions: Array<OpenPosition>
  trades: Array<TradeLogEntry>
  guardianBlocks: Array<SRRow>
  dailyPnlQuote: number
  config: EngineConfig
} {
  const db = readFinanceStore()
  const rows = (db.strategy_results || []) as Array<SRRow>
  const trades = loadOfKind<TradeLogEntry>(rows, SR_KIND_TRADE)
  return {
    scores: [...loadScores(rows).values()],
    positions: loadOfKind<OpenPosition>(rows, SR_KIND_POSITION),
    trades: trades.slice(-20).reverse(),
    guardianBlocks: rows.filter((r) => r.kind === SR_KIND_BLOCK).slice(-20).reverse(),
    dailyPnlQuote: realizedToday(trades),
    config: resolveEngineConfig((db.settings as Record<string, unknown>).demoTrading),
  }
}

export interface DemoPerformance {
  totalTrades: number
  winRate: number
  profitFactor: number
  avgProfitLossPerTrade: number
  avgProfit: number
  avgLoss: number
  sharpeRatio: number
  maxDrawdown: number
  totalFeesQuote: number
}

/** Performance metrics over the demo engine's own closed trades (fee-net P/L). */
export function summarizeDemoTrades(trades: Array<TradeLogEntry>): DemoPerformance {
  const empty: DemoPerformance = {
    totalTrades: 0, winRate: 0, profitFactor: 0, avgProfitLossPerTrade: 0,
    avgProfit: 0, avgLoss: 0, sharpeRatio: 0, maxDrawdown: 0, totalFeesQuote: 0,
  }
  if (trades.length === 0) return empty
  const pnls = trades.map((t) => t.pnlQuote)
  const wins = pnls.filter((p) => p > 0)
  const losses = pnls.filter((p) => p < 0)
  const grossProfit = wins.reduce((sum, p) => sum + p, 0)
  const grossLoss = Math.abs(losses.reduce((sum, p) => sum + p, 0))
  const totalPnl = pnls.reduce((sum, p) => sum + p, 0)
  const mean = totalPnl / pnls.length
  const variance = pnls.reduce((sum, p) => sum + (p - mean) ** 2, 0) / pnls.length
  const std = Math.sqrt(variance)
  let cumulative = 0
  let peak = 0
  let maxDrawdown = 0
  for (const p of pnls) {
    cumulative += p
    if (cumulative > peak) peak = cumulative
    const drawdown = peak - cumulative
    if (drawdown > maxDrawdown) maxDrawdown = drawdown
  }
  return {
    totalTrades: pnls.length,
    winRate: wins.length / pnls.length,
    profitFactor: grossLoss !== 0 ? grossProfit / grossLoss : 0,
    avgProfitLossPerTrade: mean,
    avgProfit: wins.length ? grossProfit / wins.length : 0,
    avgLoss: losses.length ? losses.reduce((sum, p) => sum + p, 0) / losses.length : 0,
    sharpeRatio: std !== 0 ? mean / std : 0,
    maxDrawdown,
    totalFeesQuote: trades.reduce((sum, t) => sum + (t.feesQuote || 0), 0),
  }
}

/** Reads the demo trade log from the store and summarizes it. */
export function demoTradingPerformance(): DemoPerformance {
  const rows = readFinanceStore().strategy_results as Array<SRRow>
  return summarizeDemoTrades(loadOfKind<TradeLogEntry>(rows, SR_KIND_TRADE))
}

export interface MonitorSymbol {
  symbol: string
  price: number
  signal: 'BUY' | 'SELL' | 'HOLD'
  /** Weighted council net (conviction proxy); needs to clear the threshold to act. */
  net: number
  held: boolean
  unrealizedPnlQuote: number
}

export interface LiveMonitor {
  clientAvailable: boolean
  quoteBalance: number
  deployedQuote: number
  openUnrealizedPnlQuote: number
  equityQuote: number
  monitoring: Array<MonitorSymbol>
}

/**
 * Read-only live snapshot for the monitoring UI: current testnet balance, what
 * each watched symbol is doing right now (price + council signal), and open
 * position mark-to-market. Places no orders and ignores the trading-mode gate —
 * it just observes, so it works before the engine is armed too.
 */
export async function getLiveMonitor(): Promise<LiveMonitor> {
  const db = readFinanceStore()
  const config = resolveEngineConfig((db.settings as Record<string, unknown>).demoTrading)
  const rows = db.strategy_results as Array<SRRow>
  const positions = loadOfKind<OpenPosition>(rows, SR_KIND_POSITION)
  const scores = loadScores(rows)
  const deployedQuote = positions.reduce((sum, p) => sum + p.entryQuote, 0)

  const client = createDemoClientFromEnv().client
  if (!client) {
    return { clientAvailable: false, quoteBalance: 0, deployedQuote, openUnrealizedPnlQuote: 0, equityQuote: deployedQuote, monitoring: [] }
  }

  let quoteBalance = 0
  try {
    const acct = await client.getAccount()
    quoteBalance = acct.balances.find((b) => b.asset === 'USDT')?.free ?? 0
  } catch {
    /* balance read failed — leave 0 */
  }

  const monitoring: Array<MonitorSymbol> = []
  for (const symbol of config.symbols) {
    let price = 0
    let signal: 'BUY' | 'SELL' | 'HOLD' = 'HOLD'
    let net = 0
    try {
      const candles = await client.getKlines(symbol, config.interval, 100)
      price = candles.length ? candles[candles.length - 1].close : await client.getPrice(symbol)
      const members = STRATEGIES.filter((s) => config.enabledStrategies.includes(s.id)).map((s) => ({
        strategyId: s.id,
        decision: s.evaluate(candles),
        score: scores.get(s.id)?.score ?? 0,
      }))
      const vote = councilVote(members, config.councilThreshold)
      signal = vote.signal
      net = vote.net
    } catch {
      /* market data failed for this symbol — leave defaults */
    }
    const pos = positions.find((p) => p.symbol === symbol)
    monitoring.push({
      symbol,
      price,
      signal,
      net,
      held: Boolean(pos),
      unrealizedPnlQuote: pos && price > 0 ? price * pos.quantity - pos.entryQuote : 0,
    })
  }

  const openUnrealizedPnlQuote = monitoring.reduce((sum, m) => sum + (m.held ? m.unrealizedPnlQuote : 0), 0)
  const positionsMarkValue = positions.reduce((sum, p) => {
    const m = monitoring.find((x) => x.symbol === p.symbol)
    return sum + (m && m.price > 0 ? m.price * p.quantity : p.entryQuote)
  }, 0)

  return {
    clientAvailable: true,
    quoteBalance,
    deployedQuote,
    openUnrealizedPnlQuote,
    equityQuote: quoteBalance + positionsMarkValue,
    monitoring,
  }
}
