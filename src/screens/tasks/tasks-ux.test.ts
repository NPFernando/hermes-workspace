import { describe, expect, it } from 'vitest'

import { formatTaskAssigneeLabel } from './task-card'
import { TASKS_BOARD_HELP_TEXT } from './tasks-screen'

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
})
