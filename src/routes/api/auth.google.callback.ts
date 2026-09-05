import { createFileRoute } from '@tanstack/react-router'
import {
  GOOGLE_ALLOWED_EMAIL,
  consumeOAuthState,
  exchangeCodeForEmail,
  exchangeCodeForGmailTokens,
  isGoogleOAuthEnabled,
  storeGmailRefreshToken,
  storeUserProfile,
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

        // CSRF: verify state via server-side store (avoids cookie-transmission issues).
        // The state also carries which of the two flows this is — login or
        // Gmail-connect — since both share this one registered redirect_uri.
        const purpose = consumeOAuthState(state)
        if (!purpose) {
          return new Response(null, {
            status: 302,
            headers: { Location: '/?error=oauth_state' },
          })
        }

        if (purpose === 'gmail_connect') {
          try {
            const { refreshToken, email } =
              await exchangeCodeForGmailTokens(code)
            storeGmailRefreshToken(refreshToken, email)
            return new Response(null, {
              status: 302,
              headers: { Location: '/personal-finance?gmail=connected' },
            })
          } catch (err) {
            console.error('[auth/google/callback][gmail_connect]', err)
            return new Response(null, {
              status: 302,
              headers: { Location: '/personal-finance?gmail=error' },
            })
          }
        }

        try {
          const { email, name, picture } = await exchangeCodeForEmail(code)

          if (email.toLowerCase() !== GOOGLE_ALLOWED_EMAIL.toLowerCase()) {
            return new Response(null, {
              status: 302,
              headers: { Location: '/?error=unauthorized_email' },
            })
          }

          storeUserProfile({ email, name, picture })

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
