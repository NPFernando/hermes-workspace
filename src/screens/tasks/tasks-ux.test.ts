import { describe, expect, it } from 'vitest'

import { formatTaskAssigneeLabel, formatTaskDependencyLabel } from './task-card'
import {
  TASKS_BOARD_HELP_TEXT,
  countExecutableReviewTasks,
  formatCompactTaskColumnActionLabel,
  formatBlockedTaskBreakdownLabel,
  formatBlockedTaskBreakdownTitle,
  formatCompactTaskColumnAriaLabel,
  formatTaskFilterAriaLabel,
  formatTaskFilterSummary,
  formatTaskRefreshStatus,
} from './tasks-screen'

describe('tasks UX copy', () => {
  it('exposes helper copy that explains drag and assignment behavior', () => {
    expect(TASKS_BOARD_HELP_TEXT).toBe(
      'Workspace Tasks is a lightweight task board. Drag cards to change status. Use Dashboard Kanban for native multi-board controls.',
    )
  })

  it('formats assignee labels for assigned tasks and returns empty string for unassigned', () => {
    expect(formatTaskAssigneeLabel('jarvis', { jarvis: 'Jarvis' })).toBe('Jarvis')
    expect(formatTaskAssigneeLabel(null, {})).toBe('')
  })

  it('formats task dependency chips with singular and plural copy', () => {
    expect(formatTaskDependencyLabel(0)).toBeNull()
    expect(formatTaskDependencyLabel(1)).toBe('waiting on 1 prerequisite')
    expect(formatTaskDependencyLabel(3)).toBe('waiting on 3 prerequisites')
  })

  it('formats filter result summaries with clear zero-match and plural copy', () => {
    expect(formatTaskFilterSummary(0, 0)).toBe('No tasks yet')
    expect(formatTaskFilterSummary(0, 5)).toBe('No matches across 5 tasks')
    expect(formatTaskFilterSummary(1, 1)).toBe('Showing all 1 task')
    expect(formatTaskFilterSummary(2, 5)).toBe('Showing 2 of 5 tasks')
  })

  it('formats filter toggle aria labels from active state', () => {
    expect(formatTaskFilterAriaLabel('Overdue', false)).toBe('Enable overdue task filter')
    expect(formatTaskFilterAriaLabel('Active Agent', true)).toBe('Disable active agent task filter')
    expect(formatTaskFilterAriaLabel('high priority', false)).toBe('Enable high priority task filter')
  })

  it('formats task refresh status copy for loading and background updates', () => {
    expect(formatTaskRefreshStatus(true, true)).toBe('Loading task board…')
    expect(formatTaskRefreshStatus(true, false)).toBe('Updating task board…')
    expect(formatTaskRefreshStatus(false, false)).toBeNull()
  })

  it('formats blocked task breakdown copy and titles', () => {
    expect(formatBlockedTaskBreakdownLabel(2, 1)).toBe('2 input · 1 err')
    expect(formatBlockedTaskBreakdownLabel(1, 0)).toBe('needs input')
    expect(formatBlockedTaskBreakdownLabel(0, 3)).toBe('exec error')
    expect(formatBlockedTaskBreakdownLabel(0, 0)).toBeNull()
    expect(formatBlockedTaskBreakdownTitle(1, 2)).toBe('1 waiting for input, 2 execution failures')
  })

  it('formats compact column labels for empty and populated columns', () => {
    expect(formatCompactTaskColumnAriaLabel('Backlog', 0)).toBe('Backlog column is empty. Add a task or drop one here.')
    expect(formatCompactTaskColumnAriaLabel('In Progress', 2)).toBe('In Progress column with 2 tasks')
    expect(formatCompactTaskColumnActionLabel('Review')).toBe('Add a task to the Review column')
  })

  it('counts only review tasks with usable execution plans', () => {
    const plannedHistory = [{
      id: 'h1',
      action: 'planned',
      note: '1. Inspect the target files. 2. Apply the requested code change. 3. Run focused verification and report the result.',
      by: 'astra',
      at: '2026-01-01T00:00:00Z',
    }]
    const stubHistory = [{ id: 'h3', action: 'planned', note: '1. Do the work', by: 'astra', at: '2026-01-01T00:00:00Z' }]
    const unavailableHistory = [{ id: 'h2', action: 'planned', note: 'Plan unavailable — press Execute to proceed.', by: 'astra', at: '2026-01-01T00:00:00Z' }]

    expect(countExecutableReviewTasks([
      { column: 'review', agent_state: null, agent_history: plannedHistory },
      { column: 'review', agent_state: 'working', agent_history: plannedHistory },
      { column: 'review', agent_state: null, agent_history: unavailableHistory },
      { column: 'review', agent_state: null, agent_history: stubHistory },
      { column: 'todo', agent_state: null, agent_history: plannedHistory },
      { column: 'review', agent_state: null, agent_history: [] },
    ])).toBe(1)
  })
})
