/**
 * "Ump-lite": a rule-based feature-bucket trade veto, concept-inspired by
 * bbfamily/abu's Ump (referee) system (GPL, concept-only — reimplemented
 * clean-room, no ported code, and deliberately NOT a GMM/clustering port —
 * no sklearn/scipy equivalent is worth hand-rolling for this in TS).
 *
 * Idea: bucket historical closed trades by their entry-time features
 * (strategy, RSI decile, volatility regime), track each bucket's loss rate,
 * and veto future entries whose bucket has a proven-bad loss rate with
 * enough samples to trust it. Ships with exactly one referee (the feature
 * set below); EntryFeatureVector is designed to grow additively so a second
 * referee can be added later without a schema change.
 *
 * This module is pure and has no persistence of its own — callers own
 * reading/writing bucket stats to/from their store (see demo-trading-engine.ts,
 * which persists them as finance-store strategy_results rows).
 */
import { atr, rsi } from './trading-strategies'
import type { Candle } from './trading-strategies'

export type VolRegime = 'low' | 'mid' | 'high'

export interface EntryFeatureVector {
  strategyId: string
  /** RSI(14) at entry, bucketed into deciles 0-9 (0 = most oversold). */
  rsiDecile: number
  /** ATR/price at entry, bucketed into terciles vs its own recent trailing history. */
  volRegime: VolRegime
}

export interface BucketStats {
  key: string
  trades: number
  losses: number
  lossRate: number
}

export function bucketKey(f: EntryFeatureVector): string {
  return `${f.strategyId}|rsi${f.rsiDecile}|${f.volRegime}`
}

/** Fold one closed trade's outcome into its bucket's running stats (immutable). */
export function applyBucketOutcome(
  stats: Record<string, BucketStats>,
  features: EntryFeatureVector,
  pnlQuote: number,
): Record<string, BucketStats> {
  const key = bucketKey(features)
  const prev = stats[key] ?? { key, trades: 0, losses: 0, lossRate: 0 }
  const trades = prev.trades + 1
  const losses = prev.losses + (pnlQuote < 0 ? 1 : 0)
  return {
    ...stats,
    [key]: { key, trades, losses, lossRate: losses / trades },
  }
}

/**
 * Both guards (sample floor AND loss-rate threshold) are independently
 * required — a thin bucket that happens to be all-losses isn't evidence, and
 * a well-sampled bucket at a merely-average loss rate isn't a bad setup.
 */
export function bucketVeto(
  stats: Record<string, BucketStats>,
  features: EntryFeatureVector,
  minSamples = 20,
  lossRateThreshold = 0.65,
): { blocked: boolean; detail?: string } {
  const bucket = Object.prototype.hasOwnProperty.call(stats, bucketKey(features))
    ? stats[bucketKey(features)]
    : undefined
  if (bucket === undefined || bucket.trades < minSamples) return { blocked: false }
  if (bucket.lossRate < lossRateThreshold) return { blocked: false }
  return {
    blocked: true,
    detail: `bucket ${bucket.key} has ${bucket.trades} trades at ${(bucket.lossRate * 100).toFixed(0)}% loss rate`,
  }
}

/** ATR/price at each point past the warmup — the distribution volRegime buckets against. */
export function atrPctSeries(candles: Array<Candle>, period: number): Array<number> {
  const out: Array<number> = []
  for (let i = period; i < candles.length; i++) {
    const slice = candles.slice(0, i + 1)
    const value = atr(slice, period)
    const price = slice[slice.length - 1].close
    if (value != null && price > 0) out.push(value / price)
  }
  return out
}

/**
 * Classifies `currentAtrPct` against the 33rd/66th percentile of
 * `recentAtrPct` — self-referential per symbol/window rather than a fixed
 * global threshold. Too little history to judge relative position -> 'mid'
 * (fails open to the middle bucket rather than skewing low/high).
 */
export function volRegimeFromHistory(
  recentAtrPct: Array<number>,
  currentAtrPct: number,
): VolRegime {
  if (recentAtrPct.length < 10) return 'mid'
  const sorted = [...recentAtrPct].sort((a, b) => a - b)
  const p33 = sorted[Math.floor(sorted.length * 0.33)]
  const p66 = sorted[Math.floor(sorted.length * 0.66)]
  if (currentAtrPct <= p33) return 'low'
  if (currentAtrPct >= p66) return 'high'
  return 'mid'
}

/** Builds the (single, v1) referee's feature vector for a proposed entry. */
export function buildEntryFeatureVector(
  strategyId: string,
  candles: Array<Candle>,
  atrPeriod = 14,
): EntryFeatureVector {
  const closes = candles.map((c) => c.close)
  const rsiValue = rsi(closes, 14)
  const rsiDecile =
    rsiValue == null ? 5 : Math.max(0, Math.min(9, Math.floor(rsiValue / 10)))
  const series = atrPctSeries(candles, atrPeriod)
  const currentAtrPct = series.length ? series[series.length - 1] : null
  const volRegime: VolRegime =
    currentAtrPct == null
      ? 'mid'
      : volRegimeFromHistory(series.slice(0, -1), currentAtrPct)
  return { strategyId, rsiDecile, volRegime }
}
