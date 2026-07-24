import { describe, expect, it } from 'vitest'
import { buildSisterStandupEntry } from './sister-standups'
import type { Sister } from './sisters-registry'
import type { TaskRecord } from './tasks-store'

function task(overrides: Partial<TaskRecord>): TaskRecord {
  return {
    id: overrides.id ?? 'task-1',
    title: overrides.title ?? 'Task',
    description: overrides.description ?? '',
    column: overrides.column ?? 'todo',
    priority: overrides.priority ?? 'medium',
    assignee: overrides.assignee ?? null,
    tags: overrides.tags ?? [],
    due_date: overrides.due_date ?? null,
    position: overrides.position ?? 0,
    created_by: overrides.created_by ?? 'user',
    created_at: overrides.created_at ?? '2026-07-12T08:00:00.000Z',
    updated_at: overrides.updated_at ?? '2026-07-13T08:00:00.000Z',
    session_id: overrides.session_id ?? null,
    agent_state: overrides.agent_state ?? null,
    agent_name: overrides.agent_name ?? null,
    agent_action_at: overrides.agent_action_at ?? null,
    source: overrides.source ?? null,
    agent_comment: overrides.agent_comment ?? null,
    agent_history: overrides.agent_history ?? [],
    waiting_for_user: overrides.waiting_for_user ?? false,
  }
}

const sister: Sister = {
  id: 'nova',
  name: 'Nova',
  emoji: 'N',
  description: 'Research',
  role: 'researcher',
  type: 'ai_sister',
  profilePath: '/tmp/nova',
  hasProfile: true,
  isLive: true,
}

describe('buildSisterStandupEntry', () => {
  it('summarizes completed, active, and blocked assigned tasks', () => {
    const entry = buildSisterStandupEntry({
      sister,
      now: new Date('2026-07-13T09:00:00.000Z'),
      tasks: [
        task({
          id: 'done',
          title: 'Finish research brief',
          column: 'done',
          assignee: 'nova',
          updated_at: '2026-07-13T07:00:00.000Z',
        }),
        task({
          id: 'active',
          title: 'Prepare today priorities',
          column: 'in_progress',
          assignee: 'Nova',
        }),
        task({
          id: 'blocked',
          title: 'Wait for vendor response',
          column: 'blocked',
          assignee: 'researcher',
        }),
      ],
    })

    expect(entry.date).toBe('2026-07-13')
    expect(entry.yesterday).toBe('Finish research brief')
    expect(entry.today).toBe('Prepare today priorities')
    expect(entry.blockers).toBe('Wait for vendor response')
    expect(entry.summary).toContain('Nova daily standup')
  })

  it('treats unassigned tasks as Astra ownership', () => {
    const astra: Sister = { ...sister, id: 'astra', name: 'Astra', role: 'orchestrator' }
    const entry = buildSisterStandupEntry({
      sister: astra,
      now: new Date('2026-07-13T09:00:00.000Z'),
      tasks: [
        task({
          id: 'unassigned',
          title: 'Triage inbox',
          column: 'todo',
          assignee: null,
        }),
      ],
    })

    expect(entry.today).toBe('Triage inbox')
  })
})
