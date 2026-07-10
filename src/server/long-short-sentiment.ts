/**
 * Top-trader long/short account ratio — a free, public, unauthenticated
 * Binance endpoint showing whether Binance's own "top trader" cohort is net
 * long or short on a symbol. Not "copy one specific trader" (Binance's copy-
 * trading API only covers a lead trader's own account, and there is no
 * public API for other lead traders' data) — this is a legitimate aggregate
 * crowd-sentiment signal, read-only market data with zero order-placement
 * capability.
 *
 * Deliberately isolated (own fetch helper, not shared with
 * binance-market.service.ts) — same "don't share plumbing between isolated
 * signal sources" convention as the grid/rebalance/llm-signal engines. Also
 * deliberately a DIFFERENT host: this is Binance's futures market-data API
 * (fapi.binance.com), not the spot host binance-market.service.ts uses —
 * using futures crowd positioning as a sentiment input for spot decisions,
 * not a futures execution path. No auth, no keys, no orders — this module
 * can never place a trade itself.
 */
import * as https from 'node:https'
import type { StrategyDecision } from './trading-strategies'

const FUTURES_DATA_API = 'https://fapi.binance.com'
const REQUEST_TIMEOUT_MS = 8000
const MAX_RESPONSE_BYTES = 5 * 1024 * 1024

/** Same bounded-GET shape as binance-market.service.ts's httpsGetJson. */
function httpsGetJson<T>(url: string): Promise<T> {
  return new Promise((resolve, reject) => {
    const req = https.get(url, (res) => {
      let data = ''
      let bytes = 0
      res.on('data', (chunk) => {
        bytes += chunk.length
        if (bytes > MAX_RESPONSE_BYTES) {
          req.destroy(new Error('Binance response exceeded maximum allowed size'))
          return
        }
        data += chunk
      })
      res.on('end', () => {
        try {
          resolve(JSON.parse(data) as T)
        } catch (err) {
          reject(new Error(`Failed to parse Binance response: ${err}`))
        }
      })
    })
    req.setTimeout(REQUEST_TIMEOUT_MS, () => {
      req.destroy(new Error(`Binance request timed out after ${REQUEST_TIMEOUT_MS}ms`))
    })
    req.on('error', (err) => {
      reject(new Error(`Failed to fetch from Binance: ${err}`))
    })
  })
}

interface RawLongShortRatioPoint {
  symbol: string
  longShortRatio: string
  longAccount: string
  shortAccount: string
  timestamp: string
}

export interface LongShortRatioPoint {
  symbol: string
  longShortRatio: number
  longAccount: number
  shortAccount: number
  timestamp: number
}

export async function fetchTopTraderLongShortRatio(
  symbol: string,
  period: string,
  limit = 1,
  // Injectable for tests — defaults to the real bounded HTTPS GET.
  fetchJson: <T>(url: string) => Promise<T> = httpsGetJson,
): Promise<Array<LongShortRatioPoint>> {
  const url =
    `${FUTURES_DATA_API}/futures/data/topLongShortAccountRatio` +
    `?symbol=${encodeURIComponent(symbol)}&period=${encodeURIComponent(period)}&limit=${limit}`
  const rows = await fetchJson<Array<RawLongShortRatioPoint>>(url)
  return rows.map((r) => ({
    symbol: r.symbol,
    longShortRatio: parseFloat(r.longShortRatio),
    longAccount: parseFloat(r.longAccount),
    shortAccount: parseFloat(r.shortAccount),
    timestamp: Number(r.timestamp),
  }))
}

/**
 * Converts the latest ratio into a CouncilMember-shaped decision. Symmetric:
 * >1 (more long accounts) -> BUY-leaning; <1 -> SELL-leaning (inverse);
 * confidence scales with distance from parity (1.0), capped at 1. Below a
 * small confidence floor, reports HOLD rather than a barely-there lean.
 */
export function longShortSentimentDecision(ratio: number | null): StrategyDecision {
  if (ratio == null || ratio <= 0) {
    return { signal: 'HOLD', confidence: 0, reason: 'no long/short data' }
  }
  const skew = ratio >= 1 ? ratio - 1 : 1 / ratio - 1
  const confidence = Math.min(1, skew)
  if (confidence < 0.05) {
    return {
      signal: 'HOLD',
      confidence,
      reason: `top-trader long/short ratio ${ratio.toFixed(2)} (near parity)`,
    }
  }
  return {
    signal: ratio >= 1 ? 'BUY' : 'SELL',
    confidence,
    reason: `top-trader long/short ratio ${ratio.toFixed(2)}`,
  }
}
