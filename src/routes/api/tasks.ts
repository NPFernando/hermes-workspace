/**
 * GET  /api/tasks  — list tasks (used by task-store in kanban-board)
 * POST /api/tasks  — create task
 *
 * Bridges task-store's Task shape to the ClaudeTaskRecord backend.
 * task-store uses { status: 'backlog'|'in_progress'|'review'|'done' }
 * while the backend uses { column: TaskColumn }. Map between them here.
 */
import { createFileRoute } from '@tanstack/react-router'
import { json } from '@tanstack/react-start'
import { isAuthenticated } from '../../server/auth-middleware'
import { requireJsonContentType } from '../../server/rate-limit'
import {
  createClaudeTask,
  listClaudeTasks,
} from '../../server/claude-tasks-backend'
import type { ClaudeTaskRecord } from '../../server/claude-tasks-backend'

type TaskStatus = 'backlog' | 'in_progress' | 'review' | 'done'

function toStatus(column: string): TaskStatus {
  if (column === 'in_progress') return 'in_progress'
  if (column === 'review') return 'review'
  if (column === 'done') return 'done'
  return 'backlog'
}

function toTaskShape(record: ClaudeTaskRecord) {
  return {
    id: record.id,
    title: record.title,
    description: record.description,
    status: toStatus(record.column),
    priority: record.priority === 'high' ? 'P0' : record.priority === 'medium' ? 'P1' : 'P2',
    tags: record.tags,
    dueDate: record.due_date ?? undefined,
    createdAt: record.created_at,
    updatedAt: record.updated_at,
  }
}

export const Route = createFileRoute('/api/tasks')({
  server: {
    handlers: {
      GET: async ({ request }) => {
        if (!isAuthenticated(request)) {
          return json({ ok: false, error: 'Unauthorized' }, { status: 401 })
        }
        try {
          const records = await listClaudeTasks()
          return json({ tasks: records.map(toTaskShape) })
        } catch (err) {
          return json(
            { ok: false, error: err instanceof Error ? err.message : 'Failed to list tasks' },
            { status: 500 },
          )
        }
      },

      POST: async ({ request }) => {
        if (!isAuthenticated(request)) {
          return json({ ok: false, error: 'Unauthorized' }, { status: 401 })
        }
        const csrfCheck = requireJsonContentType(request)
        if (csrfCheck) return csrfCheck

        try {
          const body = (await request.json()) as {
            title?: string
            description?: string
            status?: string
            priority?: string
            tags?: Array<string>
          }
          if (!body.title) {
            return json({ ok: false, error: 'title is required' }, { status: 400 })
          }

          const record = await createClaudeTask({
            title: body.title,
            description: body.description ?? '',
            column: body.status === 'in_progress' ? 'in_progress' : body.status === 'review' ? 'review' : 'backlog',
            priority: body.priority === 'P0' ? 'high' : body.priority === 'P1' ? 'medium' : 'low',
            tags: Array.isArray(body.tags) ? body.tags : [],
            due_date: null,
          })
          return json({ ok: true, task: toTaskShape(record) })
        } catch (err) {
          return json(
            { ok: false, error: err instanceof Error ? err.message : 'Failed to create task' },
            { status: 500 },
          )
        }
      },
    },
  },
})
