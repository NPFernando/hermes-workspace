import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useNavigate } from '@tanstack/react-router'
import { AgentHubLayout } from './agent-hub-layout'
import {
  buildAgentConfigDraft,
  buildAgentConfigPatchPayload,
  dedupe,
  deriveAgentStatus,
  deriveFriendlyIdFromKey,
  fetchAgentConfig,
  formatRelativeTime,
  formatTokenCount,
  getSessionFriendlyId,
  getSessionModelName,
  getSessionStatusBadgeClasses,
  getSessionTitle,
  getSessionTokenCount,
  matchesAgentCronJob,
  normalizeToken,
  parseAgentDefinitions,
  patchAgentConfig,
  prettyLabel,
  readResponseError,
  readString,
  readTimestamp,
  safeStringify,
  scoreSessionMatch,
  serializeAgentConfigDraft,
} from './agents/utils'
import {
  CATEGORY_ORDER,
  FALLBACK_AGENT_REGISTRY,
  STATUS_SORT_ORDER,
} from './agents/types'
import type {AgentRegistryCardData, AgentRegistryStatus} from '@/components/agent-view/agent-registry-card';
import type {
  AgentConfigDraft,
  AgentConfigPatchPayload,
  AgentDefinition,
  AgentRuntime,
  AgentsData,
  SessionEntry,
} from './agents/types'
import {
  AgentRegistryCard
  
  
} from '@/components/agent-view/agent-registry-card'
import { Button } from '@/components/ui/button'
import { Switch } from '@/components/ui/switch'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { formatModelName } from '@/lib/format-model-name'
import { fetchCronJobs } from '@/lib/cron-api'
import { toggleAgentPause } from '@/lib/gateway-api'
import { toast } from '@/components/ui/toast'
import { usePullToRefresh } from '@/hooks/use-pull-to-refresh'

type AgentsScreenVariant = 'mission-control' | 'registry'
type AgentsScreenProps = {
  variant?: AgentsScreenVariant
}

