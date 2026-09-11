import { useEffect, useMemo, useState } from 'react'
import { useFinanceAction } from '../../finance/hooks/use-finance-action'
import {
  buttonClass,
  confirmButtonClass,
  dangerTone,
  neutralTone,
  warningTone,
} from '../shared-styles'
import { stringField } from '../field-helpers'
import type { PersonalFinancePayload } from '../types'

type FinanceManagerProfile = {
  name: string
  description: string
  contextVersion: string
  scopes: Array<string>
  approvalRequiredFor: Array<string>
}

type FinanceAgentContext = {
  contextVersion: string
  sensitivity: string
  data?: {
    aiTaskSummary?: {
      total: number
      awaitingApproval: number
      highRisk: number
    }
  }
}

type FinanceAgentTaskListItem = Record<string, unknown>

type FinanceAuditStatus = {
  valid: boolean
  entries: number
  chainedEntries: number
  legacyEntries: number
  firstInvalidAt: string | null
  retentionDays: number
  retentionWarning: boolean
}

type FinanceAuditPrunePreview = {
  retentionDays: number
  cutoff: string
  totalEntries: number
  eligibleEntries: number
  retainedEntries: number
}

type FinanceAuditArchiveSummary = {
  name: string
  bytes: number
  modifiedAt: string
}

type FinanceAuditArchiveVerification = {
  valid: boolean
  name: string
  bytes: number | null
  archiveType: 'finance-audit' | null
  archivedAt: string | null
  auditEntries: number | null
  metadata: Record<string, unknown> | null
  reason?: string
}

type TaskFilter = 'all' | 'queued' | 'running' | 'awaiting_approval' | 'completed' | 'failed' | 'cancelled'
type RiskFilter = 'all' | 'low' | 'medium' | 'high'
type AgeFilter = 'all' | 'today' | '7d' | '30d'

function taskStatusTone(status: string): string {
  if (status === 'awaiting_approval') return warningTone
  if (status === 'failed') return dangerTone
  if (status === 'completed') return confirmButtonClass
  return neutralTone
}

