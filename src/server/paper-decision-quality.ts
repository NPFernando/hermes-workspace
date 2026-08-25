import type { PaperDecisionJournalEntry } from './paper-decision-journal'

export const PAPER_DECISION_OUTCOME_HORIZON_MS = 4 * 60 * 60 * 1000
const MAX_OUTCOME_STALENESS_MS = PAPER_DECISION_OUTCOME_HORIZON_MS / 4

export type PaperDecisionCalibrationBucket = {
  label: string
  minScoreMagnitude: number
  maxScoreMagnitude: number
  sampleCount: number
  directionalHits: number
  directionalHitRate: number | null
}

export type PaperDecisionQualityReport = {
  /** Every journal entry considered, including abstentions. */
  sampleCount: number
  coveredSampleCount: number
  abstainedSampleCount: number
  coverage: number
  abstentionRate: number
  directionalHitRate: number | null
  averageAdverseMovePct: number | null
  worstAdverseMovePct: number | null
  horizon: {
    durationMs: number
    maxOutcomeStalenessMs: number
    evaluatedAt: string
  }
  abstentions: Record<string, number>
  calibrationBuckets: Array<PaperDecisionCalibrationBucket>
  sideEffects: false
}

type OutcomeCandle = {
  symbol: string
  openedAtMs: number
  closedAtMs: number
  open: number
  high: number
  low: number
  close: number
}

type CalibrationAccumulator = Omit<PaperDecisionCalibrationBucket, 'directionalHitRate'>

const CALIBRATION_BUCKETS: Array<Pick<PaperDecisionCalibrationBucket, 'label' | 'minScoreMagnitude' | 'maxScoreMagnitude'>> = [
  { label: '0-24', minScoreMagnitude: 0, maxScoreMagnitude: 25 },
  { label: '25-49', minScoreMagnitude: 25, maxScoreMagnitude: 50 },
  { label: '50-74', minScoreMagnitude: 50, maxScoreMagnitude: 75 },
  { label: '75-100', minScoreMagnitude: 75, maxScoreMagnitude: 100 },
]

function finiteNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

function finiteTime(value: unknown): number | null {
  if (typeof value !== 'string') return null
  const timestamp = Date.parse(value)
  return Number.isFinite(timestamp) ? timestamp : null
}

function round(value: number): number {
  return Math.round(value * 10_000) / 10_000
}

function ratio(numerator: number, denominator: number): number | null {
  return denominator > 0 ? round(numerator / denominator) : null
}

function outcomeCandlesFrom(rows: ReadonlyArray<Record<string, unknown>>): Array<OutcomeCandle> {
  return rows.flatMap((row) => {
    const symbol = typeof row.symbol === 'string' ? row.symbol.trim().toUpperCase() : ''
    const openedAtMs = finiteTime(row.openedAt)
    const closedAtMs = finiteTime(row.closedAt)
    const open = finiteNumber(row.open)
    const high = finiteNumber(row.high)
    const low = finiteNumber(row.low)
    const close = finiteNumber(row.close)
    if (!symbol || openedAtMs == null || closedAtMs == null || closedAtMs <= openedAtMs || open == null || high == null || low == null || close == null || open <= 0 || high < low || high < open || high < close || low > open || low > close) return []
    return [{ symbol, openedAtMs, closedAtMs, open, high, low, close }]
  })
}

function calibrationBucketFor(score: number): number {
  const magnitude = Math.min(100, Math.abs(score))
  return Math.min(Math.floor(magnitude / 25), CALIBRATION_BUCKETS.length - 1)
}

function freshAccumulator(): Array<CalibrationAccumulator> {
  return CALIBRATION_BUCKETS.map((bucket) => ({ ...bucket, sampleCount: 0, directionalHits: 0 }))
}

/**
 * Pure, deterministic paper-only evaluation. It accepts stored snapshots and
 * stored candles; it never reads files, invokes providers, or writes state.
 * A candle is eligible only when its opening time is strictly after the
 * decision and its close is no later than the declared outcome horizon.
 */
