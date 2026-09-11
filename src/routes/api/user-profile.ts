import { createFileRoute } from '@tanstack/react-router'
import { json } from '@tanstack/react-start'
import { isAuthenticated } from '../../server/auth-middleware'
import { getUserProfile } from '../../server/google-oauth'

const PRIVATE_PROFILE_HEADERS = {
  'Cache-Control': 'no-store, no-cache, must-revalidate, private',
  Vary: 'Cookie',
}

export const Route = createFileRoute('/api/user-profile')({
  server: {
    handlers: {
      GET: ({ request }) => {
        if (!isAuthenticated(request)) {
          return json(
            { error: 'Unauthorized' },
            { status: 401, headers: PRIVATE_PROFILE_HEADERS },
          )
        }
        return json(getUserProfile() ?? {}, { headers: PRIVATE_PROFILE_HEADERS })
      },
    },
  },
})
