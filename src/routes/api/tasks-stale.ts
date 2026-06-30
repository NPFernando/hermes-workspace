import { randomUUID } from 'node:crypto'
import { createFileRoute } from '@tanstack/react-router'
import { json } from '@tanstack/react-start'
import { isAuthenticated } from '../../server/auth-middleware'
import { listTasks, updateTask } from '../../server/tasks-store'

// GET /api/tasks-stale  — returns age bucket stats for todo/backlog tasks
// POST /api/tasks-stale — archives tasks older than age_days days

const STALE_COLUMNS = ['todo', 'backlog'] as const

function taskLastActivityAt(task: { created_at?: string; agent_history?: Array<{ at?: string }> }): number {
  let latest = new Date(task.created_at ?? 0).getTime()
  for (const h of task.agent_history ?? []) {
    if (h.at) latest = Math.max(latest, new Date(h.at).getTime())
  }
  return latest
}

export const Route = createFileRoute('/api/tasks-stale')({
  server: {
    handlers: {
      GET: ({ request }) => {
        if (!isAuthenticated(request)) return json({ ok: false, error: 'Unauthorized' }, { status: 401 })

        const all = listTasks({})
        const now = Date.now()
        const buckets = { days30: 0, days60: 0, days90: 0, total: 0 }
        const previews: Array<{ id: string; title: string; assignee: string | null; ageDays: number; column: string }> = []

        for (const t of all) {
          if (!STALE_COLUMNS.includes(t.column as typeof STALE_COLUMNS[number])) continue
          if (t.agent_state) continue // skip tasks actively being worked on
          const ageDays = Math.floor((now - taskLastActivityAt(t)) / 86_400_000)
          if (ageDays >= 30) buckets.days30++
          if (ageDays >= 60) buckets.days60++
          if (ageDays >= 90) buckets.days90++
          if (ageDays >= 30) {
            buckets.total++
            if (previews.length < 20) {
              previews.push({ id: t.id, title: t.title, assignee: t.assignee ?? null, ageDays, column: t.column })
            }
          }
        }

        previews.sort((a, b) => b.ageDays - a.ageDays)
        return json({ ok: true, buckets, previews })
      },

      POST: async ({ request }) => {
        if (!isAuthenticated(request)) return json({ ok: false, error: 'Unauthorized' }, { status: 401 })

        let body: { age_days?: number } = {}
        try { body = (await request.json()) as typeof body } catch { /* empty */ }

        const ageDays = body.age_days ?? 60
        if (ageDays < 14) return json({ ok: false, error: 'age_days must be >= 14' }, { status: 400 })

        const all = listTasks({})
        const now = Date.now()
        const cutoff = ageDays * 86_400_000
        let archived = 0

        for (const t of all) {
          if (!STALE_COLUMNS.includes(t.column as typeof STALE_COLUMNS[number])) continue
          if (t.agent_state) continue
          const age = now - taskLastActivityAt(t)
          if (age < cutoff) continue

          updateTask(t.id, {
            column: 'done',
            agent_history: [
              ...(t.agent_history ?? []),
              {
                id: randomUUID(),
                by: 'user',
                byEmoji: '🗂️',
                action: 'completed',
                note: `Auto-archived after ${ageDays}+ days of inactivity.`,
                at: new Date().toISOString(),
              },
            ],
          })
          archived++
        }

        return json({ ok: true, archived })
      },
    },
  },
})
