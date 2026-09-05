import { randomBytes } from 'node:crypto'
import { createFileRoute } from '@tanstack/react-router'
import { isAuthenticated } from '../../server/auth-middleware'
import { readFinanceStore } from '../../server/finance-store'
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
          const db = readFinanceStore()
          const gmailIngest = (db.settings as Record<string, unknown>)
            .gmailIngest as
            | {
                lastSyncedAtSeconds?: number
                syncHistory?: Array<{
                  at: number
                  found: number
                  queued: number
                  skippedAlreadyQueued: number
                }>
              }
            | undefined
          return Response.json({
            enabled: isGoogleOAuthEnabled(),
            connected: isGmailConnected(),
            lastSyncedAtSeconds: gmailIngest?.lastSyncedAtSeconds ?? null,
            syncHistory: gmailIngest?.syncHistory ?? [],
          })
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
