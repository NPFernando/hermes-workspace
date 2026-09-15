import { useQuery } from '@tanstack/react-query'
import { useEffect, useState } from 'react'
import { loadApprovals } from '@/screens/gateway/lib/approvals-store'

type QueueSnapshot = {
  active: { id: string; status: string } | null
  waiting: Array<{ id: string; status: string }>
  recent: Array<{ id: string; status: string; deadLetterAt: number | null }>
}

type WorkerHealth = {
  checkedAt: number
  workers: Array<unknown>
  summary: {
    totalWorkers: number
    degraded: boolean
    workersPrimaryAuthFailed: number
    workersUsingFallback: number
  }
}

type HarpReadiness = {
  available: boolean
  checkedAt: number
  repositoryPath: string
  report: {
    status?: string
    blockers?: Array<string>
    graphify?: {
      status?: string
      fresh?: boolean | null
      refresh_required?: boolean
      changed_file_count?: number
    }
    health?: {
      postgres?: { healthy?: boolean; status?: string }
      graphify?: { healthy?: boolean; status?: string }
    }
    quality?: { schema_available?: boolean }
    governance?: { open_conflicts?: number }
    execution_enabled?: boolean
    side_effects?: boolean
    operator_approval_required?: boolean
  } | null
}

type SessionHealth = {
  available: boolean
  installation: { installedExecutable: boolean; packageVersion: string | null }
  probeProcess: {
    alive: boolean | null
    pid: number | null
    role: string | null
  }
  sessions: Array<{
    name: string
    attached: boolean
    paneProcessAlive: boolean | null
    paneDead: boolean
    tuiResponsive: boolean
    heartbeatLatencyMs: number | null
    keysSent: false
  }>
}

async function fetchJson<T>(path: string): Promise<T> {
  const response = await fetch(path, {
    headers: { Accept: 'application/json' },
  })
  if (!response.ok) throw new Error(`HTTP ${response.status}`)
  return (await response.json()) as T
}

function SummaryCard({
  title,
  children,
}: {
  title: string
  children: React.ReactNode
}) {
  return (
    <section className="min-w-0 rounded-xl border border-[var(--theme-border,rgba(128,128,128,0.2))] bg-[var(--theme-panel)] p-4">
      <h3 className="mb-2 text-sm font-semibold text-[var(--theme-text)]">
        {title}
      </h3>
      {children}
    </section>
  )
}

function Value({ children }: { children: React.ReactNode }) {
  return <p className="text-sm text-[var(--theme-text)]">{children}</p>
}

function LocalApprovalCount() {
  const [count, setCount] = useState<number | null>(null)

  useEffect(() => {
    const refresh = () => {
      try {
        setCount(
          loadApprovals().filter((item) => item.status === 'pending').length,
        )
      } catch {
        setCount(null)
      }
    }
    refresh()
    const timer = window.setInterval(refresh, 2000)
    window.addEventListener('storage', refresh)
    return () => {
      window.clearInterval(timer)
      window.removeEventListener('storage', refresh)
    }
  }, [])

  return (
    <SummaryCard title="Approval requests">
      <Value>
        {count == null ? 'Unavailable in this browser' : `${count} pending`}
      </Value>
      <p className="mt-1 text-xs text-[var(--theme-muted)]">
        Browser-local requests; review and resolve in Chat.
      </p>
      <a
        className="mt-3 inline-block text-xs text-accent-400 hover:underline"
        href="/chat"
      >
        Open approval review →
      </a>
    </SummaryCard>
  )
}

