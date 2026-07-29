import { createFileRoute } from '@tanstack/react-router'
import { json } from '@tanstack/react-start'
import { isAuthenticated } from '../../server/auth-middleware'
import { listSisters } from '../../server/sisters-registry'
import { getGrowthLevel, getGrowthLog } from '../../server/sisters-growth'

export const Route = createFileRoute('/api/sisters-growth')({
  server: {
    handlers: {
      GET: ({ request }) => {
        if (!isAuthenticated(request)) {
          return json({ ok: false, error: 'Unauthorized' }, { status: 401 })
        }

        const url = new URL(request.url)
        const id = url.searchParams.get('id')?.trim() ?? ''

        if (!id) {
          return json({ ok: false, error: 'id query param required' }, { status: 400 })
        }

        const sisters = listSisters()
        if (!sisters.find((s) => s.id === id)) {
          return json({ ok: false, error: `Sister '${id}' not found` }, { status: 404 })
        }

        const level = getGrowthLevel(id)
        const recentEntries = getGrowthLog(id, 20)

        return json({ ok: true, id, growth: { ...level, recentEntries } })
      },
    },
  },
})
