import { useEffect, useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useNavigate } from '@tanstack/react-router'
import { Chat01Icon, Rocket01Icon, Settings01Icon } from '@hugeicons/core-free-icons'
import { HugeiconsIcon } from '@hugeicons/react'
import { AgentBusPanel } from '@/screens/agents/components/agent-bus-panel'
import { getOperationsSessionKey, useOperations } from '@/screens/agents/hooks/use-operations'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { formatRelativeTime } from '@/screens/dashboard/lib/formatters'

// ── types ────────────────────────────────────────────────────────────────────

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

type AgentBusHealth = {
  ok?: boolean
  issues?: Array<unknown>
  status?: { summary?: { total?: number; down?: number; events?: number } }
}

// ── constants ─────────────────────────────────────────────────────────────────

const TYPE_BADGE: Record<SisterType, { label: string; classes: string }> = {
  ai_sister: {
    label: 'AI Sister',
    classes: 'border-accent-500/40 bg-accent-500/10 text-accent-600',
  },
  business_agent: {
    label: 'Business',
    classes: 'border-violet-400/40 bg-violet-400/10 text-violet-400',
  },
  delegation_profile: {
    label: 'Profile',
    classes: 'border-[var(--theme-border)] bg-[var(--theme-hover)] text-[var(--theme-muted)]',
  },
}

// ── sub-components ────────────────────────────────────────────────────────────

function StatTile({
  label,
  value,
  tone = 'neutral',
}: {
  label: string
  value: string | number
  tone?: 'neutral' | 'good' | 'warn' | 'bad'
}) {
  return (
    <div
      className={cn(
        'flex min-w-[80px] flex-col items-center gap-0.5 rounded-xl border px-3 py-2',
        tone === 'good' && 'border-emerald-400/40 bg-[var(--theme-card)]',
        tone === 'warn' && 'border-amber-400/40 bg-[var(--theme-card)]',
        tone === 'bad' && 'border-red-400/40 bg-[var(--theme-card)]',
        tone === 'neutral' && 'border-[var(--theme-border)] bg-[var(--theme-card)]',
      )}
    >
      <span
        className={cn(
          'text-lg font-bold leading-none',
          tone === 'good' && 'text-emerald-500',
          tone === 'warn' && 'text-amber-500',
          tone === 'bad' && 'text-red-500',
          tone === 'neutral' && 'text-[var(--theme-text)]',
        )}
      >
        {value}
      </span>
      <span className="micro-label">
        {label}
      </span>
    </div>
  )
}

