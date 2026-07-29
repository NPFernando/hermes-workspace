'use client'

import { useCallback, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { HugeiconsIcon } from '@hugeicons/react'
import { Alert02Icon, Bug01Icon, KeyIcon, Link04Icon, Loading03Icon, LockIcon, MessageIcon, RefreshIcon, Settings01Icon, Tick01Icon } from '@hugeicons/core-free-icons'
import type { ClaudeTask } from '@/lib/tasks-api'
import { autoResumeBlocked, fetchBlockers, provideCredential, resolveBlocker, validateCredentials } from '@/lib/tasks-api'
import { cn } from '@/lib/utils'
import { toast } from '@/components/ui/toast'

const BLOCKER_COLORS: Record<string, string> = {
  credential:  'border-amber-500/30 bg-amber-500/5',
  dependency:  'border-blue-500/30 bg-blue-500/5',
  execution:   'border-red-500/30 bg-red-500/5',
  input:       'border-purple-500/30 bg-purple-500/5',
  environment: 'border-cyan-500/30 bg-cyan-500/5',
  unknown:     'border-gray-500/30 bg-gray-500/5',
}

const BLOCKER_BADGE_COLORS: Record<string, string> = {
  credential:  'text-amber-400 bg-amber-500/10 border-amber-500/30',
  dependency:  'text-blue-400 bg-blue-500/10 border-blue-500/30',
  execution:   'text-red-400 bg-red-500/10 border-red-500/30',
  input:       'text-purple-400 bg-purple-500/10 border-purple-500/30',
  environment: 'text-cyan-400 bg-cyan-500/10 border-cyan-500/30',
  unknown:     'text-gray-400 bg-gray-500/10 border-gray-500/30',
}

const BLOCKER_ICONS: Record<string, string> = {
  credential:  '🔑',
  dependency:  '🔗',
  execution:   '⚠️',
  input:       '💬',
  environment: '🖥️',
  unknown:     '🚫',
}

const QUERY_KEY = ['tasks', 'blockers'] as const

type CredentialFormState = {
  taskId: string
  credentialKey: string
  credentialLabel: string
  value: string
}

export function BlockerPanel() {
  const queryClient = useQueryClient()
  const [expandedGroup, setExpandedGroup] = useState<string | null>(null)
  const [credentialForm, setCredentialForm] = useState<CredentialFormState | null>(null)

  // ── Queries ──────────────────────────────────────────────────────────────
  const { data, isLoading, error, refetch } = useQuery({
    queryKey: QUERY_KEY,
    queryFn: fetchBlockers,
    refetchInterval: 30_000,
  })

  // ── Mutations ────────────────────────────────────────────────────────────
  const resolveMutation = useMutation({
    mutationFn: (taskId: string) => resolveBlocker(taskId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: QUERY_KEY })
      queryClient.invalidateQueries({ queryKey: ['claude', 'tasks'] })
      toast('Blocker resolved', { type: 'success' })
    },
    onError: (err: Error) => toast(err.message, { type: 'error' }),
  })

  const provideMutation = useMutation({
    mutationFn: (params: { taskId: string; credentialKey: string; credentialValue: string }) =>
      provideCredential(params.taskId, params.credentialKey, params.credentialValue),
    onSuccess: (result) => {
      queryClient.invalidateQueries({ queryKey: QUERY_KEY })
      queryClient.invalidateQueries({ queryKey: ['claude', 'tasks'] })
      setCredentialForm(null)
      if (result.all_provided) {
        toast('All credentials collected! Run validation to unblock.', { type: 'success' })
      } else {
        toast('Credential saved', { type: 'success' })
      }
    },
    onError: (err: Error) => toast(err.message, { type: 'error' }),
  })

  const validateMutation = useMutation({
    mutationFn: (taskId: string) => validateCredentials(taskId),
    onSuccess: (result) => {
      queryClient.invalidateQueries({ queryKey: QUERY_KEY })
      queryClient.invalidateQueries({ queryKey: ['claude', 'tasks'] })
      if (result.all_valid) {
        toast('All credentials validated — task unblocked!', { type: 'success' })
      } else {
        const failed = result.results.filter((r) => !r.exists).map((r) => r.label).join(', ')
        toast(`Validation failed for: ${failed}`, { type: 'error' })
      }
    },
    onError: (err: Error) => toast(err.message, { type: 'error' }),
  })

  const autoResumeMutation = useMutation({
    mutationFn: () => autoResumeBlocked(),
    onSuccess: (result) => {
      queryClient.invalidateQueries({ queryKey: QUERY_KEY })
      queryClient.invalidateQueries({ queryKey: ['claude', 'tasks'] })
      if (result.unblocked.length > 0) {
        toast(`Auto-resumed ${result.unblocked.length} task${result.unblocked.length > 1 ? 's' : ''}`, { type: 'success' })
      } else {
        toast('No tasks ready for auto-resume', { type: 'info' })
      }
    },
    onError: (err: Error) => toast(err.message, { type: 'error' }),
  })

  // ── Credential collection modal ──────────────────────────────────────────
  const renderCredentialForm = () => {
    if (!credentialForm) return null
    return (
      <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
        <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={() => setCredentialForm(null)} />
        <div className="relative z-10 w-full max-w-md bg-[var(--theme-card)] border border-[var(--theme-border)] rounded-xl shadow-2xl">
          <div className="flex items-center justify-between px-5 py-4 border-b border-[var(--theme-border)]">
            <span className="font-semibold text-sm text-[var(--theme-text)]">
              🔑 {credentialForm.credentialLabel}
            </span>
            <button type="button" onClick={() => setCredentialForm(null)} className="text-[var(--theme-muted)] hover:text-[var(--theme-text)] text-lg leading-none">×</button>
          </div>
          <div className="px-5 py-4 flex flex-col gap-3">
            <p className="text-xs text-[var(--theme-muted)]">
              This credential will be written to your <code className="text-[var(--theme-text)] bg-[var(--theme-hover)] px-1 rounded">.env</code> file.
              It will never be stored in the task database.
            </p>
            <div className="flex flex-col gap-1.5">
              <label className="text-[11px] font-medium text-[var(--theme-text)]">
                {credentialForm.credentialKey}
              </label>
              <input
                type="text"
                autoFocus
                placeholder="Paste or type the credential value…"
                className="w-full px-3 py-2 text-xs rounded-lg border border-[var(--theme-border)] bg-[var(--theme-bg)] text-[var(--theme-text)] placeholder:text-[var(--theme-muted)] focus:outline-none focus:ring-1 focus:ring-amber-500/50"
                value={credentialForm.value}
                onChange={(e) => setCredentialForm({ ...credentialForm, value: e.target.value })}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && credentialForm.value.trim()) {
                    provideMutation.mutate({
                      taskId: credentialForm.taskId,
                      credentialKey: credentialForm.credentialKey,
                      credentialValue: credentialForm.value.trim(),
                    })
                  }
                }}
              />
            </div>
            <div className="flex gap-3 mt-2">
              <button
                type="button"
                onClick={() => setCredentialForm(null)}
                className="flex-1 text-xs rounded-lg border border-[var(--theme-border)] px-3 py-2 text-[var(--theme-muted)] hover:bg-[var(--theme-hover)] transition-colors"
              >Cancel</button>
              <button
                type="button"
                disabled={!credentialForm.value.trim() || provideMutation.isPending}
                onClick={() => {
                  provideMutation.mutate({
                    taskId: credentialForm.taskId,
                    credentialKey: credentialForm.credentialKey,
                    credentialValue: credentialForm.value.trim(),
                  })
                }}
                className="flex-1 text-xs rounded-lg border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-amber-400 hover:bg-amber-500/20 transition-colors disabled:opacity-40"
              >{provideMutation.isPending ? 'Saving…' : 'Save & Close'}</button>
            </div>
          </div>
        </div>
      </div>
    )
  }

  // ── Task card ────────────────────────────────────────────────────────────
  const renderTaskCard = useCallback((task: ClaudeTask) => {
    const isResolving = resolveMutation.isPending && resolveMutation.variables === task.id
    const isValidating = validateMutation.isPending && validateMutation.variables === task.id

    return (
      <div key={task.id} className={cn(
        'px-3 py-2 rounded-lg border transition-all',
        BLOCKER_COLORS[task.blocker_type ?? 'unknown'] ?? BLOCKER_COLORS.unknown,
      )}>
        <div className="flex items-start justify-between gap-2">
          <div className="flex-1 min-w-0">
            <p className="text-xs font-medium text-[var(--theme-text)] truncate">{task.title}</p>
            {task.blocker_reason && (
              <p className="text-[10px] text-[var(--theme-muted)] mt-0.5 line-clamp-2">{task.blocker_reason}</p>
            )}
            {task.blocked_since && (
              <p className="text-[10px] text-[var(--theme-muted)] mt-0.5">
                Blocked {Math.round((Date.now() - new Date(task.blocked_since).getTime()) / 3600000)}h ago
              </p>
            )}
          </div>
          <div className="flex items-center gap-1 flex-shrink-0">
            {/* Credential blockers: show credential status badges */}
            {task.blocker_type === 'credential' && task.credentials_needed && (
              <div className="flex flex-wrap gap-1 mr-1">
                {task.credentials_needed.map((c) => (
                  <span
                    key={c.key}
                    className={cn(
                      'inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[9px] font-medium cursor-pointer border transition-colors',
                      c.provided
                        ? 'text-green-400 bg-green-500/10 border-green-500/30'
                        : 'text-amber-400 bg-amber-500/10 border-amber-500/30 hover:bg-amber-500/20',
                    )}
                    onClick={() => {
                      if (!c.provided) {
                        setCredentialForm({
                          taskId: task.id,
                          credentialKey: c.key,
                          credentialLabel: c.label,
                          value: '',
                        })
                      }
                    }}
                    title={c.provided ? `${c.label}: provided${c.validated ? ' ✓' : ''}` : `Click to provide ${c.label}`}
                  >
                    {c.provided ? '✓' : '○'} {c.label}
                  </span>
                ))}
              </div>
            )}

            {/* Validate button (when all credentials provided) */}
            {task.blocker_type === 'credential' &&
              task.credentials_needed?.every((c) => c.provided) &&
              !task.credentials_needed.every((c) => c.validated) && (
              <button
                type="button"
                disabled={isValidating}
                onClick={() => validateMutation.mutate(task.id)}
                className="px-2 py-1 text-[9px] rounded border border-green-500/30 bg-green-500/10 text-green-400 hover:bg-green-500/20 disabled:opacity-40 transition-colors"
                title="Validate credentials and unblock"
              >
                {isValidating ? '…' : 'Validate'}
              </button>
            )}

            {/* Resolve button */}
            <button
              type="button"
              disabled={isResolving}
              onClick={() => resolveMutation.mutate(task.id)}
              className="px-2 py-1 text-[9px] rounded border border-[var(--theme-border)] text-[var(--theme-muted)] hover:bg-[var(--theme-hover)] disabled:opacity-40 transition-colors"
              title="Mark as resolved"
            >
              {isResolving ? '…' : '✕'}
            </button>
          </div>
        </div>
      </div>
    )
  }, [resolveMutation, validateMutation])

  // ── Loading / Error / Empty states ───────────────────────────────────────

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-8">
        <HugeiconsIcon icon={Loading03Icon} className="w-4 h-4 animate-spin text-[var(--theme-muted)]" />
        <span className="ml-2 text-xs text-[var(--theme-muted)]">Loading blockers…</span>
      </div>
    )
  }

  if (error) {
    return (
      <div className="flex flex-col items-center gap-3 py-8">
        <HugeiconsIcon icon={Alert02Icon} className="w-5 h-5 text-red-400" />
        <p className="text-xs text-[var(--theme-muted)]">Failed to load blockers</p>
        <button type="button" onClick={() => refetch()} className="text-xs text-amber-400 hover:underline">Retry</button>
      </div>
    )
  }

  if (!data || data.count === 0) {
    return (
      <div className="flex flex-col items-center gap-3 py-8">
        <HugeiconsIcon icon={Tick01Icon} className="w-5 h-5 text-green-400" />
        <p className="text-xs text-[var(--theme-muted)]">No blocked tasks</p>
      </div>
    )
  }

  // ── Main render ──────────────────────────────────────────────────────────

  return (
    <div className="flex flex-col gap-3">
      {/* Header */}
      <div className="flex items-center justify-between px-1">
        <div className="flex items-center gap-2">
          <HugeiconsIcon icon={LockIcon} className="w-4 h-4 text-red-400" />
          <span className="text-xs font-semibold text-[var(--theme-text)]">
            {data.count} Blocker{data.count !== 1 ? 's' : ''}
          </span>
        </div>
        <div className="flex items-center gap-1">
          {data.resumable.length > 0 && (
            <button
              type="button"
              disabled={autoResumeMutation.isPending}
              onClick={() => autoResumeMutation.mutate()}
              className="px-2 py-1 text-[9px] rounded border border-green-500/30 bg-green-500/10 text-green-400 hover:bg-green-500/20 disabled:opacity-40 transition-colors"
            >
              {autoResumeMutation.isPending ? '…' : `Resume ${data.resumable.length}`}
            </button>
          )}
          <button
            type="button"
            onClick={() => refetch()}
            className="p-1 rounded hover:bg-[var(--theme-hover)] transition-colors"
            title="Refresh blockers"
          >
            <HugeiconsIcon icon={RefreshIcon} className="w-3.5 h-3.5 text-[var(--theme-muted)]" />
          </button>
        </div>
      </div>

      {/* Blocker groups */}
      <div className="flex flex-col gap-2">
        {data.groups.map((group) => (
          <div key={group.type} className="flex flex-col gap-1">
            {/* Group header */}
            <button
              type="button"
              onClick={() => setExpandedGroup(expandedGroup === group.type ? null : group.type)}
              className="flex items-center gap-2 px-2 py-1.5 rounded-lg hover:bg-[var(--theme-hover)] transition-colors"
            >
              <span className="text-xs">{BLOCKER_ICONS[group.type] ?? '🚫'}</span>
              <span className="text-xs font-medium text-[var(--theme-text)]">{group.label}</span>
              <span className={cn(
                'ml-auto text-[9px] px-1.5 py-0.5 rounded-full border font-medium',
                BLOCKER_BADGE_COLORS[group.type] ?? BLOCKER_BADGE_COLORS.unknown,
              )}>
                {group.tasks.length}
              </span>
              <span className="text-[9px] text-[var(--theme-muted)]">
                {expandedGroup === group.type ? '▾' : '▸'}
              </span>
            </button>

            {/* Expanded task list */}
            {expandedGroup === group.type && (
              <div className="flex flex-col gap-1 pl-4 pr-1">
                {group.tasks.map(renderTaskCard)}
              </div>
            )}
          </div>
        ))}
      </div>

      {/* Credential collection modal */}
      {credentialForm && renderCredentialForm()}
    </div>
  )
}