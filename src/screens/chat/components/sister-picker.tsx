import { cn } from '@/lib/utils'

export type SisterOption = {
  id: string
  name: string
  emoji: string
  description: string
  systemPrompt?: string
  /** Registry type — delegation profiles can share a display name with an AI sister */
  type?: 'ai_sister' | 'business_agent' | 'delegation_profile'
  role?: string
}

type SisterPickerProps = {
  sisters: Array<SisterOption>
  selectedId: string | null
  autoSelectedId?: string | null
  orchestrating?: boolean
  orchestratingSisterIds?: Array<string>
  onSelect: (id: string | null) => void
}

/**
 * Hide delegation-profile entries whose display name collides with an AI
 * sister (e.g. the "researcher" profile is also named Luna) — in the picker
 * they read as duplicate pills. The full list still flows everywhere else
 * (auto-routing addresses delegation profiles by id), and a hidden profile
 * reappears while it is selected, auto-routed, or being orchestrated so the
 * active state stays visible.
 */
export function dedupeSistersForPicker(
  sisters: Array<SisterOption>,
  keepIds?: ReadonlySet<string>,
): Array<SisterOption> {
  const aiSisterNames = new Set(
    sisters
      .filter((s) => s.type !== 'delegation_profile' && s.type !== 'business_agent')
      .map((s) => s.name.toLowerCase()),
  )
  return sisters.filter(
    (s) =>
      s.type !== 'delegation_profile' ||
      !aiSisterNames.has(s.name.toLowerCase()) ||
      keepIds?.has(s.id),
  )
}

export function SisterPicker({
  sisters,
  selectedId,
  autoSelectedId,
  orchestrating,
  orchestratingSisterIds,
  onSelect,
}: SisterPickerProps) {
  const activeIds = new Set<string>(
    [selectedId, autoSelectedId, ...(orchestratingSisterIds ?? [])].filter(
      (id): id is string => Boolean(id),
    ),
  )
  const visibleSisters = dedupeSistersForPicker(sisters, activeIds)
  if (visibleSisters.length === 0) return null

  const hasOverride = Boolean(selectedId || autoSelectedId)

  return (
    <div className="flex items-center gap-1 px-2 py-1 flex-wrap">
      <span className="text-xs text-muted-foreground mr-1 shrink-0">Agent:</span>
      {orchestrating && !orchestratingSisterIds?.length && (
        <span className="text-xs text-muted-foreground animate-pulse mr-1">🌟 Astra orchestrating…</span>
      )}
      {visibleSisters.map((s) => {
        const isManual = selectedId === s.id
        const isAuto = !isManual && autoSelectedId === s.id
        const isOrchestrating = orchestrating && orchestratingSisterIds?.includes(s.id)
        // Delegation profiles can share a display name with an AI sister
        // (e.g. the "researcher" profile is also named Luna) — surface the
        // profile role so the two pills are distinguishable.
        const isProfile = s.type === 'delegation_profile'
        const fullName = isProfile && s.role ? `${s.name} (${s.role} profile)` : s.name
        return (
          <button
            key={s.id}
            type="button"
            title={
              isOrchestrating
                ? `${fullName} — being consulted by Astra`
                : isAuto
                  ? `${fullName} (auto-selected) — ${s.description}`
                  : `${fullName} — ${s.description}`
            }
            onClick={() => onSelect(selectedId === s.id ? null : s.id)}
            className={cn(
              'flex items-center gap-1 px-2 py-0.5 rounded-full text-xs transition-colors border',
              isManual && 'bg-primary/10 border-primary/30 text-primary font-medium',
              isOrchestrating && 'bg-amber-500/10 border-amber-500/40 text-amber-600 dark:text-amber-400 animate-pulse',
              isAuto && !isOrchestrating && 'bg-muted border-dashed border-muted-foreground/40 text-foreground',
              !isManual && !isAuto && !isOrchestrating && 'border-transparent text-muted-foreground hover:text-foreground hover:bg-muted hover:border-border',
            )}
          >
            <span>{s.emoji}</span>
            <span>{s.name}</span>
            {isProfile && s.role && (
              <span className="text-[9px] opacity-60">· {s.role}</span>
            )}
            {isAuto && !isOrchestrating && <span className="text-[9px] opacity-60 ml-0.5">auto</span>}
            {isOrchestrating && <span className="text-[9px] opacity-70 ml-0.5">✦</span>}
          </button>
        )
      })}
      {hasOverride && (
        <button
          type="button"
          onClick={() => onSelect(null)}
          className="text-xs text-muted-foreground hover:text-foreground ml-1 px-1"
          title="Reset to auto-routing"
        >
          ✕
        </button>
      )}
    </div>
  )
}
