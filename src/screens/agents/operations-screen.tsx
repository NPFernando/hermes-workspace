import {  useEffect, useMemo, useState } from 'react'
import { motion } from 'motion/react'
import {
  AiBrain03Icon,
  Settings01Icon,
} from '@hugeicons/core-free-icons'
import { HugeiconsIcon } from '@hugeicons/react'
import { seedAgentPresets } from './agent-presets'
import { OrchestratorCard } from './components/orchestrator-card'
import { OperationsAgentCard } from './components/operations-agent-card'
import { OperationsAgentDetail } from './components/operations-agent-detail'
import { OperationsSettingsModal } from './components/operations-settings-modal'
import { FullOutputsView } from './components/full-outputs-view'
import { AgentBusPanel } from './components/agent-bus-panel'
import { useOperations } from './hooks/use-operations'
import type {CSSProperties} from 'react';
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { formatRelativeTime } from '@/screens/dashboard/lib/formatters'

type AgentBusHealth = {
  ok?: boolean
  issues?: Array<unknown>
  status?: {
    summary?: {
      total?: number
      down?: number
      events?: number
    }
  }
}

type HealthTone = 'good' | 'warn' | 'bad' | 'loading'

function HealthTile({
  label,
  value,
  detail,
  tone,
}: {
  label: string
  value: string
  detail: string
  tone: HealthTone
}) {
  return (
    <div
      className={cn(
        'rounded-2xl border px-4 py-3',
        tone === 'good' && 'border-emerald-400/40 bg-[var(--theme-card)] text-emerald-500',
        tone === 'warn' && 'border-amber-400/40 bg-[var(--theme-card)] text-amber-500',
        tone === 'bad' && 'border-red-400/40 bg-[var(--theme-card)] text-red-500',
        tone === 'loading' && 'border-[var(--theme-border)] bg-[var(--theme-bg)] text-[var(--theme-muted)]',
      )}
    >
      <div className="text-sm font-semibold">{label}</div>
      <div className="mt-2 text-2xl font-bold leading-none terminal-glow-soft">{value}</div>
      <div className="mt-1 text-xs opacity-70">{detail}</div>
    </div>
  )
}

function OperationsHealthSummary({
  configPending,
  configError,
  profilesCount,
  sessionsPending,
  sessionsError,
  sessionsCount,
  cronPending,
  cronError,
  cronCount,
  sistersPending,
  sistersError,
  sistersCount,
  agentBus,
  agentBusPending,
  agentBusError,
  lastChecked,
}: {
  configPending: boolean
  configError: unknown
  profilesCount: number
  sessionsPending: boolean
  sessionsError: unknown
  sessionsCount: number
  cronPending: boolean
  cronError: unknown
  cronCount: number
  sistersPending: boolean
  sistersError: unknown
  sistersCount: number
  agentBus: AgentBusHealth | null
  agentBusPending: boolean
  agentBusError: string | null
  lastChecked: number | null
}) {
  const agentBusIssues = agentBus?.issues?.length ?? agentBus?.status?.summary?.down ?? 0
  const checkedLabel = lastChecked ? `Last checked ${formatRelativeTime(lastChecked)}` : 'Waiting for first check'

  return (
    <section className="rounded-3xl border border-[var(--theme-border)] bg-[var(--theme-card)] p-5 shadow-[0_24px_80px_var(--theme-shadow)]">
      <div className="flex flex-col gap-2 md:flex-row md:items-end md:justify-between">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.14em] text-[var(--theme-accent-strong)]">
            Operations Health
          </p>
          <h2 className="mt-1 text-lg font-semibold text-[var(--theme-text)]">
            Control plane readiness
          </h2>
          <p className="mt-1 text-sm text-[var(--theme-muted-2)]">
            Live checks for profiles, sessions, cron, sisters, and Agent Bus.
          </p>
        </div>
        <span className="text-xs text-[var(--theme-muted)]">{checkedLabel}</span>
      </div>

      <div className="mt-5 grid grid-cols-2 gap-3 md:grid-cols-5">
        <HealthTile
          label="Profiles"
          value={configPending ? '…' : String(profilesCount)}
          detail={configError ? 'Config API failed' : 'loaded from profiles'}
          tone={configPending ? 'loading' : configError ? 'bad' : 'good'}
        />
        <HealthTile
          label="Sessions"
          value={sessionsPending ? '…' : String(sessionsCount)}
          detail={sessionsError ? 'Gateway sessions failed' : 'activity source'}
          tone={sessionsPending ? 'loading' : sessionsError ? 'bad' : 'good'}
        />
        <HealthTile
          label="Cron"
          value={cronPending ? '…' : String(cronCount)}
          detail={cronError ? 'Cron API failed' : 'scheduled jobs'}
          tone={cronPending ? 'loading' : cronError ? 'bad' : 'good'}
        />
        <HealthTile
          label="Sisters"
          value={sistersPending ? '…' : String(sistersCount)}
          detail={sistersError ? 'Registry failed' : 'registry entries'}
          tone={sistersPending ? 'loading' : sistersError ? 'bad' : 'good'}
        />
        <HealthTile
          label="Agent Bus"
          value={agentBusPending ? '…' : String(agentBus?.status?.summary?.total ?? 0)}
          detail={agentBusError ? agentBusError : `${agentBusIssues} issue${agentBusIssues === 1 ? '' : 's'}`}
          tone={agentBusPending ? 'loading' : agentBusError ? 'bad' : agentBusIssues > 0 ? 'warn' : 'good'}
        />
      </div>
    </section>
  )
}

