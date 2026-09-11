import { createFileRoute } from '@tanstack/react-router'
import { json } from '@tanstack/react-start'
import { isAuthenticated } from '../../server/auth-middleware'
import { getDifyStatus } from '../../server/dify'

export const Route = createFileRoute('/api/dify-status')({
  server: { handlers: { GET: async ({ request }) => {
    if (!isAuthenticated(request)) return json({ ok: false, error: 'Unauthorized' }, { status: 401 })
    return json({ ok: true, ...(await getDifyStatus()) })
  } } },
})
