/**
 * Phase 5 (dual-write step) of the finance/trading backend split. Same
 * best-effort mirror-only contract as personal-finance-store.ts — see that
 * file's module doc. Not a source of truth yet; nothing reads from it.
 */
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'

const DATA_DIR = path.join(os.homedir(), '.hermes', 'finance')
const DATA_PATH = path.join(DATA_DIR, 'trading.json')

export interface TradingSlice {
  assets: Array<Record<string, unknown>>
  market_prices: Array<Record<string, unknown>>
  historical_candles: Array<Record<string, unknown>>
  news_items: Array<Record<string, unknown>>
  sentiment_scores: Array<Record<string, unknown>>
  risk_scores: Array<Record<string, unknown>>
  intelligence_records: Array<Record<string, unknown>>
  trading_plans: Array<Record<string, unknown>>
  trade_orders: Array<Record<string, unknown>>
  trade_executions: Array<Record<string, unknown>>
  virtual_accounts: Array<Record<string, unknown>>
  portfolio_positions: Array<Record<string, unknown>>
  account_balances: Array<Record<string, unknown>>
  strategy_results: Array<Record<string, unknown>>
  prediction_results: Array<Record<string, unknown>>
  trading_signals: Array<Record<string, unknown>>
  riskState: unknown
  connectivityBreaker: unknown
}

/**
 * Best-effort mirror write. Must never throw back into the caller — every
 * caller of writeFinanceStore() includes trading-engine cron cycles (every
 * 5-15 minutes), and a failure here must not interrupt a real trade write.
 */
export function writeTradingStore(slice: TradingSlice): void {
  try {
    fs.mkdirSync(DATA_DIR, { recursive: true, mode: 0o700 })
    const payload = {
      schemaVersion: 1,
      updatedAt: new Date().toISOString(),
      ...slice,
    }
    fs.writeFileSync(DATA_PATH, JSON.stringify(payload), { mode: 0o600 })
  } catch (err) {
    console.error('trading-store: mirror write failed', err)
  }
}

export function readTradingStore():
  | (TradingSlice & { schemaVersion: number; updatedAt: string })
  | null {
  try {
    const raw = fs.readFileSync(DATA_PATH, 'utf-8')
    return JSON.parse(raw)
  } catch {
    return null
  }
}
