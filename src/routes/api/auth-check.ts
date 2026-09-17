import { createFileRoute } from '@tanstack/react-router'
import { json } from '@tanstack/react-start'
import {
  isAuthenticated,
  isPasswordProtectionEnabled,
} from '../../server/auth-middleware'

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

        // This endpoint is intentionally limited to session state. Gateway
        // probing can do synchronous setup before its first await and may take
        // several seconds while the gateway is restarting or under load. It
        // must not delay this short client-side auth request or make a valid
        // session look logged out. Gateway health has dedicated endpoints.
        return json({
          authenticated,
          authRequired,
        })
      },
    },
  },
})
