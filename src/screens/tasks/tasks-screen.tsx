'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate, useSearch } from '@tanstack/react-router'
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { AnimatePresence, motion } from 'motion/react'
import { HugeiconsIcon } from '@hugeicons/react'
import { Add01Icon, AiBrainIcon, AiMagicIcon, BulbIcon, Cancel01Icon, CheckListIcon, PlayIcon, RefreshIcon, Search01Icon  } from '@hugeicons/core-free-icons'
import { TaskCard } from './task-card'
import { TaskDialog } from './task-dialog'
import type { ClaudeTask, CreateTaskInput, TaskAssignee, TaskColumn, TaskPriority, UpdateTaskInput } from '@/lib/tasks-api'
import {
  COLUMN_COLORS,
  COLUMN_LABELS,
  COLUMN_ORDER,
  PRIORITY_COLORS,
  askAstra,
  breakdownTask,
  createTask,
  deleteTask,
  executeTask,
  fetchAssignees,
  fetchTasks,
  generateTaskFromText,
  isOverdue,
  launchSession,
  moveTask,
  postTaskComment,
  updateTask,
} from '@/lib/tasks-api'
import { toast } from '@/components/ui/toast'
import { cn } from '@/lib/utils'
function isTypingTarget(target: EventTarget | null) {
  const el = target as HTMLElement | null
  return !!el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable)
}
import { TooltipContent, TooltipProvider, TooltipRoot, TooltipTrigger } from '@/components/ui/tooltip'

const QUERY_KEY = ['claude', 'tasks'] as const
const ASSIGNEES_KEY = ['claude', 'tasks', 'assignees'] as const

export const TASKS_BOARD_HELP_TEXT =
  'Workspace Tasks is a lightweight task board. Drag cards to change status. Use Dashboard Kanban for native multi-board controls.'

function SkeletonCard() {
  return (
    <div className="skeleton-shimmer rounded-lg border border-[var(--theme-border)] bg-[var(--theme-card)] p-3">
      <div className="h-3.5 bg-[var(--theme-hover)] rounded w-3/4 mb-2" />
      <div className="h-2.5 bg-[var(--theme-hover)] rounded w-full mb-1" />
      <div className="h-2.5 bg-[var(--theme-hover)] rounded w-2/3 mb-3" />
      <div className="flex gap-1.5">
        <div className="h-4 w-12 bg-[var(--theme-hover)] rounded" />
        <div className="h-4 w-10 bg-[var(--theme-hover)] rounded" />
      </div>
    </div>
  )
}

