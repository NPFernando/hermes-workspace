import { describe, expect, it } from 'vitest'

import {
  formatTaskAssigneeLabel,
  formatTaskDependencyLabel,
  formatTaskCardActionLabel,
  formatTaskQueuePositionLabel,
  formatTaskSelectionToggleLabel,
} from './task-card'
import {
  TASKS_BOARD_HELP_TEXT,
  TASK_OPERATION_FILTERS,
  TASK_STATS_ROW_CLASS,
  countExecutableReviewTasks,
  doesTaskMatchOperationFilter,
  formatCompactTaskColumnActionLabel,
  formatBlockedTaskBreakdownLabel,
  formatBlockedTaskBreakdownTitle,
  formatCompactTaskColumnAriaLabel,
  formatTaskFilterAriaLabel,
  formatTaskLastUpdated,
  formatTaskFilterSummary,
  formatTaskRefreshStatus,
  getRecentTaskNotificationEvents,
  getTaskOperationFilterLabel,
} from './format-utils'
import { buildGroupedTodoRows } from './task-row-utils'
import { getTaskBoardStats } from './task-stats-utils'
import type { ClaudeTask } from '@/lib/tasks-api'

describe('tasks UX copy', () => {
  it('exposes helper copy that explains drag and assignment behavior', () => {
    expect(TASKS_BOARD_HELP_TEXT).toBe(
      'Workspace Tasks is a lightweight task board. Drag cards to change status. Use Dashboard Kanban for native multi-board controls.',
    )
  })

  it('formats assignee labels for assigned tasks and returns empty string for unassigned', () => {
    expect(formatTaskAssigneeLabel('jarvis', { jarvis: 'Jarvis' })).toBe(
      'Jarvis',
    )
    expect(formatTaskAssigneeLabel(null, {})).toBe('')
  })

  it('formats task dependency chips with singular and plural copy', () => {
    expect(formatTaskDependencyLabel(0)).toBeNull()
    expect(formatTaskDependencyLabel(1)).toBe('waiting on 1 prerequisite')
    expect(formatTaskDependencyLabel(3)).toBe('waiting on 3 prerequisites')
  })

  it('formats task selection toggle labels from selected state', () => {
    expect(
      formatTaskSelectionToggleLabel('Review deployment plan', false),
    ).toBe('Select task: Review deployment plan')
    expect(formatTaskSelectionToggleLabel('Review deployment plan', true)).toBe(
      'Deselect task: Review deployment plan',
    )
  })

  it('describes queue position and ordering to screen readers', () => {
    expect(formatTaskQueuePositionLabel(3)).toBe(
      'Queue position 3; processed in priority order, high priority first, then oldest tasks',
    )
  })

  it('gives task card icon actions task-specific accessible names', () => {
    expect(formatTaskCardActionLabel('Review deployment', 'launch')).toBe(
      'Launch chat session for task: Review deployment',
    )
    expect(formatTaskCardActionLabel('Review deployment', 'execute')).toBe(
      'Execute task with AI agent: Review deployment',
    )
    expect(formatTaskCardActionLabel('  ', 'options')).toBe(
      'Open task options: unnamed task',
    )
  })

  it('formats filter result summaries with clear zero-match and plural copy', () => {
    expect(formatTaskFilterSummary(0, 0)).toBe('No tasks yet')
    expect(formatTaskFilterSummary(0, 5)).toBe('No matches across 5 tasks')
    expect(formatTaskFilterSummary(1, 1)).toBe('Showing all 1 task')
    expect(formatTaskFilterSummary(2, 5)).toBe('Showing 2 of 5 tasks')
  })

  it('formats filter toggle aria labels from active state', () => {
    expect(formatTaskFilterAriaLabel('Overdue', false)).toBe(
      'Enable overdue task filter',
    )
    expect(formatTaskFilterAriaLabel('Active Agent', true)).toBe(
      'Disable active agent task filter',
    )
    expect(formatTaskFilterAriaLabel('high priority', false)).toBe(
      'Enable high priority task filter',
    )
  })

  it('keeps compact task stats readable without horizontal scrolling', () => {
    expect(TASK_STATS_ROW_CLASS).toContain('flex-wrap')
    expect(TASK_STATS_ROW_CLASS).toContain('whitespace-nowrap')
    expect(TASK_STATS_ROW_CLASS).not.toContain('overflow-x-auto')
  })

  it('formats task refresh status copy for loading and background updates', () => {
    expect(formatTaskRefreshStatus(true, true)).toBe('Loading task board…')
    expect(formatTaskRefreshStatus(true, false)).toBe('Updating task board…')
    expect(formatTaskRefreshStatus(false, false)).toBeNull()
  })

  it('formats task board last-updated timing without guessing missing data', () => {
    const now = Date.UTC(2026, 6, 2, 12, 0, 0)
    expect(formatTaskLastUpdated(now, now)).toBe('Updated just now')
    expect(formatTaskLastUpdated(now - 5 * 60_000, now)).toBe('Updated 5m ago')
    expect(formatTaskLastUpdated(now - 2 * 3_600_000, now)).toBe(
      'Updated 2h ago',
    )
    expect(formatTaskLastUpdated(0, now)).toBeNull()
  })

  it('exposes operation-history filters for dispatch and recovery audits', () => {
    const historyEntry = (action: string) => ({
      id: action,
      action,
      by: 'astra',
      byEmoji: '🌟',
      note: '',
      at: '2026-01-01T00:00:00Z',
    })
    expect(TASK_OPERATION_FILTERS).toEqual([
      'all',
      'dispatched',
      'timed_out',
      'rescued',
      'replanned',
    ])
    expect(getTaskOperationFilterLabel('timed_out')).toBe('Timed out')
    expect(
      doesTaskMatchOperationFilter(
        { agent_history: [historyEntry('dispatching')] },
        'dispatched',
      ),
    ).toBe(true)
    expect(
      doesTaskMatchOperationFilter(
        { agent_history: [historyEntry('replan_requested')] },
        'replanned',
      ),
    ).toBe(true)
    expect(doesTaskMatchOperationFilter({ agent_history: [] }, 'rescued')).toBe(
      false,
    )
    expect(doesTaskMatchOperationFilter({}, 'all')).toBe(true)
  })

  it('extracts recent notification events in newest-first order', () => {
    const now = Date.UTC(2026, 6, 2, 12, 0, 0)
    expect(
      getRecentTaskNotificationEvents(
        [
          {
            id: 'old',
            title: 'Old task',
            agent_history: [
              {
                id: 'old-entry',
                action: 'completed',
                by: 'astra',
                byEmoji: '🌟',
                note: 'old',
                at: new Date(now - 25 * 60 * 60_000).toISOString(),
              },
            ],
          },
          {
            id: 'current',
            title: 'Current task',
            agent_history: [
              {
                id: 'current-entry',
                action: 'rescued',
                by: 'ada',
                byEmoji: '🛠️',
                note: 'recovered',
                at: new Date(now - 5 * 60_000).toISOString(),
              },
              {
                id: 'ignored-entry',
                action: 'updated',
                by: 'ada',
                byEmoji: '🛠️',
                note: 'ignore',
                at: new Date(now - 2 * 60_000).toISOString(),
              },
            ],
          },
        ],
        now,
      ),
    ).toEqual([
      {
        taskId: 'current',
        taskTitle: 'Current task',
        action: 'rescued',
        at: new Date(now - 5 * 60_000).toISOString(),
        note: 'recovered',
        by: 'ada',
      },
    ])
  })

  it('builds parent-first grouped todo rows with assignee fallback groups', () => {
    const makeTask = (overrides: Partial<ClaudeTask>): ClaudeTask => ({
      id: overrides.id ?? 'task',
      title: overrides.title ?? 'Task',
      description: '',
      column: 'todo',
      priority: 'medium',
      assignee: null,
      tags: [],
      due_date: null,
      position: 0,
      created_by: 'user',
      created_at: '2026-01-01T00:00:00Z',
      updated_at: '2026-01-01T00:00:00Z',
      ...overrides,
    })
    const parent = makeTask({ id: 'parent', title: 'Parent' })
    const child = makeTask({ id: 'child', depends_on: ['parent'] })
    const other = makeTask({ id: 'other', assignee: 'ada' })
    const toggled: Array<string> = []
    const rows = buildGroupedTodoRows(
      [child, other],
      [parent, child, other],
      new Set<string>(),
      (id) => toggled.push(id),
    )

    expect(
      rows.map((row) =>
        row.kind === 'group-header'
          ? row.groupId
          : row.kind === 'task'
            ? row.task.id
            : row.label,
      ),
    ).toEqual(['parent', 'child', '__asgn__ada', 'other'])
    const parentHeader = rows[0]
    if (parentHeader.kind === 'group-header') parentHeader.onToggle()
    expect(toggled).toEqual(['parent'])
  })

  it('derives board counts, readiness, inbox, and active tag summaries', () => {
    const task = (overrides: Partial<ClaudeTask>): ClaudeTask => ({
      id: overrides.id ?? 'task',
      title: overrides.title ?? 'Task',
      description: '',
      column: 'todo',
      priority: 'medium',
      assignee: null,
      tags: [],
      due_date: null,
      position: 0,
      created_by: 'user',
      created_at: '2026-01-01T00:00:00Z',
      updated_at: '2026-01-01T00:00:00Z',
      ...overrides,
    })
    const now = new Date('2026-07-02T12:00:00Z')
    const stats = getTaskBoardStats(
      [
        task({ id: 'done', column: 'done' }),
        task({
          id: 'blocked',
          column: 'blocked',
          waiting_for_user: true,
          tags: ['finance'],
        }),
        task({
          id: 'review',
          column: 'review',
          assignee: 'ada',
          agent_history: [
            {
              id: 'plan',
              action: 'planned',
              by: 'ada',
              byEmoji: '🛠️',
              note: 'A'.repeat(80),
              at: '2026-07-02T10:00:00Z',
            },
          ],
        }),
        task({
          id: 'win',
          column: 'todo',
          agent_history: [
            {
              id: 'complete',
              action: 'completed',
              by: 'astra',
              byEmoji: '🌟',
              note: 'finished',
              at: '2026-07-02T11:00:00Z',
            },
          ],
        }),
      ],
      now,
    )

    expect(stats).toMatchObject({
      total: 4,
      done: 1,
      blocked: 1,
      blockedWaiting: 1,
      blockedExecFail: 0,
      completion: 25,
      readyToExecute: 1,
      timedOut: 0,
      stubReviewCount: 0,
      tagCloud: { finance: 1 },
    })
    expect(stats.inboxTasks.map((item) => item.id)).toEqual(['blocked'])
    expect(stats.todayWins.map((win) => win.task.id)).toEqual(['win'])
    expect(stats.sisterChips).toEqual([['ada', 1]])
  })

  it('formats blocked task breakdown copy and titles', () => {
    expect(formatBlockedTaskBreakdownLabel(2, 1)).toBe('2 input · 1 err')
    expect(formatBlockedTaskBreakdownLabel(1, 0)).toBe('needs input')
    expect(formatBlockedTaskBreakdownLabel(0, 3)).toBe('exec error')
    expect(formatBlockedTaskBreakdownLabel(0, 0)).toBeNull()
    expect(formatBlockedTaskBreakdownTitle(1, 2)).toBe(
      '1 waiting for input, 2 execution failures',
    )
  })

  it('formats compact column labels for empty and populated columns', () => {
    expect(formatCompactTaskColumnAriaLabel('Backlog', 0)).toBe(
      'Backlog column is empty. Add a task or drop one here.',
    )
    expect(formatCompactTaskColumnAriaLabel('In Progress', 2)).toBe(
      'In Progress column with 2 tasks',
    )
    expect(formatCompactTaskColumnActionLabel('Review')).toBe(
      'Add a task to the Review column',
    )
  })

  it('counts only review tasks with usable execution plans', () => {
    const plannedHistory = [
      {
        id: 'h1',
        action: 'planned',
        note: '1. Inspect the target files. 2. Apply the requested code change. 3. Run focused verification and report the result.',
        by: 'astra',
        byEmoji: '🌟',
        at: '2026-01-01T00:00:00Z',
      },
    ]
    const stubHistory = [
      {
        id: 'h3',
        action: 'planned',
        note: '1. Do the work',
        by: 'astra',
        byEmoji: '🌟',
        at: '2026-01-01T00:00:00Z',
      },
    ]
    const unavailableHistory = [
      {
        id: 'h2',
        action: 'planned',
        note: 'Plan unavailable — press Execute to proceed.',
        by: 'astra',
        byEmoji: '🌟',
        at: '2026-01-01T00:00:00Z',
      },
    ]

    expect(
      countExecutableReviewTasks([
        { column: 'review', agent_state: null, agent_history: plannedHistory },
        {
          column: 'review',
          agent_state: 'working',
          agent_history: plannedHistory,
        },
        {
          column: 'review',
          agent_state: null,
          agent_history: unavailableHistory,
        },
        { column: 'review', agent_state: null, agent_history: stubHistory },
        { column: 'todo', agent_state: null, agent_history: plannedHistory },
        { column: 'review', agent_state: null, agent_history: [] },
      ]),
    ).toBe(1)
  })
})
