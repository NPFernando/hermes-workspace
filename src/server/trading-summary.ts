/**
 * Cross-engine trading summary for the Trading dashboard's top strip and the
 * dashboard's trading_overview widget — today's/total P&L, open positions,
 * blended win rate, and a per-engine armed/paper/gated/disabled status chip.
 *
 * Deliberately NOT part of finance-store.ts: that module is low-level and
 * the engines already import from it (see its own comments on avoiding a
 * circular dependency) — this sits one layer up, importing from
 * finance-store.ts AND all four engine modules, the same layering
 * src/routes/api/finance.ts's own handlers already use.
 */
import { readFinanceStore } from './finance-store'
import {
  decisionQualityReport,
  getEngineState,
  getLiveMonitor,
} from './demo-trading-engine'
import { getGridEngineState } from './grid-paper-engine'
import { getRebalanceState } from './rebalance-engine'
import { getLlmSignalState } from './llm-signal-engine'

export type TradingEngineArmState = 'live' | 'paper' | 'gated' | 'disabled'

export interface TradingEngineStatus {
  id: 'council' | 'grid' | 'rebalance' | 'llm'
  label: string
  armState: TradingEngineArmState
  reason: string
  todayPnlQuote: number | null
  totalPnlQuote: number | null
  totalTrades: number
}

export interface TradingSummary {
  tradingMode: string
  emergencyKillSwitch: boolean
  todayPnlQuote: number
  totalPnlQuote: number
  openPositions: number
  winRate: number | null
  engines: Array<TradingEngineStatus>
}

function isToday(dateIso: string | undefined, today: string): boolean {
  return typeof dateIso === 'string' && dateIso.startsWith(today)
}