export const THEME_STYLE: CSSProperties = {
  ['--theme-bg' as string]: 'var(--color-surface)',
  ['--theme-card' as string]: 'var(--color-primary-50)',
  ['--theme-card2' as string]: 'var(--color-primary-100)',
  ['--theme-border' as string]: 'var(--color-primary-200)',
  ['--theme-border2' as string]: 'var(--color-primary-400)',
  ['--theme-text' as string]: 'var(--color-ink)',
  ['--theme-muted' as string]: 'var(--color-primary-700)',
  ['--theme-muted-2' as string]: 'var(--color-primary-600)',
  ['--theme-accent' as string]: 'var(--color-accent-500)',
  ['--theme-accent-strong' as string]: 'var(--color-accent-600)',
  ['--theme-accent-soft' as string]: 'color-mix(in srgb, var(--color-accent-500) 12%, transparent)',
  ['--theme-accent-soft-strong' as string]: 'color-mix(in srgb, var(--color-accent-500) 18%, transparent)',
  ['--theme-shadow' as string]: 'color-mix(in srgb, var(--color-primary-950) 14%, transparent)',
  ['--theme-danger' as string]: 'var(--color-red-600, #dc2626)',
  ['--theme-danger-soft' as string]: 'color-mix(in srgb, var(--theme-danger) 12%, transparent)',
  ['--theme-danger-soft-strong' as string]: 'color-mix(in srgb, var(--theme-danger) 18%, transparent)',
  ['--theme-danger-border' as string]: 'color-mix(in srgb, var(--theme-danger) 35%, white)',
  ['--theme-warning' as string]: 'var(--color-amber-600, #d97706)',
  ['--theme-warning-soft' as string]: 'color-mix(in srgb, var(--theme-warning) 12%, transparent)',
  ['--theme-warning-soft-strong' as string]: 'color-mix(in srgb, var(--theme-warning) 18%, transparent)',
  ['--theme-warning-border' as string]: 'color-mix(in srgb, var(--theme-warning) 35%, white)',
}

