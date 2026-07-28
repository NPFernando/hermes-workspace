/**
 * On-chain whale/exchange balance tracking — a genuinely different signal
 * domain from every other source in this codebase (on-chain, not exchange-
 * internal), sidestepping any single exchange's ToS entirely. Uses
 * Etherscan's V2 API, addressed through a `chainid` parameter (1 = Ethereum,
 * 56 = BSC). Free tier is 5 calls/sec, 100k/day — but **confirmed via a real
 * key, not just docs, that BSC (chainid=56) is NOT actually included on the
 * free tier** ("Free API access is not supported for this chain. Please
 * upgrade your api plan.") — their July 2026 tightening's "~10% of chains
 * now paid-only" turns out to include BSC. Ethereum (chainid=1) works fine
 * on free. `WhaleChain` still types both, but BSC watchlist entries won't
 * resolve without a paid Etherscan plan — Ethereum-only for now.
 *
 * Whale Alert was the originally-logged option here but turned out to
 * require a paid subscription ($14.95-$29.95/month, credit card even for
 * the trial) — caught and corrected before any code was built around that
 * wrong assumption (docs/trading-engine.md, 2026-07-23).
 *
 * Deliberately isolated (own fetch helper, not shared with
 * binance-market.service.ts or long-short-sentiment.ts) — same "don't share
 * plumbing between isolated signal sources" convention as every other
 * standalone signal module. Read-only balance lookups, zero order-placement
 * capability, can never place a trade itself.
 *
 * No hardcoded addresses: the watchlist is entirely `set_demo_config`-driven
 * and empty by default. Curating real whale/exchange addresses from memory
 * risks baking in wrong or unverifiable addresses — worse than not having
 * the feature. Naveen adds real, independently-verified addresses later, at
 * his own pace.
 */
import * as https from 'node:https'
import type { StrategyDecision } from './trading-strategies'

const ETHERSCAN_API_BASE = 'https://api.etherscan.io/v2/api'
const REQUEST_TIMEOUT_MS = 8000
const MAX_RESPONSE_BYTES = 5 * 1024 * 1024
const CHAIN_IDS: Record<WhaleChain, number> = { ethereum: 1, bsc: 56 }
const WEI_PER_NATIVE_UNIT = 1e18
/** Below this fractional balance change, report HOLD rather than a barely-there lean. */
const CONFIDENCE_FLOOR = 0.02

export type WhaleChain = 'ethereum' | 'bsc'
export type WhaleAddressType = 'exchange' | 'whale'

export interface WatchedAddress {
  chain: WhaleChain
  address: string
  label: string
  type: WhaleAddressType
}

/** Same bounded-GET shape as long-short-sentiment.ts's httpsGetJson. */
function httpsGetJson<T>(url: string): Promise<T> {
  return new Promise((resolve, reject) => {
    const req = https.get(url, (res) => {
      let data = ''
      let bytes = 0
      res.on('data', (chunk) => {
        bytes += chunk.length
        if (bytes > MAX_RESPONSE_BYTES) {
          req.destroy(new Error('Etherscan response exceeded maximum allowed size'))
          return
        }
        data += chunk
      })
      res.on('end', () => {
        try {
          resolve(JSON.parse(data) as T)
        } catch (err) {
          reject(new Error(`Failed to parse Etherscan response: ${err}`))
        }
      })
    })
    req.setTimeout(REQUEST_TIMEOUT_MS, () => {
      req.destroy(new Error(`Etherscan request timed out after ${REQUEST_TIMEOUT_MS}ms`))
    })
    req.on('error', (err) => {
      reject(new Error(`Failed to fetch from Etherscan: ${err}`))
    })
  })
}

interface RawBalanceResponse {
  status: string
  message: string
  result: string
}

/**
 * Fetches a single address's native-token balance (ETH or BNB), in whole
 * units (not wei). Propagates any fetch/parse failure rather than
 * swallowing it — callers are responsible for try/catch, same convention as
 * fetchTopTraderLongShortRatio in long-short-sentiment.ts.
 */
export async function fetchAddressBalance(
  chain: WhaleChain,
  address: string,
  apiKey: string,
  // Injectable for tests — defaults to the real bounded HTTPS GET.
  fetchJson: <T>(url: string) => Promise<T> = httpsGetJson,
): Promise<number> {
  const url =
    `${ETHERSCAN_API_BASE}?chainid=${CHAIN_IDS[chain]}&module=account&action=balance` +
    `&address=${encodeURIComponent(address)}&tag=latest&apikey=${encodeURIComponent(apiKey)}`
  const body = await fetchJson<RawBalanceResponse>(url)
  if (body.status !== '1') {
    throw new Error(`Etherscan balance lookup failed for ${address}: ${body.message}`)
  }
  const wei = Number(body.result)
  if (!Number.isFinite(wei)) {
    throw new Error(`Etherscan returned a non-numeric balance for ${address}`)
  }
  return wei / WEI_PER_NATIVE_UNIT
}

/**
 * Converts a balance delta into a CouncilMember-shaped decision. Direction
 * is flipped by address type: for an exchange address, an inflow (balance
 * rose) means supply is building up to potentially be sold — bearish-
 * leaning; for a whale (non-exchange) address, an inflow is accumulation —
 * bullish-leaning. Confidence scales with the magnitude of the fractional
 * change, capped at 1; below CONFIDENCE_FLOOR, reports HOLD.
 */
export function whaleFlowDecision(
  prevBalance: number | null,
  currBalance: number | null,
  type: WhaleAddressType,
  label: string,
): StrategyDecision {
  if (prevBalance == null || currBalance == null || prevBalance <= 0) {
    return { signal: 'HOLD', confidence: 0, reason: `no prior balance for ${label}` }
  }
  const fractionalChange = (currBalance - prevBalance) / prevBalance
  const confidence = Math.min(1, Math.abs(fractionalChange) * 20)
  if (confidence < CONFIDENCE_FLOOR) {
    return {
      signal: 'HOLD',
      confidence,
      reason: `${label} balance ~unchanged (${(fractionalChange * 100).toFixed(2)}%)`,
    }
  }
  const inflow = fractionalChange > 0
  // Exchange inflow = bearish (supply building up); whale inflow = bullish (accumulation).
  const signal = inflow === (type === 'exchange') ? 'SELL' : 'BUY'
  const direction = inflow ? 'inflow' : 'outflow'
  return {
    signal,
    confidence,
    reason: `${label} (${type}) ${direction} of ${(Math.abs(fractionalChange) * 100).toFixed(2)}%`,
  }
}
