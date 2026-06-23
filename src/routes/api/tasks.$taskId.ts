import { createFileRoute } from '@tanstack/react-router'
import { isAuthenticated } from '../../server/auth-middleware'
import { getClaudeTask, moveClaudeTask, updateClaudeTask } from '../../server/claude-tasks-backend'
import type { ClaudeTaskRecord, TaskColumn, TaskPriority } from '../../server/claude-tasks-backend'

type TaskStatus = 'backlog' | 'in_progress' | 'review' | 'done'

function jsonResponse(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

function isTaskColumn(value: unknown): value is TaskColumn {
  return (
    value === 'backlog' ||
    value === 'todo' ||
    value === 'in_progress' ||
    value === 'review' ||
    value === 'blocked' ||
    value === 'done'
  )
}

function isTaskPriority(value: unknown): value is TaskPriority {
  return value === 'high' || value === 'medium' || value === 'low'
}

function toStatus(column: string): TaskStatus {
  if (column === 'in_progress') return 'in_progress'
  if (column === 'review') return 'review'
  if (column === 'done') return 'done'
  return 'backlog'
}

function toColumn(status: unknown): TaskColumn | undefined {
  if (status === 'in_progress') return 'in_progress'
  if (status === 'review') return 'review'
  if (status === 'done') return 'done'
  if (status === 'backlog') return 'backlog'
  return undefined
}

function toPriority(priority: unknown): TaskPriority | undefined {
  if (priority === 'P0' || priority === 'high') return 'high'
  if (priority === 'P1' || priority === 'medium') return 'medium'
  if (priority === 'P2' || priority === 'P3' || priority === 'low') return 'low'
  return undefined
}

function toTaskShape(record: ClaudeTaskRecord) {
  return {
    id: record.id,
    title: record.title,
    description: record.description,
    status: toStatus(record.column),
    column: record.column,
    assignee: record.assignee,
    priority: record.priority === 'high' ? 'P0' : record.priority === 'medium' ? 'P1' : 'P2',
    priorityRaw: record.priority,
    tags: record.tags,
    dueDate: record.due_date ?? undefined,
    due_date: record.due_date,
    createdAt: record.created_at,
    updatedAt: record.updated_at,
  }
}

export const Route = createFileRoute('/api/tasks/$taskId')({
  server: {
    handlers: {
      GET: async ({ request, params }) => {
        if (!isAuthenticated(request)) {
          return jsonResponse({ ok: false, error: 'Unauthorized' }, 401)
        }

        const task = await getClaudeTask(params.taskId)
        if (!task) return jsonResponse({ ok: false, error: 'Task not found' }, 404)
        return jsonResponse({ ok: true, task: toTaskShape(task) })
      },

      PATCH: async ({ request, params }) => {
        if (!isAuthenticated(request)) {
          return jsonResponse({ ok: false, error: 'Unauthorized' }, 401)
        }

        try {
          const body = (await request.json()) as Record<string, unknown>
          const column = isTaskColumn(body.column) ? body.column : toColumn(body.status)
          const priority = isTaskPriority(body.priority) ? body.priority : toPriority(body.priority)
          const task = await updateClaudeTask(params.taskId, {
            title: typeof body.title === 'string' ? body.title : undefined,
            description: typeof body.description === 'string' ? body.description : undefined,
            column,
            priority,
            assignee:
              body.assignee === null || typeof body.assignee === 'string'
                ? body.assignee
                : typeof body.assignedAgent === 'string'
                  ? body.assignedAgent
                  : undefined,
            tags: Array.isArray(body.tags) ? body.tags.filter((tag): tag is string => typeof tag === 'string') : undefined,
            due_date:
              body.due_date === null || typeof body.due_date === 'string'
                ? body.due_date
                : typeof body.dueDate === 'string'
                  ? body.dueDate
                  : undefined,
          })

          if (!task) return jsonResponse({ ok: false, error: 'Task not found' }, 404)
          return jsonResponse({ ok: true, task: toTaskShape(task) })
        } catch {
          return jsonResponse({ ok: false, error: 'Invalid request body' }, 400)
        }
      },

      DELETE: ({ request }) => {
        if (!isAuthenticated(request)) {
          return jsonResponse({ ok: false, error: 'Unauthorized' }, 401)
        }

        return jsonResponse({ ok: false, error: 'Delete is not supported by the shared Agent Kanban backend' }, 405)
      },

      POST: async ({ request, params }) => {
        if (!isAuthenticated(request)) {
          return jsonResponse({ ok: false, error: 'Unauthorized' }, 401)
        }

        const url = new URL(request.url)
        const action = url.searchParams.get('action') || 'move'
        if (action !== 'move') {
          return jsonResponse({ ok: false, error: `Unsupported action: ${action}` }, 400)
        }

        try {
          const body = (await request.json()) as Record<string, unknown>
          const column = isTaskColumn(body.column) ? body.column : toColumn(body.status)
          if (!column) return jsonResponse({ ok: false, error: 'column is required' }, 400)
          const task = await moveClaudeTask(params.taskId, column)
          if (!task) return jsonResponse({ ok: false, error: 'Task not found' }, 404)
          return jsonResponse({ ok: true, task: toTaskShape(task) })
        } catch {
          return jsonResponse({ ok: false, error: 'Invalid request body' }, 400)
        }
      },
    },
  },
})