export function OperationsScreen() {
  useEffect(() => { seedAgentPresets() }, [])
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [settingsAgentId, setSettingsAgentId] = useState<string | null>(null)
  const [view, setView] = useState<'overview' | 'outputs'>('overview')
  const [agentBusHealth, setAgentBusHealth] = useState<AgentBusHealth | null>(null)
  const [agentBusError, setAgentBusError] = useState<string | null>(null)
  const [agentBusPending, setAgentBusPending] = useState(true)
  const [healthLastChecked, setHealthLastChecked] = useState<number | null>(null)
  const {
    agents,
    recentActivity,
    configQuery,
    sessionsQuery,
    cronJobsQuery,
    sisterMap,
    sistersQuery,
    settings,
    saveSettings,
    defaultModel,
    saveAgent,
    isSavingAgent,
    deleteAgent,
    isDeletingAgent,
  } = useOperations()

  useEffect(() => {
    let cancelled = false

    async function loadAgentBusHealth() {
      setAgentBusPending(true)
      try {
        const response = await fetch('/api/agent-bus', {
          headers: { Accept: 'application/json' },
        })
        if (!response.ok) throw new Error(`HTTP ${response.status}`)
        const payload = (await response.json()) as AgentBusHealth
        if (cancelled) return
        setAgentBusHealth(payload)
        setAgentBusError(null)
      } catch (err) {
        if (cancelled) return
        setAgentBusError(err instanceof Error ? err.message : 'Agent Bus failed')
      } finally {
        if (!cancelled) {
          setAgentBusPending(false)
          setHealthLastChecked(Date.now())
        }
      }
    }

    void loadAgentBusHealth()
    const timer = window.setInterval(() => void loadAgentBusHealth(), 30_000)
    return () => {
      cancelled = true
      window.clearInterval(timer)
    }
  }, [])

  // Split: AI sisters + delegation profiles first (sorted by priority), then others
  const { sisterAgents } = useMemo(() => {
    const si: typeof agents = []
    const ot: typeof agents = []
    for (const agent of agents) {
      if (sisterMap[agent.id]) si.push(agent)
      else ot.push(agent)
    }
    si.sort((a, b) => {
      const pa = sisterMap[a.id]?.priority ?? 99
      const pb = sisterMap[b.id]?.priority ?? 99
      return pa - pb
    })
    return { sisterAgents: si }
  }, [agents, sisterMap])
  const rosterEntries = useMemo(
    () =>
      [...(sistersQuery.data ?? [])].sort(
        (left, right) => (left.priority ?? 99) - (right.priority ?? 99),
      ),
    [sistersQuery.data],
  )

  const isLoading =
    configQuery.isPending || sessionsQuery.isPending || cronJobsQuery.isPending
  const error =
    (configQuery.error instanceof Error && configQuery.error.message) ||
    (sessionsQuery.error instanceof Error && sessionsQuery.error.message) ||
    (cronJobsQuery.error instanceof Error && cronJobsQuery.error.message) ||
    null
  const settingsAgent = agents.find((agent) => agent.id === settingsAgentId) ?? null

  return (
    <main
      data-route-page
      className="min-h-full bg-surface px-3 pb-24 pt-5 text-primary-900 md:px-5 md:pt-8"
      style={THEME_STYLE}
    >
      <section className="mx-auto w-full max-w-[1320px] space-y-4">
        <header className="flex flex-col gap-4 rounded-xl border border-primary-200 bg-primary-50/80 px-5 py-4 shadow-sm md:flex-row md:items-center md:justify-between">
          <div className="flex items-center gap-3">
            <div className="flex h-11 w-11 items-center justify-center rounded-2xl border border-[var(--theme-border)] bg-[var(--theme-card)] text-[var(--theme-accent)] shadow-sm">
              <HugeiconsIcon icon={AiBrain03Icon} size={22} strokeWidth={1.8} />
            </div>
            <div>
              <h1 className="text-base font-semibold text-primary-900">Operations</h1>
              <p className="mt-1 text-sm text-primary-600">
                Your persistent agent team
              </p>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <div className="inline-flex rounded-xl border border-[var(--theme-border)] bg-[var(--theme-card)] p-1 shadow-sm">
              <button
                type="button"
                onClick={() => setView('overview')}
                className={cn(
                  'rounded-lg px-4 py-2 text-sm font-medium transition-all',
                  view === 'overview'
                    ? 'bg-[var(--theme-accent)] text-primary-950'
                    : 'text-[var(--theme-muted)] hover:bg-[var(--theme-card2)]',
                )}
              >
                Overview
              </button>
              <button
                type="button"
                onClick={() => setView('outputs')}
                className={cn(
                  'rounded-lg px-4 py-2 text-sm font-medium transition-all',
                  view === 'outputs'
                    ? 'bg-[var(--theme-accent)] text-primary-950'
                    : 'text-[var(--theme-muted)] hover:bg-[var(--theme-card2)]',
                )}
              >
                Outputs
              </button>
            </div>
            <Button
              variant="secondary"
              className="border border-[var(--theme-border)] bg-[var(--theme-card)] text-[var(--theme-text)] hover:bg-[var(--theme-card2)]"
              onClick={() => setSettingsOpen(true)}
            >
              <HugeiconsIcon icon={Settings01Icon} size={16} strokeWidth={1.8} />
              Settings
            </Button>
          </div>
        </header>

        {isLoading ? (
          <section className="rounded-3xl border border-[var(--theme-border)] bg-[var(--theme-card)] px-6 py-12 text-center text-sm text-[var(--theme-muted)] shadow-[0_24px_80px_var(--theme-shadow)]">
            Loading Operations roster…
          </section>
        ) : error ? (
          <section className="rounded-3xl border border-[var(--theme-danger-border)] bg-[var(--theme-danger-soft)] px-6 py-12 text-center text-sm text-[var(--theme-text)] shadow-[0_24px_80px_var(--theme-shadow)]">
            {error}
          </section>
        ) : view === 'outputs' ? (
          <FullOutputsView />
        ) : (
          <>
            <motion.div
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.25 }}
            >
              <OrchestratorCard
                totalAgents={sisterAgents.length}
                sisterCount={sisterAgents.length}
              />
            </motion.div>

            <motion.div
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.05, duration: 0.25 }}
            >
              <OperationsHealthSummary
                configPending={configQuery.isPending}
                configError={configQuery.error}
                profilesCount={sisterAgents.length}
                sessionsPending={sessionsQuery.isPending}
                sessionsError={sessionsQuery.error}
                sessionsCount={sessionsQuery.data?.length ?? 0}
                cronPending={cronJobsQuery.isPending}
                cronError={cronJobsQuery.error}
                cronCount={cronJobsQuery.data?.length ?? 0}
                sistersPending={sistersQuery.isPending}
                sistersError={sistersQuery.error}
                sistersCount={sistersQuery.data?.length ?? 0}
                agentBus={agentBusHealth}
                agentBusPending={agentBusPending}
                agentBusError={agentBusError}
                lastChecked={healthLastChecked}
              />
            </motion.div>

            <motion.div
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.1, duration: 0.25 }}
            >
              <AgentBusPanel />
            </motion.div>

            {sisterAgents.length > 0 ? (
              <div className="space-y-3">
                <div className="flex items-center gap-2 px-1">
                  <span className="text-xs font-semibold uppercase tracking-[0.12em] text-[var(--theme-accent)]">AI Sisters</span>
                  <span className="h-px flex-1 bg-[var(--theme-accent)]/20" />
                  <span className="text-[10px] text-[var(--theme-muted)]">{sisterAgents.length} active</span>
                </div>
                <section className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
                  {sisterAgents.map((agent, index) => (
                    <motion.div
                      key={agent.id}
                      initial={{ opacity: 0, y: 12 }}
                      animate={{ opacity: 1, y: 0 }}
                      transition={{ delay: index * 0.04, duration: 0.22 }}
                    >
                      <OperationsAgentCard
                        agent={agent}
                        sisterInfo={sisterMap[agent.id]}
                        onOpenSettings={(agentId) => setSettingsAgentId(agentId)}
                      />
                    </motion.div>
                  ))}
                </section>
              </div>
            ) : null}


            {rosterEntries.length > 0 ? (
              <section className="rounded-3xl border border-[var(--theme-border)] bg-[var(--theme-card)] p-5 shadow-[0_24px_80px_var(--theme-shadow)]">
                <div className="mb-4">
                  <h2 className="text-base font-semibold text-[var(--theme-text)]">Team Personality Roster</h2>
                  <p className="mt-0.5 text-xs text-[var(--theme-muted-2)]">Live personas from the sisters registry — no hard-coded roster</p>
                </div>
                <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-5">
                  {rosterEntries.map((sister) => (
                    <div
                      key={sister.id}
                      className="domino-item flex flex-col gap-1.5 rounded-2xl border border-[var(--theme-border)] bg-[var(--theme-bg)] p-3 transition-all duration-200 hover:-translate-y-0.5 hover:shadow-md hover:border-[var(--theme-accent)]/30"
                    >
                      <div className="flex items-center gap-2">
                        <span className="flex size-7 shrink-0 items-center justify-center rounded-lg border border-[var(--theme-accent-soft-strong)] bg-[var(--theme-accent-soft)] text-xs font-bold text-[var(--theme-accent)]">
                          {sister.emoji || sister.name.charAt(0)}
                        </span>
                        <span className="truncate text-sm font-semibold text-[var(--theme-text)]">{sister.name}</span>
                      </div>
                      <p className="micro-label">{sister.role}</p>
                    </div>
                  ))}
                </div>
              </section>
            ) : null}

            <section className="rounded-3xl border border-[var(--theme-border)] bg-[var(--theme-card)] p-5 shadow-[0_24px_80px_var(--theme-shadow)]">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <h2 className="text-lg font-semibold text-[var(--theme-text)]">
                    Recent Activity
                  </h2>
                  <p className="mt-1 text-sm text-[var(--theme-muted-2)]">
                    Latest outputs across the team
                  </p>
                </div>
              </div>
              <div className="mt-4 space-y-3">
                {recentActivity.length > 0 ? (
                  recentActivity.map((activity) => {
                    const agent = sisterAgents.find((entry) => entry.id === activity.agentId)
                    return (
                      <div
                        key={activity.id}
                        className="domino-item flex flex-col gap-2 rounded-2xl border border-[var(--theme-border)] bg-[var(--theme-bg)] px-4 py-3 transition-all hover:-translate-y-px hover:shadow-sm md:flex-row md:items-center md:justify-between"
                      >
                        <p className="text-sm text-[var(--theme-text)]">
                          <span className="mr-2">{agent?.meta.emoji ?? '🤖'}</span>
                          <span className="font-medium">{agent?.name ?? activity.agentId}:</span>{' '}
                          {activity.summary}
                        </p>
                        <span className="shrink-0 text-sm text-[var(--theme-muted)]">
                          {formatRelativeTime(activity.timestamp)}
                        </span>
                      </div>
                    )
                  })
                ) : (
                  <div className="rounded-2xl border border-dashed border-[var(--theme-border)] bg-[var(--theme-bg)] px-4 py-6 text-sm text-[var(--theme-muted)]">
                    No recent activity yet.
                  </div>
                )}
              </div>
            </section>
          </>
        )}
      </section>

      <OperationsSettingsModal
        open={settingsOpen}
        settings={settings}
        onClose={() => setSettingsOpen(false)}
        onSave={saveSettings}
      />

      <OperationsAgentDetail
        open={Boolean(settingsAgent)}
        agent={settingsAgent}
        onClose={() => setSettingsAgentId(null)}
        onSave={saveAgent}
        onDelete={async (agentId) => {
          await deleteAgent(agentId)
          setSettingsAgentId((current) => (current === agentId ? null : current))
        }}
        isSaving={isSavingAgent}
        isDeleting={isDeletingAgent}
      />
    </main>
  )
}
