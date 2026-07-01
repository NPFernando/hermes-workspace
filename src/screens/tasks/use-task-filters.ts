import { useCallback, useState } from 'react'
import type { TaskColumn, TaskPriority } from '@/lib/tasks-api'

export type FilterPreset = {
  name: string
  assignee: string | null
  query: string
  overdue: boolean
  blocked: boolean
  activeAgent: boolean
  inReview: boolean
  timedOut: boolean
  age: 'fresh' | 'aging' | 'stale' | null
  priority: TaskPriority | null
  tag: string | null
}

// Extracted from TasksScreen: all board-filtering state (search, quick-filter
// toggles, priority/age/tag/assignee filters, hidden columns, saved presets).
// Kept as a single hook returning the same names the component already used
// so every existing usage site in tasks-screen.tsx keeps working unchanged.
export function useTaskFilters(initialAssignee: string | null) {
  const [searchQuery, setSearchQuery] = useState('')
  const [filterOverdue, setFilterOverdue] = useState(false)
  const [filterBlocked, setFilterBlocked] = useState(false)
  const [filterActiveAgent, setFilterActiveAgent] = useState(false)
  const [filterInReview, setFilterInReview] = useState(false)
  const [filterTimedOut, setFilterTimedOut] = useState(false)
  const [ageFilter, setAgeFilter] = useState<'fresh' | 'aging' | 'stale' | null>(null)
  const [priorityFilter, setPriorityFilter] = useState<TaskPriority | null>(null)
  const [tagFilter, setTagFilter] = useState<string | null>(null)
  const [assigneeFilter, setAssigneeFilter] = useState<string | null>(initialAssignee)
  const [hideSubtasks, setHideSubtasks] = useState(false)
  const [showFilterPopover, setShowFilterPopover] = useState(false)

  const [hiddenColumns, setHiddenColumns] = useState<Set<TaskColumn>>(() => {
    try {
      return new Set(JSON.parse(localStorage.getItem('hermes-hidden-cols') ?? '[]') as Array<TaskColumn>)
    } catch {
      return new Set()
    }
  })
  const toggleHideColumn = useCallback((col: TaskColumn) => {
    setHiddenColumns((prev) => {
      const next = new Set(prev)
      if (next.has(col)) next.delete(col)
      else next.add(col)
      localStorage.setItem('hermes-hidden-cols', JSON.stringify([...next]))
      return next
    })
  }, [])

  const [filterPresets, setFilterPresets] = useState<Array<FilterPreset>>(() => {
    try {
      return JSON.parse(localStorage.getItem('hermes-filter-presets') ?? '[]') as Array<FilterPreset>
    } catch {
      return []
    }
  })

  const saveFilterPreset = useCallback(
    (name: string) => {
      const preset: FilterPreset = {
        name,
        assignee: assigneeFilter,
        query: searchQuery,
        overdue: filterOverdue,
        blocked: filterBlocked,
        activeAgent: filterActiveAgent,
        inReview: filterInReview,
        timedOut: filterTimedOut,
        age: ageFilter,
        priority: priorityFilter,
        tag: tagFilter,
      }
      setFilterPresets((prev) => {
        const next = [...prev.filter((p) => p.name !== name), preset]
        localStorage.setItem('hermes-filter-presets', JSON.stringify(next))
        return next
      })
    },
    [assigneeFilter, searchQuery, filterOverdue, filterBlocked, filterActiveAgent, filterInReview, filterTimedOut, ageFilter, priorityFilter, tagFilter],
  )

  const applyFilterPreset = useCallback((p: FilterPreset) => {
    setAssigneeFilter(p.assignee)
    setSearchQuery(p.query)
    setFilterOverdue(p.overdue)
    setFilterBlocked(p.blocked)
    setFilterActiveAgent(p.activeAgent)
    setFilterInReview(p.inReview)
    setFilterTimedOut(p.timedOut)
    setAgeFilter(p.age)
    setPriorityFilter(p.priority)
    setTagFilter(p.tag)
  }, [])

  const deleteFilterPreset = useCallback((name: string) => {
    setFilterPresets((prev) => {
      const next = prev.filter((p) => p.name !== name)
      localStorage.setItem('hermes-filter-presets', JSON.stringify(next))
      return next
    })
  }, [])

  const clearAllFilters = useCallback(() => {
    setSearchQuery('')
    setFilterOverdue(false)
    setFilterBlocked(false)
    setFilterActiveAgent(false)
    setFilterInReview(false)
    setFilterTimedOut(false)
    setAgeFilter(null)
    setPriorityFilter(null)
    setTagFilter(null)
    setAssigneeFilter(null)
    setHideSubtasks(false)
  }, [])

  return {
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
  }
}
