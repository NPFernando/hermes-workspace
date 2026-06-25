import path from 'node:path'
import os from 'node:os'
import fs from 'node:fs'
import { createFileRoute } from '@tanstack/react-router'
import { isAuthenticated } from '../../server/auth-middleware'

function jsonResponse(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

export const Route = createFileRoute('/api/openrouter-credits')({
  server: {
    handlers: {
      GET: async ({ request }) => {
        if (!isAuthenticated(request)) {
          return jsonResponse({ error: 'Unauthorized' }, 401)
        }

        const hermesHome =
          process.env.HERMES_HOME ?? path.join(os.homedir(), '.hermes')
        const envPath = path.join(hermesHome, '.env')

        // Read OPENROUTER_API_KEY from ~/.hermes/.env
        let apiKey = process.env.OPENROUTER_API_KEY ?? ''
        if (!apiKey && fs.existsSync(envPath)) {
          const envContent = fs.readFileSync(envPath, 'utf-8')
          const match = envContent.match(/^OPENROUTER_API_KEY=(.+)$/m)
          if (match) apiKey = match[1].trim().replace(/^["']|["']$/g, '')
        }

        if (!apiKey) {
          return jsonResponse({ error: 'OPENROUTER_API_KEY not configured' }, 503)
        }

        try {
          const resp = await fetch('https://openrouter.ai/api/v1/credits', {
            headers: { Authorization: `Bearer ${apiKey}` },
            signal: AbortSignal.timeout(10_000),
          })
          if (!resp.ok) {
            return jsonResponse({ error: `OpenRouter API error: ${resp.status}` }, 502)
          }
          const data = (await resp.json()) as { data?: Record<string, unknown> }
          const d = data.data ?? {}
          const total = parseFloat(String(d.total_credits ?? 0))
          const used = parseFloat(String(d.usage ?? 0))
          const remaining = Math.round((total - used) * 10000) / 10000

          let level: 'ok' | 'warning' | 'critical' | 'exhausted' = 'ok'
          if (remaining <= 0) level = 'exhausted'
          else if (remaining <= 0.5) level = 'critical'
          else if (remaining <= 2.0) level = 'warning'

          return jsonResponse({ total, used, remaining, level })
        } catch (err) {
          return jsonResponse({ error: String(err) }, 502)
        }
      },
    },
  },
})
