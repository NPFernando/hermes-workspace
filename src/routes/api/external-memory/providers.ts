import { createFileRoute } from '@tanstack/react-router'
import { json } from '@tanstack/react-start'
import { isAuthenticated } from '../../../server/auth-middleware'
import { listExternalMemoryProviders } from '../../../server/external-memory-browser'

import { safeErrorMessage } from '../../../server/rate-limit'

export const Route = createFileRoute('/api/external-memory/providers')({
  server: {
    handlers: {
      GET: ({ request }) => {
        if (!isAuthenticated(request)) {
          return json({ error: 'Unauthorized' }, { status: 401 })
        }

        try {
          return json(listExternalMemoryProviders())
        } catch (error) {
          return json(
            {
              error:
                safeErrorMessage(error),
            },
            { status: 500 },
          )
        }
      },
    },
  },
})
