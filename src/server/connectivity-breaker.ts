/**
 * Connectivity circuit breaker — concept from bbfamily's neighbor research,
 * `Drakkar-Software/OctoBot` (GPL-3.0, concept-only, reimplemented clean-room):
 * OctoBot auto-pauses all trading after repeated exchange *credential*
 * failures, distinct from PnL-based risk rules. We had nothing like this —
 * every existing safety mechanism (trading-guardian.ts, each engine's
 * loss-streak/drawdown checks) is PnL-based; none watches whether the
 * exchange connection itself is actually working.
 *
 * Deliberately narrow: only genuine auth/signature failures trip this —
 * never rate limits or transient network errors, matching OctoBot's own
 * scope. A flapping rate limit is not a reason to halt every engine; a
 * revoked/broken API key is.
 *
 * Cross-engine and manual-reset-only, unlike each engine's own PnL-based
 * gates: a shared credential problem affects every engine using it, and
 * auto-recovery on a single success would let a flapping key silently
 * trip/untrip forever without anyone noticing there's a real problem to fix
 * (matches this codebase's existing "serious things need deliberate
 * re-arming" convention, e.g. the emergency kill switch).
 */
import { sendAlert } from './alerts'
import { readFinanceStore, writeFinanceStore } from './finance-store'

const CONSECUTIVE_FAILURE_THRESHOLD = 3
const FAILURE_WINDOW_MS = 30 * 60_000 // 30 minutes

export interface ConnectivityBreakerState {
  consecutiveCredentialFailures: number
  firstFailureAt: string | null
  tripped: boolean
  trippedAt: string | null
  trippedReason: string | null
}

const CREDENTIAL_CODES = new Set([-2014, -2015, -1022])

/**
 * Narrow on purpose — only genuine auth/signature problems trip the breaker.
 * Matches against the message shape `signedRequest` already throws
 * (`... failed (${status}${code ? ` code ${code}` : ''}): ${msg}`) plus a
 * few known Binance error-text substrings, without requiring any new typed
 * error plumbing.
 */
export function isCredentialFailureMessage(message: string): boolean {
  if (/failed \(401/.test(message) || /failed \(403/.test(message)) return true
  for (const code of CREDENTIAL_CODES) {
    if (message.includes(`code ${code}`)) return true
  }
  if (/invalid api-key/i.test(message)) return true
  if (/signature for this request is not valid/i.test(message)) return true
  if (/api-key format invalid/i.test(message)) return true
  return false
}

function sendConnectivityBreakerAlert(reason: string): void {
  // 'critical' always attempts delivery regardless of settings.alertsEnabled
  // — see alerts.ts's doc comment. Preserves this alert's pre-existing
  // unconditional-on-trip behavior.
  sendAlert({
    severity: 'critical',
    title: 'Connectivity breaker tripped — all trading engines paused',
    detail: `${reason}\nReset via reset_connectivity_breaker once the exchange credentials are verified.`,
    source: 'connectivity-breaker',
  })
}

/**
 * Fold one signed-request outcome into the breaker's state. `failureMessage`
 * is the thrown error's message on failure, or `null` on success. Only
 * credential-shaped failures move the counter — everything else (including
 * a null/success) is a no-op with respect to `tripped`, which only manual
 * `resetConnectivityBreaker()` ever clears.
 */
export function recordConnectivityOutcome(failureMessage: string | null): void {
  const db = readFinanceStore()
  const state = db.connectivityBreaker
  const now = new Date()

  if (failureMessage === null) {
    if (state.consecutiveCredentialFailures === 0) return
    db.connectivityBreaker = {
      ...state,
      consecutiveCredentialFailures: 0,
      firstFailureAt: null,
    }
    writeFinanceStore(db)
    return
  }

  if (!isCredentialFailureMessage(failureMessage)) return

  const windowExpired =
    state.firstFailureAt != null &&
    now.getTime() - Date.parse(state.firstFailureAt) > FAILURE_WINDOW_MS
  const firstFailureAt =
    state.consecutiveCredentialFailures === 0 || windowExpired
      ? now.toISOString()
      : state.firstFailureAt
  const consecutiveCredentialFailures = windowExpired
    ? 1
    : state.consecutiveCredentialFailures + 1

  const shouldTrip =
    !state.tripped && consecutiveCredentialFailures >= CONSECUTIVE_FAILURE_THRESHOLD
  const trippedReason = shouldTrip
    ? `${consecutiveCredentialFailures} consecutive credential failures within ${FAILURE_WINDOW_MS / 60_000} min. Last: ${failureMessage}`
    : state.trippedReason

  db.connectivityBreaker = {
    consecutiveCredentialFailures,
    firstFailureAt,
    tripped: state.tripped || shouldTrip,
    trippedAt: shouldTrip ? now.toISOString() : state.trippedAt,
    trippedReason,
  }
  writeFinanceStore(db)

  if (shouldTrip) sendConnectivityBreakerAlert(trippedReason ?? 'unknown reason')
}

export function isConnectivityBreakerTripped(): boolean {
  return readFinanceStore().connectivityBreaker.tripped
}

export function resetConnectivityBreaker(): void {
  const db = readFinanceStore()
  db.connectivityBreaker = {
    consecutiveCredentialFailures: 0,
    firstFailureAt: null,
    tripped: false,
    trippedAt: null,
    trippedReason: null,
  }
  writeFinanceStore(db)
}
