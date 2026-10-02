import { describe, expect, it, vi } from 'vitest'

vi.mock('@tanstack/react-router', () => ({
  createFileRoute: () => (options: unknown) => options,
}))
vi.mock('../../server/auth-middleware', () => ({ isAuthenticated: () => true }))

const state = vi.hoisted(() => ({
  lastError: undefined as { at: number; message: string } | undefined,
  connectedAt: '2026-10-02T02:09:32.000Z',
}))
vi.mock('../../server/finance-store', () => ({
  readFinanceStore: () => ({
    settings: { gmailIngest: { lastError: state.lastError } },
  }),
}))
vi.mock('../../server/google-oauth', () => ({
  buildGmailConnectAuthUrl: vi.fn(),
  isGmailConnected: () => true,
  isGoogleOAuthEnabled: () => true,
  readGmailConnectedAccount: () => ({ email: 'me@example.test', connectedAt: state.connectedAt }),
  storeOAuthState: vi.fn(),
}))

async function check() {
  const { Route } = await import('./auth.gmail-connect')
  const handlers = (Route as any).server.handlers
  const res = (await handlers.GET({
    request: new Request('http://localhost/api/auth/gmail-connect?check=1'),
  })) as Response
  return (await res.json()) as { lastError: unknown }
}

describe('/api/auth/gmail-connect?check=1', () => {
  const connectedAtSeconds = Math.floor(Date.parse(state.connectedAt) / 1000)

  it('hides a sync error recorded before the current connection', async () => {
    state.lastError = { at: connectedAtSeconds - 480, message: 'Gmail needs reconnecting' }
    expect((await check()).lastError).toBeNull()
  })

  it('shows a sync error recorded after the current connection', async () => {
    state.lastError = { at: connectedAtSeconds + 60, message: 'Gmail needs reconnecting' }
    expect((await check()).lastError).toEqual(state.lastError)
  })
})
