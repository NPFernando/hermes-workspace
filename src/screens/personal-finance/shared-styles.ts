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
 *
 * Built from --theme-success/warning/danger/accent-secondary via color-mix()
 * rather than literal Tailwind palette classes (emerald-*, amber-*, red-*).
 * Those literal classes only track the active theme in the app's two SciFi
 * variants (scifi-theme.css remaps Tailwind's raw color tokens); every other
 * theme (Matrix, Hermes, Nous, Slate, Odysseus, ...) left them rendering as
 * plain default Tailwind colors, disconnected from the theme's own palette.
 * color-mix() against the theme variable makes every tone correct in every
 * theme, including future ones, with no per-theme CSS to maintain.
 */
export const neutralTone =
  'border-[var(--theme-border)] bg-black/10 text-[var(--theme-muted)]'
export const positiveTone =
  'border-[color-mix(in_srgb,var(--theme-success)_35%,transparent)] bg-[color-mix(in_srgb,var(--theme-success)_15%,transparent)] text-[var(--theme-success)]'
export const warningTone =
  'border-[color-mix(in_srgb,var(--theme-warning)_35%,transparent)] bg-[color-mix(in_srgb,var(--theme-warning)_15%,transparent)] text-[var(--theme-warning)]'
export const dangerTone =
  'border-[color-mix(in_srgb,var(--theme-danger)_35%,transparent)] bg-[color-mix(in_srgb,var(--theme-danger)_15%,transparent)] text-[var(--theme-danger)]'
export const infoTone =
  'border-[color-mix(in_srgb,var(--theme-accent-secondary)_35%,transparent)] bg-[color-mix(in_srgb,var(--theme-accent-secondary)_15%,transparent)] text-[var(--theme-accent-secondary)]'
