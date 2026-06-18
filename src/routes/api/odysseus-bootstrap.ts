import { json } from '@tanstack/react-start'
import { createFileRoute } from '@tanstack/react-router'
import { isAuthenticated } from '../../server/auth-middleware'

const ODYSSEUS_BASE = 'http://127.0.0.1:7100'

export const Route = createFileRoute('/api/odysseus-bootstrap')({
  server: {
    handlers: {
      POST: async ({ request }) => {
        if (!isAuthenticated(request)) {
          return json({ ok: false, error: 'Unauthorized' }, { status: 401 })
        }

        try {
          // Check if Odysseus already has LLM endpoints configured
          const listRes = await fetch(`${ODYSSEUS_BASE}/api/model-endpoints`)
          if (!listRes.ok) {
            return json({ ok: false, error: 'Odysseus unreachable' }, { status: 502 })
          }
          const endpoints = (await listRes.json()) as Array<unknown>
          if (Array.isArray(endpoints) && endpoints.length > 0) {
            return json({ ok: true, created: false, existing: endpoints.length })
          }

          // Register the Hermes gateway as the default LLM endpoint
          const apiKey = process.env['HERMES_API_TOKEN'] ?? ''
          const form = new URLSearchParams()
          form.set('base_url', 'http://127.0.0.1:8642/v1')
          form.set('name', 'Hermes Gateway')
          form.set('api_key', apiKey)
          form.set('skip_probe', 'false')

          const createRes = await fetch(`${ODYSSEUS_BASE}/api/model-endpoints`, {
            method: 'POST',
            headers: { 'content-type': 'application/x-www-form-urlencoded' },
            body: form.toString(),
          })

          if (!createRes.ok) {
            const body = await createRes.text()
            return json({ ok: false, error: `Registration failed: ${body}` }, { status: 500 })
          }

          return json({ ok: true, created: true })
        } catch (err) {
          const message = err instanceof Error ? err.message : 'Unknown error'
          return json({ ok: false, error: message }, { status: 500 })
        }
      },
    },
  },
})
