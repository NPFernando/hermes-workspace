/**
 * Shared color palette for sister/agent personality badges.
 *
 * Previously duplicated (and diverging) between operations-agent-card.tsx
 * and operational-worker-card.tsx — the Operations card only had colors for
 * 4 sisters and fell back to gray for the rest, even though a real color
 * was already defined here for most of them. Both screens should now show
 * the same color for the same sister.
 */
export type SisterBadgeColors = { bg: string; text: string; border: string }

export const SISTER_BADGE_COLORS: Partial<Record<string, SisterBadgeColors>> = {
  astra: { bg: 'bg-violet-500/12', text: 'text-violet-300', border: 'border-violet-400/25' },
  novus: { bg: 'bg-emerald-500/12', text: 'text-emerald-300', border: 'border-emerald-400/25' },
  nova: { bg: 'bg-sky-500/12', text: 'text-sky-300', border: 'border-sky-400/25' },
  luna: { bg: 'bg-indigo-500/12', text: 'text-indigo-300', border: 'border-indigo-400/25' },
  ada: { bg: 'bg-cyan-500/12', text: 'text-cyan-300', border: 'border-cyan-400/25' },
  maya: { bg: 'bg-lime-500/12', text: 'text-lime-300', border: 'border-lime-400/25' },
  vega: { bg: 'bg-orange-500/12', text: 'text-orange-300', border: 'border-orange-400/25' },
  atlas: { bg: 'bg-teal-500/12', text: 'text-teal-300', border: 'border-teal-400/25' },
  lyra: { bg: 'bg-purple-500/12', text: 'text-purple-300', border: 'border-purple-400/25' },
  bia: { bg: 'bg-rose-500/12', text: 'text-rose-300', border: 'border-rose-400/25' },
  keeper: { bg: 'bg-slate-500/12', text: 'text-slate-300', border: 'border-slate-400/25' },
  daiane: { bg: 'bg-yellow-500/12', text: 'text-yellow-300', border: 'border-yellow-400/25' },
  sentinel: { bg: 'bg-stone-500/12', text: 'text-stone-300', border: 'border-stone-400/25' },
  vitoria: { bg: 'bg-pink-500/12', text: 'text-pink-300', border: 'border-pink-400/25' },
  larissa: { bg: 'bg-green-500/12', text: 'text-green-300', border: 'border-green-400/25' },
  clara: { bg: 'bg-amber-500/12', text: 'text-amber-300', border: 'border-amber-400/25' },
  helena: {
    bg: 'bg-[var(--theme-card2)]',
    text: 'text-[var(--theme-muted)]',
    border: 'border-[var(--theme-border)]',
  },
  business: { bg: 'bg-amber-500/12', text: 'text-amber-300', border: 'border-amber-400/25' },
}

export const SISTER_BADGE_FALLBACK_COLORS: SisterBadgeColors = {
  bg: 'bg-primary-500/10',
  text: 'text-primary-300',
  border: 'border-primary-300/20',
}

export function sisterBadgeColors(id: string, type?: string): SisterBadgeColors {
  return (
    SISTER_BADGE_COLORS[id] ??
    (type === 'business_agent' ? SISTER_BADGE_COLORS.business : undefined) ??
    SISTER_BADGE_FALLBACK_COLORS
  )
}

/**
 * Model preference -> display tier for badges. A server-only twin of this
 * lived in src/server/sisters-registry.ts (unusable from client components
 * per this app's server/client split) and had never actually been called —
 * operations-agent-card.tsx duplicated the logic inline instead.
 */
export function sisterTierLabel(modelPreference?: string | null): string | null {
  if (!modelPreference) return null
  if (modelPreference.startsWith('local:')) return 'local'
  if (modelPreference.includes(':free')) return 'free'
  if (modelPreference.includes(':paid')) return 'paid'
  return null
}
