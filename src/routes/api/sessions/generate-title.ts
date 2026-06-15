import { createFileRoute } from '@tanstack/react-router'
import { json } from '@tanstack/react-start'
import { isAuthenticated } from '../../../server/auth-middleware'
import { openaiChat } from '../../../server/openai-compat-api'

const MAX_MSG_CHARS = 600
const MAX_TITLE_LENGTH = 60

const TITLE_PROMPT_TEMPLATE = (lines: string) =>
  `Read this conversation and write a 2-5 word title that describes its topic. Reply with the title ONLY — no quotes, no explanation, nothing else.\n\n${lines}\n\nTitle:`

function truncate(text: string, max: number): string {
  const trimmed = text.trim()
  return trimmed.length <= max ? trimmed : `${trimmed.slice(0, max - 1).trimEnd()}…`
}

export const Route = createFileRoute('/api/sessions/generate-title')({
  server: {
    handlers: {
      POST: async ({ request }) => {
        if (!isAuthenticated(request)) {
          return json({ ok: false, error: 'Unauthorized' }, { status: 401 })
        }

        let body: { messages?: Array<{ role: string; content: string }> }
        try {
          body = (await request.json()) as typeof body
        } catch {
          return json({ ok: false, error: 'Invalid JSON' }, { status: 400 })
        }

        const messages = body.messages
        if (!Array.isArray(messages) || messages.length === 0) {
          return json({ ok: false, error: 'messages required' }, { status: 400 })
        }

        // Take first user + first assistant message for context
        const context = messages.slice(0, 2).map((m) => ({
          role: m.role,
          content: truncate(String(m.content ?? ''), MAX_MSG_CHARS),
        }))

        try {
          const lines = context
            .map((m) => `${m.role === 'user' ? 'User' : 'Assistant'}: ${m.content}`)
            .join('\n')
          const raw = await openaiChat(
            [{ role: 'user', content: TITLE_PROMPT_TEMPLATE(lines) }],
            { stream: false, max_tokens: 20, temperature: 0.3 },
          )
          const title = truncate(raw.replace(/^["']|["']$/g, '').trim(), MAX_TITLE_LENGTH)
          if (!title) throw new Error('empty title from model')
          return json({ ok: true, title })
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err ?? 'Unknown error')
          return json({ ok: false, error: message }, { status: 500 })
        }
      },
    },
  },
})
