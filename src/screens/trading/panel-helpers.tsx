/**
 * Small cross-panel helpers for the Trading section — extracted verbatim from
 * trading-screen.tsx so the per-panel component files can share them.
 */
import { formatDateTime } from './format-helpers'
import type { StrategyOverride } from './trading-types'

export function overrideLifecycleLabel(
  override: Pick<StrategyOverride, 'reviewAt' | 'expiresAt'>,
): string {
  const review = override.reviewAt
    ? `Review ${formatDateTime(override.reviewAt)}`
    : null
  const expires = override.expiresAt
    ? `Expires ${formatDateTime(override.expiresAt)}`
    : null
  return [review, expires].filter(Boolean).join(' · ')
}

export function msToDuration(ms: number): string {
  if (!Number.isFinite(ms) || ms <= 0) return '0m'
  const totalMinutes = Math.floor(ms / 60_000)
  const days = Math.floor(totalMinutes / 1440)
  const hours = Math.floor((totalMinutes % 1440) / 60)
  const minutes = totalMinutes % 60
  const parts: Array<string> = []
  if (days) parts.push(`${days}d`)
  if (hours) parts.push(`${hours}h`)
  if (!days && minutes) parts.push(`${minutes}m`)
  return parts.join(' ') || '<1m'
}

export function ageLabel(iso: string | null): string {
  if (!iso) return 'never'
  const ageMs = Date.now() - new Date(iso).getTime()
  if (!Number.isFinite(ageMs) || ageMs < 0) return 'just now'
  if (ageMs < 60_000) return `${Math.round(ageMs / 1000)}s ago`
  return `${msToDuration(ageMs)} ago`
}

export function budgetRatioBar(label: string, used: number, max: number) {
  const pct = max > 0 ? Math.min(100, Math.round((used / max) * 100)) : 0
  return (
    <div key={label} className="flex flex-col gap-1">
      <div className="flex items-center justify-between text-[11px] text-[var(--theme-muted)]">
        <span>{label}</span>
        <span>{pct}%</span>
      </div>
      <div className="h-1.5 w-full overflow-hidden rounded-full bg-[color-mix(in_srgb,var(--theme-text)_12%,transparent)]">
        <div
          className={`h-full rounded-full ${pct >= 100 ? 'bg-[var(--theme-warning)]' : 'bg-[var(--theme-accent)]'}`}
          style={{ width: `${pct}%` }}
        />
      </div>
    </div>
  )
}

export function toggleTone(enabled: boolean): 'good' | 'neutral' {
  return enabled ? 'good' : 'neutral'
}
