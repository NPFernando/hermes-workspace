/**
 * POST /api/debug-analyze
 *
 * Takes terminal output and returns a structured AI-powered debug analysis:
 * { summary, rootCause, suggestedCommands, docsLink }
 *
 * Uses the Hermes gateway via the OpenAI-compatible chat API.
 * Falls back to a static parse if the gateway is unavailable.
 */
import { createFileRoute } from '@tanstack/react-router'
import { json } from '@tanstack/react-start'
import { isAuthenticated } from '../../server/auth-middleware'
import { requireJsonContentType } from '../../server/rate-limit'
import { openaiChat } from '../../server/openai-compat-api'
import { getCapabilities } from '../../server/gateway-capabilities'

const SYSTEM_PROMPT = `You are a terminal error analyst. Analyze the provided terminal output and return a JSON object with these exact fields:
{
  "summary": "One sentence describing what failed",
  "rootCause": "The specific root cause in 1-2 sentences",
  "suggestedCommands": [
    { "command": "the-command --to-run", "description": "What this command does" }
  ],
  "docsLink": "optional URL to relevant docs (omit if not applicable)"
}

Rules:
- Respond ONLY with valid JSON, no markdown fences
- suggestedCommands should be 1-3 concrete, runnable commands
- Focus on actionable remediation, not just describing the error`

function staticFallback(terminalOutput: string): {
  summary: string
  rootCause: string
  suggestedCommands: Array<{ command: string; description: string }>
} {
  const lines = terminalOutput.split('\n')
  const errorLine = lines.find((l) => /error|Error|ERROR|failed|FAILED/i.test(l)) ?? lines.at(-1) ?? ''
  return {
    summary: 'Terminal command failed',
    rootCause: errorLine.trim().slice(0, 200) || 'Unknown error',
    suggestedCommands: [],
  }
}

export const Route = createFileRoute('/api/debug-analyze')({
  server: {
    handlers: {
      POST: async ({ request }) => {
        if (!isAuthenticated(request)) {
          return json({ ok: false, error: 'Unauthorized' }, { status: 401 })
        }
        const csrfCheck = requireJsonContentType(request)
        if (csrfCheck) return csrfCheck

        let terminalOutput: string
        try {
          const body = (await request.json()) as { terminalOutput?: string }
          terminalOutput = typeof body.terminalOutput === 'string' ? body.terminalOutput.trim() : ''
        } catch {
          return json({ ok: false, error: 'Invalid JSON body' }, { status: 400 })
        }

        if (!terminalOutput) {
          return json({ ok: false, error: 'terminalOutput is required' }, { status: 400 })
        }

        // Truncate to avoid token limits
        const truncated = terminalOutput.length > 4000
          ? terminalOutput.slice(-4000)
          : terminalOutput

        const caps = getCapabilities()
        if (!caps.chatCompletions && !caps.health) {
          return json({ ...staticFallback(truncated), source: 'static' })
        }

        try {
          const raw = await openaiChat(
            [
              { role: 'system', content: SYSTEM_PROMPT },
              { role: 'user', content: `Terminal output:\n\`\`\`\n${truncated}\n\`\`\`` },
            ],
            { stream: false },
          )

          const content = typeof raw === 'string' ? raw.trim() : ''
          // Strip markdown fences if model added them anyway
          const cleaned = content.replace(/^```(?:json)?\n?/i, '').replace(/\n?```$/i, '').trim()
          const parsed = JSON.parse(cleaned) as {
            summary?: string
            rootCause?: string
            suggestedCommands?: Array<{ command: string; description: string }>
            docsLink?: string
          }

          return json({
            summary: parsed.summary ?? 'Analysis complete',
            rootCause: parsed.rootCause ?? 'See terminal output',
            suggestedCommands: Array.isArray(parsed.suggestedCommands) ? parsed.suggestedCommands : [],
            docsLink: parsed.docsLink,
          })
        } catch {
          // If the AI call or JSON parse fails, fall back to static
          return json(staticFallback(truncated))
        }
      },
    },
  },
})
