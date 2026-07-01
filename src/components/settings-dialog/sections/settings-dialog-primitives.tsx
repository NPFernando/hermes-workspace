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
      <p className="text-xs text-[var(--theme-muted)]">
        {description}
      </p>
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
        <p className="text-sm font-medium text-[var(--theme-text)]">
          {label}
        </p>
        {description && (
          <p className="text-xs text-[var(--theme-muted)]">
            {description}
          </p>
        )}
      </div>
      <div className="flex items-center gap-2">{children}</div>
    </div>
  )
}

export const SETTINGS_CARD_CLASS =
  'rounded-xl border border-[var(--theme-border)] bg-[var(--theme-panel)] px-4 py-3 shadow-sm'
