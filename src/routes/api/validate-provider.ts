/**
 * POST /api/validate-provider
 *
 * Validates an API key for a given provider by making a lightweight
 * authenticated request to the provider's models or auth endpoint.
 * Returns { ok: true } on success or { ok: false, error } on failure.
 */
import { createFileRoute } from '@tanstack/react-router'
import { json } from '@tanstack/react-start'
import { isAuthenticated } from '../../server/auth-middleware'
import {
  requireJsonContentType,
  safeErrorMessage,
} from '../../server/rate-limit'

type ProviderValidationResult = { ok: boolean; error?: string }

async function validateAnthropicKey(apiKey: string): Promise<ProviderValidationResult> {
  try {
    const res = await fetch('https://api.anthropic.com/v1/models', {
      headers: {
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
      },
      signal: AbortSignal.timeout(8000),
    })
    if (res.status === 401 || res.status === 403) return { ok: false, error: 'Invalid API key' }
    if (!res.ok) return { ok: false, error: `Provider returned ${res.status}` }
    return { ok: true }
  } catch (err) {
    return { ok: false, error: safeErrorMessage(err) }
  }
}

async function validateOpenRouterKey(apiKey: string): Promise<ProviderValidationResult> {
  try {
    const res = await fetch('https://openrouter.ai/api/v1/auth/key', {
      headers: { Authorization: `Bearer ${apiKey}` },
      signal: AbortSignal.timeout(8000),
    })
    if (res.status === 401 || res.status === 403) return { ok: false, error: 'Invalid API key' }
    if (!res.ok) return { ok: false, error: `Provider returned ${res.status}` }
    return { ok: true }
  } catch (err) {
    return { ok: false, error: safeErrorMessage(err) }
  }
}

async function validateOpenAIKey(apiKey: string): Promise<ProviderValidationResult> {
  try {
    const res = await fetch('https://api.openai.com/v1/models', {
      headers: { Authorization: `Bearer ${apiKey}` },
      signal: AbortSignal.timeout(8000),
    })
    if (res.status === 401 || res.status === 403) return { ok: false, error: 'Invalid API key' }
    if (!res.ok) return { ok: false, error: `Provider returned ${res.status}` }
    return { ok: true }
  } catch (err) {
    return { ok: false, error: safeErrorMessage(err) }
  }
}

export const Route = createFileRoute('/api/validate-provider')({
  server: {
    handlers: {
      POST: async ({ request }) => {
        if (!isAuthenticated(request)) {
          return json({ ok: false, error: 'Unauthorized' }, { status: 401 })
        }
        const csrfCheck = requireJsonContentType(request)
        if (csrfCheck) return csrfCheck

        let providerId: string, apiKey: string
        try {
          const body = (await request.json()) as { providerId?: string; apiKey?: string }
          providerId = typeof body.providerId === 'string' ? body.providerId.trim() : ''
          apiKey = typeof body.apiKey === 'string' ? body.apiKey.trim() : ''
        } catch {
          return json({ ok: false, error: 'Invalid JSON body' }, { status: 400 })
        }

        if (!providerId || !apiKey) {
          return json({ ok: false, error: 'providerId and apiKey are required' }, { status: 400 })
        }

        let result: ProviderValidationResult
        switch (providerId) {
          case 'anthropic':
            result = await validateAnthropicKey(apiKey)
            break
          case 'openrouter':
            result = await validateOpenRouterKey(apiKey)
            break
          case 'openai':
            result = await validateOpenAIKey(apiKey)
            break
          default:
            result = { ok: false, error: `Unknown provider: ${providerId}` }
        }

        return json(result, { status: result.ok ? 200 : 400 })
      },
    },
  },
})
