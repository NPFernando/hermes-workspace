/**
 * Process-level safety switch for external side effects.
 *
 * HERMES_SAFE_MODE=1 (or true/on/yes) keeps previews and diagnostics usable
 * while fail-closed callers reject network/API writes and other integrations
 * that can change an external system. It is intentionally environment-backed
 * so enabling it requires an operator-controlled process restart.
 */
export type SafeModeStatus = {
  enabled: boolean
  source: 'HERMES_SAFE_MODE' | 'disabled'
  detail: string
}

export class ExternalWriteBlockedError extends Error {
  readonly code = 'SAFE_MODE_EXTERNAL_WRITE_BLOCKED'

  constructor(operation: string) {
    super(`Safe mode is enabled; external write blocked: ${operation}`)
    this.name = 'ExternalWriteBlockedError'
  }
}

export function isSafeModeEnabled(
  env: Record<string, string | undefined> = process.env,
): boolean {
  return /^(1|true|yes|on)$/i.test((env.HERMES_SAFE_MODE ?? '').trim())
}

export function getSafeModeStatus(
  env: Record<string, string | undefined> = process.env,
): SafeModeStatus {
  const enabled = isSafeModeEnabled(env)
  return {
    enabled,
    source: enabled ? 'HERMES_SAFE_MODE' : 'disabled',
    detail: enabled
      ? 'External writes are blocked; previews and diagnostics remain available.'
      : 'External writes are enabled according to normal per-integration gates.',
  }
}

export function assertExternalWritesEnabled(
  operation: string,
  env: Record<string, string | undefined> = process.env,
): void {
  if (isSafeModeEnabled(env)) throw new ExternalWriteBlockedError(operation)
}
