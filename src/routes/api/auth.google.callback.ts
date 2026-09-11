import { createFileRoute } from '@tanstack/react-router'
import {
  GOOGLE_ALLOWED_EMAIL,
  clearOAuthStateCookie,
  consumeOAuthState,
  exchangeCodeForEmail,
  exchangeCodeForGmailTokens,
  getOAuthStateCookie,
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
        const redirect = (location: string, sessionCookie?: string) => {
          const headers = new Headers({ Location: location })
          headers.append('Set-Cookie', clearOAuthStateCookie())
          if (sessionCookie) headers.append('Set-Cookie', sessionCookie)
          return new Response(null, { status: 302, headers })
        }

        if (!isGoogleOAuthEnabled()) {
          return redirect('/?error=oauth_disabled')
        }

        const url = new URL(request.url)
        const code = url.searchParams.get('code')
        const state = url.searchParams.get('state')

        if (!code || !state) {
          return redirect('/?error=oauth_invalid')
        }

        if (getOAuthStateCookie(request.headers.get('cookie')) !== state) {
          return redirect('/?error=oauth_state')
        }

        // CSRF: verify state via server-side store (avoids cookie-transmission issues).
        // The state also carries which of the two flows this is — login or
        // Gmail-connect — since both share this one registered redirect_uri.
        const purpose = consumeOAuthState(state)
        if (!purpose) {
          return redirect('/?error=oauth_state')
        }

        if (purpose === 'gmail_connect') {
          try {
            const { refreshToken, email } =
              await exchangeCodeForGmailTokens(code)
            storeGmailRefreshToken(refreshToken, email)
            return redirect('/personal-finance?gmail=connected')
          } catch (err) {
            console.error('[auth/google/callback][gmail_connect]', err)
            return redirect('/personal-finance?gmail=error')
          }
        }

        try {
          const { email, name, picture } = await exchangeCodeForEmail(code)

          if (email.toLowerCase() !== GOOGLE_ALLOWED_EMAIL.toLowerCase()) {
            return redirect('/?error=unauthorized_email')
          }

          storeUserProfile({ email, name, picture })

          const token = generateSessionToken()
          storeSessionToken(token, true) // 1-year for Google login

          return redirect('/', createSessionCookie(token, true))
        } catch (err) {
          console.error('[auth/google/callback]', err)
          return redirect('/?error=oauth_failed')
        }
      },
    },
  },
})
