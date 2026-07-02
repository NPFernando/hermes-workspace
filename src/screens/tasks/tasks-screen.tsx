'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate, useSearch } from '@tanstack/react-router'
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { AnimatePresence, motion } from 'motion/react'
import { HugeiconsIcon } from '@hugeicons/react'
import { Add01Icon, AiBrainIcon, AiMagicIcon, BulbIcon, Cancel01Icon, CheckListIcon, Delete01Icon, Loading03Icon, MoreVerticalIcon, RefreshIcon, Search01Icon } from '@hugeicons/core-free-icons'
import { TaskCard } from './task-card'
import { TaskDialog } from './task-dialog'
import { useTaskFilters } from './use-task-filters'
import {
  countExecutableReviewTasks,
  formatBlockedTaskBreakdownLabel,
  formatBlockedTaskBreakdownTitle,
  formatCompactTaskColumnActionLabel,
  formatCompactTaskColumnAriaLabel,
  formatTaskFilterSummary,
  formatTaskRefreshStatus,
  formatTaskStatFilterButtonLabel,
  isTypingTarget,
} from './format-utils'
import { RunningTaskRow, SkeletonCard, VIRTUAL_THRESHOLD, VirtualTaskList } from './virtual-task-list'
import { KeyboardShortcutsModal } from './panels/keyboard-shortcuts-modal'
import { TimeoutAnalysisModal } from './panels/timeout-analysis-modal'
import { ArchiveWizardModal } from './panels/archive-wizard-modal'
import { UnlockPrereqModal } from './panels/unlock-prereq-modal'
import { SisterRebalanceModal } from './panels/sister-rebalance-modal'
import { TagsBrowserPanel } from './panels/tags-browser-panel'
import { ActivityPanel } from './panels/activity-panel'
import { TaskDetailPanel } from './panels/task-detail-panel'
import type { VirtualRow } from './virtual-task-list'
import type { ClaudeTask, CreateTaskInput, TaskAssignee, TaskColumn, TaskPriority, UpdateTaskInput } from '@/lib/tasks-api'
import { TooltipContent, TooltipProvider, TooltipRoot, TooltipTrigger } from '@/components/ui/tooltip'
import { cn } from '@/lib/utils'
import { toast } from '@/components/ui/toast'
import {
  COLUMN_COLORS,
  COLUMN_LABELS,
  COLUMN_ORDER,
  PRIORITY_COLORS,
  askAstra,
  batchExecuteTasks,
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
  submitClarificationAnswers,
  updateTask,
} from '@/lib/tasks-api'
import { MenuContent, MenuItem, MenuRoot, MenuTrigger } from '@/components/ui/menu'

const QUERY_KEY = ['claude', 'tasks'] as const
const ASSIGNEES_KEY = ['claude', 'tasks', 'assignees'] as const

