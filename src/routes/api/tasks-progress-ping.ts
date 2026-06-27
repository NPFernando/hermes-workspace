import { createFileRoute } from '@tanstack/react-router'
import { listTasks, updateTask } from '../../server/tasks-store'
import { sendTelegramProgressPing } from '../../server/telegram-clarify'

// ---------------------------------------------------------------------------
// POST /api/tasks-progress-ping
//
// Scans tasks in agent_state='working' and sends a "still working" Telegram
// ping for tasks that:
//   1. Have been working for at least MIN_WORKING_MS (3 min)
//   2. Haven't been pinged in the last PING_INTERVAL_MS (5 min) for this run
//   3. Have been working less than MAX_WORKING_MS (18 min — nearing timeout)
//
// Called by cron every 5 minutes. The ping message includes elapsed time and
// a deep-link button directly to the task dialog.
// ---------------------------------------------------------------------------

const MIN_WORKING_MS  = 3  * 60 * 1000   // wait at least 3 min before first ping
const PING_INTERVAL_MS = 5  * 60 * 1000  // ping at most every 5 min
const MAX_WORKING_MS  = 18 * 60 * 1000   // stop pinging near the 20 min hermes timeout

function jsonResponse(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

export const Route = createFileRoute('/api/tasks-progress-ping')({
  server: {
    handlers: {
      POST: async () => {
        const now = Date.now()
        const allTasks = listTasks({ includeDone: false })

        const candidates = allTasks.filter((t) => {
          if (t.agent_state !== 'working') return false
          if (!t.agent_action_at) return false

          const elapsedMs = now - Date.parse(t.agent_action_at)
          if (elapsedMs < MIN_WORKING_MS) return false   // too early
          if (elapsedMs >= MAX_WORKING_MS) return false  // near timeout — let stuck-task sweep handle it

          const lastPing = t.agent_progress_pinged_at
          // Is this a new execution (no ping yet, or last ping predates the current run)?
          const isNewRun = !lastPing || Date.parse(lastPing) < Date.parse(t.agent_action_at)
          if (isNewRun) return true  // first ping for this execution

          // Already pinged this run — check interval
          return now - Date.parse(lastPing) >= PING_INTERVAL_MS
        })

        const pinged: Array<{ id: string; title: string }> = []

        for (const task of candidates) {
          const elapsedMs = now - Date.parse(task.agent_action_at!)
          await sendTelegramProgressPing(
            { id: task.id, title: task.title, agent_name: task.agent_name },
            elapsedMs,
          )
          updateTask(task.id, { agent_progress_pinged_at: new Date().toISOString() })
          pinged.push({ id: task.id, title: task.title })
        }

        return jsonResponse({ ok: true, pinged: pinged.length, tasks: pinged })
      },
    },
  },
})
