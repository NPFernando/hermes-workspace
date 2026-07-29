import { describe, expect, it } from 'vitest'
import { isStubReviewTask } from './tasks-replan-stubs'
import type { TaskRecord } from '../../server/tasks-store'

function task(overrides: Partial<TaskRecord>): TaskRecord {
  return {
    id: 'task-1',
    title: 'Task',
    description: '',
    column: 'review',
    priority: 'medium',
    assignee: null,
    tags: [],
    due_date: null,
    position: 0,
    created_by: 'test',
    created_at: '2026-07-13T00:00:00.000Z',
    updated_at: '2026-07-13T00:00:00.000Z',
    session_id: null,
    agent_state: null,
    agent_name: null,
    agent_action_at: null,
    source: null,
    agent_comment: null,
    agent_history: [],
    waiting_for_user: false,
    ...overrides,
  }
}

describe('isStubReviewTask', () => {
  it('matches review tasks whose latest plan is unavailable', () => {
    expect(isStubReviewTask(task({
      agent_history: [{
        id: 'h1',
        by: 'Astra',
        byEmoji: '✨',
        action: 'planned',
        at: '2026-07-13T00:00:00.000Z',
        note: '(Plan unavailable — press Execute to proceed.)',
      }],
    }))).toBe(true)
  })

  it('does not move completed review tasks without a plan back to todo', () => {
    expect(isStubReviewTask(task({
      agent_history: [{
        id: 'h1',
        by: 'astra',
        byEmoji: '🌟',
        action: 'completed',
        at: '2026-07-13T00:00:00.000Z',
        note: 'Implemented and verified.',
      }],
    }))).toBe(false)
  })

  it('does not move attempted review tasks even if an old plan was a stub', () => {
    expect(isStubReviewTask(task({
      agent_history: [
        {
          id: 'h1',
          by: 'Astra',
          byEmoji: '✨',
          action: 'planned',
          at: '2026-07-13T00:00:00.000Z',
          note: '(Plan unavailable — press Execute to proceed.)',
        },
        {
          id: 'h2',
          by: 'maya',
          byEmoji: '🔨',
          action: 'attempted',
          at: '2026-07-13T00:05:00.000Z',
          note: 'Work was attempted.',
        },
      ],
    }))).toBe(false)
  })
})
