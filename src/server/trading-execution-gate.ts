import { isConnectivityBreakerTripped } from './connectivity-breaker'

export interface ExecutionGateResult {
  allowed: boolean
  reason?: string
}

/**
 * Shared "is real testnet order placement allowed right now" gate for
 * engines that execute signed testnet orders outside the council's own
 * trading-guardian.ts risk layer (rebalance-engine.ts, llm-signal-engine.ts).
 * Extracted from two near-identical copies (Phase 6 of the finance/trading
 * refactor plan) — kept separate from trading-guardian.ts itself because
 * that layer's one-position-per-symbol assumptions don't fit either
 * engine's model (see each engine's own module doc for the isolation
 * rationale).
 *
 * Same 4 checks in the same order as both original copies: kill switch →
 * connectivity breaker → tradingMode → engine's own enabled flag.
 */
export function executionModeAllowed(
  settings: Record<string, unknown>,
  config: { enabled: boolean },
  disabledReason: string,
): ExecutionGateResult {
  if (settings.emergencyKillSwitch) {
    return { allowed: false, reason: 'emergency kill switch is active' }
  }
  if (isConnectivityBreakerTripped()) {
    return {
      allowed: false,
      reason:
        'connectivity breaker tripped — repeated invalid-credential errors, needs manual reset',
    }
  }
  if (settings.tradingMode !== 'testnet_execute') {
    return {
      allowed: false,
      reason: `tradingMode is "${String(settings.tradingMode)}", not testnet_execute`,
    }
  }
  if (!config.enabled) return { allowed: false, reason: disabledReason }
  return { allowed: true }
}
