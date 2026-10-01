import {
  appendAuditLog,
  readFinanceStore,
  writeFinanceStore,
} from './finance-store'
import {
  baseAssetOf,
  executionModeForTradingMode,
  getFullEngineHistory,
} from './demo-trading-engine'
import {
  createDemoClientFromEnv,
  createLiveClientFromEnv,
} from './binance-demo-client'
import type { BinanceExecutionClient } from './binance-demo-client'

export type TradingAccountReconciliationStatus =
  | 'aligned'
  | 'drift_detected'
  | 'unavailable'
  | 'not_applicable'

export interface TradingAccountReconciliation {
  [key: string]: unknown
  checkedAt: string
  executionMode: 'paper' | 'testnet' | 'live' | null
  status: TradingAccountReconciliationStatus
  localPositionCount: number
  localTradeCount24h: number
  exchangeTradeCount24h: number
  exchangeAssetCount: number
  mismatches: Array<string>
  detail: string
}

const DAILY_RECONCILIATION_INTERVAL_MS = 24 * 60 * 60 * 1000
let reconciliationAutomationTimer: ReturnType<typeof setInterval> | null = null

/**
 * Keep exchange reconciliation alive for long-running server processes.
 * The check is read-only; if it finds an unexplained drift, the existing
 * reconciliation path engages the emergency kill switch and disables live
 * trading before returning. The singleton guard prevents duplicate timers
 * when the finance route is initialized more than once in development or
 * during a hot reload.
 */
export function ensureTradingAccountReconciliationAutomation(): void {
  if (reconciliationAutomationTimer) return
  reconciliationAutomationTimer = setInterval(() => {
    void reconcileTradingAccount().catch((error) => {
      console.error('[trading-reconciliation] daily check failed:', error)
    })
  }, DAILY_RECONCILIATION_INTERVAL_MS)
  reconciliationAutomationTimer.unref()
  void reconcileTradingAccount().catch((error) => {
    console.error('[trading-reconciliation] startup check failed:', error)
  })
}

function persist(report: TradingAccountReconciliation): void {
  const db = readFinanceStore()
  db.settings.tradingAccountReconciliation = report
  writeFinanceStore(db)
}

function haltAutomationOnDrift(report: TradingAccountReconciliation): void {
  const db = readFinanceStore()
  db.settings.emergencyKillSwitch = true
  db.settings.liveTradingEnabled = false
  writeFinanceStore(db)
  appendAuditLog('trading_automation_halted_reconciliation_drift', {
    mismatches: report.mismatches,
    checkedAt: report.checkedAt,
  })
}

export async function reconcileTradingAccount(
  client?: BinanceExecutionClient,
  now = new Date(),
): Promise<TradingAccountReconciliation> {
  const db = readFinanceStore()
  const executionMode = executionModeForTradingMode(db.settings.tradingMode)
  if (executionMode === null || executionMode === 'paper') {
    const report: TradingAccountReconciliation = {
      checkedAt: now.toISOString(),
      executionMode,
      status: 'not_applicable',
      localPositionCount: 0,
      localTradeCount24h: 0,
      exchangeTradeCount24h: 0,
      exchangeAssetCount: 0,
      mismatches: [],
      detail: 'Paper mode has no exchange account to reconcile.',
    }
    persist(report)
    return report
  }

  const built = client
    ? { client }
    : executionMode === 'live'
      ? createLiveClientFromEnv()
      : createDemoClientFromEnv()
  if (!built.client) {
    const report: TradingAccountReconciliation = {
      checkedAt: now.toISOString(),
      executionMode,
      status: 'unavailable',
      localPositionCount: 0,
      localTradeCount24h: 0,
      exchangeTradeCount24h: 0,
      exchangeAssetCount: 0,
      mismatches: [],
      detail:
        'reason' in built && built.reason
          ? built.reason
          : 'Exchange client unavailable.',
    }
    persist(report)
    return report
  }

  try {
    const account = await built.client.getAccount()
    const history = getFullEngineHistory()
    const positions = history.positions.filter(
      (position) =>
        (executionMode === 'live' &&
          (position.executionMode ?? 'testnet') === 'live') ||
        (executionMode === 'testnet' &&
          (position.executionMode ?? 'testnet') === 'testnet'),
    )
    const recentCutoff = now.getTime() - 24 * 60 * 60_000
    const localTradeCount24h = history.trades.filter(
      (trade) => Date.parse(trade.closedAt) >= recentCutoff,
    ).length
    const mismatches: Array<string> = []
    const localByAsset = new Map<string, number>()
    for (const position of positions) {
      const asset = baseAssetOf(position.symbol)
      if (asset)
        localByAsset.set(asset, (localByAsset.get(asset) ?? 0) + position.quantity)
    }
    for (const [asset, localQuantity] of localByAsset) {
      const balance = account.balances.find((item) => item.asset === asset)
      const available = (balance?.free ?? 0) + (balance?.locked ?? 0)
      const tolerance = Math.max(1e-8, localQuantity * 0.005)
      if (available + tolerance < localQuantity) {
        mismatches.push(
          `${asset}: local aggregate ${localQuantity} exceeds exchange balance ${available}`,
        )
      }
    }
    const symbols = new Set(positions.map((position) => position.symbol))
    history.trades.forEach((trade) => symbols.add(trade.symbol))
    let exchangeTradeCount24h = 0
    if (client?.getMyTrades) {
      for (const symbol of symbols) {
        exchangeTradeCount24h += (
          await client.getMyTrades(symbol, recentCutoff)
        ).filter((trade) => trade.time >= recentCutoff).length
      }
      if (
        localTradeCount24h > 0 &&
        exchangeTradeCount24h < localTradeCount24h * 2
      ) {
        mismatches.push(
          `trade history: local ${localTradeCount24h} closed trade(s) in 24h but exchange returned ${exchangeTradeCount24h} fill(s)`,
        )
      }
    }
    const report: TradingAccountReconciliation = {
      checkedAt: now.toISOString(),
      executionMode,
      status: mismatches.length ? 'drift_detected' : 'aligned',
      localPositionCount: positions.length,
      localTradeCount24h,
      exchangeTradeCount24h,
      exchangeAssetCount: account.balances.filter(
        (item) => item.free > 0 || item.locked > 0,
      ).length,
      mismatches,
      detail: mismatches.length
        ? `${mismatches.length} local position/account mismatch(es) detected; automation must remain stopped until reviewed.`
        : 'Local open positions are covered by exchange balances.',
    }
    persist(report)
    appendAuditLog('trading_account_reconciled', report)
    if (report.status === 'drift_detected') haltAutomationOnDrift(report)
    return report
  } catch (error) {
    const report: TradingAccountReconciliation = {
      checkedAt: now.toISOString(),
      executionMode,
      status: 'unavailable',
      localPositionCount: 0,
      localTradeCount24h: 0,
      exchangeTradeCount24h: 0,
      exchangeAssetCount: 0,
      mismatches: [],
      detail: `Account reconciliation failed: ${error instanceof Error ? error.message : String(error)}`,
    }
    persist(report)
    return report
  }
}
