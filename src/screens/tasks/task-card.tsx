import { useRef, useState } from 'react'
import { HugeiconsIcon } from '@hugeicons/react'
import { Delete01Icon, MoreVerticalIcon, PlayIcon, Rocket01Icon, SplitIcon } from '@hugeicons/core-free-icons'
import type { ClaudeTask, TaskAgentState, TaskColumn, TaskPriority } from '@/lib/tasks-api'
import { cn } from '@/lib/utils'
import { COLUMN_LABELS, COLUMN_ORDER, PRIORITY_COLORS, isOverdue, relativeTime } from '@/lib/tasks-api'
import { MenuContent, MenuItem, MenuRoot, MenuTrigger } from '@/components/ui/menu'


function isStuckAgent(task: ClaudeTask): boolean {
  if (!task.agent_state || !task.agent_action_at) return false
  return Date.now() - new Date(task.agent_action_at).getTime() > 10 * 60_000
}

type Props = {
  task: ClaudeTask
  assigneeLabels?: Record<string, string>
  onClick: () => void
  onDragStart: (e: React.DragEvent) => void
  isDragging?: boolean
  activeTagFilter: string | null
  onTagClick: (tag: string) => void
  onChangePriority: (priority: TaskPriority) => void
  onMoveToColumn: (column: TaskColumn) => void
  onDelete: () => void
  onAssigneeClick?: (assignee: string) => void
  onLaunch?: () => void
  isLaunching?: boolean
  onExecute?: () => void
  isExecuting?: boolean
  onBreakdown?: () => void
  isBreakingDown?: boolean
  onResetAgent?: () => void
  onRequestRefresh?: () => void
  onComment?: (taskId: string, text: string) => Promise<void>
  queuePosition?: number | null
}

export function formatTaskAssigneeLabel(
  assignee: string | null,
  assigneeLabels: Record<string, string>,
): string {
  const resolvedLabel = assignee ? (assigneeLabels[assignee] ?? assignee) : 'Unassigned'
  return `Assignee: ${resolvedLabel}`
}

const AGENT_STATE_CONFIG: Record<
  NonNullable<TaskAgentState>,
  { label: string; color: string; pulse: boolean }
> = {
  reviewing: { label: 'Astra reviewing…', color: '#a855f7', pulse: true },
  delegating: { label: 'Delegating…', color: '#f59e0b', pulse: true },
  working: { label: 'Agent working…', color: '#3b82f6', pulse: true },
  waiting_for_input: { label: 'Waiting for your reply', color: '#f59e0b', pulse: false },
}

function AgentStateBadge({ state, agentName }: { state: TaskAgentState; agentName?: string | null }) {
  if (!state) return null
  const cfg = AGENT_STATE_CONFIG[state]
  const label = state === 'delegating' && agentName ? `→ ${agentName}` : cfg.label
  return (
    <span
      className="inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[10px] font-medium"
      style={{ background: `${cfg.color}22`, color: cfg.color, border: `1px solid ${cfg.color}44` }}
    >
      {cfg.pulse && (
        <span
          className="inline-block w-1.5 h-1.5 rounded-full animate-pulse"
          style={{ background: cfg.color }}
        />
      )}
      {label}
    </span>
  )
}

function SourceBadge({ source }: { source: ClaudeTask['source'] }) {
  if (!source || source === 'human') return null
  if (source === 'idea_job') {
    return (
      <span className="inline-flex items-center gap-0.5 rounded-md px-1.5 py-0.5 text-[10px] font-medium bg-amber-500/10 text-amber-500 border border-amber-500/20">
        💡 idea
      </span>
    )
  }
  return (
    <span className="inline-flex items-center gap-0.5 rounded-md px-1.5 py-0.5 text-[10px] font-medium bg-violet-500/10 text-violet-400 border border-violet-500/20">
      ✦ astra
    </span>
  )
}

