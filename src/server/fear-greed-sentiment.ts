/**
 * Crypto Fear & Greed Index — a free, public, unauthenticated market-wide
 * sentiment gauge from alternative.me (confirmed live 2026-07-24: no API
 * key, no rate limit documented, commercial use allowed with attribution,
 * full history back to 2018-02-01 available in one request via `limit=0`).
 * Unlike the per-symbol long/short ratio or on-chain whale balances, this is
 * a single daily value applied identically across every traded symbol.
 *
 * Deliberately isolated (own fetch helper, not shared with
 * binance-market.service.ts or long-short-sentiment.ts) — same "don't share
 * plumbing between isolated signal sources" convention as every other
 * signal module in this codebase.
 */
import * as https from 'node:https'
import type { StrategyDecision } from './trading-strategies'

const FEAR_GREED_API = 'https://api.alternative.me/fng/'
const REQUEST_TIMEOUT_MS = 8000
const MAX_RESPONSE_BYTES = 5 * 1024 * 1024

/** Same bounded-GET shape as long-short-sentiment.ts's httpsGetJson. */
function httpsGetJson<T>(url: string): Promise<T> {
  return new Promise((resolve, reject) => {
    const req = https.get(url, (res) => {
      let data = ''
      let bytes = 0
      res.on('data', (chunk) => {
        bytes += chunk.length
        if (bytes > MAX_RESPONSE_BYTES) {
          req.destroy(
            new Error('Fear & Greed response exceeded maximum allowed size'),
          )
          return
        }
        data += chunk
      })
      res.on('end', () => {
        try {
          resolve(JSON.parse(data) as T)
        } catch (err) {
          reject(new Error(`Failed to parse Fear & Greed response: ${err}`))
        }
      })
    })
    req.setTimeout(REQUEST_TIMEOUT_MS, () => {
      req.destroy(
        new Error(
          `Fear & Greed request timed out after ${REQUEST_TIMEOUT_MS}ms`,
        ),
      )
    })
    req.on('error', (err) => {
      reject(new Error(`Failed to fetch Fear & Greed index: ${err}`))
    })
  })
}

interface RawFearGreedPoint {
  value: string
  value_classification: string
  timestamp: string
}

interface RawFearGreedResponse {
  data: Array<RawFearGreedPoint>
}

export interface FearGreedPoint {
  value: number
  classification: string
  timestamp: number
}

/** limit=0 returns full history (3000+ daily points back to 2018-02-01 as of 2026-07-24). */
export async function fetchFearGreedHistory(
  limit = 1,
  // Injectable for tests — defaults to the real bounded HTTPS GET.
  fetchJson: <T>(url: string) => Promise<T> = httpsGetJson,
): Promise<Array<FearGreedPoint>> {
  const url = `${FEAR_GREED_API}?limit=${limit}&format=json`
  const res = await fetchJson<RawFearGreedResponse>(url)
  return res.data.map((p) => ({
    value: Number(p.value),
    classification: p.value_classification,
    timestamp: Number(p.timestamp),
  }))
}

export async function fetchLatestFearGreed(
  fetchJson: <T>(url: string) => Promise<T> = httpsGetJson,
): Promise<FearGreedPoint | null> {
  const points = await fetchFearGreedHistory(1, fetchJson)
  return points[0] ?? null
}

/**
 * Contrarian mapping (the index's own stated intent): extreme fear (low
 * value) is treated as a BUY-leaning signal, extreme greed (high value) as
 * SELL-leaning. Confidence scales with distance from the 50 (neutral)
 * midpoint, same skew-based shape as longShortSentimentDecision. Below a
 * small confidence floor, reports HOLD rather than a barely-there lean.
 */
export function fearGreedSentimentDecision(
  value: number | null,
): StrategyDecision {
  if (value == null || value < 0 || value > 100) {
    return { signal: 'HOLD', confidence: 0, reason: 'no fear & greed data' }
  }
  const skew = Math.abs(value - 50) / 50
  const confidence = Math.min(1, skew)
  if (confidence < 0.1) {
    return {
      signal: 'HOLD',
      confidence,
      reason: `fear & greed ${value} (near neutral)`,
    }
  }
  return {
    signal: value < 50 ? 'BUY' : 'SELL',
    confidence,
    reason: `fear & greed ${value} (${value < 50 ? 'fear' : 'greed'}, contrarian)`,
  }
}
