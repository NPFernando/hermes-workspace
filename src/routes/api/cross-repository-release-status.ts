import { createFileRoute } from '@tanstack/react-router'
import { json } from '@tanstack/react-start'
import { isAuthenticated } from '../../server/auth-middleware'
import { getCrossRepositoryReleaseStatus } from '../../server/cross-repository-release-status'

export const Route = createFileRoute('/api/cross-repository-release-status')({
  server: {
    handlers: {
      GET: async ({ request }) => {
        if (!isAuthenticated(request)) return json({ ok: false, error: 'Unauthorized' }, { status: 401 })
        try {
          return json({ ok: true, ...(await getCrossRepositoryReleaseStatus()) }, {
            headers: { 'Cache-Control': 'private, max-age=30, stale-while-revalidate=120' },
          })
        } catch (error) {
          return json({ ok: false, error: error instanceof Error ? error.message : 'Release status unavailable.' }, { status: 503 })
        }
      },
    },
  },
})
