import { createFileRoute } from '@tanstack/react-router'
import { json } from '@tanstack/react-start'
import { isAuthenticated } from '../../../server/auth-middleware'
import { listProfilesWithFallback } from '../../../server/profiles-browser'
import { bootstrapOnceLazy } from '../../../server/sisters-registry'

import { safeErrorMessage } from '../../../server/rate-limit'

export const Route = createFileRoute('/api/profiles/list')({
  server: {
    handlers: {
      GET: async ({ request }) => {
        if (!isAuthenticated(request)) {
          return json({ error: 'Unauthorized' }, { status: 401 })
        }
        try {
          bootstrapOnceLazy()
          const { profiles, activeProfile } =
            await listProfilesWithFallback()
          return json({ profiles, activeProfile })
        } catch (error) {
          return json(
            {
              error:
                safeErrorMessage(error),
              profiles: [],
            },
            { status: 500 },
          )
        }
      },
    },
  },
})
