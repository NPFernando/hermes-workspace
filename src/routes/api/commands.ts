/**
 * Server-side proxy for /v1/commands on the gateway.
 *
 * The gateway exposes a list of slash commands at /v1/commands.
 * This route proxies that call server-side (with gateway auth) so the
 * browser never needs to reach the gateway port directly.
 */
import { createFileRoute } from '@tanstack/react-router'
import { json } from '@tanstack/react-start'
import { isAuthenticated } from '../../server/auth-middleware'
import { gatewayFetch } from '../../server/gateway-capabilities'

export const Route = createFileRoute('/api/commands')({
  server: {
    handlers: {
      GET: async ({ request }) => {
        if (!isAuthenticated(request)) {
          return json({ error: 'Unauthorized' }, { status: 401 })
        }

        try {
          const res = await gatewayFetch('/v1/commands')

          if (res.status === 404) {
            // Gateway builds without /v1/commands (e.g. hermes-agent 0.16.0)
            // have no server-side command list; the composer merges its own
            // defaults, so report "none" instead of surfacing an error.
            return json({ commands: [] })
          }

          if (!res.ok) {
            return json(
              { error: `Gateway responded with status ${res.status}` },
              { status: res.status },
            )
          }

          const body = await res.json()
          return Response.json(body)
        } catch {
          return json({ error: 'Gateway is unreachable' }, { status: 500 })
        }
      },
    },
  },
})