export function TasksScreen() {
  const queryClient = useQueryClient()
  const [showCreate, setShowCreate] = useState(false)
  const [createColumn, setCreateColumn] = useState<TaskColumn>('backlog')
  const [editingTask, setEditingTask] = useState<ClaudeTask | null>(null)
  const [draggingId, setDraggingId] = useState<string | null>(null)
  const [dragOverColumn, setDragOverColumn] = useState<TaskColumn | null>(null)
  const [showDone] = useState(true)
  const [astraReviewing, setAstraReviewing] = useState(false)
  const [askingAstra, setAskingAstra] = useState(false)
  const [ideasLoading, setIdeasLoading] = useState(false)
  const [clearingStuck, setClearingStuck] = useState(false)
  const [batchExecuting, setBatchExecuting] = useState(false)
  const [drainingNow, setDrainingNow] = useState(false)
  const [replanningStubs, setReplanningStubs] = useState(false)
  const [rescuingTimedOut, setRescuingTimedOut] = useState(false)
  const [unlockingPrereq, setUnlockingPrereq] = useState<string | null>(null)
  const [checkingCompletion, setCheckingCompletion] = useState(false)
  const [breakingDownId, setBreakingDownId] = useState<string | null>(null)
  const [pruningStale, setPruningStale] = useState(false)

  const search = useSearch({ from: '/tasks' })
  const navigate = useNavigate()
  const initialAssignee = typeof search.assignee === 'string' ? search.assignee : null
  const {
    searchQuery, setSearchQuery,
    filterOverdue, setFilterOverdue,
    filterBlocked, setFilterBlocked,
    filterActiveAgent, setFilterActiveAgent,
    filterInReview, setFilterInReview,
    filterTimedOut, setFilterTimedOut,
    ageFilter, setAgeFilter,
    priorityFilter, setPriorityFilter,
    tagFilter, setTagFilter,
    assigneeFilter, setAssigneeFilter,
    hideSubtasks, setHideSubtasks,
    showFilterPopover, setShowFilterPopover,
    hiddenColumns, toggleHideColumn,
    filterPresets, saveFilterPreset, applyFilterPreset, deleteFilterPreset,
    clearAllFilters,
  } = useTaskFilters(initialAssignee)
  const taskIdFromUrl = typeof search.task === 'string' ? search.task : null
  // Track which task ID was auto-opened from the URL to avoid re-opening after close
  const autoOpenedTaskIdRef = useRef<string | null>(null)

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
  // Becomes true when we observe at least one agent_state → ensures we don't fire summary before agents start
  const [agentsEverActive, setAgentsEverActive] = useState(false)

  // — Search + filter state (see use-task-filters.ts)
  const searchInputRef = useRef<HTMLInputElement>(null)
  const [showRunningPanel, setShowRunningPanel] = useState(true)

  const [quickAddCol, setQuickAddCol] = useState<TaskColumn | null>(null)
  const [quickAddTitle, setQuickAddTitle] = useState('')

  // Bulk select
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())
  const toggleSelect = useCallback((id: string) => {
    setSelectedIds(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id); else next.add(id)
      return next
    })
  }, [])
  const clearSelection = useCallback(() => setSelectedIds(new Set()), [])

  // Task detail panel
  const [panelTask, setPanelTask] = useState<ClaudeTask | null>(null)

  // Column hide/collapse + subtask visibility: see use-task-filters.ts

  // Unified panel state — only one slide-over open at a time
  const [activePanel, setActivePanel] = useState<'activity' | 'tags' | 'sisterLoad' | 'rebalance' | null>(null)
  const showActivity = activePanel === 'activity'
  const showTagsPanel = activePanel === 'tags'
  const showSisterLoad = activePanel === 'sisterLoad'
  const showRebalance = activePanel === 'rebalance'
  const setShowActivity = (v: boolean | ((p: boolean) => boolean)) => setActivePanel(prev => { const cur = prev === 'activity'; const next = typeof v === 'function' ? v(cur) : v; if (next) return 'activity'; if (cur) return null; return prev })
  const setShowTagsPanel = (v: boolean | ((p: boolean) => boolean)) => setActivePanel(prev => { const cur = prev === 'tags'; const next = typeof v === 'function' ? v(cur) : v; if (next) return 'tags'; if (cur) return null; return prev })
  const setShowSisterLoad = (v: boolean | ((p: boolean) => boolean)) => setActivePanel(prev => { const cur = prev === 'sisterLoad'; const next = typeof v === 'function' ? v(cur) : v; if (next) return 'sisterLoad'; if (cur) return null; return prev })
  const setShowRebalance = (v: boolean | ((p: boolean) => boolean)) => setActivePanel(prev => { const cur = prev === 'rebalance'; const next = typeof v === 'function' ? v(cur) : v; if (next) return 'rebalance'; if (cur) return null; return prev })
  // Activity panel
  const [activityTab, setActivityTab] = useState<'inbox' | 'feed'>('inbox')
  const [inboxReplies, setInboxReplies] = useState<Record<string, string>>({})
  const [inboxSending, setInboxSending] = useState<string | null>(null)

  // Today's wins popover
  const [showWins, setShowWins] = useState(false)

  // Confirm dialogs (replaces all window.confirm calls)
  const [confirmClearDone, setConfirmClearDone] = useState(false)
  const [deleteConfirmId, setDeleteConfirmId] = useState<string | null>(null)
  const [confirmPruneStale, setConfirmPruneStale] = useState(false)
  const [confirmBulkDelete, setConfirmBulkDelete] = useState(false)

  // Search syntax help popover
  const [showSearchHelp, setShowSearchHelp] = useState(false)

  // Inline goal input (replaces window.prompt)
  const [goalInputOpen, setGoalInputOpen] = useState(false)
  const [goalInputVal, setGoalInputVal] = useState('')

  // Inline preset name input (replaces window.prompt)
  const [presetNameOpen, setPresetNameOpen] = useState(false)
  const [presetNameVal, setPresetNameVal] = useState('')

  // Tags browser panel helpers
  const [tagsPanelBulkTag, setTagsPanelBulkTag] = useState('')
  const [taggingSelected, setTaggingSelected] = useState(false)

  // Parent grouping in todo
  const [groupByParent, setGroupByParent] = useState(false)
  const [collapsedGroups, setCollapsedGroups] = useState<Set<string>>(new Set())
  const toggleGroup = useCallback((groupId: string) => {
    setCollapsedGroups(prev => {
      const next = new Set(prev)
      if (next.has(groupId)) next.delete(groupId); else next.add(groupId)
      return next
    })
  }, [])

  // Sister load + rebalance params
  const [rebalanceFrom, setRebalanceFrom] = useState<string>('')
  const [rebalanceTo, setRebalanceTo] = useState<string>('')
  const [rebalanceCount, setRebalanceCount] = useState(20)
  const [rebalancing, setRebalancing] = useState(false)

  // Daily completion goal
  const [dailyGoal, setDailyGoal] = useState<number | null>(() => {
    const v = parseInt(localStorage.getItem('hermes-daily-goal') ?? '', 10)
    return isNaN(v) ? null : v
  })
  const setAndPersistGoal = useCallback((n: number | null) => {
    setDailyGoal(n)
    if (n == null) localStorage.removeItem('hermes-daily-goal')
    else localStorage.setItem('hermes-daily-goal', String(n))
  }, [])

  // Keyboard shortcuts modal
  const [showShortcuts, setShowShortcuts] = useState(false)

  // Timeout analysis modal
  const [showTimeoutAnalysis, setShowTimeoutAnalysis] = useState(false)

  // Compact / dense card mode (persisted)
  const [denseMode, setDenseMode] = useState(() => localStorage.getItem('hermes-dense-mode') === '1')
  const toggleDenseMode = useCallback(() => {
    setDenseMode(prev => {
      const next = !prev
      localStorage.setItem('hermes-dense-mode', next ? '1' : '0')
      return next
    })
  }, [])

  // View mode: board columns or swimlane by assignee
  const [viewMode, setViewMode] = useState<'board' | 'swimlane'>('board')

  // Stale task cleanup wizard
  const [showArchiveWizard, setShowArchiveWizard] = useState(false)
  const [archiveDays, setArchiveDays] = useState(60)
  const [archiving, setArchiving] = useState(false)
  const [archivePreview, setArchivePreview] = useState<{ buckets: { days30: number; days60: number; days90: number }; previews: Array<{ id: string; title: string; assignee: string | null; ageDays: number }> } | null>(null)

  // Notification feed
  const [notifLastSeen, setNotifLastSeen] = useState<string>(() => localStorage.getItem('hermes-notif-seen') ?? new Date(0).toISOString())
  const markNotifSeen = useCallback(() => {
    const now = new Date().toISOString()
    setNotifLastSeen(now)
    localStorage.setItem('hermes-notif-seen', now)
  }, [])

  // Unlock prereq modal (enhanced from window.confirm)
  const [unlockModalPrereq, setUnlockModalPrereq] = useState<{ id: string; title: string; count: number } | null>(null)

  // Saved filter presets: see use-task-filters.ts

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

  // Auto-open the task dialog when a ?task=<id> deep-link is present
  useEffect(() => {
    if (!taskIdFromUrl) { autoOpenedTaskIdRef.current = null; return }
    if (autoOpenedTaskIdRef.current === taskIdFromUrl) return
    const target = tasks.find(t => t.id === taskIdFromUrl)
    if (target) {
      autoOpenedTaskIdRef.current = taskIdFromUrl
      setEditingTask(target)
    }
  }, [taskIdFromUrl, tasks])

  const tasksByColumn = useMemo(() => {
    const columns: Record<TaskColumn, Array<ClaudeTask>> = {
      backlog: [], todo: [], in_progress: [], review: [], blocked: [], done: [], deleted: [],
    }

    // Parse search operators: assignee:X tag:X is:blocked is:timedout is:overdue is:subtask is:active
    let rawQ = searchQuery.trim().toLowerCase()
    let opAssignee: string | null = null
    let opTag: string | null = null
    const opIs: Set<string> = new Set()
    rawQ = rawQ.replace(/assignee:(\S+)/g, (_, v) => { opAssignee = v; return '' })
    rawQ = rawQ.replace(/tag:(\S+)/g, (_, v) => { opTag = v; return '' })
    rawQ = rawQ.replace(/is:(\S+)/g, (_, v) => { opIs.add(v); return '' })
    const q = rawQ.trim()

    // Merge operator-derived filters with chip filters
    const effAssignee = opAssignee ?? assigneeFilter
    const effTag = opTag ?? tagFilter
    const effTimedOut = filterTimedOut || opIs.has('timedout')
    const effBlocked = filterBlocked || opIs.has('blocked')
    const effOverdue = filterOverdue || opIs.has('overdue')
    const effActiveAgent = filterActiveAgent || opIs.has('active')
    const effInReview = filterInReview || opIs.has('review')
    const effHideSubtasks = hideSubtasks || opIs.has('subtask') === false // hideSubtasks chip
    // is:subtask means SHOW only subtasks (opposite of hide)
    const effOnlySubtasks = opIs.has('subtask')

    let matchCount = 0

    for (const t of tasks) {
      if (effAssignee && t.assignee !== effAssignee) continue
      if (q) {
        const hit = t.title.toLowerCase().includes(q)
          || t.description.toLowerCase().includes(q)
          || t.tags.some(tag => tag.toLowerCase().includes(q))
        if (!hit) continue
      }
      if (effOverdue && !isOverdue(t)) continue
      if (effBlocked && t.column !== 'blocked') continue
      if (effActiveAgent && !t.agent_state) continue
      if (effInReview && t.column !== 'review') continue
      if (priorityFilter && t.priority !== priorityFilter) continue
      if (effTag && !t.tags.includes(effTag)) continue
      if (effTimedOut && !(t.agent_history ?? []).some((h: { action: string }) => h.action === 'timed_out')) continue
      if (ageFilter) {
        const createdAt = (t as unknown as { created_at?: string }).created_at
        const ageDays = createdAt ? (Date.now() - new Date(createdAt).getTime()) / 86_400_000 : 0
        if (ageFilter === 'fresh'  && ageDays >= 1) continue
        if (ageFilter === 'aging'  && (ageDays < 1 || ageDays >= 3)) continue
        if (ageFilter === 'stale'  && ageDays < 3) continue
      }
      // Subtask filtering
      const isSubtask = t.tags.includes('subtask')
      if (effHideSubtasks && isSubtask) continue
      if (effOnlySubtasks && !isSubtask) continue

      columns[t.column].push(t)
      matchCount++
    }
    for (const col of COLUMN_ORDER) {
      columns[col].sort((a, b) => a.position - b.position)
    }
    const hasAnyFilter = Boolean(effAssignee || q || effOverdue || effBlocked || effActiveAgent || effInReview || effTimedOut || ageFilter || priorityFilter || effTag || hideSubtasks || opIs.size > 0)
    return { columns, matchCount, totalTasks: tasks.length, hasAnyFilter }
  }, [tasks, assigneeFilter, searchQuery, filterOverdue, filterBlocked, filterActiveAgent, filterInReview, filterTimedOut, ageFilter, priorityFilter, tagFilter, hideSubtasks])

  const columnMap = tasksByColumn.columns
  const taskRefreshStatus = formatTaskRefreshStatus(tasksQuery.isFetching, tasksQuery.isLoading)

  // Queue position map — mirrors server-side priority sort in runAgentDeployBackground
  const queuePositions = useMemo(() => {
    const PRIORITY_SCORE: Record<string, number> = { high: 3, medium: 2, low: 1 }
    const sorted = tasks
      .filter(t => (t.column === 'todo' || t.column === 'backlog') && !t.agent_state)
      .sort((a, b) => {
        const pa = PRIORITY_SCORE[a.priority] ?? 2
        const pb = PRIORITY_SCORE[b.priority] ?? 2
        if (pb !== pa) return pb - pa
        const da = new Date((a as unknown as { created_at?: string }).created_at ?? 0).getTime()
        const db = new Date((b as unknown as { created_at?: string }).created_at ?? 0).getTime()
        return da - db
      })
    const map: Record<string, number> = {}
    sorted.forEach((t, i) => { map[t.id] = i + 1 })
    return map
  }, [tasks])

  const stats = useMemo(() => {
    const total = tasks.length
    const running = tasks.filter(t => t.column === 'in_progress').length
    const blockedTasks = tasks.filter(t => t.column === 'blocked')
    const blocked = blockedTasks.length
    const blockedWaiting = blockedTasks.filter(t => t.waiting_for_user).length
    const blockedExecFail = blockedTasks.filter(t => !t.waiting_for_user).length
    const done = tasks.filter(t => t.column === 'done').length
    const overdue = tasks.filter(t => isOverdue(t) && t.column !== 'done').length
    const completion = total > 0 ? Math.round((done / total) * 100) : 0
    const agentActive = tasks.filter(t => t.agent_state).length
    const readyToExecute = countExecutableReviewTasks(tasks)
    // Group gated tasks by prereq ID so we can show unlock buttons
    const prereqGroups = new Map<string, { count: number; title: string }>()
    tasks.forEach((t) => {
      if (!Array.isArray(t.depends_on) || t.depends_on.length === 0) return
      t.depends_on.forEach((depId) => {
        const prereq = tasks.find((p) => p.id === depId)
        const entry = prereqGroups.get(depId)
        if (entry) { entry.count++ }
        else { prereqGroups.set(depId, { count: 1, title: prereq?.title ?? 'prerequisite' }) }
      })
    })
    const gatedPrereqs = [...prereqGroups.entries()].map(([id, { count, title }]) => ({ id, count, title }))
    const timedOut = tasks.filter(t => t.column !== 'done' && (t.agent_history ?? []).some((h: { action: string }) => h.action === 'timed_out')).length
    const workingTasks = tasks.filter(t => t.agent_state === 'working')
    const stubReviewCount = tasks.filter(t => {
      if (t.column !== 'review' || t.agent_state) return false
      const planned = (t.agent_history ?? []).filter((h: { action: string }) => h.action === 'planned')
      if (planned.length === 0) return true
      const note = (planned[planned.length - 1] as { note?: string }).note ?? ''
      return note.includes('Plan unavailable') || note.length < 80
    }).length
    const sisterLoad: Record<string, number> = {}
    tasks.filter(t => t.column !== 'done' && t.column !== 'deleted' && t.assignee)
      .forEach(t => { sisterLoad[t.assignee!] = (sisterLoad[t.assignee!] ?? 0) + 1 })
    const sisterChips = Object.entries(sisterLoad).sort((a, b) => b[1] - a[1]).slice(0, 8)

    // Today's wins: tasks with a 'completed' history entry dated today
    const today = new Date().toISOString().slice(0, 10)
    const todayWins: Array<{ task: ClaudeTask; completedAt: string; note: string }> = []
    tasks.forEach(t => {
      ;(t.agent_history ?? []).forEach((h: { action: string; at?: string; note?: string }) => {
        if (h.action === 'completed' && (h.at ?? '').startsWith(today)) {
          todayWins.push({ task: t, completedAt: h.at ?? '', note: h.note ?? '' })
        }
      })
    })
    todayWins.sort((a, b) => b.completedAt.localeCompare(a.completedAt))

    // Inbox: tasks waiting for user input
    const inboxTasks = tasks.filter(t => t.waiting_for_user || t.column === 'blocked')

    // Tag cloud across all active tasks
    const tagCloud: Record<string, number> = {}
    tasks.filter(t => t.column !== 'done' && t.column !== 'deleted')
      .forEach(t => t.tags.forEach(tag => { tagCloud[tag] = (tagCloud[tag] ?? 0) + 1 }))

    return { total, running, blocked, blockedWaiting, blockedExecFail, done, overdue, completion, agentActive, readyToExecute, gatedPrereqs, timedOut, workingTasks, stubReviewCount, sisterChips, todayWins, inboxTasks, tagCloud }
  }, [tasks])

  const invalidate = useCallback(() => {
    void queryClient.invalidateQueries({ queryKey: QUERY_KEY })
  }, [queryClient])

  // Grouped rows for todo column when groupByParent is enabled
  const groupedTodoRows = useMemo<Array<VirtualRow> | null>(() => {
    if (!groupByParent) return null
    const taskColumnsByStatus = tasksByColumn.columns
    const todoTasks = taskColumnsByStatus['todo'] ?? []
    const allById = new Map(tasks.map(t => [t.id, t]))

    // Separate tasks with known parent vs ungrouped
    const parentGroups = new Map<string, { label: string; items: Array<ClaudeTask> }>()
    const byAssignee = new Map<string, Array<ClaudeTask>>()

    todoTasks.forEach(t => {
      const parentId = t.depends_on?.[0]
      if (parentId && allById.has(parentId)) {
        const parent = allById.get(parentId)!
        if (!parentGroups.has(parentId)) parentGroups.set(parentId, { label: parent.title, items: [] })
        parentGroups.get(parentId)!.items.push(t)
      } else {
        const asgn = t.assignee ?? 'unassigned'
        if (!byAssignee.has(asgn)) byAssignee.set(asgn, [])
        byAssignee.get(asgn)!.push(t)
      }
    })

    const rows: Array<VirtualRow> = []

    // Parent-linked groups first
    for (const [parentId, { label, items }] of parentGroups) {
      const collapsed = collapsedGroups.has(parentId)
      rows.push({ kind: 'group-header', label, count: items.length, groupId: parentId, collapsed, onToggle: () => toggleGroup(parentId) })
      if (!collapsed) items.forEach(t => rows.push({ kind: 'task', task: t }))
    }

    // Assignee groups as fallback
    const sortedAssignees = [...byAssignee.entries()].sort((a, b) => b[1].length - a[1].length)
    for (const [asgn, items] of sortedAssignees) {
      const groupId = `__asgn__${asgn}`
      const collapsed = collapsedGroups.has(groupId)
      rows.push({ kind: 'group-header', label: asgn, count: items.length, groupId, collapsed, onToggle: () => toggleGroup(groupId) })
      if (!collapsed) items.forEach(t => rows.push({ kind: 'task', task: t }))
    }

    return rows
  }, [groupByParent, tasksByColumn.columns, tasks, collapsedGroups, toggleGroup])

  // Notification feed: recent agent_history events across all tasks
  const notifEvents = useMemo(() => {
    const events: Array<{ taskId: string; taskTitle: string; action: string; at: string; note: string; by: string }> = []
    const cutoff = new Date(Date.now() - 24 * 60 * 60_000).toISOString() // last 24h
    tasks.forEach(t => {
      ;(t.agent_history ?? []).forEach((h: { action?: string; at?: string; note?: string; by?: string }) => {
        if (!h.at || h.at < cutoff) return
        const action = h.action ?? ''
        if (!['completed', 'blocked', 'question', 'timed_out', 'rescued', 'planned'].includes(action)) return
        events.push({ taskId: t.id, taskTitle: t.title, action, at: h.at, note: h.note ?? '', by: h.by ?? 'astra' })
      })
    })
    events.sort((a, b) => b.at.localeCompare(a.at))
    return events.slice(0, 60)
  }, [tasks])

  const unreadNotifCount = useMemo(
    () => notifEvents.filter(e => e.at > notifLastSeen).length,
    [notifEvents, notifLastSeen],
  )

  // Swimlane data: tasks grouped by assignee × status
  const swimlaneData = useMemo(() => {
    if (viewMode !== 'swimlane') return null
    const SWIM_COLS: Array<TaskColumn> = ['todo', 'in_progress', 'review', 'blocked']
    const assigneeMap = new Map<string, Record<TaskColumn, Array<ClaudeTask>>>()
    const addRow = (asgn: string) => {
      if (!assigneeMap.has(asgn)) {
        const empty = {} as Record<TaskColumn, Array<ClaudeTask>>
        for (const c of SWIM_COLS) empty[c] = []
        assigneeMap.set(asgn, empty)
      }
      return assigneeMap.get(asgn)!
    }
    tasks.forEach(t => {
      if (!SWIM_COLS.includes(t.column)) return
      const asgn = t.assignee ?? 'unassigned'
      addRow(asgn)[t.column].push(t)
    })
    const sorted = [...assigneeMap.entries()].sort((a, b) => {
      const totalA = SWIM_COLS.reduce((s, c) => s + a[1][c].length, 0)
      const totalB = SWIM_COLS.reduce((s, c) => s + b[1][c].length, 0)
      return totalB - totalA
    })
    return { cols: SWIM_COLS, rows: sorted }
  }, [viewMode, tasks])

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

  async function handleTaskClarify(taskId: string, answers: Record<string, string>) {
    const result = await submitClarificationAnswers(taskId, answers)
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
      if (e.key === '?') {
        e.preventDefault()
        setShowShortcuts(v => !v)
        return
      }
      if (e.key === 'Escape') {
        setShowShortcuts(false)
        setShowTimeoutAnalysis(false)
        setPanelTask(null)
        return
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [])


  // Agent deploy summary — waits for agents to start (agentsEverActive) then fires when all clear.
  useEffect(() => {
    if (!deploySnapshot) return
    const anyActive = tasks.some(t => t.agent_state)
    // Phase 1: agents not yet started — wait until we see at least one spinner
    if (!agentsEverActive) {
      if (anyActive) setAgentsEverActive(true)
      return
    }
    // Phase 2: agents have started — wait until all clear
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
    setAgentsEverActive(false)
  }, [tasks, deploySnapshot, agentsEverActive])

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

  const sweepStatsQuery = useQuery({
    queryKey: ['tasks', 'sweep-stats'],
    queryFn: async () => {
      const res = await fetch('/api/tasks-sweep-stats')
      return res.json() as Promise<{ ok: boolean; dispatched: number; completed: number; blocked: number; needsInput: number; timedOutToday: number; lastSweepAt: string | null; successRate: number | null }>
    },
    refetchInterval: 30_000,
    staleTime: 20_000,
  })
  const sweepStats = sweepStatsQuery.data

  // Browser tab badge: count tasks needing attention
  useEffect(() => {
    const count = stats.blocked + (sweepStats?.timedOutToday ?? 0)
    document.title = count > 0 ? `(${count}) Hermes Tasks` : 'Hermes Tasks'
    return () => { document.title = 'Hermes Tasks' }
  }, [stats.blocked, sweepStats?.timedOutToday])

  const trendQuery = useQuery({
    queryKey: ['tasks', 'completion-trend'],
    queryFn: async () => {
      const res = await fetch('/api/tasks-completion-trend')
      return res.json() as Promise<{ ok: boolean; trend: Array<{ date: string; count: number }>; total: number }>
    },
    refetchInterval: 5 * 60_000,
    staleTime: 4 * 60_000,
  })
  const trend = trendQuery.data

  const visibleColumns = COLUMN_ORDER.filter(c => !hiddenColumns.has(c))
  const activityCount = stats.inboxTasks.length + unreadNotifCount
  const activeFilterCount = [filterOverdue, filterBlocked, filterTimedOut, filterActiveAgent, filterInReview, hideSubtasks, !!priorityFilter, !!assigneeFilter, !!ageFilter, !!tagFilter].filter(Boolean).length

  // Pre-compute live panel task (avoids tasks.find inside JSX IIFE every render)
  const panelLive = panelTask ? (tasks.find(t => t.id === panelTask.id) ?? panelTask) : null

  // Pre-compute timeout analysis data (only when modal is open)
  const timeoutAnalysisData = useMemo(() => {
    if (!showTimeoutAnalysis) return null
    const today = new Date().toISOString().slice(0, 10)
    const timedOutEntries: Array<{ task: ClaudeTask; note: string; at: string }> = []
    tasks.forEach(t => {
      ;(t.agent_history ?? []).forEach((h: { action: string; at?: string; note?: string }) => {
        if (h.action === 'timed_out' && (h.at ?? '').startsWith(today)) {
          timedOutEntries.push({ task: t, note: h.note ?? '', at: h.at ?? '' })
        }
      })
    })
    const byAssignee: Record<string, number> = {}
    timedOutEntries.forEach(e => { const a = e.task.assignee ?? 'unassigned'; byAssignee[a] = (byAssignee[a] ?? 0) + 1 })
    const byTag: Record<string, number> = {}
    timedOutEntries.forEach(e => { const tag = e.task.tags?.[0] ?? 'untagged'; byTag[tag] = (byTag[tag] ?? 0) + 1 })
    return {
      timedOutEntries,
      topAssignees: Object.entries(byAssignee).sort((a, b) => b[1] - a[1]).slice(0, 8),
      topTags: Object.entries(byTag).sort((a, b) => b[1] - a[1]).slice(0, 6),
      sample: timedOutEntries.slice(0, 8),
    }
  }, [tasks, showTimeoutAnalysis])

  return (
    <div data-route-page className="h-full overflow-hidden flex flex-col bg-surface text-ink">
      <div className="shrink-0 w-full flex flex-col gap-3 px-4 pt-5 pb-2 sm:px-6 lg:px-8">
      {/* Header */}
      <header className="rounded-2xl border border-[var(--theme-border)] bg-[var(--theme-panel)] p-4 backdrop-blur-xl">
        <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <h1 className="hidden text-2xl font-medium text-ink shrink-0 md:block">Tasks</h1>
            {assigneeFilter && (
              <div className="flex items-center gap-1.5 text-xs text-[var(--theme-muted)]">
                <span>·</span>
                <span>Filtered by: <span className="capitalize text-amber-500">{assigneeFilter}</span></span>
                <button
                  type="button"
                  onClick={() => setAssigneeFilter(null)}
                  className="text-[var(--theme-muted)] hover:text-ink transition-colors"
                >
                  ✕
                </button>
              </div>
            )}
          </div>
          {/* Stats — single compact row */}
          <div className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[11px] text-[var(--theme-muted)]">
            <span>{stats.total} tasks</span>
            {stats.running > 0 && <><span className="opacity-30">·</span><span>{stats.running} running</span></>}
            {stats.blocked > 0 && (
              <><span className="opacity-30">·</span>
              <button
                type="button"
                aria-pressed={filterBlocked}
                aria-label={formatTaskStatFilterButtonLabel('Blocked', filterBlocked)}
                className="text-red-400 cursor-pointer hover:opacity-80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-400/60 rounded-sm"
                onClick={() => setFilterBlocked(v => !v)}
                title={formatBlockedTaskBreakdownTitle(stats.blockedWaiting, stats.blockedExecFail)}
              >
                {stats.blocked} blocked{formatBlockedTaskBreakdownLabel(stats.blockedWaiting, stats.blockedExecFail) ? ` (${formatBlockedTaskBreakdownLabel(stats.blockedWaiting, stats.blockedExecFail)})` : ''}
              </button></>
            )}
            {stats.timedOut > 0 && (
              <><span className="opacity-30">·</span>
              <button
                type="button"
                aria-label="Open timed-out task analysis"
                onClick={() => setShowTimeoutAnalysis(true)}
                className="text-amber-500 hover:text-amber-300 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-400/60 rounded-sm transition-colors"
              >⏱ {stats.timedOut}</button></>
            )}
            {stats.overdue > 0 && <><span className="opacity-30">·</span><span className="text-red-400">{stats.overdue} overdue</span></>}
            <span className="opacity-30">·</span>
            <span>{stats.completion}% done</span>
            {/* Daily goal ring */}
            {(() => {
              const doneToday = trend?.trend?.find(d => d.date === new Date().toISOString().slice(0, 10))?.count ?? sweepStats?.completed ?? 0
              if (goalInputOpen) return (
                <span className="flex items-center gap-1">
                  <input
                    type="number"
                    min={0}
                    autoFocus
                    value={goalInputVal}
                    onChange={e => setGoalInputVal(e.target.value)}
                    onKeyDown={e => {
                      if (e.key === 'Enter') {
                        const n = parseInt(goalInputVal, 10)
                        if (!isNaN(n)) setAndPersistGoal(n <= 0 ? null : n)
                        setGoalInputOpen(false)
                      } else if (e.key === 'Escape') {
                        setGoalInputOpen(false)
                      }
                    }}
                    onBlur={() => setGoalInputOpen(false)}
                    className="w-12 rounded border border-[var(--theme-accent)]/50 bg-[var(--theme-card)] text-[10px] px-1 py-0.5 text-center focus:outline-none focus:border-[var(--theme-accent)]"
                    placeholder="0=clear"
                  />
                </span>
              )
              if (dailyGoal == null) return (
                <button type="button" onClick={() => { setGoalInputVal(''); setGoalInputOpen(true) }} className="text-[10px] opacity-40 hover:opacity-80 hover:text-[var(--theme-accent)] transition-colors">+ goal</button>
              )
              const pct = Math.min(1, doneToday / dailyGoal)
              const r = 7, circ = 2 * Math.PI * r
              const color = pct >= 1 ? '#34d399' : pct >= 0.5 ? '#f59e0b' : 'var(--theme-accent)'
              return (
                <button type="button" onClick={() => { setGoalInputVal(String(dailyGoal)); setGoalInputOpen(true) }} className="flex items-center gap-1" title={`${doneToday}/${dailyGoal} today — click to update`}>
                  <svg width="16" height="16"><circle cx="8" cy="8" r={r} fill="none" stroke="var(--theme-border)" strokeWidth="2"/><circle cx="8" cy="8" r={r} fill="none" stroke={color} strokeWidth="2" strokeDasharray={circ} strokeDashoffset={circ*(1-pct)} strokeLinecap="round" transform="rotate(-90 8 8)"/></svg>
                  <span className="text-[10px]" style={{ color }}>{doneToday}/{dailyGoal}</span>
                </button>
              )
            })()}
            {stats.agentActive > 0 && (
              <><span className="opacity-30">·</span><span className="flex items-center gap-1 text-violet-400"><span className="w-1 h-1 rounded-full bg-violet-400 animate-pulse inline-block"/>Astra {stats.agentActive}</span></>
            )}
            {/* Pipeline inline */}
            {sweepStats && sweepStats.dispatched > 0 && (
              <><span className="opacity-20 mx-0.5">|</span>
              <span className="opacity-60">🔄 {sweepStats.dispatched}</span>
              {sweepStats.completed > 0 && <span className="text-emerald-400">✅ {sweepStats.completed}</span>}
              {sweepStats.successRate !== null && <span className={sweepStats.successRate >= 50 ? 'text-emerald-400' : sweepStats.successRate >= 25 ? 'text-amber-400' : 'text-red-400'}>{sweepStats.successRate}%</span>}
              {sweepStats.lastSweepAt && <span className="opacity-40 text-[10px]">sweep {Math.round((Date.now()-new Date(sweepStats.lastSweepAt).getTime())/60_000)}m ago</span>}
              {trend && trend.trend.length > 0 && (() => {
                const max = Math.max(...trend.trend.map(d => d.count), 1)
                const W = 42, H = 14, barW = 4, gap = 2
                return (
                  <span className="flex items-center gap-0.5 opacity-50" title={`7d: ${trend.total} completed`}>
                    <svg width={W} height={H} viewBox={`0 0 ${W} ${H}`}>
                      {trend.trend.map((d, i) => { const h = Math.max(1, Math.round((d.count/max)*H)); return <rect key={d.date} x={i*(barW+gap)} y={H-h} width={barW} height={h} rx={1} fill={d.count===0?'currentColor':'var(--theme-accent)'} opacity={d.count===0?0.2:0.7}/> })}
                    </svg>
                    <span className="text-[9px]">{trend.total}w</span>
                  </span>
                )
              })()}
              </>
            )}
            {/* Wins popover */}
            {stats.todayWins.length > 0 && (
              <><span className="opacity-20 mx-0.5">|</span>
              <div className="relative">
                <button type="button" onClick={() => setShowWins(v => !v)} className="text-emerald-400 hover:text-emerald-300 transition-colors">🏆 {stats.todayWins.length}{showWins ? ' ▲' : ''}</button>
                {showWins && (
                  <>
                    <div className="fixed inset-0 z-30" onClick={() => setShowWins(false)}/>
                    <div className="absolute left-0 top-full mt-1 z-40 w-72 bg-[var(--theme-card)] border border-emerald-500/20 rounded-xl shadow-2xl p-2 flex flex-col gap-0.5 max-h-64 overflow-y-auto scrollbar-thin">
                      <p className="text-[9px] font-semibold text-emerald-400/60 uppercase tracking-wider px-2 pb-1">Today's wins</p>
                      {stats.todayWins.slice(0, 12).map(({ task, completedAt }) => {
                        const ms = Date.now()-new Date(completedAt).getTime()
                        const ago = ms<3600_000?`${Math.round(ms/60_000)}m`:`${Math.round(ms/3600_000)}h`
                        return (
                          <button key={task.id+completedAt} type="button" onClick={() => { setPanelTask(task); setShowWins(false) }} className="flex items-center justify-between gap-2 px-2 py-1.5 rounded-lg hover:bg-emerald-500/10 transition-colors text-left w-full">
                            <span className="text-[11px] text-emerald-300 truncate">{task.title}</span>
                            <span className="text-[9px] text-emerald-500/60 shrink-0">{ago}</span>
                          </button>
                        )
                      })}
                      {stats.todayWins.length > 12 && <p className="text-[9px] text-center text-emerald-500/40 pb-1">+{stats.todayWins.length-12} more</p>}
                    </div>
                  </>
                )}
              </div>
              </>
            )}
          </div>
        </div>

        <div className="flex items-center gap-2 shrink-0 flex-wrap justify-end">
          {/* ⚑ Activity — inbox + notifications merged */}
          <button
            type="button"
            onClick={() => {
              if (!showActivity) { markNotifSeen(); setActivityTab(stats.inboxTasks.length > 0 ? 'inbox' : 'feed') }
              setShowActivity(v => !v)
            }}
            className={cn(
              'relative flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs font-medium border transition-colors',
              showActivity ? 'border-amber-500/50 bg-amber-500/10 text-amber-400' : 'border-[var(--theme-border)] text-[var(--theme-muted)] hover:bg-[var(--theme-hover)]',
            )}
            title="Inbox + recent agent activity"
          >
            ⚑ Activity
            {activityCount > 0 && <span className={cn('text-[9px] px-1 rounded-full font-bold', showActivity ? 'bg-amber-500/20 text-amber-400' : 'bg-[var(--theme-accent)]/20 text-[var(--theme-accent)]')}>{activityCount}</span>}
          </button>

          {/* 🎛️ View dropdown */}
          <MenuRoot>
            <MenuTrigger render={
              <button
                type="button"
                className={cn(
                  'flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs font-medium border transition-colors',
                  (denseMode || viewMode === 'swimlane' || hideSubtasks || groupByParent)
                    ? 'border-[var(--theme-accent)] bg-[var(--theme-accent)]/10 text-[var(--theme-accent)]'
                    : 'border-[var(--theme-border)] text-[var(--theme-muted)] hover:bg-[var(--theme-hover)]',
                )}
                title="View settings"
              >
                🎛️ View{(denseMode || viewMode === 'swimlane' || hideSubtasks || groupByParent) ? ' ●' : ''}
              </button>
            }/>
            <MenuContent side="bottom" align="end">
              <MenuItem onClick={toggleDenseMode}>
                {denseMode ? '✓ ' : ''}Dense cards
              </MenuItem>
              <MenuItem onClick={() => setViewMode(v => v === 'board' ? 'swimlane' : 'board')}>
                {viewMode === 'swimlane' ? '✓ ' : ''}Swimlane by assignee
              </MenuItem>
              <MenuItem onClick={() => setHideSubtasks(v => !v)}>
                {hideSubtasks ? '✓ ' : ''}Hide subtasks
              </MenuItem>
              <MenuItem onClick={() => setGroupByParent(v => !v)}>
                {groupByParent ? '✓ ' : ''}Group by parent (todo)
              </MenuItem>
              <MenuItem onClick={() => setShowTagsPanel(v => !v)}>
                {showTagsPanel ? '✓ ' : ''}Tags browser
              </MenuItem>
              <MenuItem onClick={() => setShowSisterLoad(v => !v)}>
                {showSisterLoad ? '✓ ' : ''}Sister load
              </MenuItem>
            </MenuContent>
          </MenuRoot>
          {/* Ask Astra */}
          <button
            onClick={async () => {
              setAskingAstra(true)
              try {
                const { sessionId } = await askAstra()
                // Pre-fill the chat composer with a board briefing so Astra has context
                const COLS: Array<{ key: string; label: string }> = [
                  { key: 'backlog', label: 'Backlog' },
                  { key: 'todo', label: 'To Do' },
                  { key: 'in_progress', label: 'In Progress' },
                  { key: 'review', label: 'Review' },
                  { key: 'blocked', label: 'Blocked' },
                ]
                const activeTasks = tasks.filter((t) => t.column !== 'done' && t.column !== 'deleted')
                const doneCount = tasks.filter((t) => t.column === 'done').length
                const sections = COLS.map((col) => {
                  const colTasks = activeTasks.filter((t) => t.column === col.key)
                  if (!colTasks.length) return null
                  const lines = colTasks.map((t) => {
                    const prio = t.priority !== 'medium' ? ` [${t.priority}]` : ''
                    const who = t.assignee ? ` → ${t.assignee}` : ''
                    return `• ${t.title.slice(0, 80)}${prio}${who}`
                  }).join('\n')
                  return `**${col.label}** (${colTasks.length})\n${lines}`
                }).filter(Boolean).join('\n\n')
                const briefing = [
                  'Here is my current task board. Please review it and help me prioritize what to work on next.\n',
                  sections || '(no active tasks)',
                  doneCount > 0 ? `\n*${doneCount} task${doneCount === 1 ? '' : 's'} done*` : '',
                ].join('\n')
                window.sessionStorage.setItem(`claude-draft-${sessionId}`, briefing)
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
              setAgentsEverActive(false)
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

          {/* ⚡ Actions dropdown — all conditional ops */}
          {(() => {
            const totalActions = stats.readyToExecute + stats.stubReviewCount + stats.timedOut + stats.gatedPrereqs.reduce((s, g) => s + g.count, 0)
            const anyBusy = batchExecuting || drainingNow || replanningStubs || rescuingTimedOut || unlockingPrereq != null
            return (
              <MenuRoot>
                <MenuTrigger render={
                  <button
                    type="button"
                    disabled={anyBusy}
                    className={cn(
                      'flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs font-medium border transition-colors',
                      totalActions > 0
                        ? 'border-emerald-500/40 text-emerald-400 hover:bg-emerald-500/10'
                        : 'border-[var(--theme-border)] text-[var(--theme-muted)] hover:bg-[var(--theme-hover)]',
                      anyBusy && 'cursor-wait opacity-70',
                    )}
                    title="Board actions"
                  >
                    <HugeiconsIcon icon={AiMagicIcon} size={13} strokeWidth={1.8} className={anyBusy ? 'animate-pulse' : ''}/>
                    {anyBusy ? 'Working…' : 'Actions'}
                    {totalActions > 0 && <span className="text-[9px] px-1 rounded-full bg-emerald-500/20 text-emerald-400 font-bold">{totalActions}</span>}
                  </button>
                }/>
                <MenuContent side="bottom" align="end">
                  {stats.readyToExecute > 0 && (
                    <MenuItem
                      onClick={async () => {
                        setBatchExecuting(true)
                        try {
                          const res = await batchExecuteTasks(5)
                          await tasksQuery.refetch()
                          toast(res.remaining > 0 ? `Started ${res.started} · ${res.remaining} more ready` : `Started ${res.started} task${res.started !== 1 ? 's' : ''}`)
                        } catch { toast('Execute failed', { type: 'error' }) }
                        finally { setBatchExecuting(false) }
                      }}
                      disabled={batchExecuting}
                      className="text-emerald-400"
                    >
                      <HugeiconsIcon icon={AiMagicIcon} size={13}/>
                      Execute ready ({stats.readyToExecute})
                    </MenuItem>
                  )}
                  {stats.readyToExecute > 0 && (
                    <MenuItem
                      onClick={async () => {
                        setDrainingNow(true)
                        try {
                          const res = await fetch('/api/tasks-drain-now', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ limit: 50 }) })
                          const data = await res.json() as { ok: boolean; queued: number }
                          await tasksQuery.refetch()
                          toast(data.queued > 0 ? `Drained ${data.queued} to execution` : 'No eligible tasks right now')
                        } catch { toast('Drain failed', { type: 'error' }) }
                        finally { setDrainingNow(false) }
                      }}
                      disabled={drainingNow}
                      className="text-orange-400"
                    >
                      <HugeiconsIcon icon={AiMagicIcon} size={13}/>
                      Drain all now ({stats.readyToExecute})
                    </MenuItem>
                  )}
                  {stats.stubReviewCount > 0 && (
                    <MenuItem
                      onClick={async () => {
                        setReplanningStubs(true)
                        try {
                          const res = await fetch('/api/tasks-replan-stubs', { method: 'POST' })
                          const data = await res.json() as { ok: boolean; moved: number }
                          await tasksQuery.refetch()
                          toast(`Moved ${data.moved} stubs back to todo`)
                        } catch { toast('Re-plan failed', { type: 'error' }) }
                        finally { setReplanningStubs(false) }
                      }}
                      disabled={replanningStubs}
                      className="text-sky-400"
                    >
                      <HugeiconsIcon icon={RefreshIcon} size={13}/>
                      Re-plan stubs ({stats.stubReviewCount})
                    </MenuItem>
                  )}
                  {stats.timedOut > 0 && (
                    <MenuItem
                      onClick={async () => {
                        setRescuingTimedOut(true)
                        try {
                          const res = await fetch('/api/tasks-rescue-timedout', { method: 'POST' })
                          const data = await res.json() as { ok: boolean; rescued: number }
                          await tasksQuery.refetch()
                          toast(data.rescued > 0 ? `Rescued ${data.rescued} stuck tasks` : 'No stuck tasks')
                        } catch { toast('Rescue failed', { type: 'error' }) }
                        finally { setRescuingTimedOut(false) }
                      }}
                      disabled={rescuingTimedOut}
                      className="text-amber-400"
                    >
                      <HugeiconsIcon icon={Loading03Icon} size={13}/>
                      Rescue timed-out ({stats.timedOut})
                    </MenuItem>
                  )}
                  {stats.gatedPrereqs.map(({ id, count, title }) => (
                    <MenuItem
                      key={id}
                      onClick={() => setUnlockModalPrereq({ id, count, title })}
                      disabled={unlockingPrereq === id}
                      className="text-amber-400"
                    >
                      <HugeiconsIcon icon={CheckListIcon} size={13}/>
                      🔓 Unlock {count} gated tasks
                    </MenuItem>
                  ))}
                  {totalActions === 0 && (
                    <MenuItem disabled className="text-[var(--theme-muted)] opacity-50 cursor-default">No pending actions</MenuItem>
                  )}
                </MenuContent>
              </MenuRoot>
            )
          })()}

          {/* Secondary actions — overflow menu */}
          <MenuRoot>
            <MenuTrigger
              render={
                <button
                  type="button"
                  title="More actions"
                  className="relative flex items-center gap-1 rounded-lg px-2 py-1.5 text-xs font-medium border border-[var(--theme-border)] text-[var(--theme-muted)] hover:bg-[var(--theme-hover)] hover:text-ink transition-colors"
                >
                  <HugeiconsIcon icon={MoreVerticalIcon} size={14} />
                  {/* Dot badge when any conditional action is available */}
                  {(tasks.some(t => t.column === 'review' || t.column === 'in_progress') ||
                    tasks.some(t => (t.column === 'backlog' || t.column === 'todo') && !(t.agent_history?.length)) ||
                    columnMap['done'].length > 0 ||
                    tasks.some(t => t.agent_state && t.agent_action_at && Date.now() - new Date(t.agent_action_at).getTime() > 10 * 60_000)
                  ) && (
                    <span className="absolute -top-0.5 -right-0.5 w-2 h-2 rounded-full bg-amber-400 border-2 border-[var(--theme-panel)]" />
                  )}
                </button>
              }
            />
            <MenuContent side="bottom" align="end">
              {/* Clear Stuck */}
              {tasks.some(t => t.agent_state && t.agent_action_at && Date.now() - new Date(t.agent_action_at).getTime() > 10 * 60_000) && (
                <MenuItem
                  onClick={async () => {
                    setClearingStuck(true)
                    try {
                      await fetch('/api/tasks-deploy-agents', { method: 'DELETE' })
                      await tasksQuery.refetch()
                    } finally {
                      setClearingStuck(false)
                    }
                  }}
                  disabled={clearingStuck}
                  className="text-amber-400"
                >
                  <HugeiconsIcon icon={Loading03Icon} size={13} className={clearingStuck ? 'animate-spin' : ''} />
                  {clearingStuck ? 'Clearing…' : 'Clear Stuck'}
                </MenuItem>
              )}

              {/* Check Completion */}
              {tasks.some(t => t.column === 'review' || t.column === 'in_progress') && (
                <MenuItem
                  onClick={async () => {
                    setCheckingCompletion(true)
                    try {
                      await fetch('/api/tasks-completion-check', { method: 'POST' })
                      await tasksQuery.refetch()
                    } finally {
                      setCheckingCompletion(false)
                    }
                  }}
                  disabled={checkingCompletion}
                  className="text-emerald-400"
                >
                  <HugeiconsIcon icon={CheckListIcon} size={13} className={checkingCompletion ? 'animate-pulse' : ''} />
                  {checkingCompletion ? 'Checking…' : 'Check Done'}
                </MenuItem>
              )}

              {/* Add Idea */}
              <MenuItem
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
                className="text-amber-400"
              >
                <HugeiconsIcon icon={BulbIcon} size={13} className={ideasLoading ? 'animate-pulse' : ''} />
                {ideasLoading ? 'Scanning…' : 'Add Idea'}
              </MenuItem>

              {/* Prune Stale */}
              {tasks.some(t => (t.column === 'backlog' || t.column === 'todo') && !(t.agent_history?.length)) && (
                <MenuItem
                  onClick={() => setConfirmPruneStale(true)}
                  disabled={pruningStale}
                  className="text-red-400"
                >
                  <HugeiconsIcon icon={Delete01Icon} size={13} className={pruningStale ? 'animate-pulse' : ''} />
                  {pruningStale ? 'Pruning…' : 'Prune Stale'}
                </MenuItem>
              )}

              {/* Archive stale — moved from header */}
              <MenuItem
                onClick={async () => {
                  const res = await fetch('/api/tasks-stale')
                  const data = await res.json() as { ok: boolean; buckets: { days30: number; days60: number; days90: number }; previews: Array<{ id: string; title: string; assignee: string | null; ageDays: number }> }
                  if (data.ok) { setArchivePreview(data); setShowArchiveWizard(true) }
                }}
                className="text-[var(--theme-muted)]"
              >
                🗂️ Archive stale tasks
              </MenuItem>
              {/* Keyboard shortcuts — moved from header */}
              <MenuItem onClick={() => setShowShortcuts(v => !v)} className="text-[var(--theme-muted)]">
                ⌨️ Keyboard shortcuts
              </MenuItem>
            </MenuContent>
          </MenuRoot>

          <button
            type="button"
            onClick={() => void tasksQuery.refetch()}
            aria-label={tasksQuery.isFetching ? 'Refreshing task board' : 'Refresh task board'}
            className="rounded-lg p-1.5 transition-colors hover:bg-[var(--theme-hover)]"
            title={tasksQuery.isFetching ? 'Refreshing…' : 'Refresh'}
          >
            <HugeiconsIcon
              icon={RefreshIcon}
              size={16}
              className={cn('text-[var(--theme-muted)]', tasksQuery.isFetching && 'animate-spin text-[var(--theme-accent)]')}
            />
          </button>

          {/* Keyboard shortcuts button — REMOVED (moved to overflow) */}
          <button
            type="button"
            onClick={() => setShowShortcuts(v => !v)}
            style={{ display: 'none' }}
            className="rounded-lg px-2 py-1 text-xs font-mono transition-colors hover:bg-[var(--theme-hover)] text-[var(--theme-muted)]"
            aria-label="Keyboard shortcuts"
            title="Keyboard shortcuts (?)"
          >
            ?
          </button>

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
      </header>

      {/* Search + Filter Bar */}
      <div className="flex flex-wrap items-center gap-2 relative">
        {/* Text search */}
        <div className="relative flex-1 min-w-[180px]">
          <HugeiconsIcon icon={Search01Icon} size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 pointer-events-none text-[var(--theme-muted)]"/>
          <input
            ref={searchInputRef}
            type="text"
            value={searchQuery}
            onChange={e => setSearchQuery(e.target.value)}
            placeholder="Search… (/) or assignee:ada tag:subtask is:blocked"
            className="w-full rounded-lg border pl-8 pr-3 py-1.5 text-xs focus:outline-none focus:ring-1 focus:border-[var(--theme-accent)] bg-[var(--theme-card)] border-[var(--theme-border)] text-[var(--theme-text)]"
          />
          {searchQuery && (
            <button type="button" onClick={() => setSearchQuery('')} aria-label="Clear task search" className="absolute right-2 top-1/2 -translate-y-1/2 text-[var(--theme-muted)]">
              <HugeiconsIcon icon={Cancel01Icon} size={12}/>
            </button>
          )}
        </div>

        {/* ? Search syntax help */}
        <div className="relative">
          <button
            type="button"
            onClick={() => setShowSearchHelp(v => !v)}
            className={cn('rounded-full w-5 h-5 flex items-center justify-center text-[10px] border transition-colors', showSearchHelp ? 'border-[var(--theme-accent)] text-[var(--theme-accent)] bg-[var(--theme-accent)]/10' : 'border-[var(--theme-border)] text-[var(--theme-muted)] hover:border-[var(--theme-accent)] hover:text-[var(--theme-accent)]')}
            title="Search syntax help"
          >?</button>
          {showSearchHelp && (
            <>
              <div className="fixed inset-0 z-30" onClick={() => setShowSearchHelp(false)}/>
              <div className="absolute left-0 top-full mt-1 z-40 w-64 bg-[var(--theme-card)] border border-[var(--theme-border)] rounded-xl shadow-2xl p-3 flex flex-col gap-1.5">
                <p className="text-[9px] font-semibold text-[var(--theme-muted)] uppercase tracking-wider pb-1 border-b border-[var(--theme-border)]">Search syntax</p>
                {([
                  ['assignee:ada', 'filter by sister'],
                  ['tag:label', 'filter by tag'],
                  ['is:blocked', 'only blocked tasks'],
                  ['is:overdue', 'only overdue tasks'],
                  ['is:review', 'only in review'],
                  ['priority:high', 'high / medium / low'],
                ] as const).map(([syntax, desc]) => (
                  <div key={syntax} className="flex items-center justify-between gap-2">
                    <code className="text-[10px] text-[var(--theme-accent)] font-mono">{syntax}</code>
                    <span className="text-[10px] text-[var(--theme-muted)]">{desc}</span>
                  </div>
                ))}
                <p className="text-[9px] text-[var(--theme-muted)] opacity-50 pt-1 border-t border-[var(--theme-border)]">Combine freely: <code className="text-[9px] text-[var(--theme-accent)]">assignee:ada is:blocked</code></p>
              </div>
            </>
          )}
        </div>

        {/* 🔽 Filters button */}
        <div className="relative">
          <button
            type="button"
            onClick={() => setShowFilterPopover(v => !v)}
            className={cn(
              'flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs font-medium border transition-colors whitespace-nowrap',
              showFilterPopover || activeFilterCount > 0
                ? 'border-[var(--theme-accent)] bg-[var(--theme-accent)]/10 text-[var(--theme-accent)]'
                : 'border-[var(--theme-border)] text-[var(--theme-muted)] hover:bg-[var(--theme-hover)]',
            )}
          >
            🔽 Filters{activeFilterCount > 0 ? ` (${activeFilterCount})` : ''}
          </button>
              {/* Popover */}
              {showFilterPopover && (
                <>
                  <div className="fixed inset-0 z-30" onClick={() => setShowFilterPopover(false)}/>
                  <div className="absolute left-0 top-full mt-1 z-40 w-72 bg-[var(--theme-card)] border border-[var(--theme-border)] rounded-xl shadow-2xl p-3 flex flex-col gap-3">
                    {/* Status */}
                    <div>
                      <p className="text-[9px] font-semibold uppercase tracking-wider text-[var(--theme-muted)] opacity-50 mb-1.5">Status</p>
                      <div className="flex flex-wrap gap-1.5">
                        {([['Overdue', filterOverdue, () => setFilterOverdue(v => !v)], ['Blocked', filterBlocked, () => setFilterBlocked(v => !v)], ['Timed Out', filterTimedOut, () => setFilterTimedOut(v => !v)], ['Active Agent', filterActiveAgent, () => setFilterActiveAgent(v => !v)], ['In Review', filterInReview, () => setFilterInReview(v => !v)]] as Array<[string, boolean, () => void]>).map(([label, active, toggle]) => (
                          <button key={label} type="button" onClick={toggle} className="text-[10px] px-2 py-0.5 rounded-full border transition-colors" style={{ borderColor: active ? 'var(--theme-accent)' : 'var(--theme-border)', color: active ? 'var(--theme-accent)' : 'var(--theme-muted)', background: active ? 'color-mix(in srgb, var(--theme-accent) 12%, transparent)' : 'transparent' }}>{label}</button>
                        ))}
                      </div>
                    </div>
                    {/* Priority */}
                    <div>
                      <p className="text-[9px] font-semibold uppercase tracking-wider text-[var(--theme-muted)] opacity-50 mb-1.5">Priority</p>
                      <div className="flex gap-1.5">
                        {(['high', 'medium', 'low'] as Array<TaskPriority>).map(p => (
                          <button key={p} type="button" onClick={() => setPriorityFilter(prev => prev === p ? null : p)} className="text-[10px] px-2.5 py-0.5 rounded-full border transition-colors capitalize" style={{ borderColor: priorityFilter === p ? PRIORITY_COLORS[p] : 'var(--theme-border)', color: priorityFilter === p ? PRIORITY_COLORS[p] : 'var(--theme-muted)', background: priorityFilter === p ? `${PRIORITY_COLORS[p]}1a` : 'transparent' }}>{p}</button>
                        ))}
                      </div>
                    </div>
                    {/* Age */}
                    <div>
                      <p className="text-[9px] font-semibold uppercase tracking-wider text-[var(--theme-muted)] opacity-50 mb-1.5">Age</p>
                      <div className="flex gap-1.5">
                        {([['fresh', 'Fresh <1d', '#34d399'], ['aging', 'Aging 1-3d', '#f59e0b'], ['stale', 'Stale >3d', '#f87171']] as Array<['fresh'|'aging'|'stale', string, string]>).map(([band, label, color]) => (
                          <button key={band} type="button" onClick={() => setAgeFilter(prev => prev === band ? null : band)} className="text-[10px] px-2 py-0.5 rounded-full border transition-colors" style={{ borderColor: ageFilter === band ? color : 'var(--theme-border)', color: ageFilter === band ? color : 'var(--theme-muted)', background: ageFilter === band ? `${color}18` : 'transparent' }}>{label}</button>
                        ))}
                      </div>
                    </div>
                    {/* Assignee */}
                    {stats.sisterChips.length > 0 && (
                      <div>
                        <p className="text-[9px] font-semibold uppercase tracking-wider text-[var(--theme-muted)] opacity-50 mb-1.5">Assignee</p>
                        <div className="flex flex-wrap gap-1.5">
                          {stats.sisterChips.map(([name, count]) => (
                            <button key={name} type="button" onClick={() => setAssigneeFilter(prev => prev === name ? null : name)} className="text-[10px] px-2 py-0.5 rounded-full border transition-colors capitalize" style={{ borderColor: assigneeFilter === name ? 'var(--theme-accent)' : 'var(--theme-border)', color: assigneeFilter === name ? 'var(--theme-accent)' : 'var(--theme-muted)', background: assigneeFilter === name ? 'color-mix(in srgb, var(--theme-accent) 12%, transparent)' : 'transparent' }}>{name} <span className="opacity-50">{count}</span></button>
                          ))}
                        </div>
                      </div>
                    )}
                    {/* Presets row */}
                    {filterPresets.length > 0 && (
                      <div>
                        <p className="text-[9px] font-semibold uppercase tracking-wider text-[var(--theme-muted)] opacity-50 mb-1.5">Presets</p>
                        <div className="flex flex-wrap gap-1.5">
                          {filterPresets.map(p => (
                            <div key={p.name} className="flex items-center gap-0.5">
                              <button type="button" onClick={() => { applyFilterPreset(p); setShowFilterPopover(false) }} className="text-[10px] px-2 py-0.5 rounded-l-full border border-r-0 border-[var(--theme-border)] text-[var(--theme-muted)] hover:bg-[var(--theme-hover)]">{p.name}</button>
                              <button type="button" onClick={() => deleteFilterPreset(p.name)} className="text-[10px] px-1.5 py-0.5 rounded-r-full border border-[var(--theme-border)] text-[var(--theme-muted)] hover:text-red-400 hover:border-red-400/30">×</button>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}
                    {/* Footer */}
                    <div className="flex items-center justify-between pt-1 border-t border-[var(--theme-border)]">
                      <span className="text-[10px] text-[var(--theme-muted)] opacity-60">{tasksByColumn.hasAnyFilter ? formatTaskFilterSummary(tasksByColumn.matchCount, tasksByColumn.totalTasks) : 'No active filters'}</span>
                      <div className="flex gap-2">
                        {presetNameOpen ? (
                          <input
                            type="text"
                            autoFocus
                            value={presetNameVal}
                            onChange={e => setPresetNameVal(e.target.value)}
                            onKeyDown={e => {
                              if (e.key === 'Enter' && presetNameVal.trim()) {
                                saveFilterPreset(presetNameVal.trim())
                                toast(`Saved preset "${presetNameVal.trim()}"`)
                                setPresetNameVal('')
                                setPresetNameOpen(false)
                              } else if (e.key === 'Escape') {
                                setPresetNameOpen(false)
                              }
                            }}
                            onBlur={() => { if (!presetNameVal.trim()) setPresetNameOpen(false) }}
                            placeholder="preset name…"
                            className="w-24 rounded border border-violet-500/40 bg-[var(--theme-card)] text-[10px] px-1.5 py-0.5 focus:outline-none focus:border-violet-500 text-violet-300"
                          />
                        ) : (
                          <button type="button" onClick={() => { setPresetNameVal(''); setPresetNameOpen(true) }} className="text-[10px] text-violet-400 hover:underline">★ Save</button>
                        )}
                        {tasksByColumn.hasAnyFilter && <button type="button" onClick={() => { clearAllFilters(); setShowFilterPopover(false) }} className="text-[10px] text-[var(--theme-accent)] hover:underline">Clear all</button>}
                      </div>
                    </div>
                  </div>
                </>
              )}
        </div>

        {/* Active filter pills — shown inline only when active */}
        {filterOverdue && <button type="button" onClick={() => setFilterOverdue(false)} className="flex items-center gap-1 text-[10px] px-2 py-0.5 rounded-full border border-[var(--theme-accent)] text-[var(--theme-accent)] bg-[var(--theme-accent)]/10 hover:bg-[var(--theme-accent)]/20 transition-colors">Overdue <HugeiconsIcon icon={Cancel01Icon} size={9}/></button>}
        {filterBlocked && <button type="button" onClick={() => setFilterBlocked(false)} className="flex items-center gap-1 text-[10px] px-2 py-0.5 rounded-full border border-[var(--theme-accent)] text-[var(--theme-accent)] bg-[var(--theme-accent)]/10 hover:bg-[var(--theme-accent)]/20 transition-colors">Blocked <HugeiconsIcon icon={Cancel01Icon} size={9}/></button>}
        {filterTimedOut && <button type="button" onClick={() => setFilterTimedOut(false)} className="flex items-center gap-1 text-[10px] px-2 py-0.5 rounded-full border border-[var(--theme-accent)] text-[var(--theme-accent)] bg-[var(--theme-accent)]/10 hover:bg-[var(--theme-accent)]/20 transition-colors">Timed Out <HugeiconsIcon icon={Cancel01Icon} size={9}/></button>}
        {filterActiveAgent && <button type="button" onClick={() => setFilterActiveAgent(false)} className="flex items-center gap-1 text-[10px] px-2 py-0.5 rounded-full border border-[var(--theme-accent)] text-[var(--theme-accent)] bg-[var(--theme-accent)]/10 hover:bg-[var(--theme-accent)]/20 transition-colors">Active Agent <HugeiconsIcon icon={Cancel01Icon} size={9}/></button>}
        {filterInReview && <button type="button" onClick={() => setFilterInReview(false)} className="flex items-center gap-1 text-[10px] px-2 py-0.5 rounded-full border border-[var(--theme-accent)] text-[var(--theme-accent)] bg-[var(--theme-accent)]/10 hover:bg-[var(--theme-accent)]/20 transition-colors">In Review <HugeiconsIcon icon={Cancel01Icon} size={9}/></button>}
        {hideSubtasks && <button type="button" onClick={() => setHideSubtasks(false)} className="flex items-center gap-1 text-[10px] px-2 py-0.5 rounded-full border border-[var(--theme-accent)] text-[var(--theme-accent)] bg-[var(--theme-accent)]/10 hover:bg-[var(--theme-accent)]/20 transition-colors">Subtasks hidden <HugeiconsIcon icon={Cancel01Icon} size={9}/></button>}
        {priorityFilter && <button type="button" onClick={() => setPriorityFilter(null)} className="flex items-center gap-1 text-[10px] px-2 py-0.5 rounded-full border capitalize" style={{ borderColor: PRIORITY_COLORS[priorityFilter], color: PRIORITY_COLORS[priorityFilter], background: `${PRIORITY_COLORS[priorityFilter]}1a` }}>{priorityFilter} <HugeiconsIcon icon={Cancel01Icon} size={9}/></button>}
        {assigneeFilter && <button type="button" onClick={() => setAssigneeFilter(null)} className="flex items-center gap-1 text-[10px] px-2 py-0.5 rounded-full border border-[var(--theme-accent)] text-[var(--theme-accent)] bg-[var(--theme-accent)]/10 capitalize">{assigneeFilter} <HugeiconsIcon icon={Cancel01Icon} size={9}/></button>}
        {ageFilter && <button type="button" onClick={() => setAgeFilter(null)} className="flex items-center gap-1 text-[10px] px-2 py-0.5 rounded-full border" style={{ borderColor: ageFilter==='fresh'?'#34d399':ageFilter==='aging'?'#f59e0b':'#f87171', color: ageFilter==='fresh'?'#34d399':ageFilter==='aging'?'#f59e0b':'#f87171' }}>{ageFilter} <HugeiconsIcon icon={Cancel01Icon} size={9}/></button>}
        {tagFilter && <button type="button" onClick={() => setTagFilter(null)} className="flex items-center gap-1 text-[10px] px-2 py-0.5 rounded-full border border-[var(--theme-accent)] text-[var(--theme-accent)] bg-[var(--theme-accent)]/10">#{tagFilter} <HugeiconsIcon icon={Cancel01Icon} size={9}/></button>}
        {tasksByColumn.hasAnyFilter && (
          <span className="ml-auto text-[10px] text-[var(--theme-muted)] opacity-60 whitespace-nowrap">{formatTaskFilterSummary(tasksByColumn.matchCount, tasksByColumn.totalTasks)}</span>
        )}

        <span
          role="status"
          aria-live="polite"
          className={cn(
            'ml-auto text-[10px] whitespace-nowrap text-[var(--theme-muted)] transition-opacity',
            taskRefreshStatus ? 'opacity-100' : 'opacity-0',
            tasksByColumn.hasAnyFilter && 'ml-0',
          )}
        >
          {taskRefreshStatus ?? 'Task board is up to date'}
        </span>
      </div>
      </div>

      {/* Sister load panel */}
      {showSisterLoad && stats.sisterChips.length > 0 && (() => {
        const maxLoad = Math.max(...stats.sisterChips.map(([, n]) => n), 1)
        return (
          <div className="shrink-0 mx-4 sm:mx-6 lg:mx-8 mb-1 rounded-lg border border-[var(--theme-border)] bg-[var(--theme-card)] p-3">
            <div className="flex items-center justify-between mb-2">
              <p className="text-[10px] font-semibold text-[var(--theme-muted)] uppercase tracking-wider">Sister Load</p>
              <button
                type="button"
                onClick={() => setShowRebalance(true)}
                className="text-[10px] px-2 py-0.5 rounded border border-[var(--theme-border)] hover:border-[var(--theme-accent)] hover:text-[var(--theme-accent)] text-[var(--theme-muted)] transition-colors"
              >⇄ Rebalance</button>
            </div>
            <div className="flex flex-col gap-1.5">
              {stats.sisterChips.map(([name, count]) => (
                <div key={name} className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => setAssigneeFilter(prev => prev === name ? null : name)}
                    className="text-[10px] capitalize text-[var(--theme-muted)] hover:text-[var(--theme-accent)] transition-colors shrink-0 w-20 text-right"
                  >{name}</button>
                  <div className="flex-1 h-2 rounded-full bg-[var(--theme-hover)] overflow-hidden">
                    <div
                      className="h-full rounded-full transition-all duration-300"
                      style={{
                        width: `${(count / maxLoad) * 100}%`,
                        background: count / maxLoad > 0.8 ? '#ef4444' : count / maxLoad > 0.5 ? '#f59e0b' : 'var(--theme-accent)',
                      }}
                    />
                  </div>
                  <span className="text-[10px] text-[var(--theme-muted)] shrink-0 w-8 text-right">{count}</span>
                </div>
              ))}
            </div>
          </div>
        )
      })()}

      {/* Running tasks panel — live log tails for all executing tasks */}
      {stats.workingTasks.length > 0 && (
        <div className="shrink-0 mx-4 sm:mx-6 lg:mx-8 mb-1 rounded-lg border border-violet-500/30 bg-violet-500/5 overflow-hidden">
          <button
            type="button"
            onClick={() => setShowRunningPanel(v => !v)}
            className="w-full flex items-center gap-2 px-3 py-1.5 text-[10px] text-violet-400 hover:bg-violet-500/10 transition-colors"
          >
            <span className="w-1.5 h-1.5 rounded-full bg-violet-400 animate-pulse" />
            <span className="font-medium">{stats.workingTasks.length} executing</span>
            <span className="opacity-50 truncate">{stats.workingTasks.slice(0, 3).map(t => t.title.slice(0, 40)).join(' · ')}</span>
            <span className="ml-auto opacity-40">{showRunningPanel ? '▲' : '▼'}</span>
          </button>
          {showRunningPanel && (
            <div className="divide-y divide-violet-500/10 max-h-52 overflow-y-auto">
              {stats.workingTasks.map(t => (
                <RunningTaskRow key={t.id} task={t} onOpen={() => setEditingTask(t)} />
              ))}
            </div>
          )}
        </div>
      )}

      {/* Pipeline stall alert */}
      {(() => {
        if (!sweepStats || sweepStats.dispatched === 0) return null
        const sweepAgoMin = sweepStats.lastSweepAt
          ? Math.round((Date.now() - new Date(sweepStats.lastSweepAt).getTime()) / 60_000)
          : null
        const stalled = sweepAgoMin !== null && sweepAgoMin > 60
        const lowSuccess = sweepStats.successRate !== null && sweepStats.successRate < 10
        if (!stalled && !lowSuccess) return null
        const isRed = stalled
        return (
          <div className={cn(
            'mx-4 sm:mx-6 lg:mx-8 mb-1 rounded-lg px-3 py-2 flex items-center gap-3 text-xs border',
            isRed
              ? 'bg-red-500/8 border-red-500/30 text-red-300'
              : 'bg-amber-500/8 border-amber-500/30 text-amber-300',
          )}>
            <span>{isRed ? '🚨' : '⚠️'}</span>
            <span className="flex-1">
              {stalled && `Pipeline stalled — last sweep ${sweepAgoMin}m ago.`}
              {!stalled && lowSuccess && `Low success rate: ${sweepStats.successRate}% (${sweepStats.timedOutToday ?? 0} timeouts today).`}
            </span>
            <button
              onClick={async () => {
                setDrainingNow(true)
                try {
                  const res = await fetch('/api/tasks-drain-now', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ limit: 50 }) })
                  const data = await res.json() as { ok: boolean; queued: number }
                  await tasksQuery.refetch()
                  toast(data.queued > 0 ? `Drained ${data.queued} tasks` : 'No eligible tasks right now')
                } catch { toast('Drain failed', { type: 'error' }) }
                finally { setDrainingNow(false) }
              }}
              disabled={drainingNow}
              className="shrink-0 text-[10px] font-medium px-2.5 py-1 rounded border transition-colors border-current opacity-70 hover:opacity-100"
            >
              {drainingNow ? 'Draining…' : 'Drain Now'}
            </button>
          </div>
        )
      })()}

      {/* Hidden columns restore bar */}
      {hiddenColumns.size > 0 && (
        <div className="mx-4 sm:mx-6 lg:mx-8 mb-1 flex items-center gap-2 text-[10px] text-[var(--theme-muted)]">
          <span className="opacity-50">Hidden:</span>
          {[...hiddenColumns].map(col => (
            <button
              key={col}
              onClick={() => toggleHideColumn(col)}
              className="px-2 py-0.5 rounded-full border border-[var(--theme-border)] hover:border-[var(--theme-accent)] hover:text-[var(--theme-accent)] transition-colors capitalize"
            >
              {COLUMN_LABELS[col]} ↩
            </button>
          ))}
        </div>
      )}

      {/* Swimlane view — rows by assignee, columns by status */}
      {viewMode === 'swimlane' && swimlaneData && (
        <div className="flex-1 min-h-0 overflow-auto px-4 pb-[calc(var(--tabbar-h,80px)+1rem)] pt-3 sm:px-6 lg:px-8">
          <table className="w-full border-collapse text-left" style={{ minWidth: 700 }}>
            <thead>
              <tr>
                <th className="py-2 pr-3 text-[10px] font-semibold text-[var(--theme-muted)] uppercase tracking-wider w-28">Assignee</th>
                {swimlaneData.cols.map(c => (
                  <th key={c} className="py-2 px-2 text-[10px] font-semibold uppercase tracking-wider" style={{ color: COLUMN_COLORS[c] }}>{COLUMN_LABELS[c]}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {swimlaneData.rows.map(([asgn, cells]) => (
                <tr key={asgn} className="border-t border-[var(--theme-border)]">
                  <td className="py-2 pr-3 align-top">
                    <span className="text-[11px] font-medium text-[var(--theme-text)] truncate block max-w-[100px]">{asgn}</span>
                    <span className="text-[9px] text-[var(--theme-muted)] opacity-50">
                      {swimlaneData.cols.reduce((s, c) => s + cells[c].length, 0)} tasks
                    </span>
                  </td>
                  {swimlaneData.cols.map(c => (
                    <td key={c} className="py-1 px-1 align-top" style={{ minWidth: 160, maxWidth: 240 }}>
                      <div className="flex flex-col gap-0.5 max-h-48 overflow-y-auto scrollbar-thin pr-1">
                        {cells[c].length === 0
                          ? <span className="text-[9px] text-[var(--theme-muted)] opacity-30 pl-1">—</span>
                          : cells[c].slice(0, 20).map(t => (
                              <button
                                key={t.id}
                                type="button"
                                onClick={() => setPanelTask(t)}
                                className="flex items-center gap-1 px-1.5 py-0.5 rounded text-left hover:bg-[var(--theme-hover)] transition-colors group"
                                style={{ borderLeft: `2px solid ${PRIORITY_COLORS[t.priority]}` }}
                              >
                                <span className="text-[10px] text-[var(--theme-text)] truncate flex-1">{t.title.slice(0, 50)}</span>
                                {t.agent_state && <span className="w-1.5 h-1.5 rounded-full shrink-0 animate-pulse" style={{ background: '#a855f7' }} />}
                              </button>
                            ))
                        }
                        {cells[c].length > 20 && (
                          <span className="text-[9px] text-[var(--theme-muted)] opacity-50 pl-1">+{cells[c].length - 20} more</span>
                        )}
                      </div>
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Board */}
      {viewMode === 'board' && <div
        className="flex-1 min-h-0 w-full flex gap-3 overflow-x-auto overflow-y-hidden px-4 pb-[calc(var(--tabbar-h,80px)+1rem)] pt-3 sm:px-6 lg:px-8"
        style={{ boxShadow: 'inset 0 8px 24px rgba(0,0,0,0.2)' }}
      >
        {visibleColumns.map((col) => {
          const colTasks = columnMap[col]
          const colColor = COLUMN_COLORS[col]
          const columnLabel = COLUMN_LABELS[col]
          const compactAriaLabel = formatCompactTaskColumnAriaLabel(columnLabel, colTasks.length)
          const compactActionLabel = formatCompactTaskColumnActionLabel(columnLabel)
          const isDragOver = dragOverColumn === col
          // Compact when empty and not being dragged over
          const isCompact = colTasks.length === 0 && !isDragOver && !tasksQuery.isLoading

          return (
            <div
              key={col}
              className={cn(
                'flex flex-col rounded-xl border min-h-0 transition-all duration-200',
                isCompact ? 'w-10 shrink-0' : 'min-w-[280px] flex-1',
                'bg-[var(--theme-card)] border-[var(--theme-border)]',
                'shadow-[0_2px_12px_rgba(0,0,0,0.25)]',
                isDragOver && 'border-[var(--theme-accent)] bg-[var(--theme-hover)]',
              )}
              onDragOver={e => handleDragOver(e, col)}
              onDrop={e => handleDrop(e, col)}
              onDragLeave={() => setDragOverColumn(null)}
            >
              {isCompact ? (
                /* Compact column: rotated label + add button */
                <div
                  role="group"
                  aria-label={compactAriaLabel}
                  title={compactAriaLabel}
                  className="flex flex-col items-center h-full py-2 gap-2"
                  style={{ borderTopWidth: 2, borderTopColor: colColor, borderTopStyle: 'solid', borderRadius: '0.75rem 0.75rem 0 0' }}
                >
                  <button
                    type="button"
                    onClick={() => { setCreateColumn(col); setShowCreate(true) }}
                    aria-label={compactActionLabel}
                    className="rounded p-0.5 hover:bg-[var(--theme-hover)] transition-colors"
                    title={compactActionLabel}
                  >
                    <HugeiconsIcon icon={Add01Icon} size={13} className="text-[var(--theme-muted)]" />
                  </button>
                  <span className="sr-only">{compactAriaLabel}</span>
                  <div className="flex-1 flex items-center justify-center">
                    <span
                      className="text-[10px] font-semibold tracking-wide select-none"
                      style={{
                        color: colColor,
                        writingMode: 'vertical-lr',
                        transform: 'rotate(180deg)',
                      }}
                    >
                      {columnLabel}
                    </span>
                  </div>
                  <span className="w-1.5 h-1.5 rounded-full shrink-0" style={{ background: colColor }} />
                </div>
              ) : (
                <>
                  {/* Column header */}
                  <div
                    className="flex items-center justify-between px-3 py-2.5 border-b border-[var(--theme-border)] rounded-t-xl group/hdr"
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
                    <div className="flex items-center gap-0.5">
                      {/* Hide column button — shows on hover */}
                      <button
                        onClick={() => toggleHideColumn(col)}
                        title={`Hide ${COLUMN_LABELS[col]} column`}
                        className="rounded p-0.5 opacity-0 group-hover/hdr:opacity-40 hover:!opacity-100 hover:bg-[var(--theme-hover)] transition-all text-[var(--theme-muted)]"
                      >
                        <span className="text-[11px]">⊗</span>
                      </button>
                      <button
                        onClick={() => { setCreateColumn(col); setShowCreate(true) }}
                        className="rounded p-0.5 hover:bg-[var(--theme-hover)] transition-colors"
                        title={`Add to ${COLUMN_LABELS[col]}`}
                      >
                        <HugeiconsIcon icon={Add01Icon} size={14} className="text-[var(--theme-muted)]" />
                      </button>
                      {/* Column micro-actions ⋮ */}
                      {(col === 'in_progress' || col === 'blocked' || col === 'review' || col === 'todo' || col === 'backlog' || col === 'done') && (
                        <MenuRoot>
                          <MenuTrigger render={
                            <button
                              type="button"
                              className="rounded p-0.5 opacity-0 group-hover/hdr:opacity-40 hover:!opacity-100 hover:bg-[var(--theme-hover)] transition-all text-[var(--theme-muted)]"
                              title="Column actions"
                            >
                              <span className="text-[11px]">⋮</span>
                            </button>
                          }/>
                          <MenuContent side="bottom" align="end">
                            {col === 'in_progress' && (
                              <MenuItem
                                onClick={async () => {
                                  setDrainingNow(true)
                                  try {
                                    const res = await fetch('/api/tasks-drain-now', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ limit: 50 }) })
                                    const data = await res.json() as { ok: boolean; queued: number }
                                    await tasksQuery.refetch()
                                    toast(data.queued > 0 ? `Drained ${data.queued} to execution` : 'No eligible tasks right now')
                                  } catch { toast('Drain failed', { type: 'error' }) }
                                  finally { setDrainingNow(false) }
                                }}
                                disabled={drainingNow}
                                className="text-orange-400"
                              >
                                {drainingNow ? 'Draining…' : 'Drain now'}
                              </MenuItem>
                            )}
                            {col === 'blocked' && (
                              <MenuItem
                                onClick={async () => {
                                  setRescuingTimedOut(true)
                                  try {
                                    const res = await fetch('/api/tasks-rescue-timedout', { method: 'POST' })
                                    const data = await res.json() as { ok: boolean; rescued: number }
                                    await tasksQuery.refetch()
                                    toast(data.rescued > 0 ? `Rescued ${data.rescued} stuck tasks` : 'No stuck tasks')
                                  } catch { toast('Rescue failed', { type: 'error' }) }
                                  finally { setRescuingTimedOut(false) }
                                }}
                                disabled={rescuingTimedOut}
                                className="text-amber-400"
                              >
                                {rescuingTimedOut ? 'Rescuing…' : 'Rescue stuck'}
                              </MenuItem>
                            )}
                            {col === 'review' && (() => {
                              const readyCount = colTasks.filter(t => {
                                if (t.agent_state) return false
                                const planned = (t.agent_history ?? []).filter((h: { action: string }) => h.action === 'planned')
                                if (!planned.length) return false
                                const note = (planned[planned.length - 1] as { note?: string }).note ?? ''
                                return !note.includes('Plan unavailable') && note.length >= 80
                              }).length
                              return readyCount > 0 ? (
                                <MenuItem
                                  onClick={async () => {
                                    const ids = colTasks.filter(t => {
                                      if (t.agent_state) return false
                                      const pl = (t.agent_history ?? []).filter((h: { action: string }) => h.action === 'planned')
                                      if (!pl.length) return false
                                      const note = (pl[pl.length - 1] as { note?: string }).note ?? ''
                                      return !note.includes('Plan unavailable') && note.length >= 80
                                    }).map(t => t.id)
                                    setBatchExecuting(true)
                                    try {
                                      const r = await batchExecuteTasks(50, ids)
                                      await tasksQuery.refetch()
                                      toast(`Started ${r.started} review task${r.started !== 1 ? 's' : ''}`)
                                    } catch { toast('Execute failed', { type: 'error' }) }
                                    finally { setBatchExecuting(false) }
                                  }}
                                  disabled={batchExecuting}
                                  className="text-amber-400"
                                >
                                  {batchExecuting ? '…' : `▶ Execute ready (${readyCount})`}
                                </MenuItem>
                              ) : null
                            })()}
                            {col === 'review' && (
                              <MenuItem
                                onClick={async () => {
                                  setReplanningStubs(true)
                                  try {
                                    const res = await fetch('/api/tasks-replan-stubs', { method: 'POST' })
                                    const data = await res.json() as { ok: boolean; moved: number }
                                    await tasksQuery.refetch()
                                    toast(`Moved ${data.moved} stubs back to todo`)
                                  } catch { toast('Re-plan failed', { type: 'error' }) }
                                  finally { setReplanningStubs(false) }
                                }}
                                disabled={replanningStubs}
                                className="text-sky-400"
                              >
                                {replanningStubs ? 'Re-planning…' : 'Re-plan stubs'}
                              </MenuItem>
                            )}
                            {(col === 'todo' || col === 'backlog') && (
                              <MenuItem
                                onClick={async () => {
                                  const res = await fetch('/api/tasks-stale')
                                  const data = await res.json() as { ok: boolean; buckets: { days30: number; days60: number; days90: number }; previews: Array<{ id: string; title: string; assignee: string | null; ageDays: number }> }
                                  if (data.ok) { setArchivePreview(data); setShowArchiveWizard(true) }
                                }}
                                className="text-[var(--theme-muted)]"
                              >
                                Archive stale (60d+)
                              </MenuItem>
                            )}
                            {col === 'done' && columnMap['done'].length > 0 && (
                              <MenuItem
                                onClick={() => setConfirmClearDone(true)}
                                className="text-red-400"
                              >
                                Clear all done ({columnMap['done'].length})
                              </MenuItem>
                            )}
                          </MenuContent>
                        </MenuRoot>
                      )}
                    </div>
                  </div>

                  {/* Cards */}
                  {tasksQuery.isError ? (
                    <div className="flex flex-col gap-2 p-2 flex-1 min-h-0">
                      <div className="flex flex-col items-center justify-center py-8 gap-2 text-red-400">
                        <p className="text-xs font-medium">Failed to load tasks</p>
                        <button onClick={() => tasksQuery.refetch()} className="text-xs text-[var(--theme-accent)] hover:underline">Retry</button>
                      </div>
                    </div>
                  ) : tasksQuery.isLoading ? (
                    <div className="flex flex-col gap-2 p-2 flex-1 min-h-0 overflow-y-auto">
                      <SkeletonCard /><SkeletonCard /><SkeletonCard />
                    </div>
                  ) : colTasks.length === 0 ? (
                    <div className="flex flex-col gap-2 p-2 flex-1 min-h-0">
                      <div className="flex flex-col items-center justify-center py-8 gap-2 text-[var(--theme-muted)] opacity-60">
                        <HugeiconsIcon icon={CheckListIcon} size={22} />
                        <p className="text-xs font-medium">No tasks</p>
                        <p className="text-[10px]">Drop here or click + to add</p>
                      </div>
                    </div>
                  ) : colTasks.length >= VIRTUAL_THRESHOLD || (col === 'todo' && groupByParent && groupedTodoRows) ? (
                    <VirtualTaskList
                      tasks={col === 'review' ? (() => {
                        const ready = colTasks.filter(t => {
                          if (t.agent_state) return false
                          const pl = (t.agent_history ?? []).filter((h: { action: string }) => h.action === 'planned')
                          if (!pl.length) return false
                          const note = (pl[pl.length - 1] as { note?: string }).note ?? ''
                          return !note.includes('Plan unavailable') && note.length >= 80
                        })
                        const stubs = colTasks.filter(t => !ready.includes(t))
                        return [...ready, ...stubs]
                      })() : colTasks}
                      rows={col === 'todo' && groupByParent && groupedTodoRows ? groupedTodoRows : undefined}
                      sectionBreak={col === 'review' ? (() => {
                        return colTasks.filter(t => {
                          if (t.agent_state) return false
                          const pl = (t.agent_history ?? []).filter((h: { action: string }) => h.action === 'planned')
                          if (!pl.length) return false
                          const note = (pl[pl.length - 1] as { note?: string }).note ?? ''
                          return !note.includes('Plan unavailable') && note.length >= 80
                        }).length
                      })() : undefined}
                      sectionLabels={col === 'review' ? ['Ready', 'Stubs — needs re-plan'] : undefined}
                      renderCard={(task) => (
                        <TaskCard
                          task={task}
                          assigneeLabels={assigneeLabels}
                          isDragging={draggingId === task.id}
                          onDragStart={e => handleDragStart(e, task.id)}
                          onDragEnd={handleDragEnd}
                          onClick={() => setPanelTask(task)}
                          activeTagFilter={tagFilter}
                          onTagClick={(tag) => setTagFilter(prev => prev === tag ? null : tag)}
                          onAssigneeClick={(assignee) => setAssigneeFilter(prev => prev === assignee ? null : assignee)}
                          onChangePriority={(priority) => quickUpdateMutation.mutate({ id: task.id, input: { priority } })}
                          onMoveToColumn={(column) => moveMutation.mutate({ id: task.id, column })}
                          onDelete={() => setDeleteConfirmId(task.id)}
                          isLaunching={launchingTaskId === task.id}
                          onLaunch={async () => {
                            setLaunchingTaskId(task.id)
                            try { const { sessionId } = await launchSession(task.id); void navigate({ to: '/chat/$sessionKey', params: { sessionKey: sessionId } }) }
                            catch { toast('Failed to launch session', { type: 'error' }) }
                            finally { setLaunchingTaskId(null) }
                          }}
                          isExecuting={executingTaskId === task.id}
                          onExecute={async () => {
                            setExecutingTaskId(task.id)
                            try { await executeTask(task.id); await tasksQuery.refetch(); toast(`Agent is working on "${task.title}"…`) }
                            catch { toast('Failed to start agent execution', { type: 'error' }) }
                            finally { setExecutingTaskId(null) }
                          }}
                          isBreakingDown={breakingDownId === task.id}
                          onBreakdown={async () => {
                            setBreakingDownId(task.id)
                            try { const { count, titles } = await breakdownTask(task.id); invalidate(); toast(`Created ${count} subtask${count !== 1 ? 's' : ''}: ${titles.slice(0, 2).join(', ')}${count > 2 ? '…' : ''}`) }
                            catch (e) { toast(e instanceof Error ? e.message : 'Breakdown failed', { type: 'error' }) }
                            finally { setBreakingDownId(null) }
                          }}
                          onResetAgent={() => quickUpdateMutation.mutate({ id: task.id, input: { agent_state: null, agent_name: null, agent_action_at: null } })}
                          onRequestRefresh={() => void tasksQuery.refetch()}
                          onComment={handleTaskComment}
                          queuePosition={queuePositions[task.id] ?? null}
                          isSelected={selectedIds.has(task.id)}
                          onToggleSelect={toggleSelect}
                          dense={denseMode}
                        />
                      )}
                    />
                  ) : (
                    <div className={cn('flex flex-col p-2 flex-1 min-h-0 overflow-y-auto scrollbar-thin', denseMode ? 'gap-0.5' : 'gap-2')}>
                      <AnimatePresence initial={false}>
                        {colTasks.map(task => (
                          <motion.div key={task.id} layout initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -6 }} onDragEnd={handleDragEnd}>
                            <TaskCard
                              task={task}
                              assigneeLabels={assigneeLabels}
                              isDragging={draggingId === task.id}
                              onDragStart={e => handleDragStart(e, task.id)}
                              onClick={() => setPanelTask(task)}
                              activeTagFilter={tagFilter}
                              onTagClick={(tag) => setTagFilter(prev => prev === tag ? null : tag)}
                              onAssigneeClick={(assignee) => setAssigneeFilter(prev => prev === assignee ? null : assignee)}
                              onChangePriority={(priority) => quickUpdateMutation.mutate({ id: task.id, input: { priority } })}
                              onMoveToColumn={(column) => moveMutation.mutate({ id: task.id, column })}
                              onDelete={() => setDeleteConfirmId(task.id)}
                              isLaunching={launchingTaskId === task.id}
                              onLaunch={async () => {
                                setLaunchingTaskId(task.id)
                                try { const { sessionId } = await launchSession(task.id); void navigate({ to: '/chat/$sessionKey', params: { sessionKey: sessionId } }) }
                                catch { toast('Failed to launch session', { type: 'error' }) }
                                finally { setLaunchingTaskId(null) }
                              }}
                              isExecuting={executingTaskId === task.id}
                              onExecute={async () => {
                                setExecutingTaskId(task.id)
                                try { await executeTask(task.id); await tasksQuery.refetch(); toast(`Agent is working on "${task.title}"…`) }
                                catch { toast('Failed to start agent execution', { type: 'error' }) }
                                finally { setExecutingTaskId(null) }
                              }}
                              isBreakingDown={breakingDownId === task.id}
                              onBreakdown={async () => {
                                setBreakingDownId(task.id)
                                try { const { count, titles } = await breakdownTask(task.id); invalidate(); toast(`Created ${count} subtask${count !== 1 ? 's' : ''}: ${titles.slice(0, 2).join(', ')}${count > 2 ? '…' : ''}`) }
                                catch (e) { toast(e instanceof Error ? e.message : 'Breakdown failed', { type: 'error' }) }
                                finally { setBreakingDownId(null) }
                              }}
                              onResetAgent={() => quickUpdateMutation.mutate({ id: task.id, input: { agent_state: null, agent_name: null, agent_action_at: null } })}
                              onRequestRefresh={() => void tasksQuery.refetch()}
                              onComment={handleTaskComment}
                              queuePosition={queuePositions[task.id] ?? null}
                              isSelected={selectedIds.has(task.id)}
                              onToggleSelect={toggleSelect}
                              dense={denseMode}
                            />
                          </motion.div>
                        ))}
                      </AnimatePresence>
                    </div>
                  )}

                {/* Inline quick-add footer */}
                {quickAddCol === col ? (
                  <div className="shrink-0 p-2 border-t border-[var(--theme-border)]">
                    <input
                      autoFocus
                      value={quickAddTitle}
                      onChange={e => setQuickAddTitle(e.target.value)}
                      onKeyDown={e => {
                        if (e.key === 'Enter' && quickAddTitle.trim()) {
                          createMutation.mutate({ title: quickAddTitle.trim(), column: col })
                          setQuickAddTitle('')
                          setQuickAddCol(null)
                        } else if (e.key === 'Escape') {
                          setQuickAddTitle('')
                          setQuickAddCol(null)
                        }
                      }}
                      onBlur={() => { setQuickAddTitle(''); setQuickAddCol(null) }}
                      placeholder="Task title… Enter to save, Esc to cancel"
                      className="w-full text-xs rounded-lg border border-[var(--theme-border)] bg-[var(--theme-input)] px-2.5 py-2 text-ink outline-none focus:border-[var(--theme-accent)] placeholder:text-[var(--theme-muted)]"
                    />
                  </div>
                ) : (
                  <button
                    onClick={() => setQuickAddCol(col)}
                    className="shrink-0 w-full flex items-center gap-1.5 px-3 py-1.5 text-[10px] text-[var(--theme-muted)]/40 hover:text-[var(--theme-muted)] hover:bg-[var(--theme-hover)] transition-all duration-150 border-t border-[var(--theme-border)]/40 hover:border-[var(--theme-border)] rounded-b-xl"
                  >
                    <HugeiconsIcon icon={Add01Icon} size={11} />
                    Add task
                  </button>
                )}
                </>
              )}
            </div>
          )
        })}
      </div>}

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
        onOpenChange={(open) => {
          if (!open) {
            setEditingTask(null)
            if (taskIdFromUrl) void navigate({ to: '/tasks', search: (prev) => ({ ...prev, task: undefined }) })
          }
        }}
        task={editingTask ? (tasks.find(t => t.id === editingTask.id) ?? editingTask) : null}
        assignees={assignees}
        isSubmitting={updateMutation.isPending}
        onSubmit={async (input) => {
          if (!editingTask) return
          await updateMutation.mutateAsync({ id: editingTask.id, input })
        }}
        onComment={handleTaskComment}
        onClarify={handleTaskClarify}
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

      {/* Bulk action bar */}
      {selectedIds.size > 0 && (
        <div className="fixed bottom-[calc(var(--tabbar-h,80px)+12px)] left-1/2 -translate-x-1/2 z-50 flex items-center gap-2 rounded-xl border border-[var(--theme-border)] bg-[var(--theme-panel)] px-3 py-2 shadow-2xl text-xs flex-wrap max-w-[92vw]">
          <span className="text-[var(--theme-muted)] mr-1">{selectedIds.size} selected</span>
          <MenuRoot>
            <MenuTrigger
              render={
                <button
                  type="button"
                  className="px-2.5 py-1 rounded-lg border border-[var(--theme-border)] hover:bg-[var(--theme-hover)] transition-colors text-[var(--theme-text)]"
                >Move to ▾</button>
              }
            />
            <MenuContent>
              {visibleColumns.map(col => (
                <MenuItem key={col} onClick={async () => {
                  for (const id of selectedIds) await moveMutation.mutateAsync({ id, column: col })
                  clearSelection()
                  toast(`Moved ${selectedIds.size} tasks to ${COLUMN_LABELS[col]}`)
                }}>{COLUMN_LABELS[col]}</MenuItem>
              ))}
            </MenuContent>
          </MenuRoot>
          {/* Set priority */}
          {(['high', 'medium', 'low'] as Array<TaskPriority>).map(p => (
            <button
              key={p}
              onClick={async () => {
                for (const id of selectedIds) await quickUpdateMutation.mutateAsync({ id, input: { priority: p } })
                clearSelection()
                toast(`Set ${selectedIds.size} tasks to ${p} priority`)
              }}
              className="px-2.5 py-1 rounded-lg border transition-colors capitalize"
              style={{ borderColor: PRIORITY_COLORS[p], color: PRIORITY_COLORS[p], background: `${PRIORITY_COLORS[p]}18` }}
            >{p}</button>
          ))}
          <button
            onClick={() => setConfirmBulkDelete(true)}
            className="px-2.5 py-1 rounded-lg border border-red-500/30 hover:bg-red-500/10 text-red-400 transition-colors"
          >Delete</button>
          <button onClick={clearSelection} className="px-2.5 py-1 rounded-lg border border-[var(--theme-border)] hover:bg-[var(--theme-hover)] text-[var(--theme-muted)] transition-colors">✕</button>
        </div>
      )}

      {/* Task detail slide-in panel */}
      {panelLive && (
        <TaskDetailPanel
          task={panelLive}
          isExecuting={executingTaskId === panelLive.id}
          onClose={() => setPanelTask(null)}
          onEdit={() => { setPanelTask(null); setEditingTask(panelLive) }}
          onExecute={async () => {
            const live = panelLive
            setExecutingTaskId(live.id)
            try { await executeTask(live.id); await tasksQuery.refetch(); toast(`Agent is working on "${live.title}"…`) }
            catch { toast('Failed to start agent', { type: 'error' }) }
            finally { setExecutingTaskId(null) }
          }}
        />
      )}

      {/* Unified Activity panel — Action Required (inbox) + Recent (feed) */}
      {showActivity && (
        <ActivityPanel
          activityTab={activityTab}
          onTabChange={(tab) => { setActivityTab(tab); if (tab === 'feed') markNotifSeen() }}
          inboxTasks={stats.inboxTasks}
          inboxReplies={inboxReplies}
          onReplyChange={(taskId, value) => setInboxReplies(prev => ({ ...prev, [taskId]: value }))}
          onReplySubmit={async (taskId) => {
            const text = (inboxReplies[taskId] ?? '').trim()
            if (!text) return
            setInboxSending(taskId)
            try {
              await handleTaskComment(taskId, text)
              setInboxReplies(prev => { const n = { ...prev }; delete n[taskId]; return n })
              toast('Reply sent — Astra will resume')
            } catch { toast('Reply failed', { type: 'error' }) }
            finally { setInboxSending(null) }
          }}
          inboxSending={inboxSending}
          notifEvents={notifEvents}
          unreadNotifCount={unreadNotifCount}
          notifLastSeen={notifLastSeen}
          onSelectTask={(t) => { setShowActivity(false); setPanelTask(t) }}
          onSelectTaskById={(taskId) => { const selectedTask = tasks.find(t => t.id === taskId); if (selectedTask) { setPanelTask(selectedTask); setShowActivity(false) } }}
          onClose={() => { setShowActivity(false); markNotifSeen() }}
        />
      )}

      {/* Tags browser panel */}
      {showTagsPanel && (
        <TagsBrowserPanel
          tagCloud={stats.tagCloud}
          tagFilter={tagFilter}
          onSelectTag={(tag) => { setTagFilter(tag); setShowTagsPanel(false) }}
          onClose={() => setShowTagsPanel(false)}
          selectedCount={selectedIds.size}
          bulkTagValue={tagsPanelBulkTag}
          onBulkTagValueChange={setTagsPanelBulkTag}
          taggingSelected={taggingSelected}
          onBulkTagSubmit={async () => {
            const tag = tagsPanelBulkTag.trim().toLowerCase()
            if (!tag) return
            setTaggingSelected(true)
            try {
              const selected = tasks.filter(t => selectedIds.has(t.id))
              for (const t of selected) {
                if (!t.tags.includes(tag)) {
                  await quickUpdateMutation.mutateAsync({ id: t.id, input: { tags: [...t.tags, tag] } })
                }
              }
              invalidate()
              toast(`Tagged ${selected.length} tasks with #${tag}`)
              setTagsPanelBulkTag('')
            } catch { toast('Tagging failed', { type: 'error' }) }
            finally { setTaggingSelected(false) }
          }}
        />
      )}

      {/* Sister rebalance modal */}
      {showRebalance && (
        <SisterRebalanceModal
          sisterChips={stats.sisterChips}
          rebalanceFrom={rebalanceFrom}
          rebalanceTo={rebalanceTo}
          rebalanceCount={rebalanceCount}
          rebalancing={rebalancing}
          onClose={() => setShowRebalance(false)}
          onFromChange={setRebalanceFrom}
          onToChange={setRebalanceTo}
          onCountChange={setRebalanceCount}
          onConfirm={async () => {
            if (!rebalanceFrom || !rebalanceTo || rebalanceFrom === rebalanceTo) {
              toast('Pick two different sisters', { type: 'error' }); return
            }
            setRebalancing(true)
            try {
              const candidates = tasks
                .filter(t => t.assignee === rebalanceFrom && (t.column === 'todo' || t.column === 'backlog') && !t.agent_state)
                .slice(0, rebalanceCount)
              for (const t of candidates) {
                await quickUpdateMutation.mutateAsync({ id: t.id, input: { assignee: rebalanceTo } })
              }
              invalidate()
              toast(`Moved ${candidates.length} tasks from ${rebalanceFrom} → ${rebalanceTo}`)
              setShowRebalance(false)
            } catch { toast('Rebalance failed', { type: 'error' }) }
            finally { setRebalancing(false) }
          }}
        />
      )}

      {/* Keyboard shortcuts modal */}
      {showShortcuts && (
        <KeyboardShortcutsModal onClose={() => setShowShortcuts(false)} />
      )}

      {/* Timeout failure analysis modal */}
      {showTimeoutAnalysis && timeoutAnalysisData && (
        <TimeoutAnalysisModal
          data={timeoutAnalysisData}
          rescuing={rescuingTimedOut}
          onClose={() => setShowTimeoutAnalysis(false)}
          onSelectTask={(task) => { setShowTimeoutAnalysis(false); setPanelTask(task) }}
          onFilterTimedOut={() => { setShowTimeoutAnalysis(false); setFilterTimedOut(true) }}
          onRescueAll={async () => {
            setRescuingTimedOut(true)
            try {
              const res = await fetch('/api/tasks-rescue-timedout', { method: 'POST' })
              const data = await res.json() as { ok: boolean; rescued: number }
              await tasksQuery.refetch()
              toast(`Rescued ${data.rescued} tasks`)
              setShowTimeoutAnalysis(false)
            } catch { toast('Rescue failed', { type: 'error' }) }
            finally { setRescuingTimedOut(false) }
          }}
        />
      )}

      {/* Stale task archive wizard */}
      {showArchiveWizard && archivePreview && (
        <ArchiveWizardModal
          preview={archivePreview}
          days={archiveDays}
          onDaysChange={setArchiveDays}
          archiving={archiving}
          onClose={() => setShowArchiveWizard(false)}
          onConfirm={async () => {
            setArchiving(true)
            try {
              const res = await fetch('/api/tasks-stale', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ age_days: archiveDays }) })
              const data = await res.json() as { ok: boolean; archived: number }
              if (data.ok) {
                await tasksQuery.refetch()
                toast(`Archived ${data.archived} stale task${data.archived !== 1 ? 's' : ''}`)
                setShowArchiveWizard(false)
              } else {
                toast('Archive failed', { type: 'error' })
              }
            } catch { toast('Archive failed', { type: 'error' }) }
            finally { setArchiving(false) }
          }}
        />
      )}

      {/* Unlock prereq modal */}
      {unlockModalPrereq && (
        <UnlockPrereqModal
          prereq={unlockModalPrereq}
          unlocking={unlockingPrereq === unlockModalPrereq.id}
          onClose={() => setUnlockModalPrereq(null)}
          onConfirm={async () => {
            const { id, count } = unlockModalPrereq
            setUnlockingPrereq(id)
            try {
              const res = await fetch('/api/tasks-unlock-prereq', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ prereq_id: id }) })
              const data = await res.json() as { ok: boolean; unblocked?: number; error?: string }
              if (data.ok) {
                await tasksQuery.refetch()
                toast(`Unlocked ${data.unblocked ?? count} task${(data.unblocked ?? count) !== 1 ? 's' : ''} — deploy sweep triggered`)
                setUnlockModalPrereq(null)
              } else {
                toast(data.error ?? 'Unlock failed', { type: 'error' })
              }
            } catch { toast('Unlock failed', { type: 'error' }) }
            finally { setUnlockingPrereq(null) }
          }}
        />
      )}

      {/* Confirm clear done */}
      {confirmClearDone && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={() => setConfirmClearDone(false)}/>
          <div className="relative z-10 w-full max-w-xs bg-[var(--theme-card)] border border-[var(--theme-border)] rounded-xl shadow-2xl p-5 flex flex-col gap-4">
            <p className="text-sm font-semibold text-[var(--theme-text)]">Clear {columnMap['done'].length} done task{columnMap['done'].length !== 1 ? 's' : ''}?</p>
            <p className="text-[11px] text-[var(--theme-muted)]">This permanently deletes them. Cannot be undone.</p>
            <div className="flex gap-2">
              <button type="button" onClick={() => setConfirmClearDone(false)} className="flex-1 text-xs rounded-lg border border-[var(--theme-border)] px-3 py-2 text-[var(--theme-muted)] hover:bg-[var(--theme-hover)] transition-colors">Cancel</button>
              <button
                type="button"
                onClick={() => {
                  const doneTasks = columnMap['done']
                  setConfirmClearDone(false)
                  void Promise.all(doneTasks.map(t => deleteTask(t.id))).then(() => {
                    invalidate()
                    toast(`Cleared ${doneTasks.length} done task${doneTasks.length !== 1 ? 's' : ''}`)
                  }).catch(() => toast('Failed to clear done tasks', { type: 'error' }))
                }}
                className="flex-1 text-xs rounded-lg border border-red-500/40 bg-red-500/10 px-3 py-2 text-red-400 hover:bg-red-500/20 transition-colors"
              >Delete all</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
