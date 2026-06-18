import { createFileRoute } from '@tanstack/react-router'
import { json } from '@tanstack/react-start'
import { isAuthenticated } from '../../../server/auth-middleware'
import { deleteHindsightMemory } from '../../../server/hindsight-client'

export const Route = createFileRoute('/api/hindsight/delete')({
  server: {
    handlers: {
      POST: async ({ request }) => {
        if (!isAuthenticated(request)) {
          return json({ error: 'Unauthorized' }, { status: 401 })
        }
        try {
          const body = (await request.json()) as { id?: string; bank?: string }
          const id = String(body.id ?? '').trim()
          if (!id) {
            return json({ error: 'id is required' }, { status: 400 })
          }
          const bank = body.bank ? String(body.bank) : undefined
          await deleteHindsightMemory(id, bank)
          return json({ ok: true })
        } catch (err) {
          return json(
            { error: err instanceof Error ? err.message : 'Delete failed' },
            { status: 500 },
          )
        }
      },
    },
  },
})
