import { createFileRoute } from '@tanstack/react-router'
import { json } from '@tanstack/react-start'
import { isAuthenticated } from '../../server/auth-middleware'
import { requireJsonContentType } from '../../server/rate-limit'
import { forgetLearnedCapability } from '../../server/harp-capabilities'

export const Route = createFileRoute('/api/harp-capability-forget')({
  server: {
    handlers: {
      POST: async ({ request }) => {
        if (!isAuthenticated(request)) {
          return json({ ok: false, error: 'Unauthorized' }, { status: 401 })
        }
        const csrfCheck = requireJsonContentType(request)
        if (csrfCheck) return csrfCheck
        let body: Record<string, unknown>
        try {
          body = (await request.json()) as Record<string, unknown>
        } catch {
          return json(
            { ok: false, error: 'Invalid JSON body' },
            { status: 400 },
          )
        }
        const result = await forgetLearnedCapability({
          model: body.model,
          option: body.option,
        })
        if (!result.ok) {
          return json(
            { ok: false, error: result.error },
            { status: result.status },
          )
        }
        return json(result)
      },
    },
  },
})
