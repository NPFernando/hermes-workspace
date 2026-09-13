import { describe, expect, it } from 'vitest'

import {
  handleTaskBoardSummary,
  summarizeTaskBoard,
} from '../routes/api/telegram-board-summary'
import type { TaskRecord } from './tasks-store'

const makeTask = (overrides: Partial<TaskRecord>): TaskRecord =>
  ({
    id: 'task-1',
    title: 'Example task',
    description: '',
    column: 'todo',
    priority: 'medium',
    assignee: null,
    tags: [],
    due_date: null,
    position: 0,
    created_by: 'test',
    created_at: '2026-09-13T00:00:00Z',
    updated_at: '2026-09-13T00:00:00Z',
    ...overrides,
  }) as TaskRecord

describe('summarizeTaskBoard', () => {
  it('counts running, actionable review, blocked, and dependency-waiting tasks', () => {
    const tasks = [
      makeTask({ id: 'running', agent_state: 'working' }),
      makeTask({
        id: 'ready',
        column: 'review',
        agent_history: [
          {
            id: 'plan',
            by: 'agent',
            byEmoji: '🤖',
            action: 'planned',
            note: 'A sufficiently detailed implementation plan for review.'.padEnd(
              80,
              ' details',
            ),
            at: '2026-09-13T00:00:00Z',
          },
        ],
      }),
      makeTask({ id: 'blocked', column: 'blocked' }),
      makeTask({ id: 'waiting', depends_on: ['other-task'] }),
      makeTask({
        id: 'done-dependency',
        column: 'done',
        depends_on: ['other-task'],
      }),
      makeTask({
        id: 'unready',
        column: 'review',
        agent_history: [
          {
            id: 'short-plan',
            by: 'agent',
            byEmoji: '🤖',
            action: 'planned',
            note: 'Plan unavailable',
            at: '2026-09-13T00:00:00Z',
          },
        ],
      }),
    ]

    expect(summarizeTaskBoard(tasks)).toEqual({
      running: 1,
      ready: 1,
      blocked: 1,
      dependencyWaiting: 1,
    })
  })

  it('uses the latest planned entry when deciding review readiness', () => {
    const task = makeTask({
      column: 'review',
      agent_history: [
        {
          id: 'old-plan',
          by: 'agent',
          byEmoji: '🤖',
          action: 'planned',
          note: 'A sufficiently detailed implementation plan. '.repeat(3),
          at: '2026-09-12T00:00:00Z',
        },
        {
          id: 'new-plan',
          by: 'agent',
          byEmoji: '🤖',
          action: 'planned',
          note: 'Plan unavailable',
          at: '2026-09-13T00:00:00Z',
        },
      ],
    })

    expect(summarizeTaskBoard([task]).ready).toBe(0)
  })

  it('requires authentication and prevents caching task counts', async () => {
    const previousPassword = process.env.HERMES_PASSWORD
    const previousLegacyPassword = process.env.CLAUDE_PASSWORD
    process.env.HERMES_PASSWORD = 'test-only-password'
    delete process.env.CLAUDE_PASSWORD

    try {
      const response = await handleTaskBoardSummary(
        new Request('http://localhost/api/telegram-board-summary'),
      )

      expect(response.status).toBe(401)
      expect(response.headers.get('cache-control')).toBe('private, no-store')
      await expect(response.json()).resolves.toEqual({
        ok: false,
        error: 'Unauthorized',
      })
    } finally {
      if (previousPassword === undefined) delete process.env.HERMES_PASSWORD
      else process.env.HERMES_PASSWORD = previousPassword
      if (previousLegacyPassword === undefined)
        delete process.env.CLAUDE_PASSWORD
      else process.env.CLAUDE_PASSWORD = previousLegacyPassword
    }
  })
})
