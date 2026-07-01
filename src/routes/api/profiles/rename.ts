import { createFileRoute } from '@tanstack/react-router'
import { json } from '@tanstack/react-start'
import { isAuthenticated } from '../../../server/auth-middleware'
import { renameProfile } from '../../../server/profiles-browser'
import {
  requireJsonContentType,
  safeErrorMessage,
} from '../../../server/rate-limit'

export const Route = createFileRoute('/api/profiles/rename')({
  server: {
    handlers: {
      POST: async ({ request }) => {
        if (!isAuthenticated(request)) {
          return json({ error: 'Unauthorized' }, { status: 401 })
        }
        const csrfCheck = requireJsonContentType(request)
        if (csrfCheck) return csrfCheck
        try {
          const body = (await request.json()) as {
            oldName?: string
            newName?: string
          }
          return json({
            ok: true,
            profile: renameProfile(body.oldName || '', body.newName || ''),
          })
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
