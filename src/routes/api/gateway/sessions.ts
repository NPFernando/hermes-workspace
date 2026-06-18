/**
 * GET /api/gateway/sessions
 *
 * Wraps the existing sessions list for stores that poll
 * /api/gateway/sessions (agent-swarm-store, chat-activity-store).
 * Returns { ok, data: { sessions } } so both stores work without
 * having to reach the dashboard API directly.
 */
import { createFileRoute } from '@tanstack/react-router'
import { json } from '@tanstack/react-start'
import { isAuthenticated } from '../../../server/auth-middleware'
import { ensureGatewayProbed, listSessions } from '../../../server/claude-api'
import { getCapabilities } from '../../../server/gateway-capabilities'

export const Route = createFileRoute('/api/gateway/sessions')({
  server: {
    handlers: {
      GET: async ({ request }) => {
        if (!isAuthenticated(request)) {
          return json({ ok: false, error: 'Unauthorized' }, { status: 401 })
        }

        await ensureGatewayProbed()
        const caps = getCapabilities()

        if (!caps.sessions) {
          return json({ ok: true, data: { sessions: [] }, source: 'unavailable' })
        }

        try {
          const sessions = await listSessions(50)
          return json({ ok: true, data: { sessions: Array.isArray(sessions) ? sessions : [] } })
        } catch (err) {
          return json(
            { ok: false, error: err instanceof Error ? err.message : 'Failed to list sessions' },
            { status: 502 },
          )
        }
      },
    },
  },
})
