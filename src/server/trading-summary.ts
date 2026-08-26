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
import { decisionQualityReport, getEngineState } from './demo-trading-engine'
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
  const llmClosedTrades = llm.trades.filter((t) => typeof t.pnlQuote === 'number')
  const llmTotalPnl = llmClosedTrades.reduce((sum, t) => sum + (t.pnlQuote ?? 0), 0)
  const llmTodayPnl = llmClosedTrades
    .filter((t) => isToday(t.createdAt, today))
    .reduce((sum, t) => sum + (t.pnlQuote ?? 0), 0)
  const llmWins = llmClosedTrades.filter((t) => (t.pnlQuote ?? 0) > 0).length

  function armState(
    enabled: boolean,
    requiresTestnet: boolean,
    ownExecutionMode?: string,
  ): { state: TradingEngineArmState; reason: string } {
    if (emergencyKillSwitch) return { state: 'disabled', reason: 'emergency kill switch is active' }
    if (!enabled) return { state: 'disabled', reason: 'disabled in settings' }
    if (requiresTestnet && tradingMode !== 'testnet_execute') {
      return { state: 'gated', reason: `tradingMode is "${tradingMode}", not testnet_execute` }
    }
    // Grid has its OWN independent executionMode (settings.demoTradingGrid),
    // checked in addition to the global tradingMode by
    // grid-paper-engine.ts's own testnet-mirror gate — deliberately
    // decoupled so grid can't be silently armed by a global tradingMode
    // flip meant for other engines. Reflect that here, not just tradingMode.
    if (ownExecutionMode !== undefined && ownExecutionMode !== 'testnet_execute') {
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
  const totalPnlQuote = quality.metrics.totalPnlQuote + grid.performance.totalPnlQuote + llmTotalPnl
  const openPositions = engineState.positions.length + grid.states.filter((s) =>
    s.levels.some((l) => l.held),
  ).length

  const totalWinTrades = quality.metrics.totalTrades * quality.metrics.winRate + grid.performance.wins + llmWins
  const totalTradesWithOutcome = quality.metrics.totalTrades + grid.performance.totalTrades + llmClosedTrades.length
  const winRate = totalTradesWithOutcome > 0 ? totalWinTrades / totalTradesWithOutcome : null

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
