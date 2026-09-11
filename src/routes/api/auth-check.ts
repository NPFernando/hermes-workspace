import { createFileRoute } from '@tanstack/react-router'
import { json } from '@tanstack/react-start'
import {
  isAuthenticated,
  isPasswordProtectionEnabled,
} from '../../server/auth-middleware'
import { ensureGatewayProbed } from '../../server/gateway-capabilities'

const AUTH_CHECK_HEADERS = {
  'Cache-Control': 'no-store, no-cache, must-revalidate, private',
  Vary: 'Cookie',
}

export function authCheckResponse(
  body: Record<string, unknown>,
  status = 200,
): Response {
  return json(body, { status, headers: AUTH_CHECK_HEADERS })
}

export const Route = createFileRoute('/api/auth-check')({
  server: {
    handlers: {
      GET: async ({ request }) => {
        try {
          // Use ensureGatewayProbed() which handles auto-detection across
          // multiple ports (8642, 8643) instead of checking a single
          // hardcoded URL. This was previously a standalone
          // isBackendReachable() that only tried port 8642 and never
          // benefited from the gateway-capabilities auto-detection logic.
          const caps = await ensureGatewayProbed()
          const reachable = caps.health || caps.chatCompletions || caps.models

          if (!reachable) {
            return authCheckResponse(
              {
                authenticated: false,
                authRequired: true,
                error: 'claude_agent_unreachable',
              },
              503,
            )
          }
        } catch (error) {
          return authCheckResponse(
            {
              authenticated: false,
              authRequired: true,
              error:
                error instanceof DOMException && error.name === 'AbortError'
                  ? 'claude_agent_timeout'
                  : 'claude_agent_unreachable',
            },
            503,
          )
        }

        const authRequired = isPasswordProtectionEnabled()
        const authenticated = isAuthenticated(request)

        return authCheckResponse({
          authenticated,
          authRequired,
        })
      },
    },
  },
})
