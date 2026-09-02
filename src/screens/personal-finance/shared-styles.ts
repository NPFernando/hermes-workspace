/** Shared Tailwind class strings for Personal Finance panel form controls. */

export const inputClass =
  'min-w-[140px] rounded-xl border border-[var(--theme-border)] bg-black/10 px-3 py-1.5 text-xs text-[var(--theme-text)] outline-none'

export const wideInputClass =
  'min-w-[200px] flex-1 rounded-xl border border-[var(--theme-border)] bg-black/10 px-3 py-1.5 text-xs text-[var(--theme-text)] outline-none'

export const buttonClass =
  'rounded-xl border border-[var(--theme-border)] bg-black/10 px-3 py-1.5 text-xs font-medium text-[var(--theme-text)] hover:bg-black/20 disabled:opacity-40'

/**
 * Shared status-pill tone classes. Every panel independently redefined the
 * same neutral/positive/warning/danger triplet for its own status badges
 * (maturity, payday, confidence, severity, alert level, etc.) — this is the
 * single source of truth for those four visual tones. Each call site still
 * owns its own business-state -> tone mapping (e.g. `{ ok: neutralTone,
 * soon: warningTone, overdue: dangerTone }`), since the state names differ
 * per feature, but the actual class strings are no longer duplicated.
 */
export const neutralTone =
  'border-[var(--theme-border)] bg-black/10 text-[var(--theme-muted)]'
export const positiveTone =
  'border-emerald-400/30 bg-emerald-500/15 text-emerald-100'
export const warningTone = 'border-amber-400/30 bg-amber-500/15 text-amber-100'
export const dangerTone = 'border-red-400/30 bg-red-500/15 text-red-100'
