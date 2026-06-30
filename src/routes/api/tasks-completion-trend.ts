import { createFileRoute } from '@tanstack/react-router'
import { json } from '@tanstack/react-start'
import { listTasks } from '../../server/tasks-store'

// GET /api/tasks-completion-trend
// Returns daily completion counts for the last 7 days.

export const Route = createFileRoute('/api/tasks-completion-trend')({
  server: {
    handlers: {
      GET: () => {
        const all = listTasks({ includeDone: true })
        const now = Date.now()
        const days: Record<string, number> = {}

        // Build last 7 day keys
        for (let i = 6; i >= 0; i--) {
          const d = new Date(now - i * 86_400_000)
          days[d.toISOString().slice(0, 10)] = 0
        }

        // Count completions from agent_history 'completed' entries (accurate vs updated_at)
        all.forEach((t) => {
          (t.agent_history ?? []).forEach((h: { action: string; at?: string }) => {
            if (h.action === 'completed' && h.at) {
              const day = h.at.slice(0, 10)
              if (day in days) days[day]++
            }
          })
        })

        const trend = Object.entries(days).map(([date, count]) => ({ date, count }))
        const total = trend.reduce((s, d) => s + d.count, 0)
        return json({ ok: true, trend, total })
      },
    },
  },
})
