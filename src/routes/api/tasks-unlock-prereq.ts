import { randomUUID } from 'node:crypto'
import { createFileRoute } from '@tanstack/react-router'
import { json } from '@tanstack/react-start'
import { isAuthenticated } from '../../server/auth-middleware'
import { listTasks, updateTask } from '../../server/tasks-store'
import { runAgentDeployBackground } from '../../server/astra-tasks'

// ---------------------------------------------------------------------------
// POST /api/tasks-unlock-prereq
//
// Marks a prerequisite task as done and removes depends_on from all tasks
// that were waiting on it. Immediately triggers a deploy sweep so the newly
// unblocked tasks flow into planning without waiting for the next 15-min tick.
//
// Body: { prereq_id: string }   — ID of the prerequisite task to mark done
// ---------------------------------------------------------------------------

export const Route = createFileRoute('/api/tasks-unlock-prereq')({
  server: {
    handlers: {
      POST: async ({ request }) => {
        if (!isAuthenticated(request)) {
          return json({ ok: false, error: 'Unauthorized' }, { status: 401 })
        }

        let body: { prereq_id?: string } = {}
        try { body = (await request.json()) as typeof body } catch { /* empty body */ }

        const prereqId = body.prereq_id?.trim()
        if (!prereqId) {
          return json({ ok: false, error: 'prereq_id is required' }, { status: 400 })
        }

        const prereq = listTasks({ includeDone: true }).find((t) => t.id === prereqId)
        if (!prereq) {
          return json({ ok: false, error: 'Prerequisite task not found' }, { status: 404 })
        }

        const now = new Date().toISOString()

        // Mark the prereq task as done
        updateTask(prereqId, {
          column: 'done',
          agent_history: [...(prereq.agent_history ?? []), {
            id: randomUUID(),
            by: 'user',
            byEmoji: '👤',
            action: 'completed',
            note: 'Marked done via Unlock Prereq — credentials configured manually.',
            at: now,
          }],
        })

        // Remove depends_on from all tasks waiting on this prereq
        const gated = listTasks({}).filter(
          (t) => Array.isArray(t.depends_on) && t.depends_on.includes(prereqId),
        )

        for (const task of gated) {
          const remaining = (task.depends_on ?? []).filter((id) => id !== prereqId)
          updateTask(task.id, {
            depends_on: remaining.length > 0 ? remaining : undefined,
            agent_history: [...(task.agent_history ?? []), {
              id: randomUUID(),
              by: 'astra',
              byEmoji: '🌟',
              action: 'unblocked',
              note: `Credential prerequisite resolved — task is now eligible for planning.`,
              at: now,
            }],
          })
        }

        // Fire a deploy sweep so newly eligible tasks get picked up immediately
        setTimeout(() => {
          try { runAgentDeployBackground('manual') } catch { /* non-fatal */ }
        }, 500)

        return json({ ok: true, unblocked: gated.length, prereq_title: prereq.title })
      },

      // GET: return info about which tasks are gated on which prereqs
      GET: async ({ request }) => {
        if (!isAuthenticated(request)) {
          return json({ ok: false, error: 'Unauthorized' }, { status: 401 })
        }

        const all = listTasks({})
        const prereqIds = new Set<string>()
        all.forEach((t) => {
          if (Array.isArray(t.depends_on)) t.depends_on.forEach((id) => prereqIds.add(id))
        })

        const prereqs = [...prereqIds].map((id) => {
          const task = all.find((t) => t.id === id) ??
            listTasks({ includeDone: true }).find((t) => t.id === id)
          const gated = all.filter((t) => Array.isArray(t.depends_on) && t.depends_on.includes(id))
          return { id, title: task?.title ?? '(unknown)', column: task?.column ?? '?', gated_count: gated.length }
        })

        return json({ ok: true, prereqs })
      },
    },
  },
})
