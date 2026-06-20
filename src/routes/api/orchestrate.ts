import { createFileRoute } from '@tanstack/react-router'
import { json } from '@tanstack/react-start'
import { isAuthenticated } from '../../server/auth-middleware'
import { listSisters } from '../../server/sisters-registry'
import { BEARER_TOKEN, CLAUDE_API } from '../../server/gateway-capabilities'
import { classifyMultiple, classifyOne } from '../../lib/sister-routing'

function authHeaders(): Record<string, string> {
  return BEARER_TOKEN ? { Authorization: `Bearer ${BEARER_TOKEN}` } : {}
}

// Single completions call — one request, no parallel session conflicts.
// Uses user-role only (avoids 403 from system-role restrictions on some models).
async function callOrchestration(
  message: string,
  sisters: Array<{ name: string; emoji: string; description: string }>,
): Promise<string> {
  const sisterLines = sisters
    .map((s) => `- ${s.emoji} ${s.name} (${s.description})`)
    .join('\n')

  const prompt =
    `You are Astra, an AI orchestrator coordinating specialist agents. ` +
    `Respond to the following task from the perspective of each specialist below. ` +
    `Each specialist gives a focused 2-3 sentence response from their expertise. ` +
    `End with a 2-sentence synthesis.\n\n` +
    `Task: "${message}"\n\n` +
    `Specialists:\n${sisterLines}\n\n` +
    `Format:\n## [Specialist Name]\n[response]\n\n## Astra — Synthesis\n[synthesis]`

  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), 90_000)
  try {
    const res = await fetch(`${CLAUDE_API}/v1/chat/completions`, {
      method: 'POST',
      headers: { ...authHeaders(), 'Content-Type': 'application/json' },
      body: JSON.stringify({
        messages: [{ role: 'user', content: prompt }],
        max_tokens: 700,
      }),
      signal: controller.signal,
    })
    if (!res.ok) {
      const text = await res.text().catch(() => '')
      throw new Error(`completions ${res.status}: ${text.slice(0, 100)}`)
    }
    const data = await res.json() as { choices?: Array<{ message?: { content?: string } }> }
    return data.choices?.[0]?.message?.content?.trim() ?? ''
  } finally {
    clearTimeout(timer)
  }
}

export const Route = createFileRoute('/api/orchestrate')({
  server: {
    handlers: {
      POST: async ({ request }) => {
        if (!isAuthenticated(request)) {
          return json({ ok: false, error: 'Unauthorized' }, { status: 401 })
        }

        let message = ''
        try {
          const body = await request.json() as { message?: unknown }
          message = typeof body.message === 'string' ? body.message.trim() : ''
        } catch {
          return json({ ok: false, error: 'invalid body' }, { status: 400 })
        }

        if (!message) {
          return json({ ok: false, error: 'message required' }, { status: 400 })
        }

        // Check for multi-sister orchestration first
        const multiScores = classifyMultiple(message)

        if (multiScores.length >= 2) {
          const allSisters = listSisters()
          const matched = multiScores
            .slice(0, 3)
            .map((s) => allSisters.find((sr) => sr.id === s.id))
            .filter((sr): sr is NonNullable<typeof sr> => Boolean(sr))

          if (matched.length >= 2) {
            let rawContent = ''
            try {
              rawContent = await callOrchestration(message, matched.map((s) => ({
                name: s.name,
                emoji: s.emoji,
                description: s.description,
              })))
            } catch (err) {
              console.error('[orchestrate] callOrchestration failed:', err)
            }

            if (rawContent) {
              const names = matched.map((s) => s.name).join(', ')
              const preamble = `> 🌟 **Astra** — Coordinating with ${names}\n\n`
              return json({ orchestrated: true, content: preamble + rawContent })
            }
            // Fall through to single-sister if orchestration failed
          }
        }

        // Single-sister routing — fold in what /api/route-sister used to do
        const { sister_id, reason } = classifyOne(message)
        return json({ orchestrated: false, sister_id, reason })
      },
    },
  },
})