export function TasksScreen() {
  const queryClient = useQueryClient()
  const [showCreate, setShowCreate] = useState(false)
  const [createColumn, setCreateColumn] = useState<TaskColumn>('backlog')
  const [editingTask, setEditingTask] = useState<ClaudeTask | null>(null)
  const [draggingId, setDraggingId] = useState<string | null>(null)
  const [dragOverColumn, setDragOverColumn] = useState<TaskColumn | null>(null)
  const [showDone, setShowDone] = useState(false)
  const [astraReviewing, setAstraReviewing] = useState(false)
  const [askingAstra, setAskingAstra] = useState(false)
  const [ideasLoading, setIdeasLoading] = useState(false)
  const [breakingDownId, setBreakingDownId] = useState<string | null>(null)

  const search = useSearch({ from: '/tasks' })
  const navigate = useNavigate()
  const initialAssignee = typeof search.assignee === 'string' ? search.assignee : null
  const [assigneeFilter, setAssigneeFilter] = useState<string | null>(initialAssignee)

  const [launchingTaskId, setLaunchingTaskId] = useState<string | null>(null)
  const [executingTaskId, setExecutingTaskId] = useState<string | null>(null)
  const [nlInput, setNlInput] = useState('')
  const [nlParsing, setNlParsing] = useState(false)
  const nlInputRef = useRef<HTMLInputElement>(null)
  const [createDefaults, setCreateDefaults] = useState<{
    title?: string; description?: string; column?: TaskColumn
    priority?: TaskPriority; assignee?: string; tags?: string
  } | null>(null)
  // Snapshot of column/priority taken when Deploy Agents fires; cleared when agents finish
  const [deploySnapshot, setDeploySnapshot] = useState<Partial<Record<string, { column: TaskColumn; priority: TaskPriority }>> | null>(null)

  // — Search + filter state
  const [searchQuery, setSearchQuery] = useState('')
  const searchInputRef = useRef<HTMLInputElement>(null)
  const [filterOverdue, setFilterOverdue] = useState(false)
  const [filterBlocked, setFilterBlocked] = useState(false)
  const [filterActiveAgent, setFilterActiveAgent] = useState(false)
  const [filterInReview, setFilterInReview] = useState(false)
  const [priorityFilter, setPriorityFilter] = useState<TaskPriority | null>(null)
  const [tagFilter, setTagFilter] = useState<string | null>(null)

  const tasksQuery = useQuery({
    queryKey: [...QUERY_KEY, showDone],
    queryFn: () => fetchTasks({ include_done: showDone }),
    refetchInterval: (query) => {
      const tasks = query.state.data ?? []
      const hasActiveAgent = tasks.some((t) => t.agent_state)
      return hasActiveAgent ? 4_000 : 30_000
    },
    placeholderData: keepPreviousData,
  })

  const assigneesQuery = useQuery({
    queryKey: ASSIGNEES_KEY,
    queryFn: fetchAssignees,
    staleTime: 5 * 60_000,
  })

  const assignees: Array<TaskAssignee> = assigneesQuery.data?.assignees ?? []
  const humanReviewer = assigneesQuery.data?.humanReviewer ?? null

  const assigneeLabels = useMemo(() => {
    const map: Record<string, string> = {}
    for (const a of assignees) map[a.id] = a.label
    return map
  }, [assignees])

  const tasks = tasksQuery.data ?? []

  const tasksByColumn = useMemo(() => {
    const columns: Record<TaskColumn, Array<ClaudeTask>> = {
      backlog: [], todo: [], in_progress: [], review: [], blocked: [], done: [], deleted: [],
    }
    const q = searchQuery.trim().toLowerCase()
    let matchCount = 0

    for (const t of tasks) {
      if (assigneeFilter && t.assignee !== assigneeFilter) continue
      if (q) {
        const hit = t.title.toLowerCase().includes(q)
          || t.description.toLowerCase().includes(q)
          || t.tags.some(tag => tag.toLowerCase().includes(q))
        if (!hit) continue
      }
      if (filterOverdue && !isOverdue(t)) continue
      if (filterBlocked && t.column !== 'blocked') continue
      if (filterActiveAgent && !t.agent_state) continue
      if (filterInReview && t.column !== 'review') continue
      if (priorityFilter && t.priority !== priorityFilter) continue
      if (tagFilter && !t.tags.includes(tagFilter)) continue

      columns[t.column].push(t)
      matchCount++
    }
    for (const col of COLUMN_ORDER) {
      columns[col].sort((a, b) => a.position - b.position)
    }
    const hasAnyFilter = Boolean(assigneeFilter || q || filterOverdue || filterBlocked || filterActiveAgent || filterInReview || priorityFilter || tagFilter)
    return { columns, matchCount, totalTasks: tasks.length, hasAnyFilter }
  }, [tasks, assigneeFilter, searchQuery, filterOverdue, filterBlocked, filterActiveAgent, filterInReview, priorityFilter, tagFilter])

  const columnMap = tasksByColumn.columns

  const stats = useMemo(() => {
    const total = tasks.length
    const running = tasks.filter(t => t.column === 'in_progress').length
    const blocked = tasks.filter(t => t.column === 'blocked').length
    const done = tasks.filter(t => t.column === 'done').length
    const overdue = tasks.filter(t => isOverdue(t) && t.column !== 'done').length
    const completion = total > 0 ? Math.round((done / total) * 100) : 0
    const agentActive = tasks.filter(t => t.agent_state).length
    return { total, running, blocked, done, overdue, completion, agentActive }
  }, [tasks])

  const invalidate = useCallback(() => {
    void queryClient.invalidateQueries({ queryKey: QUERY_KEY })
  }, [queryClient])

  const createMutation = useMutation({
    mutationFn: createTask,
    onSuccess: () => { invalidate(); toast('Task created'); setShowCreate(false) },
    onError: (e) => toast(e instanceof Error ? e.message : 'Failed to create task', { type: 'error' }),
  })

  const updateMutation = useMutation({
    mutationFn: ({ id, input }: { id: string; input: CreateTaskInput }) => updateTask(id, input),
    onSuccess: () => { invalidate(); toast('Task updated'); setEditingTask(null) },
    onError: (e) => toast(e instanceof Error ? e.message : 'Failed to update task', { type: 'error' }),
  })

  const deleteMutation = useMutation({
    mutationFn: deleteTask,
    onSuccess: () => { invalidate(); toast('Task deleted') },
    onError: (e) => toast(e instanceof Error ? e.message : 'Failed to delete task', { type: 'error' }),
  })

  const moveMutation = useMutation({
    mutationFn: ({ id, column }: { id: string; column: TaskColumn }) => moveTask(id, column, 'user'),
    onSuccess: () => invalidate(),
    onError: (e) => toast(e instanceof Error ? e.message : 'Failed to move task', { type: 'error' }),
  })

  // Silent update mutation — for quick card actions (no dialog close side-effect)
  const quickUpdateMutation = useMutation({
    mutationFn: ({ id, input }: { id: string; input: UpdateTaskInput }) => updateTask(id, input),
    onSuccess: () => invalidate(),
    onError: (e) => toast(e instanceof Error ? e.message : 'Failed to update task', { type: 'error' }),
  })

  async function handleTaskComment(taskId: string, text: string) {
    const result = await postTaskComment(taskId, text)
    invalidate()
    if (result.resumed) {
      toast('Astra is on it…')
    }
  }

  async function handleNlCreate() {
    const text = nlInput.trim()
    if (!text || nlParsing) return
    setNlParsing(true)
    try {
      const suggestion = await generateTaskFromText(text)
      setNlInput('')
      setCreateDefaults({
        title: suggestion.title,
        description: suggestion.description ?? '',
        column: suggestion.column,
        priority: suggestion.priority,
        assignee: suggestion.assignee ?? '',
        tags: Array.isArray(suggestion.tags) ? suggestion.tags.join(', ') : '',
      })
      setShowCreate(true)
    } catch (e) {
      toast(e instanceof Error ? e.message : 'AI could not parse the task — try rephrasing', { type: 'error' })
    } finally {
      setNlParsing(false)
    }
  }

  // Keyboard shortcuts
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (isTypingTarget(e.target)) return
      if (e.metaKey || e.ctrlKey || e.altKey) return

      if (e.key === 'n') {
        e.preventDefault()
        setCreateColumn('backlog')
        setShowCreate(true)
        return
      }
      if (e.key === '/') {
        e.preventDefault()
        searchInputRef.current?.focus()
        return
      }
      if (e.key === 'd') {
        e.preventDefault()
        setShowDone(v => !v)
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [])

  // Agent deploy summary — fires when all agent_state clears after Deploy Agents was clicked
  useEffect(() => {
    if (!deploySnapshot) return
    const anyActive = tasks.some(t => t.agent_state)
    if (anyActive) return
    // All agents finished — compute diff vs snapshot
    let movedToReady = 0
    let movedToBlocked = 0
    let reprioritised = 0
    let total = 0
    for (const task of tasks) {
      const before = deploySnapshot[task.id]
      if (!before) continue
      total++
      if (before.column !== task.column) {
        if (task.column === 'todo') movedToReady++
        if (task.column === 'blocked') movedToBlocked++
      }
      if (before.priority !== task.priority) reprioritised++
    }
    if (total > 0) {
      const parts: Array<string> = [`Reviewed ${total} task${total !== 1 ? 's' : ''}`]
      if (movedToReady > 0) parts.push(`${movedToReady} → Ready`)
      if (movedToBlocked > 0) parts.push(`${movedToBlocked} Blocked`)
      if (reprioritised > 0) parts.push(`${reprioritised} reprioritised`)
      toast(parts.join(' · '))
    }
    setDeploySnapshot(null)
  }, [tasks, deploySnapshot])

  function handleDragStart(e: React.DragEvent, taskId: string) {
    e.dataTransfer.setData('text/plain', taskId)
    setDraggingId(taskId)
  }

  function handleDragOver(e: React.DragEvent, col: TaskColumn) {
    e.preventDefault()
    setDragOverColumn(col)
  }

  function handleDrop(e: React.DragEvent, targetColumn: TaskColumn) {
    e.preventDefault()
    const taskId = e.dataTransfer.getData('text/plain')
    const task = tasks.find(t => t.id === taskId)
    if (!task || task.column === targetColumn) {
      setDraggingId(null)
      setDragOverColumn(null)
      return
    }
    if (targetColumn === 'done' && humanReviewer) {
      toast(`Only ${humanReviewer} can mark tasks as done`, { type: 'error' })
      setDraggingId(null)
      setDragOverColumn(null)
      return
    }
    moveMutation.mutate({ id: taskId, column: targetColumn })
    setDraggingId(null)
    setDragOverColumn(null)
  }

  function handleDragEnd() {
    setDraggingId(null)
    setDragOverColumn(null)
  }

  function clearAllFilters() {
    setSearchQuery('')
    setFilterOverdue(false)
    setFilterBlocked(false)
    setFilterActiveAgent(false)
    setPriorityFilter(null)
    setTagFilter(null)
  }

  const visibleColumns = showDone ? COLUMN_ORDER : COLUMN_ORDER.filter(c => c !== 'done')
  const colMaxWidth = Math.floor(1200 / visibleColumns.length)

  return (
    <div data-route-page className="h-full overflow-hidden flex flex-col bg-surface text-ink">
      <div className="shrink-0 mx-auto w-full max-w-[1200px] flex flex-col gap-3 px-4 pt-5 pb-2 sm:px-6 lg:px-8">
      {/* Header */}
      <header className="rounded-2xl border border-[var(--theme-border)] bg-[var(--theme-panel)] p-4 backdrop-blur-xl">
        <div className="flex items-center justify-between">
        <div className="flex items-center gap-3 min-w-0">
          <h1 className="text-2xl font-medium text-ink">Tasks</h1>
          {assigneeFilter && (
            <div className="flex items-center gap-2 text-xs text-[var(--theme-muted)]">
              <span>Filtered by: <span className="capitalize text-amber-500">{assigneeFilter}</span></span>
              <button
                type="button"
                onClick={() => setAssigneeFilter(null)}
                className="text-[var(--theme-muted)] hover:text-[var(--theme-text)] transition-colors"
              >
                ✕ Clear
              </button>
            </div>
          )}
          {/* Stats */}
          <div className="flex items-center gap-2 text-xs text-[var(--theme-muted)] flex-wrap">
            <span>{stats.total} total</span>
            <span className="hidden sm:inline">·</span>
            <span className="hidden sm:inline">{stats.running} running</span>
            {stats.blocked > 0 && (
              <>
                <span className="hidden sm:inline">·</span>
                <span className="text-red-400">{stats.blocked} blocked</span>
              </>
            )}
            {stats.overdue > 0 && (
              <>
                <span>·</span>
                <span className="text-red-400">{stats.overdue} overdue</span>
              </>
            )}
            <span className="hidden sm:inline">·</span>
            <span className="hidden sm:inline">{stats.completion}% done</span>
            {stats.agentActive > 0 && (
              <>
                <span>·</span>
                <span className="flex items-center gap-1 text-violet-400">
                  <span className="w-1.5 h-1.5 rounded-full bg-violet-400 animate-pulse inline-block" />
                  Astra reviewing {stats.agentActive}
                </span>
              </>
            )}
          </div>
        </div>

        <div className="flex items-center gap-2 shrink-0 flex-wrap">
          {/* Ask Astra */}
          <button
            onClick={async () => {
              setAskingAstra(true)
              try {
                const { sessionId } = await askAstra()
                void navigate({ to: '/chat/$sessionKey', params: { sessionKey: sessionId } })
              } catch {
                toast('Failed to start Astra session', { type: 'error' })
              } finally {
                setAskingAstra(false)
              }
            }}
            disabled={askingAstra}
            title="Open a chat with Astra pre-briefed on the current board state"
            className={cn(
              'flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs font-medium border transition-colors',
              askingAstra
                ? 'border-violet-500/50 bg-violet-500/10 text-violet-400 cursor-wait'
                : 'border-[var(--theme-border)] text-violet-400 hover:bg-violet-500/10 hover:border-violet-500/50',
            )}
          >
            <span className={askingAstra ? 'animate-pulse' : ''}>✦</span>
            {askingAstra ? 'Opening…' : 'Ask Astra'}
          </button>

          {/* Deploy Agents */}
          <button
            onClick={async () => {
              // Snapshot current states so we can compute diff when agents finish
              const snapshot: Record<string, { column: TaskColumn; priority: TaskPriority }> = {}
              for (const t of tasks) snapshot[t.id] = { column: t.column, priority: t.priority }
              setDeploySnapshot(snapshot)
              setAstraReviewing(true)
              try {
                await fetch('/api/tasks-deploy-agents', { method: 'POST' })
                await tasksQuery.refetch()
              } finally {
                setAstraReviewing(false)
              }
            }}
            disabled={astraReviewing}
            title="Deploy agents: Astra reviews each task and delegates to specialist sisters as needed"
            className={cn(
              'flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs font-medium border transition-colors',
              astraReviewing
                ? 'border-violet-500/50 bg-violet-500/10 text-violet-400 cursor-wait'
                : 'border-[var(--theme-border)] text-violet-400 hover:bg-violet-500/10 hover:border-violet-500/50',
            )}
          >
            <HugeiconsIcon icon={AiBrainIcon} size={13} strokeWidth={1.8} className={astraReviewing ? 'animate-pulse' : ''} />
            {astraReviewing ? 'Deploying…' : 'Deploy Agents'}
          </button>

          {/* AI idea generation */}
          <button
            onClick={async () => {
              setIdeasLoading(true)
              try {
                const res = await fetch('/api/tasks-generate-ideas', { method: 'POST' })
                const data = await res.json() as { ok: boolean; injected: number; ideas: Array<string>; error?: string }
                if (data.injected > 0) {
                  await tasksQuery.refetch()
                  toast(`Added ${data.injected} idea${data.injected > 1 ? 's' : ''} to backlog`)
                } else if (data.error) {
                  toast(`Idea scan failed: ${data.error}`, { type: 'error' })
                } else {
                  toast('AI scanned workspace — no new ideas to add right now', { type: 'info' })
                }
              } catch {
                toast('Failed to reach idea generator', { type: 'error' })
              } finally {
                setIdeasLoading(false)
              }
            }}
            disabled={ideasLoading}
            title="Ask AI to scan the workspace and suggest feature ideas"
            className={cn(
              'flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs font-medium border transition-colors',
              ideasLoading
                ? 'border-amber-500/50 bg-amber-500/10 text-amber-400 cursor-wait'
                : 'border-[var(--theme-border)] text-amber-400 hover:bg-amber-500/10 hover:border-amber-500/50',
            )}
          >
            <HugeiconsIcon icon={BulbIcon} size={13} strokeWidth={1.8} className={ideasLoading ? 'animate-pulse' : ''} />
            {ideasLoading ? 'Scanning…' : 'Add Idea'}
          </button>

          <button
            onClick={() => setShowDone(v => !v)}
            className={cn(
              'text-xs px-2.5 py-1 rounded-lg border transition-colors',
              showDone
                ? 'border-[var(--theme-accent)] text-[var(--theme-accent)] bg-[var(--theme-hover)]'
                : 'border-[var(--theme-border)] text-[var(--theme-muted)] hover:text-[var(--theme-text)] hover:border-[var(--theme-accent)]',
            )}
          >
            {showDone ? 'Hide Done' : 'Show Done'}
          </button>

          {/* Clear Done — only shown when Done column is visible and has tasks */}
          {showDone && columnMap['done'].length > 0 && (
            <button
              type="button"
              onClick={() => {
                const doneTasks = columnMap['done']
                if (!window.confirm(`Delete all ${doneTasks.length} done task${doneTasks.length !== 1 ? 's' : ''}? This cannot be undone.`)) return
                void Promise.all(doneTasks.map(t => deleteTask(t.id))).then(() => {
                  invalidate()
                  toast(`Cleared ${doneTasks.length} done task${doneTasks.length !== 1 ? 's' : ''}`)
                }).catch(() => toast('Failed to clear done tasks', { type: 'error' }))
              }}
              className="text-xs px-2.5 py-1 rounded-lg border transition-colors border-red-500/40 text-red-400 hover:bg-red-500/10"
            >
              Clear Done ({columnMap['done'].length})
            </button>
          )}

          <button
            onClick={invalidate}
            className="rounded-lg p-1.5 transition-colors hover:bg-[var(--theme-hover)]"
            title="Refresh"
          >
            <HugeiconsIcon icon={RefreshIcon} size={16} className="text-[var(--theme-muted)]" />
          </button>

          {/* Keyboard shortcuts hint */}
          <TooltipProvider>
            <TooltipRoot>
              <TooltipTrigger
                render={
                  <button
                    type="button"
                    className="rounded-lg px-2 py-1 text-xs font-mono transition-colors hover:bg-[var(--theme-hover)] text-[var(--theme-muted)]"
                    aria-label="Keyboard shortcuts"
                  >
                    ?
                  </button>
                }
              />
              <TooltipContent side="bottom" className="space-y-1 text-[11px] leading-relaxed">
                <div><kbd className="font-mono rounded px-1 bg-[var(--theme-hover)]">n</kbd> New task (Triage)</div>
                <div><kbd className="font-mono rounded px-1 bg-[var(--theme-hover)]">/</kbd> Focus search</div>
                <div><kbd className="font-mono rounded px-1 bg-[var(--theme-hover)]">d</kbd> Toggle Done column</div>
              </TooltipContent>
            </TooltipRoot>
          </TooltipProvider>

          <button
            onClick={() => { setCreateColumn('backlog'); setShowCreate(true) }}
            className="flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium text-white transition-opacity hover:opacity-90 bg-[var(--theme-accent)]"
          >
            <HugeiconsIcon icon={Add01Icon} size={14} />
            New Task
          </button>
        </div>
      </div>
        {/* Natural language task creation */}
        <div className="flex gap-2 mt-3">
          <div className="relative flex-1">
            <HugeiconsIcon
              icon={AiMagicIcon}
              size={14}
              className={cn('absolute left-2.5 top-1/2 -translate-y-1/2 pointer-events-none', nlParsing ? 'text-[var(--theme-accent)]' : 'text-[var(--theme-muted)]')}
            />
            <input
              ref={nlInputRef}
              type="text"
              value={nlInput}
              onChange={e => setNlInput(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') void handleNlCreate() }}
              placeholder="Describe a task in plain language and press Enter…"
              disabled={nlParsing}
              className="w-full rounded-lg border text-sm pl-8 pr-3 py-2 focus:outline-none focus:ring-1 focus:ring-[var(--theme-accent)] focus:border-[var(--theme-accent)] disabled:opacity-50 bg-[var(--theme-input)] border-[var(--theme-border)] text-[var(--theme-text)]"
            />
          </div>
          <button
            type="button"
            onClick={() => void handleNlCreate()}
            disabled={!nlInput.trim() || nlParsing}
            className="px-3 py-2 rounded-lg text-sm font-medium transition-colors disabled:opacity-40 shrink-0 bg-[var(--theme-accent)] text-white"
          >
            {nlParsing ? '✦ Thinking…' : '✦ Create'}
          </button>
        </div>
        <p className="mt-3 text-xs text-[var(--theme-muted)]">
          {TASKS_BOARD_HELP_TEXT}
        </p>
      </header>

      {/* Search + Filter Bar */}
      <div className="flex flex-wrap items-center gap-2">
        {/* Text search */}
        <div className="relative flex-1 min-w-[180px]">
          <HugeiconsIcon
            icon={Search01Icon}
            size={13}
            className="absolute left-2.5 top-1/2 -translate-y-1/2 pointer-events-none text-[var(--theme-muted)]"
          />
          <input
            ref={searchInputRef}
            type="text"
            value={searchQuery}
            onChange={e => setSearchQuery(e.target.value)}
            placeholder="Search tasks… (/)"
            className="w-full rounded-lg border pl-8 pr-3 py-1.5 text-xs focus:outline-none focus:ring-1 focus:border-[var(--theme-accent)] bg-[var(--theme-card)] border-[var(--theme-border)] text-[var(--theme-text)]"
          />
          {searchQuery && (
            <button
              type="button"
              onClick={() => setSearchQuery('')}
              className="absolute right-2 top-1/2 -translate-y-1/2 text-[var(--theme-muted)]"
            >
              <HugeiconsIcon icon={Cancel01Icon} size={12} />
            </button>
          )}
        </div>

        {/* Quick-filter chips */}
        {([
          ['Overdue', filterOverdue, () => setFilterOverdue(v => !v)],
          ['Blocked', filterBlocked, () => setFilterBlocked(v => !v)],
          ['Active Agent', filterActiveAgent, () => setFilterActiveAgent(v => !v)],
          ['In Review', filterInReview, () => setFilterInReview(v => !v)],
        ] as Array<[string, boolean, () => void]>).map(([label, active, toggle]) => (
          <button
            key={label}
            type="button"
            onClick={toggle}
            className="text-[10px] px-2.5 py-1 rounded-full border transition-colors whitespace-nowrap"
            style={{
              borderColor: active ? 'var(--theme-accent)' : 'var(--theme-border)',
              color: active ? 'var(--theme-accent)' : 'var(--theme-muted)',
              background: active ? 'color-mix(in srgb, var(--theme-accent) 12%, transparent)' : 'transparent',
            }}
          >
            {label}
          </button>
        ))}

        {/* Priority filter chips */}
        {(['high', 'medium', 'low'] as Array<TaskPriority>).map(p => (
          <button
            key={p}
            type="button"
            onClick={() => setPriorityFilter(prev => prev === p ? null : p)}
            className="text-[10px] px-2.5 py-1 rounded-full border transition-colors capitalize"
            style={{
              borderColor: priorityFilter === p ? PRIORITY_COLORS[p] : 'var(--theme-border)',
              color: priorityFilter === p ? PRIORITY_COLORS[p] : 'var(--theme-muted)',
              background: priorityFilter === p ? `${PRIORITY_COLORS[p]}1a` : 'transparent',
            }}
          >
            {p}
          </button>
        ))}

        {/* Active tag filter chip */}
        {tagFilter && (
          <div
            className="flex items-center gap-1 text-[10px] rounded-full px-2.5 py-1 border"
            style={{
              borderColor: 'var(--theme-accent)',
              color: 'var(--theme-accent)',
              background: 'color-mix(in srgb, var(--theme-accent) 12%, transparent)',
            }}
          >
            <span>#{tagFilter}</span>
            <button
              type="button"
              onClick={() => setTagFilter(null)}
              aria-label="Clear tag filter"
              className="ml-0.5"
            >
              <HugeiconsIcon icon={Cancel01Icon} size={10} />
            </button>
          </div>
        )}

        {/* Match counter + clear all */}
        {tasksByColumn.hasAnyFilter && (
          <span className="ml-auto text-[10px] flex items-center gap-2 whitespace-nowrap text-[var(--theme-muted)]">
            Showing {tasksByColumn.matchCount} of {tasksByColumn.totalTasks}
            <button
              type="button"
              onClick={clearAllFilters}
              className="hover:underline text-[var(--theme-accent)]"
            >
              Clear all
            </button>
          </span>
        )}
      </div>
      </div>

      {/* Board */}
      <div
        className="flex-1 min-h-0 mx-auto w-full max-w-[1200px] flex gap-3 overflow-x-auto overflow-y-hidden px-4 pb-[calc(var(--tabbar-h,80px)+1rem)] pt-3 sm:px-6 lg:px-8"
        style={{ boxShadow: 'inset 0 8px 24px rgba(0,0,0,0.2)' }}
      >
        {visibleColumns.map((col) => {
          const colTasks = columnMap[col]
          const colColor = COLUMN_COLORS[col]
          const isDragOver = dragOverColumn === col

          return (
            <div
              key={col}
              className={cn(
                'flex flex-col rounded-xl border min-w-[180px] w-full shrink-0 flex-1 min-h-0',
                'bg-[var(--theme-card)] border-[var(--theme-border)]',
                'transition-colors shadow-[0_2px_12px_rgba(0,0,0,0.25)]',
                isDragOver && 'border-[var(--theme-accent)] bg-[var(--theme-hover)]',
              )}
              style={{ maxWidth: colMaxWidth }}
              onDragOver={e => handleDragOver(e, col)}
              onDrop={e => handleDrop(e, col)}
              onDragLeave={() => setDragOverColumn(null)}
            >
              {/* Column header */}
              <div
                className="flex items-center justify-between px-3 py-2.5 border-b border-[var(--theme-border)] rounded-t-xl"
                style={{ borderTopWidth: 2, borderTopColor: colColor, borderTopStyle: 'solid' }}
              >
                <div className="flex items-center gap-2">
                  <span className="w-2 h-2 rounded-full shrink-0" style={{ background: colColor }} />
                  <span className="text-xs font-semibold text-[var(--theme-text)]">
                    {COLUMN_LABELS[col]}
                  </span>
                  <span className="text-xs text-[var(--theme-muted)]">
                    ({tasksQuery.isFetching && tasksQuery.data === undefined ? '…' : colTasks.length})
                  </span>
                </div>
                <button
                  onClick={() => { setCreateColumn(col); setShowCreate(true) }}
                  className="rounded p-0.5 hover:bg-[var(--theme-hover)] transition-colors"
                  title={`Add to ${COLUMN_LABELS[col]}`}
                >
                  <HugeiconsIcon icon={Add01Icon} size={14} className="text-[var(--theme-muted)]" />
                </button>
              </div>

              {/* Cards */}
              <div className="flex flex-col gap-2 p-2 flex-1 min-h-0 overflow-y-auto scrollbar-thin">
                {tasksQuery.isError ? (
                  <motion.div
                    key="error"
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    className="flex flex-col items-center justify-center py-8 gap-2 text-red-400"
                  >
                    <p className="text-xs font-medium">Failed to load tasks</p>
                    <button
                      onClick={() => tasksQuery.refetch()}
                      className="text-xs text-[var(--theme-accent)] hover:underline"
                    >
                      Retry
                    </button>
                  </motion.div>
                ) : tasksQuery.isLoading ? (
                  <>
                    <SkeletonCard />
                    <SkeletonCard />
                    <SkeletonCard />
                  </>
                ) : (
                  <AnimatePresence initial={false}>
                    {colTasks.length === 0 ? (
                      <motion.div
                        key="empty"
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        exit={{ opacity: 0 }}
                        className="flex flex-col items-center justify-center py-8 gap-2 text-[var(--theme-muted)] opacity-60"
                      >
                        <HugeiconsIcon icon={CheckListIcon} size={22} />
                        <p className="text-xs font-medium">No tasks</p>
                        <p className="text-[10px]">Drop here or click + to add</p>
                      </motion.div>
                    ) : (
                      colTasks.map(task => (
                        <motion.div
                          key={task.id}
                          layout
                          initial={{ opacity: 0, y: 6 }}
                          animate={{ opacity: 1, y: 0 }}
                          exit={{ opacity: 0, y: -6 }}
                          onDragEnd={handleDragEnd}
                        >
                          <TaskCard
                            task={task}
                            assigneeLabels={assigneeLabels}
                            isDragging={draggingId === task.id}
                            onDragStart={e => handleDragStart(e, task.id)}
                            onClick={() => setEditingTask(task)}
                            activeTagFilter={tagFilter}
                            onTagClick={(tag) => setTagFilter(prev => prev === tag ? null : tag)}
                            onAssigneeClick={(assignee) => setAssigneeFilter(prev => prev === assignee ? null : assignee)}
                            onChangePriority={(priority) =>
                              quickUpdateMutation.mutate({ id: task.id, input: { priority } })
                            }
                            onMoveToColumn={(column) =>
                              moveMutation.mutate({ id: task.id, column })
                            }
                            onDelete={() => {
                              if (window.confirm(`Delete "${task.title}"?`))
                                deleteMutation.mutate(task.id)
                            }}
                            isLaunching={launchingTaskId === task.id}
                            onLaunch={async () => {
                              setLaunchingTaskId(task.id)
                              try {
                                const { sessionId } = await launchSession(task.id)
                                void navigate({ to: '/chat/$sessionKey', params: { sessionKey: sessionId } })
                              } catch {
                                toast('Failed to launch session', { type: 'error' })
                              } finally {
                                setLaunchingTaskId(null)
                              }
                            }}
                            isExecuting={executingTaskId === task.id}
                            onExecute={async () => {
                              setExecutingTaskId(task.id)
                              try {
                                await executeTask(task.id)
                                await tasksQuery.refetch()
                                toast(`Agent is working on "${task.title}"…`)
                              } catch {
                                toast('Failed to start agent execution', { type: 'error' })
                              } finally {
                                setExecutingTaskId(null)
                              }
                            }}
                            isBreakingDown={breakingDownId === task.id}
                            onBreakdown={async () => {
                              setBreakingDownId(task.id)
                              try {
                                const { count, titles } = await breakdownTask(task.id)
                                invalidate()
                                toast(`Created ${count} subtask${count !== 1 ? 's' : ''}: ${titles.slice(0, 2).join(', ')}${count > 2 ? '…' : ''}`)
                              } catch (e) {
                                toast(e instanceof Error ? e.message : 'Breakdown failed', { type: 'error' })
                              } finally {
                                setBreakingDownId(null)
                              }
                            }}
                            onResetAgent={() => {
                              quickUpdateMutation.mutate({ id: task.id, input: { agent_state: null, agent_name: null, agent_action_at: null } })
                            }}
                            onRequestRefresh={() => void tasksQuery.refetch()}
                            onComment={handleTaskComment}
                          />
                        </motion.div>
                      ))
                    )}
                  </AnimatePresence>
                )}
              </div>
            </div>
          )
        })}
      </div>

      {/* Create dialog */}
      <TaskDialog
        open={showCreate}
        onOpenChange={(open) => { setShowCreate(open); if (!open) setCreateDefaults(null) }}
        defaultColumn={createDefaults?.column ?? createColumn}
        defaultTags={createDefaults?.tags}
        defaultTitle={createDefaults?.title}
        defaultDescription={createDefaults?.description}
        defaultPriority={createDefaults?.priority}
        defaultAssignee={createDefaults?.assignee}
        assignees={assignees}
        isSubmitting={createMutation.isPending}
        onSubmit={async (input) => { await createMutation.mutateAsync(input) }}
      />

      {/* Edit dialog — use live task data so agent_state reflects latest poll */}
      <TaskDialog
        open={editingTask !== null}
        onOpenChange={(open) => { if (!open) setEditingTask(null) }}
        task={editingTask ? (tasks.find(t => t.id === editingTask.id) ?? editingTask) : null}
        assignees={assignees}
        isSubmitting={updateMutation.isPending}
        onSubmit={async (input) => {
          if (!editingTask) return
          await updateMutation.mutateAsync({ id: editingTask.id, input })
        }}
        onComment={handleTaskComment}
        onExecute={editingTask ? async () => {
          setExecutingTaskId(editingTask.id)
          try {
            await executeTask(editingTask.id)
            await tasksQuery.refetch()
            toast(`Agent is working on "${editingTask.title}"…`)
          } finally {
            setExecutingTaskId(null)
          }
        } : undefined}
        isExecuting={editingTask ? executingTaskId === editingTask.id : false}
        onOpenSession={(sid) => { setEditingTask(null); void navigate({ to: '/chat/$sessionKey', params: { sessionKey: sid } }) }}
        isBreakingDown={editingTask ? breakingDownId === editingTask.id : false}
        onBreakdown={editingTask ? async () => {
          setBreakingDownId(editingTask.id)
          try {
            const { count, titles } = await breakdownTask(editingTask.id)
            invalidate()
            toast(`Created ${count} subtask${count !== 1 ? 's' : ''}: ${titles.slice(0, 2).join(', ')}${count > 2 ? '…' : ''}`)
          } finally {
            setBreakingDownId(null)
          }
        } : undefined}
      />
    </div>
  )
}