export function FinanceManagerPanel({
  payload,
  onPayload,
}: {
  payload: PersonalFinancePayload
  onPayload: (payload: PersonalFinancePayload) => void
}) {
  const { run: post, busy, error } =
    useFinanceAction<PersonalFinancePayload>(onPayload)
  const [profile, setProfile] = useState<FinanceManagerProfile | null>(null)
  const [context, setContext] = useState<FinanceAgentContext | null>(null)
  const [auditStatus, setAuditStatus] = useState<FinanceAuditStatus | null>(null)
  const [auditPreview, setAuditPreview] = useState<FinanceAuditPrunePreview | null>(null)
  const [auditArchives, setAuditArchives] = useState<Array<FinanceAuditArchiveSummary>>([])
  const [archiveVerification, setArchiveVerification] = useState<FinanceAuditArchiveVerification | null>(null)
  const [archiveVerifying, setArchiveVerifying] = useState<string | null>(null)
  const [auditActionBusy, setAuditActionBusy] = useState(false)
  const [metadataError, setMetadataError] = useState<string | null>(null)
  const [loadingMetadata, setLoadingMetadata] = useState(false)
  const [statusFilter, setStatusFilter] = useState<TaskFilter>('all')
  const [riskFilter, setRiskFilter] = useState<RiskFilter>('all')
  const [agentFilter, setAgentFilter] = useState('all')
  const [ageFilter, setAgeFilter] = useState<AgeFilter>('all')
  const [historyTasks, setHistoryTasks] = useState<Array<FinanceAgentTaskListItem>>([])
  const [historyTotal, setHistoryTotal] = useState(0)
  const [historyOffset, setHistoryOffset] = useState(0)
  const [historyHasMore, setHistoryHasMore] = useState(false)
  const [historyLoading, setHistoryLoading] = useState(false)
  const [exporting, setExporting] = useState(false)
  const [selectedTask, setSelectedTask] = useState<FinanceAgentTaskListItem | null>(null)

  const tasks = payload.data.ai_tasks ?? []
  const agentNames = useMemo(
    () =>
      Array.from(
        new Set(
          tasks
            .map((task) => stringField(task, 'agentName'))
            .filter(Boolean),
        ),
      ).sort(),
    [tasks],
  )
  const filteredTasks = useMemo(
    () =>
      tasks
        .filter((task) => statusFilter === 'all' || stringField(task, 'status') === statusFilter)
        .filter((task) => riskFilter === 'all' || stringField(task, 'risk') === riskFilter)
        .filter((task) => agentFilter === 'all' || stringField(task, 'agentName') === agentFilter)
        .filter((task) => {
          if (ageFilter === 'all') return true
          const created = Date.parse(stringField(task, 'createdAt'))
          if (!Number.isFinite(created)) return false
          const now = Date.now()
          const windowMs = ageFilter === 'today' ? 86_400_000 : ageFilter === '7d' ? 7 * 86_400_000 : 30 * 86_400_000
          return now - created <= windowMs
        })
        .slice()
        .sort((a, b) =>
          stringField(b, 'createdAt').localeCompare(stringField(a, 'createdAt')),
        ),
    [agentFilter, ageFilter, riskFilter, statusFilter, tasks],
  )
  const reviewTasks = filteredTasks.filter((task) => {
    const status = stringField(task, 'status')
    return status !== 'completed' && status !== 'cancelled'
  })
  const awaitingApproval = reviewTasks.filter(
    (task) => stringField(task, 'status') === 'awaiting_approval',
  ).length

  async function loadAuditArchives(): Promise<Array<FinanceAuditArchiveSummary>> {
    const response = await fetch('/api/finance', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ action: 'list_finance_audit_archives' }),
    })
    const data = (await response.json()) as {
      financeAuditArchives?: Array<FinanceAuditArchiveSummary>
      error?: string
    }
    if (!response.ok || !data.financeAuditArchives)
      throw new Error(data.error || 'Finance audit archives unavailable')
    return data.financeAuditArchives
  }

  useEffect(() => {
    let active = true
    setLoadingMetadata(true)
    setMetadataError(null)
    void Promise.all([
      fetch('/api/finance', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ action: 'get_finance_agent_profile' }),
      }).then(async (response) => {
        const data = (await response.json()) as {
          financeAgentProfile?: FinanceManagerProfile
          error?: string
        }
        if (!response.ok || !data.financeAgentProfile)
          throw new Error(data.error || 'Finance Manager profile unavailable')
        return data.financeAgentProfile
      }),
      fetch('/api/finance', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ action: 'build_finance_context' }),
      }).then(async (response) => {
        const data = (await response.json()) as {
          financeAgentContext?: FinanceAgentContext
          error?: string
        }
        if (!response.ok || !data.financeAgentContext)
          throw new Error(data.error || 'Finance context unavailable')
        return data.financeAgentContext
      }),
      fetch('/api/finance', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ action: 'finance_audit_status' }),
      }).then(async (response) => {
        const data = (await response.json()) as {
          financeAudit?: FinanceAuditStatus
          error?: string
        }
        if (!response.ok || !data.financeAudit)
          throw new Error(data.error || 'Finance audit status unavailable')
        return data.financeAudit
      }),
      loadAuditArchives(),
    ])
      .then(([nextProfile, nextContext, nextAudit, nextArchives]) => {
        if (!active) return
        setProfile(nextProfile)
        setContext(nextContext)
        setAuditStatus(nextAudit)
        setAuditArchives(nextArchives)
      })
      .catch((nextError) => {
        if (active)
          setMetadataError(
            nextError instanceof Error
              ? nextError.message
              : 'Finance Manager metadata unavailable',
          )
      })
      .finally(() => {
        if (active) setLoadingMetadata(false)
      })
    return () => {
      active = false
    }
  }, [])

  useEffect(() => {
    let active = true
    setHistoryLoading(true)
    const now = Date.now()
    const ageMs =
      ageFilter === 'today'
        ? 86_400_000
        : ageFilter === '7d'
          ? 7 * 86_400_000
          : ageFilter === '30d'
            ? 30 * 86_400_000
            : null
    const body: Record<string, unknown> = {
      action: 'list_ai_tasks',
      terminalOnly: true,
      limit: 30,
      offset: historyOffset,
    }
    if (statusFilter !== 'all') body.status = statusFilter
    if (riskFilter !== 'all') body.risk = riskFilter
    if (agentFilter !== 'all') body.agentName = agentFilter
    if (ageMs !== null) body.from = new Date(now - ageMs).toISOString()

    void fetch('/api/finance', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    })
      .then(async (response) => {
        const data = (await response.json()) as {
          aiTaskPage?: {
            items: Array<FinanceAgentTaskListItem>
            total: number
            hasMore: boolean
          }
          error?: string
        }
        if (!response.ok || !data.aiTaskPage)
          throw new Error(data.error || 'Task history unavailable')
        return data.aiTaskPage
      })
      .then((page) => {
        if (!active) return
        setHistoryTasks(page.items)
        setHistoryTotal(page.total)
        setHistoryHasMore(page.hasMore)
      })
      .catch(() => {
        if (active) {
          setHistoryTasks([])
          setHistoryTotal(0)
          setHistoryHasMore(false)
        }
      })
      .finally(() => {
        if (active) setHistoryLoading(false)
      })
    return () => {
      active = false
    }
  }, [agentFilter, ageFilter, historyOffset, riskFilter, statusFilter])

  async function updateTask(id: string, status: 'completed' | 'cancelled') {
    const nextPayload = await post(
      {
        action: 'update_record',
        kind: 'ai_task',
        id,
        payload: { status },
      },
      `ai-task-${id}`,
    )
    const updated = nextPayload?.data.ai_tasks?.find(
      (task) => stringField(task, 'id') === id,
    )
    if (updated) setSelectedTask(updated)
  }

  async function exportReview() {
    setExporting(true)
    try {
      const response = await fetch('/api/finance', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ action: 'export_ai_task_review' }),
      })
      if (!response.ok) throw new Error('Task review export failed')
      const blob = await response.blob()
      const url = URL.createObjectURL(blob)
      const anchor = document.createElement('a')
      anchor.href = url
      anchor.download = `finance-ai-task-review-${new Date().toISOString().slice(0, 10)}.csv`
      document.body.appendChild(anchor)
      anchor.click()
      anchor.remove()
      URL.revokeObjectURL(url)
    } finally {
      setExporting(false)
    }
  }

  async function previewAuditPrune() {
    setAuditActionBusy(true)
    try {
      const response = await fetch('/api/finance', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ action: 'preview_finance_audit_prune' }),
      })
      const data = (await response.json()) as {
        financeAuditPrune?: FinanceAuditPrunePreview
        error?: string
      }
      if (!response.ok || !data.financeAuditPrune)
        throw new Error(data.error || 'Retention preview failed')
      setAuditPreview(data.financeAuditPrune)
    } finally {
      setAuditActionBusy(false)
    }
  }

  async function archiveAndPruneAudit() {
    if (!auditPreview || auditPreview.eligibleEntries === 0) return
    if (
      !window.confirm(
        `Create an encrypted archive and remove ${auditPreview.eligibleEntries} old audit entries?`,
      )
    )
      return
    setAuditActionBusy(true)
    try {
      const response = await fetch('/api/finance', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          action: 'archive_and_prune_finance_audit',
          confirm: true,
          retentionDays: auditPreview.retentionDays,
        }),
      })
      const data = (await response.json()) as {
        financeAudit?: FinanceAuditStatus
        error?: string
      }
      if (!response.ok || !data.financeAudit)
        throw new Error(data.error || 'Audit archive/prune failed')
      setAuditStatus(data.financeAudit)
      setAuditPreview(null)
      setAuditArchives(await loadAuditArchives())
    } finally {
      setAuditActionBusy(false)
    }
  }

  async function verifyAuditArchive(name: string) {
    setArchiveVerifying(name)
    try {
      const response = await fetch('/api/finance', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ action: 'verify_finance_audit_archive', name }),
      })
      const data = (await response.json()) as {
        financeAuditArchive?: FinanceAuditArchiveVerification
        error?: string
      }
      if (!data.financeAuditArchive)
        throw new Error(data.error || 'Archive verification failed')
      setArchiveVerification(data.financeAuditArchive)
    } finally {
      setArchiveVerifying(null)
    }
  }

  return (
    <section className="mt-6 rounded-3xl border border-[var(--theme-border)] bg-[var(--theme-panel)]/70 p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-[var(--theme-accent-secondary)]">
            AI-100 / AI-109
          </p>
          <h2 className="mt-1 text-lg font-semibold text-[var(--theme-text)]">
            Finance Manager
          </h2>
          <p className="mt-1 max-w-2xl text-xs text-[var(--theme-muted)]">
            Read-only context by default. Review explicit task approvals here;
            no action is executed automatically.
          </p>
        </div>
        <span className={`rounded-full border px-2 py-1 text-[10px] ${neutralTone}`}>
          {profile?.contextVersion ?? 'finance-agent-v1'}
        </span>
      </div>

      <div className="mt-4 grid gap-2 sm:grid-cols-3">
        <div className={`rounded-2xl border p-3 ${neutralTone}`}>
          <p className="text-[10px] uppercase tracking-wide">Open tasks</p>
          <p className="mt-1 text-xl font-semibold text-[var(--theme-text)]">
            {reviewTasks.length}
          </p>
        </div>
        <div className={`rounded-2xl border p-3 ${awaitingApproval ? warningTone : neutralTone}`}>
          <p className="text-[10px] uppercase tracking-wide">Needs approval</p>
          <p className="mt-1 text-xl font-semibold text-[var(--theme-text)]">
            {awaitingApproval}
          </p>
        </div>
        <div className={`rounded-2xl border p-3 ${neutralTone}`}>
          <p className="text-[10px] uppercase tracking-wide">Context</p>
          <p className="mt-1 text-sm font-semibold text-[var(--theme-text)]">
            {context?.sensitivity ?? 'aggregated personal finance'}
          </p>
        </div>
      </div>
      {auditStatus && (
        <div className={`mt-3 rounded-2xl border p-3 text-xs ${auditStatus.valid && !auditStatus.retentionWarning ? neutralTone : warningTone}`}>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span className="font-semibold text-[var(--theme-text)]">
              Audit chain {auditStatus.valid ? 'verified' : 'needs review'}
            </span>
            <span>{auditStatus.entries} entries · {auditStatus.chainedEntries} chained</span>
          </div>
          <p className="mt-1 text-[var(--theme-muted)]">
            Retention target: {auditStatus.retentionDays} days
            {auditStatus.legacyEntries > 0 ? ` · ${auditStatus.legacyEntries} legacy entries` : ''}
            {auditStatus.firstInvalidAt ? ` · first issue ${auditStatus.firstInvalidAt}` : ''}
          </p>
          <div className="mt-3 flex flex-wrap gap-2">
            <button
              type="button"
              className={buttonClass}
              onClick={() => void previewAuditPrune()}
              disabled={auditActionBusy}
            >
              Preview retention
            </button>
            {auditPreview && (
              <button
                type="button"
                className={`${buttonClass} ${warningTone}`}
                onClick={() => void archiveAndPruneAudit()}
                disabled={auditActionBusy || auditPreview.eligibleEntries === 0}
              >
                {auditPreview.eligibleEntries === 0
                  ? 'Nothing eligible'
                  : `Archive & prune ${auditPreview.eligibleEntries}`}
              </button>
            )}
          </div>
          {auditPreview && (
            <p className="mt-2 text-[11px] text-[var(--theme-muted)]">
              Preview cutoff: {auditPreview.cutoff} · {auditPreview.retainedEntries} entries retained. An encrypted archive is required before pruning.
            </p>
          )}
        </div>
      )}

      <div className="mt-3 rounded-2xl border border-[var(--theme-border)] p-3 text-xs">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <span className="font-semibold text-[var(--theme-text)]">Encrypted audit archives</span>
          <span className="text-[var(--theme-muted)]">{auditArchives.length} available · verification only</span>
        </div>
        {auditArchives.length === 0 ? (
          <p className="mt-2 text-[var(--theme-muted)]">No encrypted audit archives found in the configured archive location.</p>
        ) : (
          <div className="mt-2 space-y-2">
            {auditArchives.slice(0, 10).map((archive) => (
              <div key={archive.name} className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-[var(--theme-border)] p-2">
                <div className="min-w-0">
                  <p className="truncate font-mono text-[10px] text-[var(--theme-text)]">{archive.name}</p>
                  <p className="text-[10px] text-[var(--theme-muted)]">
                    {(archive.bytes / 1024).toFixed(1)} KB · modified {new Date(archive.modifiedAt).toLocaleString()}
                  </p>
                </div>
                <button
                  type="button"
                  className={buttonClass}
                  onClick={() => void verifyAuditArchive(archive.name)}
                  disabled={archiveVerifying !== null}
                >
                  {archiveVerifying === archive.name ? 'Verifying…' : 'Verify'}
                </button>
              </div>
            ))}
            {auditArchives.length > 10 && (
              <p className="text-[10px] text-[var(--theme-muted)]">Showing the 10 most recently modified archives.</p>
            )}
          </div>
        )}
        {archiveVerification && (
          <div className={`mt-2 rounded-xl border p-2 ${archiveVerification.valid ? neutralTone : warningTone}`}>
            <p className="font-semibold text-[var(--theme-text)]">
              {archiveVerification.valid ? 'Archive verified' : 'Archive verification failed'}
            </p>
            <p className="mt-1 text-[10px] text-[var(--theme-muted)]">
              {archiveVerification.valid
                ? `${archiveVerification.auditEntries ?? 0} audit entries · archived ${archiveVerification.archivedAt ?? 'unknown'}`
                : archiveVerification.reason ?? 'Unable to verify archive'}
            </p>
          </div>
        )}
      </div>

      <div className="mt-4 rounded-2xl border border-[var(--theme-border)] p-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="text-xs font-semibold uppercase tracking-wide text-[var(--theme-muted)]">
            Task history filters
          </p>
            <button
            type="button"
            className={buttonClass}
            onClick={() => {
              setStatusFilter('all')
              setRiskFilter('all')
              setAgentFilter('all')
              setAgeFilter('all')
              setHistoryOffset(0)
            }}
          >
            Reset filters
          </button>
          <button
            type="button"
            className={buttonClass}
            onClick={() => void exportReview()}
            disabled={exporting}
          >
            {exporting ? 'Exporting…' : 'Export review CSV'}
          </button>
        </div>
        <div className="mt-2 grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
          <label className="text-xs text-[var(--theme-muted)]">
            Status
            <select
              value={statusFilter}
              onChange={(event) => {
                setStatusFilter(event.target.value as TaskFilter)
                setHistoryOffset(0)
              }}
              className="mt-1 w-full rounded-xl border border-[var(--theme-border)] bg-[var(--theme-panel)] px-2 py-1.5 text-xs text-[var(--theme-text)]"
            >
              <option value="all">All statuses</option>
              <option value="queued">Queued</option>
              <option value="running">Running</option>
              <option value="awaiting_approval">Awaiting approval</option>
              <option value="completed">Completed</option>
              <option value="failed">Failed</option>
              <option value="cancelled">Cancelled</option>
            </select>
          </label>
          <label className="text-xs text-[var(--theme-muted)]">
            Risk
            <select
              value={riskFilter}
              onChange={(event) => {
                setRiskFilter(event.target.value as RiskFilter)
                setHistoryOffset(0)
              }}
              className="mt-1 w-full rounded-xl border border-[var(--theme-border)] bg-[var(--theme-panel)] px-2 py-1.5 text-xs text-[var(--theme-text)]"
            >
              <option value="all">All risk levels</option>
              <option value="low">Low</option>
              <option value="medium">Medium</option>
              <option value="high">High</option>
            </select>
          </label>
          <label className="text-xs text-[var(--theme-muted)]">
            Agent
            <select
              value={agentFilter}
              onChange={(event) => {
                setAgentFilter(event.target.value)
                setHistoryOffset(0)
              }}
              className="mt-1 w-full rounded-xl border border-[var(--theme-border)] bg-[var(--theme-panel)] px-2 py-1.5 text-xs text-[var(--theme-text)]"
            >
              <option value="all">All agents</option>
              {agentNames.map((agent) => (
                <option key={agent} value={agent}>{agent}</option>
              ))}
            </select>
          </label>
          <label className="text-xs text-[var(--theme-muted)]">
            Created
            <select
              value={ageFilter}
              onChange={(event) => {
                setAgeFilter(event.target.value as AgeFilter)
                setHistoryOffset(0)
              }}
              className="mt-1 w-full rounded-xl border border-[var(--theme-border)] bg-[var(--theme-panel)] px-2 py-1.5 text-xs text-[var(--theme-text)]"
            >
              <option value="all">Any time</option>
              <option value="today">Last 24 hours</option>
              <option value="7d">Last 7 days</option>
              <option value="30d">Last 30 days</option>
            </select>
          </label>
        </div>
      </div>

      {(loadingMetadata || metadataError) && (
        <p className="mt-3 text-xs text-[var(--theme-muted)]">
          {loadingMetadata ? 'Loading Finance Manager contract…' : metadataError}
        </p>
      )}
      {error && <p className="mt-3 text-xs text-[var(--theme-danger)]">{error}</p>}

      <div className="mt-4 grid gap-2">
        {reviewTasks.length === 0 ? (
          <p className="rounded-2xl border border-dashed border-[var(--theme-border)] p-4 text-sm text-[var(--theme-muted)]">
            No open Finance Manager tasks.
          </p>
        ) : (
          reviewTasks.slice(0, 12).map((task) => {
            const id = stringField(task, 'id')
            const status = stringField(task, 'status') || 'queued'
            const taskBusy = busy === `ai-task-${id}`
            return (
              <div key={id} className="rounded-2xl border border-[var(--theme-border)] p-3">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div>
                    <p className="text-sm font-medium text-[var(--theme-text)]">
                      {stringField(task, 'title') || 'Finance task'}
                    </p>
                    <p className="mt-1 text-xs text-[var(--theme-muted)]">
                      {stringField(task, 'requestedAction') || 'review'} · risk{' '}
                      {stringField(task, 'risk') || 'low'}
                    </p>
                  </div>
                  <span className={`rounded-full border px-2 py-1 text-[10px] ${taskStatusTone(status)}`}>
                    {status.replaceAll('_', ' ')}
                  </span>
                </div>
                <button
                  type="button"
                  className={`${buttonClass} mt-3`}
                  onClick={() => setSelectedTask(task)}
                >
                  View audit details
                </button>
                {status === 'awaiting_approval' && (
                  <div className="mt-3 flex flex-wrap gap-2">
                    <button
                      type="button"
                      disabled={taskBusy}
                      className={confirmButtonClass}
                      onClick={() => void updateTask(id, 'completed')}
                    >
                      {taskBusy ? 'Saving…' : 'Approve completion'}
                    </button>
                    <button
                      type="button"
                      disabled={taskBusy}
                      className={buttonClass}
                      onClick={() => void updateTask(id, 'cancelled')}
                    >
                      Cancel task
                    </button>
                  </div>
                )}
              </div>
            )
          })
        )}
      </div>

      <div className="mt-5">
        <div className="flex items-center justify-between gap-2">
          <h3 className="text-sm font-semibold text-[var(--theme-text)]">
            Task history
          </h3>
          <span className="text-xs text-[var(--theme-muted)]">
            {historyTotal} matching completed task{historyTotal === 1 ? '' : 's'}
          </span>
        </div>
        {historyLoading ? (
          <p className="mt-2 text-xs text-[var(--theme-muted)]">Loading task history…</p>
        ) : historyTasks.length === 0 ? (
          <p className="mt-2 text-xs text-[var(--theme-muted)]">
            No completed or cancelled tasks match these filters.
          </p>
        ) : (
          <div className="mt-2 grid gap-2">
            {historyTasks.map((task) => {
              const status = stringField(task, 'status') || 'completed'
              return (
                <div key={stringField(task, 'id')} className="flex flex-wrap items-center justify-between gap-2 rounded-2xl border border-[var(--theme-border)] p-3">
                  <div>
                    <p className="text-sm text-[var(--theme-text)]">
                      {stringField(task, 'title') || 'Finance task'}
                    </p>
                    <p className="mt-1 text-xs text-[var(--theme-muted)]">
                      {stringField(task, 'agentName') || 'Finance Manager'} · {stringField(task, 'completedAt') || stringField(task, 'updatedAt')}
                    </p>
                  </div>
                  <span className={`rounded-full border px-2 py-1 text-[10px] ${taskStatusTone(status)}`}>
                    {status.replaceAll('_', ' ')}
                  </span>
                  <button
                    type="button"
                    className={buttonClass}
                    onClick={() => setSelectedTask(task)}
                  >
                    Details
                  </button>
                </div>
              )
            })}
          </div>
        )}
        {historyHasMore && (
          <button
            type="button"
            className={`${buttonClass} mt-3`}
            onClick={() => setHistoryOffset((offset) => offset + 30)}
            disabled={historyLoading}
          >
            Load older tasks
          </button>
        )}
      </div>

      {selectedTask && (
        <aside className="mt-5 rounded-2xl border border-[color-mix(in_srgb,var(--theme-accent-secondary)_40%,transparent)] bg-[color-mix(in_srgb,var(--theme-accent-secondary)_8%,transparent)] p-4">
          <div className="flex flex-wrap items-start justify-between gap-2">
            <div>
              <p className="text-xs font-semibold uppercase tracking-wide text-[var(--theme-accent-secondary)]">
                Audit detail
              </p>
              <h3 className="mt-1 text-base font-semibold text-[var(--theme-text)]">
                {stringField(selectedTask, 'title') || 'Finance task'}
              </h3>
            </div>
            <button
              type="button"
              className={buttonClass}
              onClick={() => setSelectedTask(null)}
            >
              Close
            </button>
          </div>
          <div className="mt-3 grid gap-2 text-xs text-[var(--theme-muted)] sm:grid-cols-2">
            <p>Task ID: <span className="font-mono text-[var(--theme-text)]">{stringField(selectedTask, 'id')}</span></p>
            <p>Action: <span className="text-[var(--theme-text)]">{stringField(selectedTask, 'requestedAction') || 'review'}</span></p>
            <p>Risk: <span className="text-[var(--theme-text)]">{stringField(selectedTask, 'risk') || 'low'}</span></p>
            <p>Agent: <span className="text-[var(--theme-text)]">{stringField(selectedTask, 'agentName') || 'Finance Manager'}</span></p>
          </div>
          <div className="mt-4">
            <p className="text-xs font-semibold text-[var(--theme-text)]">Status timeline</p>
            <div className="mt-2 grid gap-2">
              {(Array.isArray(selectedTask.statusHistory)
                ? selectedTask.statusHistory
                : []
              ).map((event, index) => {
                const entry =
                  event && typeof event === 'object'
                    ? (event as Record<string, unknown>)
                    : {}
                const status = stringField(entry, 'status') || 'unknown'
                return (
                  <div key={`${status}-${stringField(entry, 'at')}-${index}`} className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-[var(--theme-border)] bg-[var(--theme-panel)]/60 px-3 py-2">
                    <span className={`rounded-full border px-2 py-1 text-[10px] ${taskStatusTone(status)}`}>
                      {status.replaceAll('_', ' ')}
                    </span>
                    <span className="text-[11px] text-[var(--theme-muted)]">
                      {stringField(entry, 'by') || 'legacy event'} · {stringField(entry, 'at')}
                    </span>
                  </div>
                )
              })}
            </div>
          </div>
          <p className="mt-3 text-[11px] text-[var(--theme-muted)]">
            Input, result, and error summaries are intentionally omitted from this dashboard detail view.
          </p>
        </aside>
      )}
    </section>
  )
}