export function TaskCard({
  task,
  assigneeLabels = {},
  onClick,
  onDragStart,
  isDragging,
  activeTagFilter,
  onTagClick,
  onChangePriority,
  onMoveToColumn,
  onDelete,
  onAssigneeClick,
  onLaunch,
  isLaunching,
  onExecute,
  isExecuting,
  onBreakdown,
  isBreakingDown,
  onResetAgent,
  onRequestRefresh,
  onComment,
  queuePosition,
}: Props) {
  const [activityOpen, setActivityOpen] = useState(false)
  const [replyText, setReplyText] = useState('')
  const [replySending, setReplySending] = useState(false)
  const replyInputRef = useRef<HTMLInputElement>(null)
  const [logContent, setLogContent] = useState<string | null>(null)
  const [logLoading, setLogLoading] = useState(false)
  const overdue = isOverdue(task)
  const priorityColor = PRIORITY_COLORS[task.priority]
  const visibleTags = task.tags.slice(0, 2)
  const extraTagCount = task.tags.length - 2
  const assigneeLabel = formatTaskAssigneeLabel(task.assignee, assigneeLabels)
  const isAgentActive = Boolean(task.agent_state)
  const hasHistory = (task.agent_history?.length ?? 0) > 0
  const stuck = isStuckAgent(task)
  const isDimmed = Boolean(activeTagFilter && !task.tags.includes(activeTagFilter))

  return (
    <div
      draggable
      onDragStart={onDragStart}
      onClick={onClick}
      className={cn(
        'relative rounded-lg border p-3 cursor-pointer transition-all select-none group',
        'bg-[var(--theme-card)] border-[var(--theme-border)]',
        'hover:border-[var(--theme-accent)]',
        isDragging ? 'opacity-40 rotate-1 shadow-2xl' : 'hover:shadow-[0_4px_16px_rgba(0,0,0,0.35)]',
        isExecuting && 'ring-2 ring-amber-500/50',
        isBreakingDown && !isExecuting && 'ring-2 ring-violet-500/50',
        isAgentActive && !isExecuting && !isBreakingDown && 'ring-1 ring-violet-500/30',
        isDimmed && 'opacity-40',
      )}
      style={{ borderLeftWidth: 3, borderLeftColor: priorityColor }}
    >
      {/* Priority dot */}
      <span
        className="absolute top-2.5 right-10 w-2 h-2 rounded-full shrink-0"
        style={{ background: priorityColor }}
        title={`Priority: ${task.priority}`}
      />

      {/* Agent state gradient banner — click to toggle activity panel */}
      {isAgentActive && (
        <button
          type="button"
          aria-label="Toggle agent activity"
          onClick={(e) => { e.stopPropagation(); setActivityOpen(v => { if (!v) onRequestRefresh?.(); return !v }) }}
          className="absolute inset-x-0 top-0 h-1 rounded-t-lg w-full cursor-pointer"
          style={{ background: stuck ? 'linear-gradient(90deg, #ef4444, #f97316)' : 'linear-gradient(90deg, #a855f7, #3b82f6, #a855f7)', backgroundSize: '200%' }}
          title={activityOpen ? 'Hide agent activity' : 'Show agent activity'}
        />
      )}

      {/* Hover action buttons (▶ launch + ⋮ menu) */}
      <div
        className="absolute top-1.5 right-1.5 flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity"
        onClick={e => e.stopPropagation()}
      >
        {/* ▶ Launch Session */}
        {onLaunch && (
          <button
            type="button"
            onClick={(e) => { e.stopPropagation(); onLaunch() }}
            disabled={isLaunching}
            title="Launch chat session for this task"
            className="rounded p-0.5 hover:bg-[var(--theme-hover)] transition-colors"
          >
            <HugeiconsIcon
              icon={PlayIcon}
              size={13}
              className={cn(isLaunching ? 'animate-pulse' : '', 'text-[var(--theme-accent)]')}
            />
          </button>
        )}
        {/* 🚀 Execute with agent */}
        {onExecute && (
          <button
            type="button"
            onClick={(e) => { e.stopPropagation(); onExecute() }}
            disabled={isExecuting}
            title="Execute task with AI agent"
            className="rounded p-0.5 hover:bg-[var(--theme-hover)] transition-colors"
          >
            <HugeiconsIcon
              icon={Rocket01Icon}
              size={13}
              className={cn(isExecuting ? 'animate-pulse' : '', 'text-amber-500')}
            />
          </button>
        )}
        <MenuRoot>
          <MenuTrigger
            type="button"
            className="rounded p-0.5 hover:bg-[var(--theme-hover)] transition-colors"
            aria-label="Task options"
          >
            <HugeiconsIcon icon={MoreVerticalIcon} size={13} className="text-[var(--theme-muted)]" />
          </MenuTrigger>
          <MenuContent side="bottom" align="end">
            <div
              className="px-2 py-1 text-[9px] font-semibold uppercase tracking-widest text-[var(--theme-muted)]"
            >
              Priority
            </div>
            {(['high', 'medium', 'low'] as Array<TaskPriority>).map(p => (
              <MenuItem
                key={p}
                onClick={(e) => { e.stopPropagation(); onChangePriority(p) }}
                className="text-xs capitalize flex items-center gap-2"
              >
                <span className="w-2 h-2 rounded-full shrink-0" style={{ background: PRIORITY_COLORS[p] }} />
                {p}
                {task.priority === p && <span className="ml-auto text-[10px]">✓</span>}
              </MenuItem>
            ))}

            <hr className="border-[var(--theme-border)] my-1" />

            <div
              className="px-2 py-1 text-[9px] font-semibold uppercase tracking-widest text-[var(--theme-muted)]"
            >
              Move to
            </div>
            {COLUMN_ORDER.filter(c => c !== task.column && c !== 'deleted').map(col => (
              <MenuItem
                key={col}
                onClick={(e) => { e.stopPropagation(); onMoveToColumn(col) }}
                className="text-xs"
              >
                {COLUMN_LABELS[col]}
              </MenuItem>
            ))}

            <hr className="border-[var(--theme-border)] my-1" />

            {onBreakdown && (
              <MenuItem
                onClick={(e) => { e.stopPropagation(); if (!isBreakingDown) onBreakdown() }}
                className="text-xs flex items-center gap-2"
                style={{ opacity: isBreakingDown ? 0.5 : 1, cursor: isBreakingDown ? 'wait' : 'pointer' }}
              >
                <HugeiconsIcon icon={SplitIcon} size={12} className="text-violet-500" />
                {isBreakingDown ? 'Breaking down…' : 'Break Down'}
              </MenuItem>
            )}

            <hr className="border-[var(--theme-border)] my-1" />

            <MenuItem
              onClick={(e) => { e.stopPropagation(); onDelete() }}
              className="text-xs flex items-center gap-2 text-red-400"
            >
              <HugeiconsIcon icon={Delete01Icon} size={12} />
              Delete
            </MenuItem>
          </MenuContent>
        </MenuRoot>
      </div>{/* end hover actions */}

      <div className="flex items-start gap-1.5 mb-1 pr-12">
        {queuePosition != null && !task.agent_state && (task.column === 'todo' || task.column === 'backlog') && (
          <span
            title={`Queue position ${queuePosition} — processed in priority order (high → medium → low, oldest first)`}
            className={cn(
              'shrink-0 mt-0.5 inline-flex items-center rounded px-1 py-0 text-[9px] font-bold tabular-nums border',
              queuePosition === 1
                ? 'bg-violet-500/15 text-violet-400 border-violet-500/30'
                : 'bg-[var(--theme-hover)] text-[var(--theme-muted)] border-[var(--theme-border)]',
            )}
          >
            #{queuePosition}
          </span>
        )}
        <p className="text-sm font-medium text-[var(--theme-text)] leading-snug line-clamp-2">
          {task.title}
        </p>
      </div>

      {task.description && (
        <p className="text-xs text-[var(--theme-muted)] line-clamp-2 mb-2">
          {task.description}
        </p>
      )}

      <div className="flex flex-col gap-1.5 mt-2">
        {/* Agent state + source badges */}
        {(isAgentActive || hasHistory || (task.source && task.source !== 'human')) && (
          <div className="flex items-center gap-1.5 flex-wrap">
            {isAgentActive && (
              <button
                type="button"
                onClick={(e) => { e.stopPropagation(); setActivityOpen(v => { if (!v) onRequestRefresh?.(); return !v }) }}
                className="flex items-center"
                title={activityOpen ? 'Hide agent activity' : 'Show agent activity'}
              >
                <AgentStateBadge state={task.agent_state ?? null} agentName={task.agent_name} />
              </button>
            )}
            {stuck && onResetAgent && (
              <button
                type="button"
                onClick={(e) => { e.stopPropagation(); onResetAgent() }}
                title="Agent appears stuck — click to reset"
                className="text-[9px] px-1.5 py-0.5 rounded-md border transition-colors border-red-500/40 text-red-500 bg-red-500/7"
              >
                ✕ reset
              </button>
            )}
            <SourceBadge source={task.source} />
          </div>
        )}

        {/* Agent comment — latest reasoning shown at a glance (when panel is closed) */}
        {task.agent_comment && !isAgentActive && !activityOpen && task.column !== 'review' && (
          <p className="text-[10px] leading-relaxed line-clamp-2 text-[var(--theme-muted)]">
            <span className="text-purple-500">✦</span> {task.agent_comment}
          </p>
        )}

        {/* Plan-ready banner — shown when task is in review with a sister's plan.
            Replaces the buried "expand history → find planned entry" workflow. */}
        {task.column === 'review' && !isAgentActive && (() => {
          const planEntry = [...(task.agent_history ?? [])].reverse().find(e => e.action === 'planned')
          if (!planEntry) return null
          return (
            <div
              className="rounded-md p-2 space-y-1.5 bg-violet-500/5 border border-violet-500/20"
              onClick={e => e.stopPropagation()}
            >
              <div className="flex items-center gap-1 text-[9px] font-semibold uppercase tracking-wider text-violet-400">
                <span>{planEntry.byEmoji}</span>
                <span>{planEntry.by} · plan ready</span>
              </div>
              <p className="text-[10px] text-[var(--theme-muted)] leading-relaxed line-clamp-5 whitespace-pre-line">
                {planEntry.note}
              </p>
              {onExecute && (
                <button
                  type="button"
                  onClick={() => onExecute()}
                  disabled={isExecuting}
                  className={cn(
                    'w-full rounded py-1 text-[10px] font-medium border transition-colors',
                    isExecuting
                      ? 'border-amber-500/20 bg-amber-500/5 text-amber-400/50 cursor-wait'
                      : 'border-amber-500/30 bg-amber-500/10 text-amber-400 hover:bg-amber-500/20',
                  )}
                >
                  {isExecuting ? '🚀 Executing…' : '🚀 Execute this plan'}
                </button>
              )}
            </div>
          )
        })()}

        {/* History note count — clickable to expand panel */}
        {hasHistory && !isAgentActive && (
          <button
            type="button"
            onClick={(e) => { e.stopPropagation(); setActivityOpen(v => !v) }}
            className="text-[9px] text-left hover:underline text-[var(--theme-muted)]"
          >
            {activityOpen ? '▲ hide' : `💬 ${task.agent_history!.length} note${task.agent_history!.length !== 1 ? 's' : ''} — click to reply`}
          </button>
        )}

        {/* Collapsible agent activity panel — shown when agent active OR when history panel toggled */}
        {(isAgentActive || hasHistory) && activityOpen && (
          <div
            className="rounded-md p-2 space-y-1.5 bg-[var(--theme-hover)] border border-[var(--theme-border)]"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Live status indicator (only when active) */}
            {isAgentActive && (() => {
              const cfg = AGENT_STATE_CONFIG[task.agent_state!]
              return (
                <div className="flex items-center gap-1.5 text-[10px] pb-1 border-b border-[var(--theme-border)]" style={{ color: cfg.color }}>
                  <span
                    className={`w-1.5 h-1.5 rounded-full shrink-0 ${cfg.pulse ? 'animate-ping' : ''}`}
                    style={{ background: cfg.color }}
                  />
                  <span className={cfg.pulse ? 'animate-pulse' : ''}>{cfg.label}</span>
                </div>
              )
            })()}

            {/* Activity entries */}
            {hasHistory && task.agent_history!.slice(-4).map((entry) => (
              <div key={entry.id} className="flex gap-1.5 text-[10px]">
                <span className="shrink-0 leading-none mt-0.5">{entry.byEmoji}</span>
                <div className="min-w-0">
                  <span className={cn('font-medium capitalize', entry.action === 'question' ? 'text-amber-500' : 'text-[var(--theme-text)]')}>{entry.by}</span>
                  <span className="text-[var(--theme-muted)]"> · {entry.action === 'question' ? 'asked' : entry.action} · {relativeTime(entry.at)}</span>
                  {entry.note && (
                    <p className={cn('mt-0.5 leading-relaxed line-clamp-3', entry.action === 'question' ? 'text-amber-500' : 'text-[var(--theme-muted)]')}>
                      {entry.note}
                    </p>
                  )}
                </div>
              </div>
            ))}

            {/* View log — shown when there are execution entries */}
            {task.agent_history?.some(e => ['completed', 'attempted', 'blocked'].includes(e.action) && e.by !== 'user') && (
              <div className="pt-1 border-t border-[var(--theme-border)]">
                <button
                  type="button"
                  onClick={async (e) => {
                    e.stopPropagation()
                    if (logContent !== null) { setLogContent(null); return }
                    setLogLoading(true)
                    try {
                      const res = await fetch(`/api/hermes-tasks/${task.id}?action=log`)
                      const data = await res.json() as { found: boolean; log: string }
                      setLogContent(data.found ? data.log : '(no log file found for this task)')
                    } catch {
                      setLogContent('(failed to fetch log)')
                    } finally {
                      setLogLoading(false)
                    }
                  }}
                  className="text-[9px] text-[var(--theme-muted)] hover:text-[var(--theme-text)] hover:underline transition-colors"
                >
                  {logLoading ? 'loading…' : logContent !== null ? '▲ hide log' : '📋 view execution log'}
                </button>
                {logContent !== null && (
                  <pre className="mt-1.5 text-[9px] leading-relaxed text-[var(--theme-muted)] bg-black/20 rounded p-2 overflow-auto max-h-48 whitespace-pre-wrap break-all">
                    {logContent}
                  </pre>
                )}
              </div>
            )}

            {/* Inline reply input */}
            {onComment && (
              <div className="flex gap-1.5 pt-1 border-t border-[var(--theme-border)]">
                <input
                  ref={replyInputRef}
                  className="flex-1 rounded px-2 py-1 text-[10px] min-w-0 bg-[var(--theme-input)] border border-[var(--theme-border)] text-[var(--theme-text)] outline-none"
                  placeholder={task.agent_state === 'waiting_for_input' ? 'Reply to Astra…' : 'Continue…'}
                  value={replyText}
                  onChange={e => setReplyText(e.target.value)}
                  onKeyDown={async (e) => {
                    if (e.key === 'Enter' && !e.shiftKey && replyText.trim() && !replySending) {
                      e.preventDefault()
                      setReplySending(true)
                      try {
                        await onComment(task.id, replyText.trim())
                        setReplyText('')
                      } finally {
                        setReplySending(false)
                      }
                    }
                  }}
                />
                <button
                  type="button"
                  disabled={!replyText.trim() || replySending}
                  onClick={async () => {
                    if (!replyText.trim() || replySending) return
                    setReplySending(true)
                    try {
                      await onComment(task.id, replyText.trim())
                      setReplyText('')
                    } finally {
                      setReplySending(false)
                    }
                  }}
                  className={cn('rounded px-2 py-1 text-[10px] shrink-0 transition-opacity text-white', replySending ? 'bg-purple-500/20' : 'bg-purple-500')}
                  style={{
                    opacity: (!replyText.trim() || replySending) ? 0.5 : 1,
                    cursor: (!replyText.trim() || replySending) ? 'default' : 'pointer',
                  }}
                >
                  {replySending ? '…' : '↵'}
                </button>
              </div>
            )}
          </div>
        )}

        <div className="flex items-center justify-between gap-2 flex-wrap">
          <div className="flex items-center gap-1.5 flex-wrap">
            {task.assignee && onAssigneeClick ? (
              <button
                type="button"
                onClick={(e) => { e.stopPropagation(); onAssigneeClick(task.assignee!) }}
                className="text-[10px] px-1.5 py-0.5 rounded-md transition-colors hover:outline hover:outline-1 hover:outline-[var(--theme-accent)] bg-[var(--theme-hover)] text-[var(--theme-muted)]"
                title="Filter by this assignee"
              >
                {assigneeLabel}
              </button>
            ) : (
              <span className="text-[10px] px-1.5 py-0.5 rounded-md bg-[var(--theme-hover)] text-[var(--theme-muted)]">
                {assigneeLabel}
              </span>
            )}
            {visibleTags.map((tag) => (
              <button
                key={tag}
                type="button"
                onClick={(e) => { e.stopPropagation(); onTagClick(tag) }}
                className={cn(
                  'text-[10px] px-1.5 py-0.5 rounded-md transition-colors',
                  activeTagFilter === tag
                    ? 'bg-[var(--theme-accent)]/20 text-[var(--theme-accent)] outline outline-1 outline-[var(--theme-accent)]'
                    : 'bg-[var(--theme-hover)] text-[var(--theme-muted)]',
                )}
              >
                #{tag}
              </button>
            ))}
            {extraTagCount > 0 && (
              <span className="text-[10px] px-1.5 py-0.5 rounded-md bg-[var(--theme-hover)] text-[var(--theme-muted)]">
                +{extraTagCount} more
              </span>
            )}
          </div>

          {task.due_date && (
            <div className="flex items-center gap-1 text-[10px] tabular-nums">
              {overdue && (
                <>
                  <span className="w-1.5 h-1.5 rounded-full bg-red-400 shrink-0" />
                  <span className="text-red-400 font-semibold">Overdue</span>
                  <span className="text-[var(--theme-muted)] mx-0.5">·</span>
                </>
              )}
              <span className={overdue ? 'text-red-400 font-semibold' : 'text-[var(--theme-muted)]'}>
                {(() => {
                  const [y, m, d] = task.due_date.split('-').map(Number)
                  return new Date(y, m - 1, d).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
                })()}
              </span>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
