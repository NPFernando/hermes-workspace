import { createFileRoute } from '@tanstack/react-router'
import { json } from '@tanstack/react-start'
import { isAuthenticated } from '../../server/auth-middleware'
import {
  clearStuckTasks,
  runAgentDeployBackground,
} from '../../server/astra-tasks'
import {
  getClientIp,
  rateLimit,
  rateLimitResponse,
} from '../../server/rate-limit'

export const Route = createFileRoute('/api/tasks-deploy-agents')({
  server: {
    handlers: {
      POST: ({ request }) => {
        if (!isAuthenticated(request)) {
          return json({ ok: false, error: 'Unauthorized' }, { status: 401 })
        }
        if (
          !rateLimit(`tasks-deploy-agents:${getClientIp(request)}`, 5, 60_000)
        ) {
          return rateLimitResponse()
        }
        const result = runAgentDeployBackground()
        return json({ ok: true, taskCount: result.taskCount })
      },
      // DELETE: manual stuck-task sweep without triggering a new deploy cycle.
      // Useful when the board shows spinners after a server restart.
      DELETE: ({ request }) => {
        if (!isAuthenticated(request)) {
          return json({ ok: false, error: 'Unauthorized' }, { status: 401 })
        }
        if (
          !rateLimit(
            `tasks-deploy-agents:delete:${getClientIp(request)}`,
            10,
            60_000,
          )
        ) {
          return rateLimitResponse()
        }
        const cleared = clearStuckTasks()
        return json({ ok: true, cleared })
      },
    },
  },
})
