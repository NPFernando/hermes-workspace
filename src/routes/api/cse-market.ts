import { createFileRoute } from '@tanstack/react-router'
import { json } from '@tanstack/react-start'
import { isAuthenticated } from '../../server/auth-middleware'
import {
  appendCseMarketSnapshot,
  fetchCseMarketSnapshot,
  readCseMarketSnapshots,
} from '../../server/cse-market-index.service'
import {
  getClientIp,
  rateLimit,
  rateLimitResponse,
  requireJsonContentType,
  safeErrorMessage,
} from '../../server/rate-limit'

function snapshotPayload() {
  const history = readCseMarketSnapshots()
  return { ok: true, latest: history.at(-1) ?? null, history }
}

export const Route = createFileRoute('/api/cse-market')({
  server: {
    handlers: {
      GET: ({ request }) => {
        if (!isAuthenticated(request)) {
          return json({ ok: false, error: 'Unauthorized' }, { status: 401 })
        }
        return json(snapshotPayload(), {
          headers: { 'Cache-Control': 'private, no-store' },
        })
      },
      POST: async ({ request }) => {
        if (!isAuthenticated(request)) {
          return json({ ok: false, error: 'Unauthorized' }, { status: 401 })
        }
        const csrfCheck = requireJsonContentType(request)
        if (csrfCheck) return csrfCheck
        if (!rateLimit(`cse-market:${getClientIp(request)}`, 12, 60_000)) {
          return rateLimitResponse()
        }
        try {
          const snapshot = await fetchCseMarketSnapshot()
          if (!snapshot) {
            return json(
              { ...snapshotPayload(), refreshed: false },
              { status: 502 },
            )
          }
          const history = appendCseMarketSnapshot(snapshot)
          return json({ ok: true, latest: snapshot, history, refreshed: true })
        } catch (error) {
          return json(
            { ok: false, error: safeErrorMessage(error) },
            { status: 502 },
          )
        }
      },
    },
  },
})
