import { createFileRoute } from '@tanstack/react-router'
import { json } from '@tanstack/react-start'
import { isAuthenticated } from '../../server/auth-middleware'
import { getUserProfile } from '../../server/google-oauth'

export const Route = createFileRoute('/api/user-profile')({
  server: {
    handlers: {
      GET: async ({ request }) => {
        if (!isAuthenticated(request)) {
          return json({ error: 'Unauthorized' }, { status: 401 })
        }
        return json(getUserProfile() ?? {})
      },
    },
  },
})
