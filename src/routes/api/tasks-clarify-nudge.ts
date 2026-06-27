import { createFileRoute } from '@tanstack/react-router'
import { listTasks, updateTask } from '../../server/tasks-store'
import { sendTelegramClarificationReminder } from '../../server/telegram-clarify'

// ---------------------------------------------------------------------------
// POST /api/tasks-clarify-nudge?hours=4
//
// Scans all tasks waiting for clarification. For any task that has been
// waiting longer than `hours` without a nudge (or with a nudge that was
// also > `hours` ago), resends the Telegram clarification message with a
// 📢 Reminder header and updates clarify_tg + clarify_nudged_at.
//
// Max 3 nudges per task (stops after that — user has deliberately ignored it).
// Called by cron script every 4 hours.
// ---------------------------------------------------------------------------

const MAX_NUDGES = 3

function jsonResponse(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

export const Route = createFileRoute('/api/tasks-clarify-nudge')({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const url = new URL(request.url)
        const hoursParam = Number(url.searchParams.get('hours') ?? '4')
        const thresholdMs = (isNaN(hoursParam) ? 4 : Math.max(1, hoursParam)) * 60 * 60 * 1000

        const now = Date.now()
        const allTasks = listTasks({ includeDone: false })

        // Find tasks that need a nudge
        const candidates = allTasks.filter((t) => {
          if (!t.waiting_for_user) return false
          if (!t.clarification_questions?.length) return false
          // Still has unanswered questions
          const anyPending = t.clarification_questions.some((q) => !q.answer)
          if (!anyPending) return false
          // Under the max nudge cap
          if ((t.clarify_nudge_count ?? 0) >= MAX_NUDGES) return false
          // Check time since last nudge (or since question was asked if never nudged)
          const lastNudgeOrAsked = t.clarify_nudged_at ?? t.agent_action_at ?? t.updated_at
          if (!lastNudgeOrAsked) return false
          return now - Date.parse(lastNudgeOrAsked) >= thresholdMs
        })

        const nudged: Array<{ id: string; title: string }> = []

        for (const task of candidates) {
          const pendingQs = (task.clarification_questions ?? []).filter((q) => !q.answer)
          const pointer = await sendTelegramClarificationReminder(
            { id: task.id, title: task.title },
            pendingQs,
          )

          if (pointer) {
            updateTask(task.id, {
              clarify_tg: pointer,
              clarify_nudged_at: new Date().toISOString(),
              clarify_nudge_count: (task.clarify_nudge_count ?? 0) + 1,
            })
            nudged.push({ id: task.id, title: task.title })
          }
        }

        return jsonResponse({ ok: true, nudged: nudged.length, tasks: nudged })
      },
    },
  },
})
