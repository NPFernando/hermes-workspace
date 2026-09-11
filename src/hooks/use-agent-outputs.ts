// use-agent-outputs.ts
//
// Operations "Outputs" adapter. Cron jobs are the workspace's durable
// execution source, so their recent runs provide a provider-neutral output
// feed without introducing a second activity store.

import { useCallback, useEffect, useState } from 'react'
import { fetchCronJobs, fetchCronRuns } from '@/lib/cron-api'

export type AgentOutputStatus = 'ok' | 'error' | 'running' | 'unknown'
export type AgentOutputFailureKind =
  | 'delivery'
  | 'config'
  | 'approval'
  | 'runtime'
  | undefined

export type AgentOutput = {
  id: string
  agentId: string
  agentName: string
  agentEmoji?: string
  jobId?: string
  jobName?: string
  timestamp: number
  durationMs?: number
  status: AgentOutputStatus
  statusLabel?: string
  failureKind?: AgentOutputFailureKind
  summary: string
  fullOutput: string
  model?: string
  sessionKey?: string
  chatSessionKey?: string
  error?: string
}

export type AgentOutputFilter = 'all' | 'ok' | 'error' | 'running'

export type AgentOutputFilterOption = {
  id: AgentOutputFilter
  label: string
  emoji?: string
}

const DEFAULT_FILTERS: Array<AgentOutputFilterOption> = [
  { id: 'all', label: 'All', emoji: '📋' },
  { id: 'ok', label: 'Success', emoji: '✅' },
  { id: 'error', label: 'Errors', emoji: '❌' },
  { id: 'running', label: 'Running', emoji: '⏳' },
]
const OUTPUT_REFRESH_INTERVAL_MS = 30_000
const MAX_OUTPUTS = 100
const RUN_FETCH_CONCURRENCY = 4

function statusForOutput(status: string): AgentOutputStatus {
  if (status === 'success') return 'ok'
  if (status === 'error') return 'error'
  if (status === 'running' || status === 'queued') return 'running'
  return 'unknown'
}

function outputText(value: unknown): string {
  if (typeof value === 'string') return value
  if (value === undefined || value === null) return ''
  try {
    return JSON.stringify(value, null, 2)
  } catch {
    return String(value)
  }
}

function agentDetails(jobName: string): { id: string; name: string } {
  const parts = jobName
    .split(':')
    .map((part) => part.trim())
    .filter(Boolean)
  const id = parts[0] === 'ops' ? parts[1] || 'operations' : parts[0]
  return {
    id,
    name: id
      .split(/[-_]/g)
      .filter(Boolean)
      .map((part) => part[0].toUpperCase() + part.slice(1))
      .join(' '),
  }
}

export function normalizeCronOutput(
  job: { id: string; name: string },
  run: {
    id: string
    status: string
    startedAt: string | null
    finishedAt: string | null
    durationMs?: number
    error?: string
    deliverySummary?: string
    chatSessionKey?: string
    output?: unknown
  },
): AgentOutput {
  const agent = agentDetails(job.name)
  const status = statusForOutput(run.status)
  const fullOutput =
    outputText(run.output) || run.deliverySummary || run.error || ''
  const timestamp = run.startedAt || run.finishedAt || new Date(0).toISOString()
  return {
    id: `${job.id}:${run.id}`,
    agentId: agent.id,
    agentName: agent.name || job.name,
    agentEmoji: agent.id === 'trader' ? '📈' : '🤖',
    jobId: job.id,
    jobName: job.name,
    timestamp: Date.parse(timestamp) || 0,
    durationMs: run.durationMs,
    status,
    statusLabel: status === 'ok' ? 'Success' : undefined,
    summary:
      run.error ||
      run.deliverySummary ||
      (status === 'running' ? 'Run in progress' : 'No summary available'),
    fullOutput: fullOutput || 'No output was recorded for this run.',
    sessionKey: run.chatSessionKey,
    chatSessionKey: run.chatSessionKey,
    error: run.error,
  }
}

function matchesFilter(
  output: AgentOutput,
  filter: AgentOutputFilter,
): boolean {
  return filter === 'all' || output.status === filter
}

async function loadJobOutputs(
  jobs: Array<{
    id: string
    name: string
    lastRun?: Parameters<typeof normalizeCronOutput>[1]
  }>,
): Promise<Array<AgentOutput>> {
  const groups: Array<Array<AgentOutput>> = Array.from(
    { length: jobs.length },
    () => [],
  )
  let nextIndex = 0

  async function worker() {
    while (nextIndex < jobs.length) {
      const index = nextIndex++
      const job = jobs[index]
      try {
        const runs = await fetchCronRuns(job.id)
        groups[index] = runs.map((run) => normalizeCronOutput(job, run))
      } catch {
        groups[index] = job.lastRun
          ? [normalizeCronOutput(job, job.lastRun)]
          : []
      }
    }
  }

  await Promise.all(
    Array.from({ length: Math.min(RUN_FETCH_CONCURRENCY, jobs.length) }, () =>
      worker(),
    ),
  )
  return groups.flat()
}

export function useAgentOutputs(filter: AgentOutputFilter) {
  const [outputs, setOutputs] = useState<Array<AgentOutput>>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [refreshToken, setRefreshToken] = useState(0)

  const refresh = useCallback(() => {
    setRefreshToken((value) => value + 1)
  }, [])

  useEffect(() => {
    let active = true
    const isActive = () => active
    setLoading(true)
    setError(null)

    void (async () => {
      try {
        const jobs = await fetchCronJobs()
        const jobOutputs = await loadJobOutputs(jobs)
        if (!isActive()) return
        setOutputs(
          jobOutputs
            .sort((left, right) => right.timestamp - left.timestamp)
            .slice(0, MAX_OUTPUTS),
        )
      } catch (cause) {
        if (!isActive()) return
        setError(
          cause instanceof Error
            ? cause.message
            : 'Failed to load agent outputs',
        )
        setOutputs([])
      } finally {
        if (isActive()) setLoading(false)
      }
    })()

    const refreshTimer = window.setInterval(() => {
      if (active) setRefreshToken((value) => value + 1)
    }, OUTPUT_REFRESH_INTERVAL_MS)

    return () => {
      active = false
      window.clearInterval(refreshTimer)
    }
  }, [refreshToken])

  return {
    outputs: outputs.filter((output) => matchesFilter(output, filter)),
    availableFilters: DEFAULT_FILTERS,
    loading,
    error,
    refresh,
  }
}
