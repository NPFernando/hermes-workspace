/**
 * Cross-engine correlated-exposure visibility.
 *
 * trading-guardian.ts's bucket_exposure_cap rule (PR #23) only ever saw the
 * council engine's own open positions — it had zero visibility into what
 * the grid engine (grid-paper-engine.ts) independently holds in the same
 * symbols. Council could think it has $100 of ETHUSDT correlated exposure
 * while grid separately holds another $150 in the same symbol, and neither
 * engine's risk logic ever saw the combined total.
 *
 * This module is the one place that imports both engines' read paths to
 * merge their exposure — grid-paper-engine.ts and demo-trading-engine.ts
 * stay unaware of each other (see grid-paper-engine.ts's module doc on
 * staying isolated from the council engine).
 *
 * KNOWN GAP, not solved here: this only gives council-side awareness of
 * grid's exposure. The grid engine's own entry logic has no equivalent
 * check and remains unaware of council's exposure — grid could still pile
 * into a symbol council already has heavily concentrated. Flagging this
 * explicitly rather than leaving it undocumented, matching this repo's
 * established pattern (see the autoRecenter stop-floor gap, PR #10/#19).
 * A real fix needs grid-paper-engine.ts to gain its own guardian-style
 * check, which is a larger change than this visibility fix.
 */
import { bucketExposureQuote } from './trading-guardian'
import { heldGridPositions } from './grid-paper-engine'

/**
 * Merges council's own per-bucket exposure with the grid engine's current
 * per-bucket exposure. Safe to call every cycle — heldGridPositions() does
 * a single fresh readFinanceStore() call, no caching/staleness risk.
 */
export function crossEngineBucketExposureQuote(
  councilExposure: Record<string, number>,
  buckets: Record<string, Array<string>>,
): Record<string, number> {
  const gridExposure = bucketExposureQuote(heldGridPositions(), buckets)
  const merged: Record<string, number> = { ...councilExposure }
  for (const [bucket, quote] of Object.entries(gridExposure)) {
    merged[bucket] = (merged[bucket] ?? 0) + quote
  }
  return merged
}
