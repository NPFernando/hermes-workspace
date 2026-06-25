import { createFileRoute } from '@tanstack/react-router'
import { json } from '@tanstack/react-start'
import { isAuthenticated } from '../../server/auth-middleware'
import { clearStuckTasks, runAgentDeployBackground } from '../../server/astra-tasks'

export const Route = createFileRoute('/api/tasks-deploy-agents')({
  server: {
    handlers: {
      POST: async ({ request }) => {
        if (!isAuthenticated(request)) {
          return json({ ok: false, error: 'Unauthorized' }, { status: 401 })
        }
        const result = runAgentDeployBackground()
        return json({ ok: true, taskCount: result.taskCount })
      },
      // DELETE: manual stuck-task sweep without triggering a new deploy cycle.
      // Useful when the board shows spinners after a server restart.
      DELETE: async ({ request }) => {
        if (!isAuthenticated(request)) {
          return json({ ok: false, error: 'Unauthorized' }, { status: 401 })
        }
        const cleared = clearStuckTasks()
        return json({ ok: true, cleared })
      },
    },
  },
})
