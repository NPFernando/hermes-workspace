import { describe, expect, it } from 'vitest'

import { formatTaskAssigneeLabel } from './task-card'
import {
  TASKS_BOARD_HELP_TEXT,
  formatCompactTaskColumnActionLabel,
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

  it('formats compact column labels for empty and populated columns', () => {
    expect(formatCompactTaskColumnAriaLabel('Backlog', 0)).toBe('Backlog column is empty. Add a task or drop one here.')
    expect(formatCompactTaskColumnAriaLabel('In Progress', 2)).toBe('In Progress column with 2 tasks')
    expect(formatCompactTaskColumnActionLabel('Review')).toBe('Add a task to the Review column')
  })
})
