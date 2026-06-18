import { useQuery } from '@tanstack/react-query'
import { useNavigate } from '@tanstack/react-router'
import { Rocket01Icon, UserGroupIcon, UserMultipleIcon } from '@hugeicons/core-free-icons'
import { HugeiconsIcon } from '@hugeicons/react'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'

type SisterType = 'ai_sister' | 'business_agent' | 'delegation_profile'

type Sister = {
  id: string
  name: string
  emoji: string
  description: string
  model?: string
  role: string
  type: SisterType
  hasProfile: boolean
  isLive: boolean
  growthLevel?: number
  growthLabel?: string
  growthEmoji?: string
}

type PersonalityPreset = {
  key: string
  name: string
  label: string
  description: string
}

const TYPE_BADGE: Record<SisterType, { label: string; classes: string }> = {
  ai_sister: {
    label: 'AI Sister',
    classes: 'border-accent-500/40 bg-accent-500/10 text-accent-600',
  },
  business_agent: {
    label: 'Business',
    classes: 'border-violet-400/40 bg-violet-400/10 text-violet-600',
  },
  delegation_profile: {
    label: 'Profile',
    classes: 'border-[var(--theme-border)] bg-[var(--theme-hover)] text-[var(--theme-muted)]',
  },
}

function SisterCard({ sister, className }: { sister: Sister; className?: string }) {
  const badge = TYPE_BADGE[sister.type]

  return (
    <div
      className={cn(
        'card-glow flex flex-col gap-3 rounded-2xl border p-4 shadow-sm transition-all duration-200 hover:-translate-y-0.5 hover:shadow-md',
        sister.isLive
          ? 'border-[var(--theme-border)] bg-[var(--theme-card)]'
          : 'border-[var(--theme-border)] bg-[var(--theme-card)] opacity-60',
        className,
      )}
    >
      <div className="flex items-start gap-3">
        <div className="flex size-11 shrink-0 items-center justify-center rounded-xl border border-[var(--theme-border)] bg-[var(--theme-card2)] text-2xl shadow-sm">
          {sister.emoji}
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <p className="truncate text-sm font-semibold text-[var(--theme-text)]">{sister.name}</p>
            {!sister.isLive && (
              <span className="shrink-0 rounded-full border border-[var(--theme-border)] bg-[var(--theme-hover)] px-1.5 py-0.5 text-[10px] font-medium text-[var(--theme-muted)]">
                offline
              </span>
            )}
          </div>
          <p className="mt-0.5 truncate text-xs capitalize text-[var(--theme-muted)]">{sister.role}</p>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-1.5">
        <span
          className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] font-semibold ${badge.classes}`}
        >
          {badge.label}
        </span>

        {sister.growthLabel ? (
          <span className="inline-flex items-center gap-0.5 rounded-full border border-emerald-300/50 bg-emerald-50 px-2 py-0.5 text-[10px] font-medium text-emerald-700">
            {sister.growthEmoji ?? '🌱'} {sister.growthLabel}
          </span>
        ) : null}

        {sister.hasProfile ? (
          <span className="inline-flex items-center rounded-full border border-[var(--theme-border)] bg-[var(--theme-card2)] px-2 py-0.5 text-[10px] font-medium text-[var(--theme-muted)]">
            profile ✓
          </span>
        ) : null}
      </div>

      {sister.model ? (
        <p className="truncate text-[11px] text-[var(--theme-muted)]">{sister.model}</p>
      ) : null}

      {sister.description ? (
        <p className="line-clamp-2 text-xs text-[var(--theme-muted)]">{sister.description}</p>
      ) : null}
    </div>
  )
}

function PresetCard({ preset, className }: { preset: PersonalityPreset; className?: string }) {
  const roleLabel = preset.label.startsWith(`${preset.name} — `)
    ? preset.label.slice(preset.name.length + 4)
    : preset.label

  return (
    <div className={cn('flex flex-col gap-2 rounded-2xl border border-[var(--theme-border)] bg-[var(--theme-card)] p-4 shadow-sm transition-all duration-200 hover:-translate-y-0.5 hover:shadow-md hover:border-[var(--theme-accent)]/30', className)}>
      <div className="flex items-center gap-2">
        <span className="flex size-8 shrink-0 items-center justify-center rounded-lg border border-accent-500/30 bg-accent-500/10 text-sm font-bold text-accent-600">
          {preset.name.charAt(0)}
        </span>
        <div className="min-w-0">
          <p className="truncate text-sm font-semibold text-[var(--theme-text)]">{preset.name}</p>
          <p className="truncate text-[11px] text-[var(--theme-muted)]">{roleLabel}</p>
        </div>
      </div>
      <p className="line-clamp-2 text-xs text-[var(--theme-muted)]">{preset.description}</p>
    </div>
  )
}

function LoadingGrid() {
  return (
    <div className="flex h-24 items-center justify-center rounded-2xl border border-[var(--theme-border)] bg-[var(--theme-panel)]">
      <div className="flex items-center gap-2 text-[var(--theme-muted)]">
        <div className="spinner-accent" />
        <span className="text-sm">Loading...</span>
      </div>
    </div>
  )
}

export function AgentsScreen() {
  const navigate = useNavigate()

  const sistersQuery = useQuery({
    queryKey: ['sisters'],
    queryFn: async () => {
      const res = await fetch('/api/sisters')
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const data = (await res.json()) as { ok: boolean; sisters?: Array<Sister> }
      return data.sisters ?? []
    },
    staleTime: 30_000,
    retry: 1,
  })

  const presetsQuery = useQuery({
    queryKey: ['personality-swarm'],
    queryFn: async () => {
      const res = await fetch('/api/personality-swarm')
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const data = (await res.json()) as { ok: boolean; presets?: Array<PersonalityPreset> }
      return data.presets ?? []
    },
    staleTime: 60_000,
    retry: 1,
  })

  const sisters = sistersQuery.data ?? []
  const presets = presetsQuery.data ?? []

  const aiSisters = sisters.filter((s) => s.type === 'ai_sister')
  const businessAgents = sisters.filter((s) => s.type === 'business_agent')
  const profiles = sisters.filter((s) => s.type === 'delegation_profile')

  return (
    <main data-route-page className="min-h-full bg-surface px-4 pb-24 pt-5 text-[var(--theme-text)] md:px-6 md:pt-8">
      <section className="mx-auto w-full max-w-[1480px] space-y-6">

        {/* Header */}
        <header className="flex flex-col gap-4 rounded-xl border border-[var(--theme-border)] bg-[var(--theme-panel)] px-5 py-4 shadow-sm md:flex-row md:items-center md:justify-between">
          <div className="flex items-start gap-3">
            <div className="flex size-11 items-center justify-center rounded-xl border border-accent-500/30 bg-accent-500/10 text-accent-500">
              <HugeiconsIcon icon={UserGroupIcon} size={24} strokeWidth={1.6} />
            </div>
            <div>
              <h1 className="text-base font-semibold text-[var(--theme-text)]">Agent Team</h1>
              <p className="mt-1 text-sm text-[var(--theme-muted)]">
                {sisters.length > 0
                  ? `${sisters.length} configured · ${aiSisters.length} AI sisters · ${presets.length} swarm roles`
                  : 'Your configured sisters, agents, and swarm personality roster'}
              </p>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <Button
              variant="secondary"
              className="border border-[var(--theme-border)] bg-[var(--theme-card)] text-[var(--theme-muted)] hover:bg-[var(--theme-panel)]"
              onClick={() => void navigate({ to: '/operations' })}
            >
              <HugeiconsIcon icon={UserMultipleIcon} size={16} strokeWidth={1.8} />
              Operations
            </Button>
            <Button
              className="bg-accent-500 text-[var(--theme-text)] hover:bg-accent-400"
              onClick={() => void navigate({ to: '/conductor' })}
            >
              <HugeiconsIcon icon={Rocket01Icon} size={16} strokeWidth={1.8} />
              Conductor
            </Button>
          </div>
        </header>

        {/* AI Sisters */}
        <section className="space-y-3">
          <div className="flex items-center justify-between px-1">
            <h2 className="micro-label">
              AI Sisters
            </h2>
            <span className="text-[10px] font-medium text-[var(--theme-muted)]">{aiSisters.length}</span>
          </div>

          {sistersQuery.isLoading ? (
            <LoadingGrid />
          ) : sistersQuery.isError ? (
            <div className="rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
              {sistersQuery.error instanceof Error
                ? sistersQuery.error.message
                : 'Failed to load sisters'}
            </div>
          ) : aiSisters.length === 0 ? (
            <div className="rounded-2xl border border-[var(--theme-border)] bg-[var(--theme-panel)] px-4 py-6 text-sm text-[var(--theme-muted)]">
              No AI sisters configured. Add them in{' '}
              <code className="rounded bg-[var(--theme-hover)] px-1 text-xs">
                ~/.hermes/config/sisters.yaml
              </code>
              .
            </div>
          ) : (
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
              {aiSisters.map((sister) => (
                <SisterCard key={sister.id} sister={sister} className="domino-item" />
              ))}
            </div>
          )}
        </section>

        {/* Business Agents */}
        {businessAgents.length > 0 ? (
          <section className="space-y-3">
            <div className="flex items-center justify-between px-1">
              <h2 className="micro-label">
                Business Agents
              </h2>
              <span className="text-[10px] font-medium text-[var(--theme-muted)]">
                {businessAgents.length}
              </span>
            </div>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
              {businessAgents.map((sister) => (
                <SisterCard key={sister.id} sister={sister} className="domino-item" />
              ))}
            </div>
          </section>
        ) : null}

        {/* Delegation Profiles */}
        {profiles.length > 0 ? (
          <section className="space-y-3">
            <div className="flex items-center justify-between px-1">
              <h2 className="micro-label">
                Delegation Profiles
              </h2>
              <span className="text-[10px] font-medium text-[var(--theme-muted)]">{profiles.length}</span>
            </div>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
              {profiles.map((sister) => (
                <SisterCard key={sister.id} sister={sister} className="domino-item" />
              ))}
            </div>
          </section>
        ) : null}

        {/* Swarm Personality Roster */}
        <section className="space-y-3">
          <div className="flex items-center justify-between px-1">
            <h2 className="micro-label">
              Swarm Personality Roster
            </h2>
            <span className="text-[10px] font-medium text-[var(--theme-muted)]">{presets.length}</span>
          </div>
          <p className="px-1 text-xs text-[var(--theme-muted)]">
            Named roles assigned to swarm workers during multi-agent missions. Dispatch via
            Conductor.
          </p>

          {presetsQuery.isLoading ? (
            <LoadingGrid />
          ) : presetsQuery.isError ? (
            <div className="rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
              {presetsQuery.error instanceof Error
                ? presetsQuery.error.message
                : 'Failed to load presets'}
            </div>
          ) : (
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5">
              {presets.map((preset) => (
                <PresetCard key={preset.key} preset={preset} className="domino-item" />
              ))}
            </div>
          )}
        </section>

      </section>
    </main>
  )
}
