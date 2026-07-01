/**
 * GET/PATCH /api/gateway/agents
 *
 * Proxy to the upstream gateway's /api/agents endpoint when available.
 * Falls back to the sisters registry so the Agents screen always gets
 * a clean JSON response instead of an HTML 404.
 */
import { createFileRoute } from '@tanstack/react-router'
import { json } from '@tanstack/react-start'
import { isAuthenticated } from '../../../server/auth-middleware'
import {
  requireJsonContentType,
  safeErrorMessage,
} from '../../../server/rate-limit'
import { gatewayFetch } from '../../../server/gateway-capabilities'
import { listSisters } from '../../../server/sisters-registry'

type AgentEntry = {
  id: string
  name: string
  role?: string
  category?: string
  color?: string
  [key: string]: unknown
}

function sistersAsAgents(): Array<AgentEntry> {
  try {
    return listSisters().map((s) => ({
      id: s.id,
      name: s.name,
      role: s.description.split('.').at(0) ?? s.type,
      category: s.type === 'business_agent' ? 'Business' : 'Core',
      color: s.id === 'astra' ? 'orange' : undefined,
    }))
  } catch {
    return []
  }
}

export const Route = createFileRoute('/api/gateway/agents')({
  server: {
    handlers: {
      GET: async ({ request }) => {
        if (!isAuthenticated(request)) {
          return json({ ok: false, error: 'Unauthorized' }, { status: 401 })
        }

        const url = new URL(request.url)
        const agentId = url.searchParams.get('agentId')

        // Try the upstream gateway first
        try {
          const path = agentId ? `/api/agents?agentId=${encodeURIComponent(agentId)}` : '/api/agents'
          const res = await gatewayFetch(path)
          if (res.ok) {
            const data = await res.json().catch(() => null)
            if (data) return json({ ok: true, data })
          }
        } catch {
          // fall through
        }

        // Fallback: serve sisters registry as agent list
        if (agentId) {
          const agents = sistersAsAgents()
          const found = agents.find(
            (a) => a.id === agentId || a.name.toLowerCase() === agentId.toLowerCase(),
          )
          return json({
            ok: true,
            data: found ?? null,
            source: 'local',
          })
        }

        return json({
          ok: true,
          data: {
            defaultId: 'astra',
            agents: sistersAsAgents(),
            source: 'local',
          },
        })
      },

      PATCH: async ({ request }) => {
        if (!isAuthenticated(request)) {
          return json({ ok: false, error: 'Unauthorized' }, { status: 401 })
        }
        const csrfCheck = requireJsonContentType(request)
        if (csrfCheck) return csrfCheck

        try {
          const body = await request.json()
          const res = await gatewayFetch('/api/agents', {
            method: 'PATCH',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify(body),
          })
          if (res.status === 404) {
            return json({ ok: false, error: 'Gateway does not support agent config updates' }, { status: 404 })
          }
          const payload = await res.json().catch(() => ({ ok: true }))
          return json(payload, { status: res.ok ? 200 : res.status })
        } catch (err) {
          return json(
            { ok: false, error: safeErrorMessage(err) },
            { status: 502 },
          )
        }
      },
    },
  },
})