export function getTradingSummary(): TradingSummary {
  const db = readFinanceStore()
  const settings = db.settings as Record<string, unknown>
  const tradingMode = String(settings.tradingMode ?? 'observe_only')
  const emergencyKillSwitch = settings.emergencyKillSwitch === true
  const today = new Date().toISOString().slice(0, 10)

  // Council — no per-engine enabled toggle exists; gated purely by
  // tradingMode/kill switch, so it's always "enabled" for arm-state purposes.
  const engineState = getEngineState()
  const quality = decisionQualityReport()

  // Grid — same as council, no per-engine enabled toggle in its config.
  const grid = getGridEngineState()
  const gridTodayPnl = grid.trades
    .filter((t) => isToday(t.closedAt, today))
    .reduce((sum, t) => sum + t.pnlQuote, 0)

  // Rebalance — no P&L concept (portfolio drift rebalancing, not directional trades)
  const rebalance = getRebalanceState()

  // LLM signal
  const llm = getLlmSignalState()
  const llmClosedTrades = llm.trades.filter(
    (t) => typeof t.pnlQuote === 'number',
  )
  const llmTotalPnl = llmClosedTrades.reduce(
    (sum, t) => sum + (t.pnlQuote ?? 0),
    0,
  )
  const llmTodayPnl = llmClosedTrades
    .filter((t) => isToday(t.createdAt, today))
    .reduce((sum, t) => sum + (t.pnlQuote ?? 0), 0)
  const llmWins = llmClosedTrades.filter((t) => (t.pnlQuote ?? 0) > 0).length

  function armState(
    enabled: boolean,
    requiresTestnet: boolean,
    ownExecutionMode?: string,
  ): { state: TradingEngineArmState; reason: string } {
    if (emergencyKillSwitch)
      return { state: 'disabled', reason: 'emergency kill switch is active' }
    if (!enabled) return { state: 'disabled', reason: 'disabled in settings' }
    if (requiresTestnet && tradingMode !== 'testnet_execute') {
      return {
        state: 'gated',
        reason: `tradingMode is "${tradingMode}", not testnet_execute`,
      }
    }
    // Grid has its OWN independent executionMode (settings.demoTradingGrid),
    // checked in addition to the global tradingMode by
    // grid-paper-engine.ts's own testnet-mirror gate — deliberately
    // decoupled so grid can't be silently armed by a global tradingMode
    // flip meant for other engines. Reflect that here, not just tradingMode.
    if (
      ownExecutionMode !== undefined &&
      ownExecutionMode !== 'testnet_execute'
    ) {
      return {
        state: 'paper',
        reason: `own executionMode is "${ownExecutionMode}" (independent of the global tradingMode)`,
      }
    }
    if (tradingMode === 'paper_trade' || tradingMode === 'observe_only') {
      return { state: 'paper', reason: `running in ${tradingMode}` }
    }
    return { state: 'live', reason: `armed in ${tradingMode}` }
  }

  const councilArm = armState(true, false)
  const gridArm = armState(true, false, grid.config.executionMode)
  const rebalanceArm = armState(rebalance.config.enabled, true)
  const llmArm = armState(llm.config.enabled, true)

  const engines: Array<TradingEngineStatus> = [
    {
      id: 'council',
      label: 'Council',
      armState: councilArm.state,
      reason: councilArm.reason,
      todayPnlQuote: engineState.dailyPnlQuote,
      totalPnlQuote: quality.metrics.totalPnlQuote,
      totalTrades: quality.metrics.totalTrades,
    },
    {
      id: 'grid',
      label: 'Grid',
      armState: gridArm.state,
      reason: gridArm.reason,
      todayPnlQuote: gridTodayPnl,
      totalPnlQuote: grid.performance.totalPnlQuote,
      totalTrades: grid.performance.totalTrades,
    },
    {
      id: 'rebalance',
      label: 'Rebalance',
      armState: rebalanceArm.state,
      reason: rebalanceArm.reason,
      todayPnlQuote: null,
      totalPnlQuote: null,
      totalTrades: rebalance.trades.length,
    },
    {
      id: 'llm',
      label: 'LLM Signal',
      armState: llmArm.state,
      reason: llmArm.reason,
      todayPnlQuote: llmTodayPnl,
      totalPnlQuote: llmTotalPnl,
      totalTrades: llm.trades.length,
    },
  ]

  const todayPnlQuote = engineState.dailyPnlQuote + gridTodayPnl + llmTodayPnl
  const totalPnlQuote =
    quality.metrics.totalPnlQuote + grid.performance.totalPnlQuote + llmTotalPnl
  const openPositions =
    engineState.positions.length +
    grid.states.filter((s) => s.levels.some((l) => l.held)).length

  const totalWinTrades =
    quality.metrics.totalTrades * quality.metrics.winRate +
    grid.performance.wins +
    llmWins
  const totalTradesWithOutcome =
    quality.metrics.totalTrades +
    grid.performance.totalTrades +
    llmClosedTrades.length
  const winRate =
    totalTradesWithOutcome > 0 ? totalWinTrades / totalTradesWithOutcome : null

  return {
    tradingMode,
    emergencyKillSwitch,
    todayPnlQuote,
    totalPnlQuote,
    openPositions,
    winRate,
    engines,
  }
}

export interface AccountBaseline {
  equityQuote: number
  recordedAt: string
}

