import { randomBytes } from 'node:crypto'
import { createFileRoute } from '@tanstack/react-router'
import { isAuthenticated } from '../../server/auth-middleware'
import {
  buildGmailConnectAuthUrl,
  isGmailConnected,
  isGoogleOAuthEnabled,
  storeOAuthState,
} from '../../server/google-oauth'

export const Route = createFileRoute('/api/auth/gmail-connect')({
  server: {
    handlers: {
      GET: ({ request }) => {
        if (!isAuthenticated(request)) {
          return new Response('Unauthorized', { status: 401 })
        }

        const url = new URL(request.url)
        if (url.searchParams.get('check') === '1') {
          return Response.json({ enabled: isGoogleOAuthEnabled(), connected: isGmailConnected() })
        }

        if (!isGoogleOAuthEnabled()) {
          return new Response('Google OAuth not configured', { status: 503 })
        }

        const state = randomBytes(16).toString('hex')
        storeOAuthState(state, 'gmail_connect')
        return new Response(null, {
          status: 302,
          headers: { Location: buildGmailConnectAuthUrl(state) },
        })
      },
    },
  },
})
