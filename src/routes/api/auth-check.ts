import { createFileRoute } from '@tanstack/react-router'
import { json } from '@tanstack/react-start'
import {
  isAuthenticated,
  isPasswordProtectionEnabled,
} from '../../server/auth-middleware'
import { ensureGatewayProbed } from '../../server/gateway-capabilities'

export const Route = createFileRoute('/api/auth-check')({
  server: {
    handlers: {
      GET: ({ request }) => {
        // Authentication is independent from gateway availability. A slow or
        // unreachable gateway must not turn a valid workspace session into a
        // false logout while the root shell is bootstrapping.
        const authRequired = isPasswordProtectionEnabled()
        const authenticated = isAuthenticated(request)

        if (authRequired && !authenticated) {
          return json({ authenticated: false, authRequired })
        }

        // Do not make session validity depend on the gateway probe. The probe
        // can take several seconds while the gateway is restarting or under
        // load; blocking this endpoint would make the browser treat a valid
        // session as logged out after its short client-side timeout. Gateway
        // health is reported by its dedicated status surfaces instead.
        void ensureGatewayProbed().catch(() => undefined)
        return json({
          authenticated,
          authRequired,
        })
      },
    },
  },
})