function SisterCard({ sister, onChat, className }: { sister: Sister; onChat: () => void; className?: string }) {
  const badge = TYPE_BADGE[sister.type]
  return (
    <div
      className={cn(
        'group flex flex-col gap-3 rounded-2xl border p-4 shadow-sm transition-all duration-200 hover:-translate-y-0.5 hover:shadow-md',
        sister.isLive
          ? 'border-[var(--theme-border)] bg-[var(--theme-card)] hover:border-[var(--theme-accent)]/30'
          : 'border-[var(--theme-border)] bg-[var(--theme-panel)] opacity-70',
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
        <span className={cn('inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] font-semibold', badge.classes)}>
          {badge.label}
        </span>
        {sister.growthLabel ? (
          <span className="inline-flex items-center gap-0.5 rounded-full border border-emerald-400/40 bg-[var(--theme-card2)] px-2 py-0.5 text-[10px] font-medium text-emerald-500">
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
      {sister.hasProfile && (
        <button
          type="button"
          onClick={onChat}
          className="mt-auto flex items-center gap-1.5 self-start rounded-lg border border-[var(--theme-border)] bg-[var(--theme-bg)] px-2.5 py-1.5 text-[11px] font-medium text-[var(--theme-muted)] opacity-0 transition-opacity group-hover:opacity-100 [@media(hover:none)]:opacity-100 touch-manipulation hover:border-accent-500/40 hover:bg-accent-500/5 hover:text-accent-600"
        >
          <HugeiconsIcon icon={Chat01Icon} size={12} strokeWidth={2} />
          Chat
        </button>
      )}
    </div>
  )
}

function PresetCard({ preset, className }: { preset: PersonalityPreset; className?: string }) {
  const sep = ' — '
  const roleLabel = preset.label.startsWith(`${preset.name}${sep}`)
    ? preset.label.slice(preset.name.length + sep.length)
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

function SectionHeader({ title, count }: { title: string; count: number }) {
  return (
    <div className="flex items-center justify-between px-1">
      <h2 className="text-[11px] font-bold uppercase tracking-widest text-[var(--theme-muted)]">{title}</h2>
      <span className="text-[11px] font-medium text-[var(--theme-muted)]">{count}</span>
    </div>
  )
}

function Spinner() {
  return (
    <div className="flex h-24 items-center justify-center rounded-2xl border border-[var(--theme-border)] bg-[var(--theme-panel)]">
      <div className="spinner-accent" />
    </div>
  )
}

// ── main screen ───────────────────────────────────────────────────────────────

export function CommandCenterScreen() {
  const navigate = useNavigate()

  // Sisters + presets
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

  // Operations data (profiles, sessions, cron, recent activity)
  const {
    agents,
    sessionsQuery,
    cronJobsQuery,
    recentActivity,
  } = useOperations()

  // Agent bus health (polled)
  const [agentBus, setAgentBus] = useState<AgentBusHealth | null>(null)
  const [agentBusPending, setAgentBusPending] = useState(true)
  const [agentBusError, setAgentBusError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    async function poll() {
      setAgentBusPending(true)
      try {
        const res = await fetch('/api/agent-bus', { headers: { Accept: 'application/json' } })
        if (!res.ok) throw new Error(`HTTP ${res.status}`)
        const payload = (await res.json()) as AgentBusHealth
        if (!cancelled) { setAgentBus(payload); setAgentBusError(null) }
      } catch (err) {
        if (!cancelled) setAgentBusError(err instanceof Error ? err.message : 'Agent Bus error')
      } finally {
        if (!cancelled) setAgentBusPending(false)
      }
    }
    void poll()
    const timer = window.setInterval(() => void poll(), 30_000)
    return () => { cancelled = true; window.clearInterval(timer) }
  }, [])

  // Derived data
  const sisters = sistersQuery.data ?? []
  const presets = presetsQuery.data ?? []
  const aiSisters = sisters.filter((s) => s.type === 'ai_sister')
  const businessAgents = sisters.filter((s) => s.type === 'business_agent')
  const delegationProfiles = sisters.filter((s) => s.type === 'delegation_profile')
  const sessionCount = sessionsQuery.data?.length ?? 0
  const cronCount = cronJobsQuery.data?.length ?? 0
  const agentBusIssues = agentBus?.issues?.length ?? agentBus?.status?.summary?.down ?? 0
  const busTotal = agentBus?.status?.summary?.total ?? 0

  const latestActivity = useMemo(
    () => recentActivity.slice(0, 8),
    [recentActivity],
  )

  return (
    <main data-route-page className="min-h-full bg-surface px-4 pb-24 pt-5 text-[var(--theme-text)] md:px-6 md:pt-8">
      <section className="mx-auto w-full max-w-[1480px] space-y-6">

        {/* ── Header ── */}
        <header className="flex flex-col gap-4 rounded-xl border border-[var(--theme-border)] bg-[var(--theme-panel)] px-5 py-4 shadow-sm md:flex-row md:items-center md:justify-between">
          <div className="flex items-start gap-3">
            <div className="flex size-11 items-center justify-center rounded-xl border border-accent-500/30 bg-accent-500/10 text-2xl">
              🌟
            </div>
            <div>
              <h1 className="text-base font-semibold text-[var(--theme-text)]">Command Center</h1>
              <p className="mt-1 text-sm text-[var(--theme-muted)]">
                {sisters.length > 0
                  ? `${sisters.length} agents · ${aiSisters.length} AI sisters · ${presets.length} swarm roles`
                  : 'Unified agent roster and operations dashboard'}
              </p>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-3">
            {/* Stats strip */}
            <div className="flex flex-wrap gap-2">
              <StatTile label="Agents" value={agents.length} />
              <StatTile label="Sessions" value={sessionCount} />
              <StatTile label="Cron" value={cronCount} />
              <StatTile label="Sisters" value={sisters.length} />
              <StatTile
                label="Bus"
                value={agentBusPending ? '…' : agentBusError ? '!' : `${busTotal}`}
                tone={agentBusPending ? 'neutral' : agentBusError ? 'bad' : busTotal === 0 ? 'neutral' : agentBusIssues > 0 ? 'warn' : 'good'}
              />
            </div>
            <Button
              className="bg-accent-500 text-[var(--theme-text)] hover:bg-accent-400"
              onClick={() => void navigate({ to: '/conductor' })}
            >
              <HugeiconsIcon icon={Rocket01Icon} size={16} strokeWidth={1.8} />
              Conductor
            </Button>
            <Button
              variant="secondary"
              className="border border-[var(--theme-border)] bg-[var(--theme-card)] text-[var(--theme-muted)] hover:bg-[var(--theme-panel)]"
              onClick={() => void navigate({ to: '/settings' })}
            >
              <HugeiconsIcon icon={Settings01Icon} size={16} strokeWidth={1.8} />
              Settings
            </Button>
          </div>
        </header>

        {/* ── AI Sisters ── */}
        <section className="space-y-3">
          <SectionHeader title="AI Sisters" count={aiSisters.length} />
          {sistersQuery.isLoading ? (
            <Spinner />
          ) : aiSisters.length === 0 ? (
            <p className="rounded-2xl border border-[var(--theme-border)] bg-[var(--theme-panel)] px-4 py-6 text-sm text-[var(--theme-muted)]">
              No AI sisters configured.{' '}
              <code className="rounded bg-[var(--theme-hover)] px-1 text-xs">~/.hermes/config/sisters.yaml</code>
            </p>
          ) : (
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
              {aiSisters.map((s) => (
                <SisterCard
                  key={s.id}
                  sister={s}
                  className="domino-item"
                  onChat={() => void navigate({ to: '/chat/$sessionKey', params: { sessionKey: getOperationsSessionKey(s.id) } })}
                />
              ))}
            </div>
          )}
        </section>

        {/* ── Business Agents ── */}
        {businessAgents.length > 0 && (
          <section className="space-y-3">
            <SectionHeader title="Business Agents" count={businessAgents.length} />
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
              {businessAgents.map((s) => (
                <SisterCard
                  key={s.id}
                  sister={s}
                  className="domino-item"
                  onChat={() => void navigate({ to: '/chat/$sessionKey', params: { sessionKey: getOperationsSessionKey(s.id) } })}
                />
              ))}
            </div>
          </section>
        )}

        {/* ── Delegation Profiles ── */}
        {delegationProfiles.length > 0 && (
          <section className="space-y-3">
            <SectionHeader title="Delegation Profiles" count={delegationProfiles.length} />
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
              {delegationProfiles.map((s) => (
                <SisterCard
                  key={s.id}
                  sister={s}
                  className="domino-item"
                  onChat={() => void navigate({ to: '/chat/$sessionKey', params: { sessionKey: getOperationsSessionKey(s.id) } })}
                />
              ))}
            </div>
          </section>
        )}

        {/* ── Swarm Personality Roster ── */}
        <section className="space-y-3">
          <SectionHeader title="Swarm Personality Roster" count={presets.length} />
          <p className="px-1 text-xs text-[var(--theme-muted)]">
            Named roles assigned to swarm workers during multi-agent missions. Dispatch via Conductor.
          </p>
          {presetsQuery.isLoading ? (
            <Spinner />
          ) : (
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5">
              {presets.map((p) => <PresetCard key={p.key} preset={p} className="domino-item" />)}
            </div>
          )}
        </section>

        {/* ── Bottom strip: Agent Bus + Recent Activity ── */}
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
          {/* Agent Bus */}
          <section className="space-y-3">
            <SectionHeader title="Agent Bus" count={busTotal} />
            <AgentBusPanel />
          </section>

          {/* Recent Activity */}
          <section className="space-y-3">
            <SectionHeader title="Recent Activity" count={latestActivity.length} />
            {latestActivity.length === 0 ? (
              <p className="rounded-2xl border border-[var(--theme-border)] bg-[var(--theme-panel)] px-4 py-6 text-sm text-[var(--theme-muted)]">
                No recent activity yet.
              </p>
            ) : (
              <ul className="space-y-2">
                {latestActivity.map((item) => (
                  <li
                    key={item.id}
                    className="domino-item flex items-start gap-3 rounded-xl border border-[var(--theme-border)] bg-[var(--theme-card)] px-4 py-3 shadow-sm transition-all hover:-translate-y-px hover:shadow-md"
                  >
                    <span
                      className={cn(
                        'mt-0.5 shrink-0 rounded-full border px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wider',
                        item.source === 'cron'
                          ? 'border-violet-300/50 bg-violet-50 text-violet-600'
                          : 'border-[var(--theme-border)] bg-[var(--theme-panel)] text-[var(--theme-muted)]',
                      )}
                    >
                      {item.source}
                    </span>
                    <div className="min-w-0 flex-1">
                      <p className="line-clamp-2 text-xs text-[var(--theme-muted)]">{item.summary}</p>
                      <p className="mt-0.5 text-[10px] text-[var(--theme-muted)]">
                        {item.agentId} · {formatRelativeTime(item.timestamp)}
                      </p>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>

      </section>
    </main>
  )
}
