import { createFileRoute } from '@tanstack/react-router'
import { json } from '@tanstack/react-start'
import { isAuthenticated } from '../../server/auth-middleware'
import { getWorkspaceSessionHealth } from '../../server/workspace-session-health'

export const Route = createFileRoute('/api/workspace-session-health')({
  server: {
    handlers: {
      GET: async ({ request }) => {
        if (!isAuthenticated(request)) {
          return json({ ok: false, error: 'Unauthorized' }, { status: 401 })
        }
        return json({ ok: true, ...(await getWorkspaceSessionHealth()) })
      },
    },
  },
})
