import { randomUUID } from 'node:crypto'
import { createFileRoute } from '@tanstack/react-router'
import { isAuthenticated } from '../../server/auth-middleware'
import { appendLocalMessage, ensureLocalSession } from '../../server/local-session-store'
import { listTasks } from '../../server/tasks-store'

function jsonResponse(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

export const Route = createFileRoute('/api/tasks-ask-astra')({
  server: {
    handlers: {
      POST: async ({ request }) => {
        if (!isAuthenticated(request)) {
          return jsonResponse({ error: 'Unauthorized' }, 401)
        }

        const allTasks = listTasks({ includeDone: false })

        const counts = {
          total: allTasks.length,
          running: allTasks.filter((t) => t.column === 'in_progress').length,
          blocked: allTasks.filter((t) => t.column === 'blocked').length,
          review: allTasks.filter((t) => t.column === 'review').length,
          backlog: allTasks.filter((t) => t.column === 'backlog').length,
          todo: allTasks.filter((t) => t.column === 'todo').length,
          agentActive: allTasks.filter((t) => t.agent_state).length,
        }

        const focusTasks = allTasks
          .filter((t) => t.column === 'in_progress' || t.column === 'blocked' || t.column === 'review')
          .slice(0, 15)

        const focusLines = focusTasks
          .map((t) => {
            const agentNote = t.agent_state ? ` [agent: ${t.agent_state} by ${t.agent_name ?? 'astra'}]` : ''
            const commentNote = t.agent_comment ? ` — ${t.agent_comment.slice(0, 120)}` : ''
            return `- [${t.column.toUpperCase()}] [${t.priority}] ${t.title}${agentNote}${commentNote}`
          })
          .join('\n')

        const briefing = [
          'You are Astra. I need a quick board review and your recommendations.',
          '',
          `**Board snapshot (${new Date().toLocaleString()}):**`,
          `- Total active tasks: ${counts.total}`,
          `- Running: ${counts.running}  |  Blocked: ${counts.blocked}  |  In Review: ${counts.review}`,
          `- Triage: ${counts.backlog}  |  Ready: ${counts.todo}`,
          counts.agentActive > 0 ? `- Agents currently working: ${counts.agentActive}` : '',
          '',
          focusTasks.length > 0
            ? `**Active / blocked tasks:**\n${focusLines}`
            : '*No active tasks right now.*',
          '',
          'Please give me: (1) a 2-sentence overall status, (2) top 3 tasks to focus on next and why, (3) anything needing immediate attention (blocked, overdue, stuck agents). Be concise and direct.',
        ]
          .filter((l) => l !== '')
          .join('\n')

        const sessionId = `board-${randomUUID().slice(0, 12)}`
        ensureLocalSession(sessionId)
        appendLocalMessage(sessionId, {
          id: randomUUID(),
          role: 'user',
          content: briefing,
          timestamp: Date.now(),
        })

        return jsonResponse({ sessionId })
      },
    },
  },
})