export function AgentControlPlane() {
  const queue = useQuery({
    queryKey: ['agent-control-plane', 'queue'],
    queryFn: () => fetchJson<QueueSnapshot>('/api/swarm-dispatch'),
    refetchInterval: 30_000,
  })
  const workers = useQuery({
    queryKey: ['agent-control-plane', 'workers'],
    queryFn: () => fetchJson<WorkerHealth>('/api/swarm-health'),
    refetchInterval: 30_000,
  })
  const harp = useQuery({
    queryKey: ['agent-control-plane', 'harp-readiness'],
    queryFn: () =>
      fetchJson<{ readiness: HarpReadiness }>('/api/harp-observability').then(
        (data) => data.readiness,
      ),
    refetchInterval: 60_000,
  })
  const sessionHealth = useQuery({
    queryKey: ['agent-control-plane', 'workspace-session-health'],
    queryFn: () => fetchJson<SessionHealth>('/api/workspace-session-health'),
    refetchInterval: 30_000,
  })

  const ready = harp.data?.report
  const blockers = ready?.blockers ?? []
  const openMemoryConflicts = ready?.governance?.open_conflicts
  const changedGraphFiles = ready?.graphify?.changed_file_count
  const graphifyFreshness =
    ready?.graphify?.refresh_required === true
      ? `stale · refresh required${
          typeof changedGraphFiles === 'number'
            ? ` · ${changedGraphFiles} changed files`
            : ''
        }`
      : ready?.graphify?.fresh === true
        ? 'fresh'
        : ready?.graphify?.fresh === false
          ? 'stale'
          : (ready?.graphify?.status ?? 'unknown')
  const postgresHealth =
    ready?.health?.postgres?.healthy === true
      ? 'healthy'
      : (ready?.health?.postgres?.status ?? 'unknown')
  const qualitySchema =
    ready?.quality?.schema_available === true
      ? 'available'
      : ready?.quality?.schema_available === false
        ? 'unavailable'
        : 'unknown'
  const executionState =
    ready?.execution_enabled === false
      ? 'disabled'
      : ready?.execution_enabled === true
        ? 'enabled'
        : 'unknown'

  return (
    <section
      aria-labelledby="agent-control-plane-heading"
      className="space-y-3"
    >
      <div>
        <h2
          id="agent-control-plane-heading"
          className="text-base font-semibold text-[var(--theme-text)]"
        >
          Agent control plane
        </h2>
        <p className="text-xs text-[var(--theme-muted)]">
          Read-only status overview. Queue and approval actions remain in their
          dedicated workflows.
        </p>
      </div>
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
        <SummaryCard title="Dispatch queue">
          {queue.isError ? (
            <Value>Unavailable · queue API could not be read</Value>
          ) : queue.data ? (
            <>
              <Value>
                {queue.data.active ? '1 active' : 'No active job'} ·{' '}
                {queue.data.waiting.length} waiting
              </Value>
              <p className="mt-1 text-xs text-[var(--theme-muted)]">
                {
                  queue.data.recent.filter((job) => job.deadLetterAt != null)
                    .length
                }{' '}
                recent dead-lettered
              </p>
            </>
          ) : (
            <Value>Loading queue status…</Value>
          )}
          <a
            className="mt-3 inline-block text-xs text-accent-400 hover:underline"
            href="/swarm2"
          >
            Open queue controls →
          </a>
        </SummaryCard>

        <SummaryCard title="Agent health">
          {workers.isError ? (
            <Value>Unavailable · worker health API could not be read</Value>
          ) : workers.data ? (
            <>
              <Value>
                {workers.data.summary.totalWorkers} configured ·{' '}
                {workers.data.summary.degraded
                  ? 'degraded'
                  : 'no auth degradation reported'}
              </Value>
              <p className="mt-1 text-xs text-[var(--theme-muted)]">
                {workers.data.summary.workersPrimaryAuthFailed} primary-auth
                issues · {workers.data.summary.workersUsingFallback} using
                fallback
              </p>
            </>
          ) : (
            <Value>Loading worker status…</Value>
          )}
          <a
            className="mt-3 inline-block text-xs text-accent-400 hover:underline"
            href="/agents"
          >
            Open agent management →
          </a>
        </SummaryCard>

        <SummaryCard title="HARP memory readiness">
          {harp.isError || (harp.data && !harp.data.available) ? (
            <Value>
              Unavailable · readiness service did not return a report
            </Value>
          ) : ready ? (
            <>
              <Value>
                {ready.status ?? 'Unknown'} · {blockers.length} blocker(s)
              </Value>
              <p className="mt-1 break-all text-xs text-[var(--theme-muted)]">
                {harp.data?.repositoryPath}
              </p>
              {blockers.length > 0 && (
                <p className="mt-1 text-xs text-amber-300">
                  {blockers.join(', ')}
                </p>
              )}
              <p className="mt-1 text-xs text-[var(--theme-muted)]">
                Graphify data: {graphifyFreshness}
                {' · '}Postgres: {postgresHealth}
                {' · '}Quality schema: {qualitySchema}
              </p>
              <p className="mt-1 text-xs text-[var(--theme-muted)]">
                Unresolved memory conflicts:{' '}
                {typeof openMemoryConflicts === 'number'
                  ? openMemoryConflicts
                  : 'unknown'}
              </p>
              {ready.health?.graphify?.status &&
                ready.health.graphify.status !== 'ready' && (
                  <p className="mt-1 text-xs text-[var(--theme-muted)]">
                    Graphify service check: {ready.health.graphify.status};
                    repository freshness is reported separately.
                  </p>
              )}
              <p className="mt-1 text-xs text-[var(--theme-muted)]">
                Execution: {executionState}
                {' · '}Side effects: {String(ready.side_effects)}
                {' · '}Operator approval required:{' '}
                {String(ready.operator_approval_required)}
              </p>
            </>
          ) : (
            <Value>Loading readiness…</Value>
          )}
        </SummaryCard>

        <SummaryCard title="Workspace sessions">
          {sessionHealth.isError ||
          (sessionHealth.data && !sessionHealth.data.available) ? (
            <Value>Unavailable · WSM heartbeat could not be read</Value>
          ) : sessionHealth.data ? (
            <>
              <Value>
                WSM{' '}
                {sessionHealth.data.installation.packageVersion ??
                  'version unknown'}{' '}
                · {sessionHealth.data.sessions.length} session(s)
              </Value>
              <p className="mt-1 text-xs text-[var(--theme-muted)]">
                WSM probe process:{' '}
                {sessionHealth.data.probeProcess.alive === true
                  ? 'healthy'
                  : sessionHealth.data.probeProcess.alive === false
                    ? 'unavailable'
                    : 'unknown'}
                {' · '}
                {
                  sessionHealth.data.sessions.filter((item) => item.attached)
                    .length
                }{' '}
                attached ·{' '}
                {
                  sessionHealth.data.sessions.filter(
                    (item) =>
                      item.paneProcessAlive === true && item.tuiResponsive,
                  ).length
                }{' '}
                pane/process probes responsive
              </p>
              <p className="mt-1 text-xs text-[var(--theme-muted)]">
                TUI probe means pane capture only; no keys sent and no agent
                reply inferred.
              </p>
            </>
          ) : (
            <Value>Loading session status…</Value>
          )}
        </SummaryCard>

        <LocalApprovalCount />
      </div>
    </section>
  )
}
