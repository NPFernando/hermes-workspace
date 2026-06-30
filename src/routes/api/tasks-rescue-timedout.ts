import { createFileRoute } from '@tanstack/react-router'
import { json } from '@tanstack/react-start'
import { listTasks, updateTask } from '../../server/tasks-store'

// POST /api/tasks-rescue-timedout
// Rescues tasks that are stuck or timed-out:
//   1. Clears agent_state on all stuck tasks (agent_state set but not working productively)
//   2. Moves blocked timed-out tasks (not waiting_for_user) → todo
// Does NOT touch todo/review tasks that are already in valid states.

export const Route = createFileRoute('/api/tasks-rescue-timedout')({
  server: {
    handlers: {
      POST: async () => {
        const now = new Date().toISOString()
        const all = listTasks({})
        let rescued = 0

        for (const t of all) {
          if (t.column === 'done' || t.column === 'deleted') continue

          const hasTimedOut = (t.agent_history ?? []).some((h) => h.action === 'timed_out')
          const isStuck = !!t.agent_state && t.agent_state !== 'waiting_for_input'
          const isBlockedTimedOut = t.column === 'blocked' && !t.waiting_for_user && hasTimedOut

          if (!isStuck && !isBlockedTimedOut) continue

          const updates: Record<string, unknown> = {
            agent_state: null,
            agent_name: null,
            agent_action_at: null,
            agent_history: [
              ...(t.agent_history ?? []),
              { action: 'rescued', at: now, note: 'Rescued via batch rescue: cleared stuck state.' },
            ],
          }

          if (isStuck && (t.column === 'in_progress' || t.column === 'todo')) {
            updates.column = 'todo'
          }
          if (isBlockedTimedOut) {
            updates.column = 'todo'
            updates.waiting_for_user = false
          }

          await updateTask(t.id, updates)
          rescued++
        }

        return json({ ok: true, rescued })
      },

      GET: () => {
        const all = listTasks({})
        const stuck = all.filter((t) =>
          t.column !== 'done' && t.column !== 'deleted' &&
          (!!t.agent_state && t.agent_state !== 'waiting_for_input'),
        ).length
        const blockedTimedOut = all.filter((t) =>
          t.column === 'blocked' && !t.waiting_for_user &&
          (t.agent_history ?? []).some((h) => h.action === 'timed_out'),
        ).length
        return json({ ok: true, stuck, blockedTimedOut, total: stuck + blockedTimedOut })
      },
    },
  },
})