export function evaluatePaperDecisionQuality(input: {
  decisions: ReadonlyArray<PaperDecisionJournalEntry>
  historicalCandles: ReadonlyArray<Record<string, unknown>>
  evaluatedAt: string
  horizonMs?: number
  maxOutcomeStalenessMs?: number
}): PaperDecisionQualityReport {
  const evaluatedAtMs = finiteTime(input.evaluatedAt)
  if (evaluatedAtMs == null) throw new Error('evaluatedAt must be a valid ISO timestamp')
  const horizonMs = input.horizonMs ?? PAPER_DECISION_OUTCOME_HORIZON_MS
  const maxOutcomeStalenessMs = input.maxOutcomeStalenessMs ?? Math.min(MAX_OUTCOME_STALENESS_MS, horizonMs)
  if (!Number.isFinite(horizonMs) || horizonMs <= 0) throw new Error('horizonMs must be positive')
  if (!Number.isFinite(maxOutcomeStalenessMs) || maxOutcomeStalenessMs < 0 || maxOutcomeStalenessMs > horizonMs) throw new Error('maxOutcomeStalenessMs must be between zero and horizonMs')

  const candlesBySymbol = new Map<string, Array<OutcomeCandle>>()
  for (const candle of outcomeCandlesFrom(input.historicalCandles)) {
    const candles = candlesBySymbol.get(candle.symbol) ?? []
    candles.push(candle)
    candlesBySymbol.set(candle.symbol, candles)
  }
  for (const candles of candlesBySymbol.values()) candles.sort((a, b) => a.openedAtMs - b.openedAtMs || a.closedAtMs - b.closedAtMs)

  const abstentions: Record<string, number> = {}
  const calibration = freshAccumulator()
  let coveredSampleCount = 0
  let directionalHits = 0
  const adverseMoves: Array<number> = []

  for (const decision of input.decisions) {
    const decisionAtMs = finiteTime(decision.recordedAt)
    const score = decision.compositeScore
    const symbol = decision.symbol.trim().toUpperCase()
    const abstain = (reason: string) => {
      abstentions[reason] = (abstentions[reason] ?? 0) + 1
    }
    if (!symbol || decisionAtMs == null) {
      abstain('invalid_decision_time_or_symbol')
      continue
    }
    if (score == null || !Number.isFinite(score) || score === 0) {
      abstain('no_directional_signal')
      continue
    }
    const deadlineMs = decisionAtMs + horizonMs
    if (evaluatedAtMs < deadlineMs) {
      abstain('horizon_not_elapsed')
      continue
    }
    const outcomeCandles = (candlesBySymbol.get(symbol) ?? []).filter(
      (candle) => candle.openedAtMs > decisionAtMs && candle.closedAtMs <= deadlineMs,
    )
    if (outcomeCandles.length === 0) {
      abstain('missing_outcome_candles')
      continue
    }
    const finalCandle = outcomeCandles[outcomeCandles.length - 1]
    if (finalCandle.closedAtMs < deadlineMs - maxOutcomeStalenessMs) {
      abstain('stale_outcome_candles')
      continue
    }

    const entryPrice = outcomeCandles[0].open
    const direction = score > 0 ? 1 : -1
    const signedReturnPct = ((finalCandle.close - entryPrice) / entryPrice) * 100 * direction
    const worstPrice = direction > 0
      ? Math.min(...outcomeCandles.map((candle) => candle.low))
      : Math.max(...outcomeCandles.map((candle) => candle.high))
    const adverseMovePct = direction > 0
      ? ((entryPrice - worstPrice) / entryPrice) * 100
      : ((worstPrice - entryPrice) / entryPrice) * 100
    const bucket = calibration[calibrationBucketFor(score)]

    coveredSampleCount += 1
    bucket.sampleCount += 1
    adverseMoves.push(adverseMovePct)
    if (signedReturnPct > 0) {
      directionalHits += 1
      bucket.directionalHits += 1
    }
  }

  const sampleCount = input.decisions.length
  const abstainedSampleCount = sampleCount - coveredSampleCount
  return {
    sampleCount,
    coveredSampleCount,
    abstainedSampleCount,
    coverage: ratio(coveredSampleCount, sampleCount) ?? 0,
    abstentionRate: ratio(abstainedSampleCount, sampleCount) ?? 0,
    directionalHitRate: ratio(directionalHits, coveredSampleCount),
    averageAdverseMovePct: adverseMoves.length > 0 ? round(adverseMoves.reduce((sum, value) => sum + value, 0) / adverseMoves.length) : null,
    worstAdverseMovePct: adverseMoves.length > 0 ? round(Math.max(...adverseMoves)) : null,
    horizon: { durationMs: horizonMs, maxOutcomeStalenessMs, evaluatedAt: new Date(evaluatedAtMs).toISOString() },
    abstentions,
    calibrationBuckets: calibration.map((bucket) => ({
      ...bucket,
      directionalHitRate: ratio(bucket.directionalHits, bucket.sampleCount),
    })),
    sideEffects: false,
  }
}
