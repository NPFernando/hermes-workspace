import { createFileRoute } from '@tanstack/react-router'
import { randomBytes } from 'node:crypto'
import { buildGoogleAuthUrl, isGoogleOAuthEnabled, storeOAuthState } from '../../server/google-oauth'

export const Route = createFileRoute('/api/auth/google')({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const url = new URL(request.url)

        // ?check=1 — used by the login screen to detect if Google OAuth is configured
        if (url.searchParams.get('check') === '1') {
          return Response.json({ enabled: isGoogleOAuthEnabled() })
        }

        if (!isGoogleOAuthEnabled()) {
          return new Response('Google OAuth not configured', { status: 503 })
        }

        const state = randomBytes(16).toString('hex')
        storeOAuthState(state)
        const authUrl = buildGoogleAuthUrl(state)

        return new Response(null, {
          status: 302,
          headers: { Location: authUrl },
        })
      },
    },
  },
})
