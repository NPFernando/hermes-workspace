import type * as React from 'react'

// ── Shared building blocks ──────────────────────────────────────────────

export function SectionHeader({
  title,
  description,
}: {
  title: string
  description: string
}) {
  return (
    <div className="mb-2">
      <p className="mb-2 text-xs font-semibold uppercase tracking-wider text-[var(--theme-muted)]">
        Settings
      </p>
      <h3 className="text-base font-semibold text-[var(--theme-text)]">
        {title}
      </h3>
      <p className="text-xs text-[var(--theme-muted)]">{description}</p>
    </div>
  )
}

export function Row({
  label,
  description,
  children,
}: {
  label: string
  description?: string
  children: React.ReactNode
}) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-4 py-1.5">
      <div className="min-w-0 flex-1">
        <p className="text-sm font-medium text-[var(--theme-text)]">{label}</p>
        {description && (
          <p className="text-xs text-[var(--theme-muted)]">{description}</p>
        )}
      </div>
      <div className="flex items-center gap-2">{children}</div>
    </div>
  )
}

export const SETTINGS_CARD_CLASS =
  'rounded-xl border border-[var(--theme-border)] bg-[var(--theme-panel)] px-4 py-3 shadow-sm'

/** Shared select/input styling, previously repeated verbatim 6 times across
 * agent-behavior-content.tsx, display-content.tsx, and voice-content.tsx. */
export const SETTINGS_SELECT_CLASS =
  'h-8 rounded-lg border border-[var(--theme-border)] bg-[var(--theme-input)] px-2 text-sm text-[var(--theme-text)] outline-none'

/**
 * "Saved"/"Failed" status banner, previously hand-copied with slightly
 * different padding/sizing across agent-behavior-content.tsx,
 * display-content.tsx, voice-content.tsx, and hermes-content.tsx.
 */
export function SavedMessageBanner({ msg }: { msg: string | null }) {
  if (!msg) return null
  const failed = msg === 'Failed' || msg.toLowerCase().includes('fail')
  return (
    <div
      className={
        failed
          ? 'rounded-lg bg-[color-mix(in_srgb,var(--theme-danger)_15%,transparent)] px-3 py-1.5 text-xs font-medium text-[var(--theme-danger)]'
          : 'rounded-lg bg-[color-mix(in_srgb,var(--theme-success)_15%,transparent)] px-3 py-1.5 text-xs font-medium text-[var(--theme-success)]'
      }
    >
      {msg}
    </div>
  )
}
