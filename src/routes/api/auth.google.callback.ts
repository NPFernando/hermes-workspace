import { createFileRoute } from '@tanstack/react-router'
import {
  GOOGLE_ALLOWED_EMAIL,
  consumeOAuthState,
  exchangeCodeForEmail,
  isGoogleOAuthEnabled,
} from '../../server/google-oauth'
import {
  createSessionCookie,
  generateSessionToken,
  storeSessionToken,
} from '../../server/auth-middleware'

export const Route = createFileRoute('/api/auth/google/callback')({
  server: {
    handlers: {
      GET: async ({ request }) => {
        if (!isGoogleOAuthEnabled()) {
          return new Response(null, {
            status: 302,
            headers: { Location: '/?error=oauth_disabled' },
          })
        }

        const url = new URL(request.url)
        const code = url.searchParams.get('code')
        const state = url.searchParams.get('state')

        if (!code || !state) {
          return new Response(null, {
            status: 302,
            headers: { Location: '/?error=oauth_invalid' },
          })
        }

        // CSRF: verify state via server-side store (avoids cookie-transmission issues)
        if (!consumeOAuthState(state)) {
          return new Response(null, {
            status: 302,
            headers: { Location: '/?error=oauth_state' },
          })
        }

        try {
          const email = await exchangeCodeForEmail(code)

          if (email.toLowerCase() !== GOOGLE_ALLOWED_EMAIL.toLowerCase()) {
            return new Response(null, {
              status: 302,
              headers: { Location: '/?error=unauthorized_email' },
            })
          }

          const token = generateSessionToken()
          storeSessionToken(token, true) // 1-year for Google login

          const headers = new Headers({ Location: '/' })
          headers.append('Set-Cookie', createSessionCookie(token, true))
          return new Response(null, { status: 302, headers })
        } catch (err) {
          console.error('[auth/google/callback]', err)
          return new Response(null, {
            status: 302,
            headers: { Location: '/?error=oauth_failed' },
          })
        }
      },
    },
  },
})