export function AgentsScreen({ variant = 'mission-control' }: AgentsScreenProps) {
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const missionControlEnabled = variant === 'mission-control'
  const [optimisticPausedByAgentId, setOptimisticPausedByAgentId] = useState<
    Record<string, boolean>
  >({})
  const [optimisticPausedByControlKey, setOptimisticPausedByControlKey] =
    useState<Record<string, boolean>>({})
  const [spawningByAgentId, setSpawningByAgentId] = useState<
    Record<string, boolean>
  >({})
  const [historyAgentId, setHistoryAgentId] = useState<string | null>(null)
  const [selectedAgentId, setSelectedAgentId] = useState<string | null>(null)
  const [detailTab, setDetailTab] = useState('overview')
  const [agentConfigDraft, setAgentConfigDraft] = useState<AgentConfigDraft | null>(
    null,
  )

  // Mobile detection for pull-to-refresh
  const [isMobile, setIsMobile] = useState(() =>
    typeof window !== 'undefined' && window.matchMedia('(max-width: 767px)').matches,
  )
  useEffect(() => {
    const media = window.matchMedia('(max-width: 767px)')
    const update = () => setIsMobile(media.matches)
    update()
    media.addEventListener('change', update)
    return () => media.removeEventListener('change', update)
  }, [])

  // Pull-to-refresh: attach to the scrollable <main> in workspace-shell
  const scrollContainerRef = useRef<HTMLElement | null>(null)
  useEffect(() => {
    const el = document.querySelector('main[data-tour="chat-area"]')
    scrollContainerRef.current = el as HTMLElement | null
  }, [])

  // handlePullRefresh defined after queries (see below)

  const agentsQuery = useQuery({
    queryKey: ['gateway', 'agents'],
    queryFn: async () => {
      const res = await fetch('/api/gateway/agents')
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const json = await res.json()
      if (!json.ok) throw new Error(json.error || 'Gateway error')
      return json.data as AgentsData
    },
    refetchInterval: 15_000,
    retry: 1,
  })

  const sessionsQuery = useQuery({
    queryKey: ['agent-registry', 'sessions'],
    queryFn: async () => {
      const res = await fetch('/api/sessions')
      if (!res.ok) return [] as Array<SessionEntry>
      const payload = (await res.json()) as { sessions?: Array<SessionEntry> }
      return Array.isArray(payload.sessions) ? payload.sessions : []
    },
    refetchInterval: 10_000,
    retry: false,
  })

  const cronJobsQuery = useQuery({
    queryKey: ['cron', 'jobs'],
    queryFn: fetchCronJobs,
    staleTime: 30_000,
    retry: 1,
  })

  const handlePullRefresh = useCallback(() => {
    void agentsQuery.refetch()
    void sessionsQuery.refetch()
  }, [agentsQuery, sessionsQuery])

  const { isPulling: agentHubPulling, pullDistance: agentHubPullDistance, threshold: agentHubThreshold } = usePullToRefresh(
    isMobile,
    handlePullRefresh,
    scrollContainerRef,
  )

  useEffect(() => {
    if (!sessionsQuery.isSuccess) return

    setOptimisticPausedByAgentId((previous) => {
      if (Object.keys(previous).length === 0) return previous
      return {}
    })
    setOptimisticPausedByControlKey((previous) => {
      if (Object.keys(previous).length === 0) return previous
      return {}
    })
  }, [sessionsQuery.dataUpdatedAt, sessionsQuery.isSuccess])

  const parsedDefinitions = useMemo(
    () => parseAgentDefinitions(agentsQuery.data),
    [agentsQuery.data],
  )

  const usingFallbackRegistry =
    !agentsQuery.isLoading && parsedDefinitions === null

  const registryDefinitions = useMemo(() => {
    const merged = new Map<string, AgentDefinition>()

    FALLBACK_AGENT_REGISTRY.forEach((definition) => {
      merged.set(definition.id, definition)
    })

    ;(parsedDefinitions ?? []).forEach((definition) => {
      const existing = merged.get(definition.id)
      if (!existing) {
        merged.set(definition.id, definition)
        return
      }

      merged.set(definition.id, {
        ...existing,
        ...definition,
        aliases: dedupe([...existing.aliases, ...definition.aliases]),
      })
    })

    return Array.from(merged.values())
  }, [parsedDefinitions])

  const runtimeAgents = useMemo(() => {
    const sessions = Array.isArray(sessionsQuery.data) ? sessionsQuery.data : []

    return registryDefinitions.map((definition) => {
      const matchedSessions = sessions
        .map((session) => {
          const score = scoreSessionMatch(definition, session)
          return {
            session,
            score,
            updatedAt: readTimestamp(session.updatedAt),
          }
        })
        .filter((candidate) => candidate.score > 0)
        .sort((left, right) => {
          if (right.score !== left.score) return right.score - left.score
          return right.updatedAt - left.updatedAt
        })
        .map((candidate) => candidate.session)

      const primarySession = matchedSessions[0]
      const hasOverride = Object.prototype.hasOwnProperty.call(
        optimisticPausedByAgentId,
        definition.id,
      )
      const sessionKey = readString(primarySession?.key)
      const controlKey = sessionKey || definition.id
      const hasControlOverride = Object.prototype.hasOwnProperty.call(
        optimisticPausedByControlKey,
        controlKey,
      )
      const pausedOverride = hasControlOverride
        ? optimisticPausedByControlKey[controlKey]
        : hasOverride
          ? optimisticPausedByAgentId[definition.id]
          : undefined

      const friendlyId = getSessionFriendlyId(primarySession)
      const status = deriveAgentStatus(primarySession, pausedOverride)

      return {
        id: definition.id,
        name: definition.name,
        role: definition.role,
        category: definition.category,
        color: definition.color,
        status,
        sessionKey: sessionKey || undefined,
        friendlyId: friendlyId || undefined,
        controlKey,
        matchedSessions,
      } satisfies AgentRuntime
    })
  }, [
    registryDefinitions,
    sessionsQuery.data,
    optimisticPausedByAgentId,
    optimisticPausedByControlKey,
  ])

  const unmatchedSessions = useMemo(() => {
    const sessions = Array.isArray(sessionsQuery.data) ? sessionsQuery.data : []
    const matchedSessionKeys = new Set<string>()

    runtimeAgents.forEach((agent) => {
      agent.matchedSessions.forEach((session) => {
        const sessionKey = readString(session.key)
        if (sessionKey) matchedSessionKeys.add(sessionKey)
      })
    })

    const cutoff = Date.now() - 10 * 60_000

    return sessions
      .filter((session) => {
        const sessionKey = readString(session.key)
        if (!sessionKey || matchedSessionKeys.has(sessionKey)) return false
        if (!sessionKey.includes('subagent:')) return false
        return readTimestamp(session.updatedAt) >= cutoff
      })
      .sort((left, right) => readTimestamp(right.updatedAt) - readTimestamp(left.updatedAt))
  }, [runtimeAgents, sessionsQuery.data])

  const groupedSections = useMemo(() => {
    const grouped = new Map<string, Array<AgentRuntime>>()

    runtimeAgents.forEach((agent) => {
      const existing = grouped.get(agent.category) ?? []
      existing.push(agent)
      grouped.set(agent.category, existing)
    })

    const orderedCategories = [
      ...CATEGORY_ORDER.filter((category) => grouped.has(category)),
      ...Array.from(grouped.keys())
        .filter((category) => !CATEGORY_ORDER.includes(category as never))
        .sort((left, right) => left.localeCompare(right)),
    ]

    return orderedCategories.map((category) => {
      const agentsInCategory = (grouped.get(category) ?? []).sort((left, right) => {
        const leftPriority = STATUS_SORT_ORDER[left.status] ?? 9
        const rightPriority = STATUS_SORT_ORDER[right.status] ?? 9
        if (leftPriority !== rightPriority) return leftPriority - rightPriority
        return left.name.localeCompare(right.name)
      })

      return {
        category,
        agents: agentsInCategory,
      }
    })
  }, [runtimeAgents])

  const selectedHistoryAgent = useMemo(
    () => runtimeAgents.find((agent) => agent.id === historyAgentId) ?? null,
    [historyAgentId, runtimeAgents],
  )

  const selectedConfigAgent = useMemo(
    () => runtimeAgents.find((agent) => agent.id === selectedAgentId) ?? null,
    [runtimeAgents, selectedAgentId],
  )

  const selectedDefinition = useMemo(
    () => registryDefinitions.find((agent) => agent.id === selectedAgentId) ?? null,
    [registryDefinitions, selectedAgentId],
  )

  const agentConfigQuery = useQuery({
    queryKey: ['gateway', 'agents', 'config', selectedAgentId],
    enabled: Boolean(selectedAgentId),
    queryFn: () => fetchAgentConfig(selectedAgentId as string),
    retry: false,
  })

  useEffect(() => {
    if (!selectedAgentId) {
      setAgentConfigDraft(null)
      return
    }
    if (!agentConfigQuery.data) return
    setAgentConfigDraft(buildAgentConfigDraft(agentConfigQuery.data))
  }, [agentConfigQuery.data, selectedAgentId])

  useEffect(() => {
    setDetailTab('overview')
  }, [selectedAgentId])

  const saveAgentConfigMutation = useMutation({
    mutationFn: async ({
      agentId,
      config,
    }: {
      agentId: string
      config: AgentConfigPatchPayload
    }) => patchAgentConfig(agentId, config),
    onSuccess: async (_, variables) => {
      toast('Agent config saved', { type: 'success' })
      await Promise.all([
        queryClient.invalidateQueries({
          queryKey: ['gateway', 'agents', 'config', variables.agentId],
        }),
        queryClient.invalidateQueries({ queryKey: ['gateway', 'agents'] }),
      ])
    },
    onError: (error) => {
      toast(error instanceof Error ? error.message : 'Failed to save agent config', {
        type: 'error',
      })
    },
  })

  const selectedCronJobs = useMemo(() => {
    const jobs = Array.isArray(cronJobsQuery.data) ? cronJobsQuery.data : []
    return jobs.filter((job) =>
      matchesAgentCronJob(job, selectedDefinition, selectedConfigAgent),
    )
  }, [cronJobsQuery.data, selectedConfigAgent, selectedDefinition])

  const selectedAgentConfig = agentConfigQuery.data
  const draftSnapshot = serializeAgentConfigDraft(agentConfigDraft)
  const configSnapshot = useMemo(
    () =>
      serializeAgentConfigDraft(
        selectedAgentConfig ? buildAgentConfigDraft(selectedAgentConfig) : null,
      ),
    [selectedAgentConfig],
  )
  const isConfigDirty =
    Boolean(agentConfigDraft && selectedAgentConfig) &&
    draftSnapshot !== configSnapshot

  const modelOverrideOptions = useMemo(() => {
    const values = dedupe([
      selectedAgentConfig?.primaryModel ?? '',
      ...(selectedAgentConfig?.fallbackModels ?? []),
      agentConfigDraft?.modelOverride ?? '',
      selectedConfigAgent?.matchedSessions[0]
        ? getSessionModelName(selectedConfigAgent.matchedSessions[0])
        : '',
    ]).filter((value) => value.length > 0)

    return values
  }, [agentConfigDraft?.modelOverride, selectedAgentConfig, selectedConfigAgent])

  async function spawnSessionForAgent(
    agent: AgentRegistryCardData,
  ): Promise<{ sessionKey: string; friendlyId: string } | null> {
    if (spawningByAgentId[agent.id]) return null

    setSpawningByAgentId((previous) => ({ ...previous, [agent.id]: true }))

    try {
      const baseFriendlyId = normalizeToken(agent.id || agent.name || 'agent')
      const friendlyId = `${baseFriendlyId}-${Math.random().toString(36).slice(2, 8)}`

      const response = await fetch('/api/sessions', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          friendlyId,
          label: agent.name,
        }),
      })

      if (!response.ok) {
        throw new Error(await readResponseError(response))
      }

      const payload = (await response.json()) as {
        sessionKey?: string
        friendlyId?: string
      }

      const sessionKey = readString(payload.sessionKey)
      const resolvedFriendlyId =
        readString(payload.friendlyId) || deriveFriendlyIdFromKey(sessionKey)

      if (!sessionKey || !resolvedFriendlyId) {
        throw new Error('Failed to create a session for this agent')
      }

      toast(`${agent.name} session started`, { type: 'success' })
      void sessionsQuery.refetch()

      return { sessionKey, friendlyId: resolvedFriendlyId }
    } catch (error) {
      const message =
        error instanceof Error ? error.message : 'Failed to spawn agent session'
      toast(message, { type: 'error' })
      return null
    } finally {
      setSpawningByAgentId((previous) => {
        const next = { ...previous }
        delete next[agent.id]
        return next
      })
    }
  }

  async function handleChat(agent: AgentRegistryCardData) {
    const existingFriendlyId =
      readString(agent.friendlyId) || deriveFriendlyIdFromKey(readString(agent.sessionKey))

    if (existingFriendlyId) {
      void navigate({
        to: '/chat/$sessionKey',
        params: { sessionKey: existingFriendlyId },
      })
      return
    }

    const spawned = await spawnSessionForAgent(agent)
    if (!spawned) return

    void navigate({
      to: '/chat/$sessionKey',
      params: { sessionKey: spawned.friendlyId },
    })
  }

  async function handleSpawn(agent: AgentRegistryCardData) {
    await spawnSessionForAgent(agent)
  }

  function handleHistory(agent: AgentRegistryCardData) {
    setHistoryAgentId(agent.id)
  }

  async function handlePauseToggle(
    agent: AgentRegistryCardData,
    nextPaused: boolean,
  ) {
    const controlKey = readString(agent.controlKey)
    if (!controlKey) {
      toast('No control key available for this agent', { type: 'warning' })
      return
    }

    const hadPrevious = Object.prototype.hasOwnProperty.call(
      optimisticPausedByAgentId,
      agent.id,
    )
    const previousValue = optimisticPausedByAgentId[agent.id]
    const hadControlPrevious = Object.prototype.hasOwnProperty.call(
      optimisticPausedByControlKey,
      controlKey,
    )
    const previousControlValue = optimisticPausedByControlKey[controlKey]

    setOptimisticPausedByAgentId((previous) => ({
      ...previous,
      [agent.id]: nextPaused,
    }))
    setOptimisticPausedByControlKey((previous) => ({
      ...previous,
      [controlKey]: nextPaused,
    }))

    try {
      const payload = await toggleAgentPause(controlKey, nextPaused)
      const paused =
        typeof payload.paused === 'boolean' ? payload.paused : nextPaused

      setOptimisticPausedByAgentId((previous) => ({
        ...previous,
        [agent.id]: paused,
      }))
      setOptimisticPausedByControlKey((previous) => ({
        ...previous,
        [controlKey]: paused,
      }))

      toast(`${agent.name} ${paused ? 'paused' : 'resumed'}`, {
        type: 'success',
      })
      void sessionsQuery.refetch()
    } catch (error) {
      setOptimisticPausedByAgentId((previous) => {
        const next = { ...previous }
        if (hadPrevious) {
          next[agent.id] = previousValue
        } else {
          delete next[agent.id]
        }
        return next
      })
      setOptimisticPausedByControlKey((previous) => {
        const next = { ...previous }
        if (hadControlPrevious) {
          next[controlKey] = previousControlValue
        } else {
          delete next[controlKey]
        }
        return next
      })

      const message =
        error instanceof Error
          ? error.message
          : `Failed to ${nextPaused ? 'pause' : 'resume'} agent`
      toast(message, { type: 'error' })
    }
  }

  function handleOpenAgentConfig(agent: AgentRegistryCardData) {
    setSelectedAgentId(agent.id)
    setDetailTab('overview')
  }

  function handleCloseAgentConfig() {
    setSelectedAgentId(null)
    setAgentConfigDraft(null)
  }

  function handleReloadAgentConfig() {
    if (!selectedAgentId) return
    void agentConfigQuery.refetch()
  }

  function handleSaveAgentConfig() {
    if (!selectedAgentId || !agentConfigDraft) return
    void saveAgentConfigMutation.mutateAsync({
      agentId: selectedAgentId,
      config: buildAgentConfigPatchPayload(agentConfigDraft),
    })
  }

  function handleToolToggle(toolId: string, enabled: boolean) {
    setAgentConfigDraft((previous) => {
      if (!previous) return previous
      return {
        ...previous,
        tools: {
          ...previous.tools,
          [toolId]: enabled,
        },
      }
    })
  }

  function handleSkillToggle(skillId: string, enabled: boolean) {
    setAgentConfigDraft((previous) => {
      if (!previous) return previous
      return {
        ...previous,
        skills: {
          ...previous.skills,
          [skillId]: enabled,
        },
      }
    })
  }

  function handleChannelToggle(channelId: string, enabled: boolean) {
    setAgentConfigDraft((previous) => {
      if (!previous) return previous
      const current = previous.channels[channelId]
      if (!current) return previous
      return {
        ...previous,
        channels: {
          ...previous.channels,
          [channelId]: {
            ...current,
            enabled,
          },
        },
      }
    })
  }

  function handleKilled(agent: AgentRegistryCardData) {
    setOptimisticPausedByAgentId((previous) => {
      const next = { ...previous }
      delete next[agent.id]
      return next
    })
    setOptimisticPausedByControlKey((previous) => {
      const controlKey = readString(agent.controlKey)
      if (!controlKey) return previous
      const next = { ...previous }
      delete next[controlKey]
      return next
    })
    void sessionsQuery.refetch()
  }

  const lastUpdated = agentsQuery.dataUpdatedAt
    ? new Date(agentsQuery.dataUpdatedAt).toLocaleTimeString()
    : null

  const agentHubPullIndicatorStyle = agentHubPulling
    ? { transform: `translateY(${Math.min(agentHubPullDistance - 8, 48)}px)`, opacity: Math.min(agentHubPullDistance / agentHubThreshold, 1) }
    : undefined

  if (missionControlEnabled) {
    return (
      <div className="relative flex min-h-full flex-col overflow-x-hidden md:h-full md:min-h-0 md:bg-surface">
        {/* Pull-to-refresh indicator (mobile) */}
        {isMobile && agentHubPulling ? (
          <div
            className="pointer-events-none absolute left-1/2 top-2 z-50 -translate-x-1/2 transition-all duration-150"
            style={agentHubPullIndicatorStyle}
            aria-hidden
          >
            <div className="flex items-center gap-1.5 rounded-full border border-[var(--theme-border)] bg-[var(--theme-card)]/90 px-3 py-1.5 shadow-md backdrop-blur-sm">
              <span
                className={[
                  'size-3 rounded-full border-2 border-accent-500',
                  agentHubPullDistance >= agentHubThreshold ? 'border-t-transparent animate-spin' : 'opacity-50',
                ].join(' ')}
              />
              <span className="text-xs font-medium text-[var(--theme-muted)]">
                {agentHubPullDistance >= agentHubThreshold ? 'Release to refresh' : 'Pull to refresh'}
              </span>
            </div>
          </div>
        ) : null}
        {usingFallbackRegistry ? (
          <div className="border-b border-amber-300/50 bg-amber-50/70 px-6 py-2 text-xs font-medium text-amber-800 dark:border-amber-500/40 dark:bg-amber-900/20 dark:text-amber-200">
            Gateway registry unavailable. Showing fallback definitions.
          </div>
        ) : null}
        <div className="min-h-0 flex-1">
          <AgentHubLayout agents={runtimeAgents} />
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-full bg-surface px-4 pb-24 pt-5 text-[var(--theme-text)] md:px-6 md:pb-4 md:pt-8">
      <div className="w-full">
        <header className="mb-4 flex items-center justify-between gap-3 rounded-xl border border-[var(--theme-border)] bg-[var(--theme-panel)] px-4 py-3 shadow-sm">
          <div>
            <h1 className="text-lg font-bold text-[var(--theme-text)] md:text-xl">
              Gateway Agents
            </h1>
            <p className="text-xs text-[var(--theme-muted)]">
              Registered agents and their status
            </p>
          </div>
          <div className="flex items-center gap-2 md:gap-3">
            {agentsQuery.isFetching && !agentsQuery.isLoading ? (
              <span className="text-[10px] text-[var(--theme-muted)] animate-pulse">
                syncing…
              </span>
            ) : null}
            {lastUpdated ? (
              <span className="text-[10px] text-[var(--theme-muted)]">
                Updated {lastUpdated}
              </span>
            ) : null}
            <span
              className={`inline-block size-2 rounded-full ${agentsQuery.isError ? 'bg-red-500' : agentsQuery.isSuccess ? 'bg-emerald-500' : 'bg-amber-500'}`}
            />
          </div>
        </header>

        {usingFallbackRegistry ? (
          <div className="mb-4 rounded-xl border border-amber-300/50 bg-amber-50/70 px-3 py-2 text-xs font-medium text-amber-800 dark:border-amber-500/40 dark:bg-amber-900/20 dark:text-amber-200">
            Gateway registry unavailable. Showing fallback definitions.
          </div>
        ) : null}

        <div className="flex-1 overflow-auto">
          {agentsQuery.isLoading && !agentsQuery.data ? (
            <div className="flex h-32 items-center justify-center">
              <div className="flex items-center gap-2 text-[var(--theme-muted)]">
                <div className="spinner-accent" />
                <span className="text-sm">Loading registry...</span>
              </div>
            </div>
          ) : registryDefinitions.length === 0 ? (
            <div className="rounded-2xl border border-[var(--theme-border)] bg-[var(--theme-card)]/60 p-5 shadow-sm backdrop-blur-md">
              <h2 className="text-base font-semibold text-[var(--theme-text)]">
                Add your first agent
              </h2>
              <ul className="mt-3 space-y-2 text-sm text-[var(--theme-muted)]">
                <li>Create an agent profile</li>
                <li>Connect a gateway</li>
                <li>Spawn your first session</li>
              </ul>
              <button
                type="button"
                onClick={() => {
                  void navigate({ to: '/settings', search: {} })
                }}
                className="mt-4 inline-flex min-h-11 items-center rounded-lg bg-accent-500 px-3 py-1.5 text-xs font-semibold text-white shadow-sm transition-colors hover:bg-accent-600 sm:px-4 sm:py-2 sm:text-sm"
              >
                Open Settings
              </button>
            </div>
          ) : (
            <div className="space-y-4">
              {groupedSections.map((section) => (
                <section key={section.category} className="space-y-2">
                  <div className="flex items-center justify-between px-1">
                    <h2 className="text-[10px] font-bold uppercase tracking-widest text-[var(--theme-muted)]">
                      {section.category}
                    </h2>
                    <span className="text-[11px] font-medium text-[var(--theme-muted)]">
                      {section.agents.length}
                    </span>
                  </div>

                  <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
                    {section.agents.map((agent) => (
                      <AgentRegistryCard
                        key={agent.id}
                        agent={agent}
                        isSpawning={Boolean(spawningByAgentId[agent.id])}
                        onTap={handleOpenAgentConfig}
                        onChat={handleChat}
                        onSpawn={handleSpawn}
                        onHistory={handleHistory}
                        onPauseToggle={handlePauseToggle}
                        onKilled={handleKilled}
                      />
                    ))}
                  </div>
                </section>
              ))}

              {unmatchedSessions.length > 0 ? (
                <section className="space-y-2">
                  <div className="flex items-center justify-between px-1">
                    <h2 className="text-[10px] font-bold uppercase tracking-widest text-[var(--theme-muted)]">
                      Active Sessions
                    </h2>
                    <span className="text-[11px] font-medium text-[var(--theme-muted)]">
                      {unmatchedSessions.length}
                    </span>
                  </div>

                  <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
                    {unmatchedSessions.map((session, index) => {
                      const sessionKey = readString(session.key)
                      const sessionTarget = getSessionFriendlyId(session) || sessionKey
                      const sessionModel = getSessionModelName(session)

                      return (
                        <div
                          key={`${sessionKey}-${index}`}
                          className="rounded-2xl border border-[var(--theme-border)] bg-[var(--theme-bg)] p-4 shadow-sm"
                        >
                          <div className="flex items-start justify-between gap-3">
                            <div className="min-w-0">
                              <p className="truncate text-sm font-semibold text-[var(--theme-text)]">
                                {getSessionTitle(session)}
                              </p>
                              <p className="mt-1 truncate text-xs text-[var(--theme-muted)]">
                                {sessionKey}
                              </p>
                            </div>
                            <span
                              className={`inline-flex shrink-0 items-center rounded-full px-2 py-1 text-[10px] font-semibold uppercase tracking-wide ${getSessionStatusBadgeClasses(session)}`}
                            >
                              {readString(session.status) || 'active'}
                            </span>
                          </div>

                          <div className="mt-3 flex items-center justify-between gap-3 text-xs text-[var(--theme-muted)]">
                            {sessionModel ? (
                              <span className="truncate">
                                {formatModelName(sessionModel)}
                              </span>
                            ) : (
                              <span />
                            )}
                            <span>{formatTokenCount(getSessionTokenCount(session))} tokens</span>
                            <span>{formatRelativeTime(session.updatedAt)}</span>
                          </div>

                          {sessionTarget ? (
                            <a
                              href={`/chat/${encodeURIComponent(sessionTarget)}`}
                              className="mt-4 inline-flex min-h-11 items-center rounded-lg border border-[var(--theme-border)] px-3 py-1.5 text-xs font-semibold text-accent-300 transition-colors hover:border-accent-500 hover:text-accent-300 sm:px-4 sm:py-2 sm:text-sm"
                            >
                              Open Chat
                            </a>
                          ) : null}
                        </div>
                      )
                    })}
                  </div>
                </section>
              ) : null}
            </div>
          )}
        </div>
      </div>

      {selectedConfigAgent ? (
        <div className="fixed inset-0 z-[95]">
          <button
            type="button"
            aria-label="Close agent config"
            className="absolute inset-0 bg-[var(--theme-bg)]/25 backdrop-blur-sm"
            onClick={handleCloseAgentConfig}
          />

          <aside className="absolute right-0 top-0 flex h-full w-full max-w-3xl flex-col border-l border-[var(--theme-border)] bg-surface shadow-2xl">
            <header className="border-b border-[var(--theme-border)] bg-[var(--theme-panel)] px-5 py-4">
              <div className="flex items-start justify-between gap-4">
                <div className="min-w-0">
                  <p className="text-xs font-semibold uppercase tracking-[0.22em] text-[var(--theme-muted)]">
                    Agent Config
                  </p>
                  <h2 className="mt-1 truncate text-xl font-semibold text-[var(--theme-text)]">
                    {selectedConfigAgent.name}
                  </h2>
                  <p className="mt-1 text-sm text-[var(--theme-muted)]">
                    {selectedAgentConfig?.name && selectedAgentConfig.name !== selectedConfigAgent.name
                      ? `${selectedConfigAgent.role} · ${selectedAgentConfig.name}`
                      : selectedConfigAgent.role}
                  </p>
                  {selectedAgentConfig?.warning ? (
                    <p className="mt-2 text-xs font-medium text-amber-700">
                      {selectedAgentConfig.warning}
                    </p>
                  ) : null}
                </div>

                <div className="flex items-center gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={handleReloadAgentConfig}
                    disabled={agentConfigQuery.isFetching}
                  >
                    Reload
                  </Button>
                  <Button
                    size="sm"
                    onClick={handleSaveAgentConfig}
                    disabled={
                      !agentConfigDraft ||
                      !selectedAgentConfig ||
                      selectedAgentConfig.readOnly ||
                      !selectedAgentConfig.supportsPatch ||
                      !isConfigDirty ||
                      saveAgentConfigMutation.isPending
                    }
                  >
                    {saveAgentConfigMutation.isPending ? 'Saving...' : 'Save'}
                  </Button>
                  <Button variant="outline" size="sm" onClick={handleCloseAgentConfig}>
                    Close
                  </Button>
                </div>
              </div>
            </header>

            <div className="min-h-0 flex-1 overflow-y-auto px-5 py-5">
              {agentConfigQuery.isLoading && !selectedAgentConfig ? (
                <div className="flex h-40 items-center justify-center">
                  <div className="flex items-center gap-2 text-[var(--theme-muted)]">
                    <div className="spinner-accent" />
                    <span className="text-sm">Loading agent config...</span>
                  </div>
                </div>
              ) : agentConfigQuery.isError && !selectedAgentConfig ? (
                <div className="rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
                  {agentConfigQuery.error instanceof Error
                    ? agentConfigQuery.error.message
                    : 'Failed to load agent config'}
                </div>
              ) : (
                <Tabs value={detailTab} onValueChange={setDetailTab}>
                  <TabsList className="mb-5 flex w-full flex-nowrap overflow-x-auto scrollbar-none gap-2 rounded-2xl border border-[var(--theme-border)] bg-[var(--theme-card)] p-1 text-[var(--theme-muted)] shadow-sm">
                    <TabsTrigger value="overview" className="min-w-[110px] shrink-0">
                      Overview
                    </TabsTrigger>
                    <TabsTrigger value="tools" className="min-w-[92px] shrink-0">
                      Tools
                    </TabsTrigger>
                    <TabsTrigger value="skills" className="min-w-[92px] shrink-0">
                      Skills
                    </TabsTrigger>
                    <TabsTrigger value="channels" className="min-w-[102px] shrink-0">
                      Channels
                    </TabsTrigger>
                    <TabsTrigger value="cron" className="min-w-[102px] shrink-0">
                      Cron Jobs
                    </TabsTrigger>
                  </TabsList>

                  <TabsContent value="overview" className="space-y-4">
                    <div className="grid gap-3 md:grid-cols-3">
                      <div className="rounded-2xl border border-[var(--theme-border)] bg-[var(--theme-card)] p-4 shadow-sm">
                        <p className="text-xs font-semibold uppercase tracking-wide text-[var(--theme-muted)]">
                          Agent ID
                        </p>
                        <p className="mt-2 text-sm font-medium text-[var(--theme-text)]">
                          {selectedConfigAgent.id}
                        </p>
                      </div>
                      <div className="rounded-2xl border border-[var(--theme-border)] bg-[var(--theme-card)] p-4 shadow-sm">
                        <p className="text-xs font-semibold uppercase tracking-wide text-[var(--theme-muted)]">
                          Name
                        </p>
                        <p className="mt-2 text-sm font-medium text-[var(--theme-text)]">
                          {selectedAgentConfig?.name || selectedConfigAgent.name}
                        </p>
                      </div>
                      <div className="rounded-2xl border border-[var(--theme-border)] bg-[var(--theme-card)] p-4 shadow-sm">
                        <p className="text-xs font-semibold uppercase tracking-wide text-[var(--theme-muted)]">
                          Workspace Path
                        </p>
                        <p className="mt-2 break-all text-sm font-medium text-[var(--theme-text)]">
                          {selectedAgentConfig?.workspacePath || 'Unavailable'}
                        </p>
                      </div>
                    </div>

                    <div className="rounded-2xl border border-[var(--theme-border)] bg-[var(--theme-card)] p-4 shadow-sm">
                      <div className="grid gap-4 md:grid-cols-2">
                        <div>
                          <p className="text-xs font-semibold uppercase tracking-wide text-[var(--theme-muted)]">
                            Primary Model
                          </p>
                          <p className="mt-2 text-sm font-medium text-[var(--theme-text)]">
                            {selectedAgentConfig?.primaryModel
                              ? formatModelName(selectedAgentConfig.primaryModel)
                              : 'Unavailable'}
                          </p>
                        </div>

                        <div>
                          <p className="text-xs font-semibold uppercase tracking-wide text-[var(--theme-muted)]">
                            Fallbacks
                          </p>
                          <div className="mt-2 flex flex-wrap gap-2">
                            {(selectedAgentConfig?.fallbackModels ?? []).length > 0 ? (
                              selectedAgentConfig?.fallbackModels.map((fallback) => (
                                <span
                                  key={fallback}
                                  className="rounded-full border border-[var(--theme-border)] bg-[var(--theme-panel)] px-2.5 py-1 text-xs font-medium text-[var(--theme-muted)]"
                                >
                                  {formatModelName(fallback)}
                                </span>
                              ))
                            ) : (
                              <span className="text-sm text-[var(--theme-muted)]">No fallback models</span>
                            )}
                          </div>
                        </div>
                      </div>

                      <div className="mt-5 grid gap-3 md:grid-cols-[minmax(0,1fr)_auto] md:items-end">
                        <label className="block">
                          <span className="text-xs font-semibold uppercase tracking-wide text-[var(--theme-muted)]">
                            Model Override
                          </span>
                          <select
                            value={agentConfigDraft?.modelOverride ?? ''}
                            disabled={
                              !agentConfigDraft ||
                              selectedAgentConfig?.readOnly ||
                              !selectedAgentConfig?.supportsPatch
                            }
                            onChange={(event) => {
                              const nextValue = event.target.value
                              setAgentConfigDraft((previous) =>
                                previous
                                  ? {
                                      ...previous,
                                      modelOverride: nextValue,
                                    }
                                  : previous,
                              )
                            }}
                            className="mt-2 h-10 w-full rounded-xl border border-[var(--theme-border)] bg-[var(--theme-panel)] px-3 text-sm text-[var(--theme-text)] outline-none transition focus:border-[var(--theme-border)]"
                          >
                            <option value="">Use agent default</option>
                            {modelOverrideOptions.map((option) => (
                              <option key={option} value={option}>
                                {formatModelName(option)}
                              </option>
                            ))}
                          </select>
                        </label>

                        <div className="rounded-xl border border-[var(--theme-border)] bg-[var(--theme-panel)] px-3 py-2 text-xs text-[var(--theme-muted)]">
                          {selectedAgentConfig?.sourceMethod
                            ? `Loaded via ${selectedAgentConfig.sourceMethod}`
                            : selectedAgentConfig?.readOnly
                              ? 'Read-only fallback display'
                              : 'Config ready'}
                        </div>
                      </div>
                    </div>
                  </TabsContent>

                  <TabsContent value="tools" className="space-y-3">
                    {(selectedAgentConfig?.tools ?? []).length === 0 ? (
                      <div className="rounded-2xl border border-[var(--theme-border)] bg-[var(--theme-card)] px-4 py-6 text-sm text-[var(--theme-muted)] shadow-sm">
                        No tool policy was exposed for this agent.
                      </div>
                    ) : (
                      selectedAgentConfig?.tools.map((tool) => (
                        <div
                          key={tool.id}
                          className="flex items-center justify-between gap-4 rounded-2xl border border-[var(--theme-border)] bg-[var(--theme-card)] px-4 py-3 shadow-sm"
                        >
                          <div className="min-w-0">
                            <p className="text-sm font-medium text-[var(--theme-text)]">
                              {prettyLabel(tool.id)}
                            </p>
                            <p className="text-xs text-[var(--theme-muted)]">
                              {tool.source === 'allowed'
                                ? 'Allowed by policy'
                                : tool.source === 'denied'
                                  ? 'Denied by policy'
                                  : tool.source === 'explicit'
                                    ? 'Explicit per-agent rule'
                                    : 'Policy source unknown'}
                            </p>
                          </div>
                          <Switch
                            checked={agentConfigDraft?.tools[tool.id] ?? tool.enabled}
                            disabled={
                              selectedAgentConfig.readOnly ||
                              !selectedAgentConfig.supportsPatch
                            }
                            onCheckedChange={(checked) =>
                              handleToolToggle(tool.id, Boolean(checked))
                            }
                          />
                        </div>
                      ))
                    )}
                  </TabsContent>

                  <TabsContent value="skills" className="space-y-3">
                    {(selectedAgentConfig?.skills ?? []).length === 0 ? (
                      <div className="rounded-2xl border border-[var(--theme-border)] bg-[var(--theme-card)] px-4 py-6 text-sm text-[var(--theme-muted)] shadow-sm">
                        No active skills were exposed for this agent.
                      </div>
                    ) : (
                      selectedAgentConfig?.skills.map((skill) => (
                        <div
                          key={skill.id}
                          className="flex items-center justify-between gap-4 rounded-2xl border border-[var(--theme-border)] bg-[var(--theme-card)] px-4 py-3 shadow-sm"
                        >
                          <div className="min-w-0">
                            <p className="text-sm font-medium text-[var(--theme-text)]">
                              {prettyLabel(skill.id)}
                            </p>
                            <p className="text-xs text-[var(--theme-muted)]">{skill.id}</p>
                          </div>
                          <Switch
                            checked={agentConfigDraft?.skills[skill.id] ?? skill.enabled}
                            disabled={
                              selectedAgentConfig.readOnly ||
                              !selectedAgentConfig.supportsPatch
                            }
                            onCheckedChange={(checked) =>
                              handleSkillToggle(skill.id, Boolean(checked))
                            }
                          />
                        </div>
                      ))
                    )}
                  </TabsContent>

                  <TabsContent value="channels" className="space-y-3">
                    {(selectedAgentConfig?.channels ?? []).length === 0 ? (
                      <div className="rounded-2xl border border-[var(--theme-border)] bg-[var(--theme-card)] px-4 py-6 text-sm text-[var(--theme-muted)] shadow-sm">
                        No per-channel config was exposed for this agent.
                      </div>
                    ) : (
                      selectedAgentConfig?.channels.map((channel) => {
                        const draftChannel = agentConfigDraft?.channels[channel.id]
                        const channelConfig = draftChannel?.config ?? channel.config
                        const channelJson = safeStringify(channelConfig)
                        return (
                          <div
                            key={channel.id}
                            className="rounded-2xl border border-[var(--theme-border)] bg-[var(--theme-card)] p-4 shadow-sm"
                          >
                            <div className="flex items-start justify-between gap-4">
                              <div className="min-w-0">
                                <p className="text-sm font-medium text-[var(--theme-text)]">
                                  {prettyLabel(channel.id)}
                                </p>
                                <p className="text-xs text-[var(--theme-muted)]">
                                  Responds on {channel.id}
                                </p>
                              </div>
                              {channel.enabled !== null ? (
                                <Switch
                                  checked={draftChannel?.enabled ?? channel.enabled}
                                  disabled={
                                    selectedAgentConfig.readOnly ||
                                    !selectedAgentConfig.supportsPatch
                                  }
                                  onCheckedChange={(checked) =>
                                    handleChannelToggle(channel.id, Boolean(checked))
                                  }
                                />
                              ) : (
                                <span className="rounded-full border border-[var(--theme-border)] bg-[var(--theme-panel)] px-2.5 py-1 text-[11px] font-medium text-[var(--theme-muted)]">
                                  Display only
                                </span>
                              )}
                            </div>

                            <div className="mt-3 rounded-xl border border-[var(--theme-border)] bg-[var(--theme-panel)] p-3">
                              {channelJson ? (
                                <pre className="overflow-x-auto text-xs leading-5 text-[var(--theme-muted)]">
                                  {channelJson}
                                </pre>
                              ) : (
                                <p className="text-xs text-[var(--theme-muted)]">
                                  No extra channel config provided.
                                </p>
                              )}
                            </div>
                          </div>
                        )
                      })
                    )}
                  </TabsContent>

                  <TabsContent value="cron" className="space-y-3">
                    <div className="flex items-center justify-between rounded-2xl border border-[var(--theme-border)] bg-[var(--theme-card)] px-4 py-3 shadow-sm">
                      <div>
                        <p className="text-sm font-medium text-[var(--theme-text)]">
                          Assigned cron jobs
                        </p>
                        <p className="text-xs text-[var(--theme-muted)]">
                          Matched against agent id, name, aliases, payload, and delivery config.
                        </p>
                      </div>
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => void navigate({ to: '/jobs' })}
                      >
                        Open Cron Screen
                      </Button>
                    </div>

                    {cronJobsQuery.isLoading ? (
                      <div className="rounded-2xl border border-[var(--theme-border)] bg-[var(--theme-card)] px-4 py-6 text-sm text-[var(--theme-muted)] shadow-sm">
                        Loading cron jobs...
                      </div>
                    ) : cronJobsQuery.isError ? (
                      <div className="rounded-2xl border border-red-200 bg-red-50 px-4 py-6 text-sm text-red-700 shadow-sm">
                        {cronJobsQuery.error instanceof Error
                          ? cronJobsQuery.error.message
                          : 'Failed to load cron jobs'}
                      </div>
                    ) : selectedCronJobs.length === 0 ? (
                      <div className="rounded-2xl border border-[var(--theme-border)] bg-[var(--theme-card)] px-4 py-6 text-sm text-[var(--theme-muted)] shadow-sm">
                        No cron jobs matched this agent.
                      </div>
                    ) : (
                      selectedCronJobs.map((job) => (
                        <div
                          key={job.id}
                          className="rounded-2xl border border-[var(--theme-border)] bg-[var(--theme-card)] p-4 shadow-sm"
                        >
                          <div className="flex items-start justify-between gap-4">
                            <div className="min-w-0">
                              <p className="truncate text-sm font-medium text-[var(--theme-text)]">
                                {job.name}
                              </p>
                              <p className="mt-1 text-xs text-[var(--theme-muted)]">
                                {job.id}
                              </p>
                            </div>
                            <span className="rounded-full border border-[var(--theme-border)] bg-[var(--theme-panel)] px-2.5 py-1 text-[11px] font-medium text-[var(--theme-muted)]">
                              {job.enabled ? 'Enabled' : 'Disabled'}
                            </span>
                          </div>

                          <div className="mt-3 grid gap-3 text-sm text-[var(--theme-muted)] md:grid-cols-3">
                            <div>
                              <p className="text-[11px] font-semibold uppercase tracking-wide text-[var(--theme-muted)]">
                                Schedule
                              </p>
                              <p className="mt-1">{job.schedule}</p>
                            </div>
                            <div>
                              <p className="text-[11px] font-semibold uppercase tracking-wide text-[var(--theme-muted)]">
                                Status
                              </p>
                              <p className="mt-1">{job.status || 'Unknown'}</p>
                            </div>
                            <div>
                              <p className="text-[11px] font-semibold uppercase tracking-wide text-[var(--theme-muted)]">
                                Last Run
                              </p>
                              <p className="mt-1">
                                {job.lastRun?.startedAt
                                  ? new Date(job.lastRun.startedAt).toLocaleString()
                                  : 'Never'}
                              </p>
                            </div>
                          </div>
                        </div>
                      ))
                    )}
                  </TabsContent>
                </Tabs>
              )}
            </div>
          </aside>
        </div>
      ) : null}

      {selectedHistoryAgent ? (
        <div className="fixed inset-0 z-[90] md:hidden">
          <button
            type="button"
            aria-label="Close history"
            className="absolute inset-0 bg-black/40 backdrop-blur-sm"
            onClick={() => setHistoryAgentId(null)}
          />

          <div className="absolute inset-x-4 top-[12vh] rounded-2xl border border-[var(--theme-border)] bg-[var(--theme-card)]/90 p-4 shadow-lg backdrop-blur-md">
            <div className="mb-3 flex items-center justify-between">
              <h3 className="truncate pr-2 text-base font-bold text-[var(--theme-text)]">
                {selectedHistoryAgent.name} history
              </h3>
              <button
                type="button"
                className="min-h-11 rounded-lg border border-[var(--theme-border)] bg-[var(--theme-card)] px-3 py-1.5 text-xs font-semibold text-[var(--theme-text)] transition-colors hover:bg-[var(--theme-card2)] sm:px-4 sm:py-2 sm:text-sm"
                onClick={() => setHistoryAgentId(null)}
              >
                Close
              </button>
            </div>

            {selectedHistoryAgent.matchedSessions.length === 0 ? (
              <p className="text-xs text-[var(--theme-muted)]">
                No recent sessions for this agent yet.
              </p>
            ) : (
              <div className="max-h-[48vh] space-y-2 overflow-auto">
                {selectedHistoryAgent.matchedSessions.slice(0, 8).map((session, index) => {
                  const friendlyId = getSessionFriendlyId(session)
                  const sessionModel = getSessionModelName(session)
                  return (
                    <div
                      key={`${readString(session.key)}-${readString(session.friendlyId)}-${index}`}
                      className="rounded-xl border border-[var(--theme-border)] bg-[var(--theme-card)]/60 p-2.5"
                    >
                      <div className="flex items-center justify-between gap-2">
                        <p className="truncate text-xs font-medium text-[var(--theme-text)]">
                          {getSessionTitle(session)}
                        </p>
                        <span className="text-[10px] text-[var(--theme-muted)]">
                          {formatRelativeTime(session.updatedAt)}
                        </span>
                      </div>

                      <div className="mt-1 flex items-center justify-between">
                        <span className="text-[10px] font-medium text-[var(--theme-muted)]">
                          {sessionModel
                            ? `${readString(session.status) || 'unknown'} · ${formatModelName(sessionModel)}`
                            : readString(session.status) || 'unknown'}
                        </span>
                        {friendlyId ? (
                          <button
                            type="button"
                            onClick={() => {
                              setHistoryAgentId(null)
                              void navigate({
                                to: '/chat/$sessionKey',
                                params: { sessionKey: friendlyId },
                              })
                            }}
                            className="min-h-11 rounded-lg border border-[var(--theme-border)] bg-[var(--theme-card)] px-3 py-1.5 text-xs font-semibold text-accent-500 transition-colors hover:bg-accent-500/8 sm:px-4 sm:py-2 sm:text-sm"
                          >
                            Open Chat
                          </button>
                        ) : null}
                      </div>
                    </div>
                  )
                })}
              </div>
            )}
          </div>
        </div>
      ) : null}
    </div>
  )
}
