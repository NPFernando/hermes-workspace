import { createFileRoute } from '@tanstack/react-router'
import { isAuthenticated } from '../../server/auth-middleware'
import { runAgentDeployBackground } from '../../server/astra-tasks'
import { createTask, listTasks } from '../../server/tasks-store'
import type { TaskColumn, TaskPriority } from '../../server/tasks-store'

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
    value === 'done' ||
    value === 'deleted'
  )
}

function isTaskPriority(value: unknown): value is TaskPriority {
  return value === 'high' || value === 'medium' || value === 'low'
}

export const Route = createFileRoute('/api/hermes-tasks')({
  server: {
    handlers: {
      GET: async ({ request }) => {
        if (!isAuthenticated(request)) {
          return jsonResponse({ error: 'Unauthorized' }, 401)
        }

        const url = new URL(request.url)
        const tasks = listTasks({
          column: url.searchParams.get('column'),
          assignee: url.searchParams.get('assignee'),
          priority: url.searchParams.get('priority'),
          includeDone: url.searchParams.get('include_done') === 'true',
        })

        return jsonResponse({ tasks })
      },

      POST: async ({ request }) => {
        if (!isAuthenticated(request)) {
          return jsonResponse({ error: 'Unauthorized' }, 401)
        }

        try {
          const body = (await request.json()) as Record<string, unknown>
          if (!body.title || typeof body.title !== 'string') {
            return jsonResponse({ error: 'title is required' }, 400)
          }

          const task = createTask({
            id: typeof body.id === 'string' ? body.id : undefined,
            title: body.title,
            description: typeof body.description === 'string' ? body.description : '',
            column: isTaskColumn(body.column) ? body.column : undefined,
            priority: isTaskPriority(body.priority) ? body.priority : undefined,
            assignee: typeof body.assignee === 'string' ? body.assignee : null,
            tags: Array.isArray(body.tags) ? body.tags.filter((tag): tag is string => typeof tag === 'string') : [],
            due_date: typeof body.due_date === 'string' ? body.due_date : null,
            position: typeof body.position === 'number' ? body.position : 0,
            created_by: typeof body.created_by === 'string' ? body.created_by : 'user',
          })

          // Auto-start Phase 1 review for actionable tasks — no manual Deploy needed.
          // Skip if the task was created directly into in_progress/review/blocked/done
          // (that means the caller already knows what to do with it).
          if (task.column === 'backlog' || task.column === 'todo') {
            runAgentDeployBackground()
          }

          return jsonResponse({ task }, 201)
        } catch {
          return jsonResponse({ error: 'Invalid request body' }, 400)
        }
      },
    },
  },
})
