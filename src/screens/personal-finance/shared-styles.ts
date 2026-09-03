/**
 * Shared Tailwind class strings for Personal Finance panel form controls.
 *
 * The surface tint (inputs, buttons, neutral pills) uses color-mix() against
 * --theme-text rather than a flat bg-black/N — a flat black overlay reads
 * fine on dark themes but shows as a plain muddy gray on light themes,
 * disconnected from the theme's own ink color. Mixing in --theme-text keeps
 * the same "distinct surface" effect while picking up each theme's actual
 * color cast (it lightens on dark themes, darkens on light ones, since
 * --theme-text is always the theme's own high-contrast color).
 */

export const inputClass =
  'min-w-[140px] rounded-xl border border-[var(--theme-border)] bg-[color-mix(in_srgb,var(--theme-text)_8%,transparent)] px-3 py-1.5 text-xs text-[var(--theme-text)] outline-none'

export const wideInputClass =
  'min-w-[200px] flex-1 rounded-xl border border-[var(--theme-border)] bg-[color-mix(in_srgb,var(--theme-text)_8%,transparent)] px-3 py-1.5 text-xs text-[var(--theme-text)] outline-none'

export const buttonClass =
  'rounded-xl border border-[var(--theme-border)] bg-[color-mix(in_srgb,var(--theme-text)_8%,transparent)] px-3 py-1.5 text-xs font-medium text-[var(--theme-text)] hover:bg-[color-mix(in_srgb,var(--theme-text)_16%,transparent)] disabled:opacity-40'

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
  'border-[var(--theme-border)] bg-[color-mix(in_srgb,var(--theme-text)_8%,transparent)] text-[var(--theme-muted)]'
export const positiveTone =
  'border-[color-mix(in_srgb,var(--theme-success)_35%,transparent)] bg-[color-mix(in_srgb,var(--theme-success)_15%,transparent)] text-[var(--theme-success)]'
export const warningTone =
  'border-[color-mix(in_srgb,var(--theme-warning)_35%,transparent)] bg-[color-mix(in_srgb,var(--theme-warning)_15%,transparent)] text-[var(--theme-warning)]'
export const dangerTone =
  'border-[color-mix(in_srgb,var(--theme-danger)_35%,transparent)] bg-[color-mix(in_srgb,var(--theme-danger)_15%,transparent)] text-[var(--theme-danger)]'
export const infoTone =
  'border-[color-mix(in_srgb,var(--theme-accent-secondary)_35%,transparent)] bg-[color-mix(in_srgb,var(--theme-accent-secondary)_15%,transparent)] text-[var(--theme-accent-secondary)]'

/**
 * Shared Save/Confirm and Delete/Reject action-button classes. Redefined
 * identically (byte-for-byte, in two size variants) across ~15 panel files
 * using literal emerald-* / red-* classes before being converted here.
 */
export const confirmButtonClass =
  'rounded-xl border border-[color-mix(in_srgb,var(--theme-success)_30%,transparent)] bg-[color-mix(in_srgb,var(--theme-success)_15%,transparent)] px-3 py-1.5 text-xs font-medium text-[var(--theme-success)] hover:bg-[color-mix(in_srgb,var(--theme-success)_25%,transparent)] disabled:opacity-50'
export const confirmButtonClassLarge =
  'rounded-xl border border-[color-mix(in_srgb,var(--theme-success)_30%,transparent)] bg-[color-mix(in_srgb,var(--theme-success)_15%,transparent)] px-4 py-2 text-sm font-medium text-[var(--theme-success)] hover:bg-[color-mix(in_srgb,var(--theme-success)_25%,transparent)] disabled:opacity-50'
export const dangerButtonClass =
  'rounded-xl border border-[color-mix(in_srgb,var(--theme-danger)_30%,transparent)] bg-[color-mix(in_srgb,var(--theme-danger)_15%,transparent)] px-3 py-1.5 text-xs font-medium text-[var(--theme-danger)] hover:bg-[color-mix(in_srgb,var(--theme-danger)_25%,transparent)] disabled:opacity-50'
export const dangerButtonClassLarge =
  'rounded-xl border border-[color-mix(in_srgb,var(--theme-danger)_30%,transparent)] bg-[color-mix(in_srgb,var(--theme-danger)_15%,transparent)] px-4 py-2 text-sm font-medium text-[var(--theme-danger)] hover:bg-[color-mix(in_srgb,var(--theme-danger)_25%,transparent)] disabled:opacity-50'