export interface AccountOverview {
  /** Always the Binance sandbox/testnet account today — surfaced explicitly
   * so the UI can label it clearly as resettable paper-trade validation,
   * never real money. */
  label: string
  tradingMode: string
  clientAvailable: boolean
  /** False if the balance fetch failed (network hiccup/rate limit) — the UI
   * should show "unavailable" rather than a misleading $0 in that case. */
  balanceFetchOk: boolean
  baseline: AccountBaseline | null
  /** Free balance, not currently deployed in any open position. */
  availableQuote: number
  /** Currently deployed across all 4 engines' open positions. */
  deployedQuote: number
  /** Mark-to-market P/L on currently open positions (council only — grid/llm
   * don't currently expose live mark price the same way). */
  unrealizedPnlQuote: number
  /** All-time realized P/L (sum of closed trades) across all 4 engines, for
   * the currently active execution mode only. */
  realizedPnlQuote: number
  todayPnlQuote: number
  /** available + deployed + unrealized. */
  equityQuote: number
  /** equityQuote - baseline.equityQuote, or null if no baseline recorded yet. */
  netVsBaselineQuote: number | null
  /** Counts only — see getEngineState()'s archivedPositions/archivedTrades
   * for the actual stale/other-mode entries kept out of this view. */
  archivedPositionsCount: number
  archivedTradesCount: number
  /** Epoch ms when the balance/price data behind this snapshot was actually
   * fetched from the exchange (served from a ~20s background-refreshed
   * cache, not fetched fresh on every call) — lets the UI show "as of Xs
   * ago" instead of implying an always-instant live read. */
  asOfMs: number
}

/** Powers the Trading Account Overview card — the single "what do we have,
 * what's deployed, what have we earned/lost, what's it worth now" view the
 * per-engine panels don't otherwise provide in one place. */
export async function getAccountOverview(): Promise<AccountOverview> {
  const db = readFinanceStore()
  const settings = db.settings as Record<string, unknown>
  const tradingMode = String(settings.tradingMode ?? 'observe_only')
  const baseline = (settings.accountBaseline ?? null) as AccountBaseline | null

  const monitor = await getLiveMonitor()
  const engineState = getEngineState()
  const grid = getGridEngineState()
  const rebalance = getRebalanceState()
  const llm = getLlmSignalState()
  void rebalance // rebalancing shuffles existing spot holdings rather than
  // deploying separate quote capital, so it has no distinct "deployed"
  // figure to add here.

  const gridDeployedQuote = grid.states.reduce(
    (sum, state) =>
      sum +
      state.levels
        .filter((level) => level.held)
        .reduce((levelSum, level) => levelSum + level.entryQuote, 0),
    0,
  )
  const llmDeployedQuote = llm.positions.reduce(
    (sum, position) => sum + position.entryQuote,
    0,
  )
  const deployedQuote =
    monitor.deployedQuote + gridDeployedQuote + llmDeployedQuote

  const gridRealizedQuote = grid.performance.totalPnlQuote
  const llmRealizedQuote = llm.trades.reduce(
    (sum, trade) => sum + (trade.pnlQuote ?? 0),
    0,
  )
  const realizedPnlQuote =
    engineState.totalRealizedPnlQuote + gridRealizedQuote + llmRealizedQuote

  const today = new Date().toISOString().slice(0, 10)
  const gridTodayPnl = grid.trades
    .filter((trade) => isToday(trade.closedAt, today))
    .reduce((sum, trade) => sum + trade.pnlQuote, 0)
  const llmTodayPnl = llm.trades
    .filter((trade) => isToday(trade.createdAt, today))
    .reduce((sum, trade) => sum + (trade.pnlQuote ?? 0), 0)
  const todayPnlQuote = engineState.dailyPnlQuote + gridTodayPnl + llmTodayPnl

  const equityQuote =
    monitor.quoteBalance + deployedQuote + monitor.openUnrealizedPnlQuote

  return {
    label: 'Binance Sandbox (Testnet) — Paper-Trade Validation',
    tradingMode,
    clientAvailable: monitor.clientAvailable,
    balanceFetchOk: monitor.balanceFetchOk,
    baseline,
    availableQuote: monitor.quoteBalance,
    deployedQuote,
    unrealizedPnlQuote: monitor.openUnrealizedPnlQuote,
    realizedPnlQuote,
    todayPnlQuote,
    equityQuote,
    netVsBaselineQuote: baseline ? equityQuote - baseline.equityQuote : null,
    archivedPositionsCount: engineState.archivedPositions.length,
    archivedTradesCount: engineState.archivedTrades.length,
    asOfMs: monitor.asOfMs,
  }
}
