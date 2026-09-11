// @vitest-environment jsdom
/**
 * GmailConnectionCard — the settings-level Gmail connection status card.
 * Covers: disabled state, connected/not-connected, and the "reconnect
 * needed" banner that's the whole reason this card exists (lastError
 * persists across page loads, unlike the transient toast in
 * PendingIngestionPanel).
 *
 * React.act + createRoot (not @testing-library/react) to dodge the vitest
 * ESM/CJS dual-React issue, matching -assistant-memory-card.test.tsx. No
 * react-query mock needed — this card is plain useState/useEffect/fetch.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import React from 'react'
import { createRoot } from 'react-dom/client'

import { GmailConnectionCard } from './gmail-connection-card'

type Status = {
  enabled: boolean
  connected: boolean
  email: string | null
  connectedAt: string | null
  lastSyncedAtSeconds: number | null
  syncHistory: Array<unknown>
  lastError: { at: number; message: string } | null
}

function status(over: Partial<Status> = {}): Status {
  return {
    enabled: true,
    connected: false,
    email: null,
    connectedAt: null,
    lastSyncedAtSeconds: null,
    syncHistory: [],
    lastError: null,
    ...over,
  }
}

let fetchMock: ReturnType<typeof vi.fn>

function mockCheckResponse(body: Status) {
  fetchMock = vi.fn(async () => new Response(JSON.stringify(body), { status: 200 }))
  vi.stubGlobal('fetch', fetchMock)
}

afterEach(() => {
  vi.unstubAllGlobals()
})

async function render() {
  const container = document.createElement('div')
  document.body.appendChild(container)
  const root = createRoot(container)
  await React.act(async () => {
    root.render(React.createElement(GmailConnectionCard))
  })
  await React.act(async () => {
    await Promise.resolve()
    await Promise.resolve()
  })
  return {
    container,
    unmount: async () => {
      await React.act(async () => root.unmount())
      document.body.removeChild(container)
    },
  }
}

describe('GmailConnectionCard', () => {
  it('shows a not-configured message when the server has no OAuth client set up', async () => {
    mockCheckResponse(status({ enabled: false }))
    const { container, unmount } = await render()
    expect(container.textContent).toContain('Not configured')
    await unmount()
  })

  it('shows "Not connected" with a Connect Gmail link when never connected', async () => {
    mockCheckResponse(status({ connected: false }))
    const { container, unmount } = await render()
    expect(container.textContent).toContain('Not connected')
    const link = container.querySelector('a')
    expect(link?.textContent).toBe('Connect Gmail')
    expect(link?.getAttribute('href')).toBe('/api/auth/gmail-connect')
    await unmount()
  })

  it('shows the connected email and last-synced time when healthy', async () => {
    mockCheckResponse(
      status({
        connected: true,
        email: 'fernandonaveen2000@gmail.com',
        lastSyncedAtSeconds: 1_700_000_000,
      }),
    )
    const { container, unmount } = await render()
    expect(container.textContent).toContain('Connected as fernandonaveen2000@gmail.com')
    expect(container.textContent).toContain('Last synced')
    const link = container.querySelector('a')
    expect(link?.textContent).toBe('Reconnect Gmail')
    await unmount()
  })

  it('shows the persistent reconnect banner when connected but the last sync recorded an error', async () => {
    mockCheckResponse(
      status({
        connected: true,
        email: 'fernandonaveen2000@gmail.com',
        lastError: { at: 1_700_000_000, message: 'invalid_grant: Token expired' },
      }),
    )
    const { container, unmount } = await render()
    expect(container.textContent).toContain('the last sync failed')
    expect(container.textContent).toContain('invalid_grant: Token expired')
    await unmount()
  })

  it('shows "Never synced" for a connected account that has not run a sync yet', async () => {
    mockCheckResponse(status({ connected: true, email: 'x@gmail.com' }))
    const { container, unmount } = await render()
    expect(container.textContent).toContain('Never synced')
    await unmount()
  })

  it('falls back to the not-configured card without throwing when the check request fails', async () => {
    // status stays null (the .catch fallback) — `!status?.enabled` is then
    // true, so it renders the same branch as enabled:false rather than
    // crashing or getting stuck on "Checking…".
    fetchMock = vi.fn(async () => {
      throw new Error('network down')
    })
    vi.stubGlobal('fetch', fetchMock)
    const { container, unmount } = await render()
    expect(container.textContent).toContain('Not configured')
    await unmount()
  })
})
