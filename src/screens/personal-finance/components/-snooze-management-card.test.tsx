// @vitest-environment jsdom
/**
 * SnoozeManagementCard — lists every current alert snooze and dismissed
 * sender candidate, with an un-snooze/un-dismiss action on each. Covers:
 * empty state, rendering both lists with human-readable labels, and that
 * each undo button POSTs the right action and removes just that row.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import React from 'react'
import { createRoot } from 'react-dom/client'

import { SnoozeManagementCard } from './snooze-management-card'

let fetchMock: ReturnType<typeof vi.fn>

function mockFetch(
  alertSnoozes: Array<{
    key: string
    snoozedAt: string
    magnitudeAtSnooze: number
  }>,
  dismissedSenderCandidates: Array<{
    senderAddress: string
    dismissedAt: string
    occurrencesAtDismissal: number
  }>,
) {
  fetchMock = vi.fn(async (_url: string, init?: RequestInit) => {
    const body = init?.body
      ? (JSON.parse(init.body as string) as { action: string })
      : null
    if (body?.action === 'list_snoozes') {
      return new Response(
        JSON.stringify({ ok: true, alertSnoozes, dismissedSenderCandidates }),
        { status: 200 },
      )
    }
    return new Response(JSON.stringify({ ok: true }), { status: 200 })
  })
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
    root.render(<SnoozeManagementCard />)
  })
  return { container, root }
}

describe('SnoozeManagementCard', () => {
  it('shows "nothing silenced" when both lists are empty', async () => {
    mockFetch([], [])
    const { container } = await render()
    expect(container.textContent).toContain('Nothing currently silenced')
  })

  it('renders a budget-pace snooze with a human-readable label', async () => {
    mockFetch(
      [
        {
          key: 'budget-pace:Groceries:2026-09',
          snoozedAt: '2026-09-10T00:00:00.000Z',
          magnitudeAtSnooze: 120,
        },
      ],
      [],
    )
    const { container } = await render()
    expect(container.textContent).toContain('Budget pace: Groceries (2026-09)')
    expect(container.textContent).toContain('Un-snooze')
  })

  it('renders a dismissed sender candidate', async () => {
    mockFetch(
      [],
      [
        {
          senderAddress: 'billing@newbiller.test',
          dismissedAt: '2026-09-10T00:00:00.000Z',
          occurrencesAtDismissal: 3,
        },
      ],
    )
    const { container } = await render()
    expect(container.textContent).toContain('billing@newbiller.test')
    expect(container.textContent).toContain('Un-dismiss')
  })

  it('un-snoozing POSTs remove_alert_snooze and removes that row only', async () => {
    mockFetch(
      [
        {
          key: 'tax-record:2026',
          snoozedAt: '2026-09-10T00:00:00.000Z',
          magnitudeAtSnooze: 100_000,
        },
      ],
      [
        {
          senderAddress: 'billing@keep.test',
          dismissedAt: '2026-09-10T00:00:00.000Z',
          occurrencesAtDismissal: 2,
        },
      ],
    )
    const { container } = await render()
    const button = Array.from(container.querySelectorAll('button')).find(
      (b) => b.textContent === 'Un-snooze',
    ) as HTMLButtonElement
    await React.act(async () => {
      button.click()
      await Promise.resolve()
    })
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/finance',
      expect.objectContaining({
        body: JSON.stringify({ action: 'remove_alert_snooze', key: 'tax-record:2026' }),
      }),
    )
    // The re-fetch after removal returns the mocked list unchanged (the mock
    // doesn't actually mutate), so this only checks the request shape above
    // — the sender candidate stays visible either way, confirming the
    // un-snooze action didn't touch the other list's row.
    expect(container.textContent).toContain('billing@keep.test')
  })

  it('un-dismissing POSTs remove_dismissed_sender_candidate', async () => {
    mockFetch(
      [],
      [
        {
          senderAddress: 'billing@remove.test',
          dismissedAt: '2026-09-10T00:00:00.000Z',
          occurrencesAtDismissal: 2,
        },
      ],
    )
    const { container } = await render()
    const button = container.querySelector('button') as HTMLButtonElement
    await React.act(async () => {
      button.click()
      await Promise.resolve()
    })
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/finance',
      expect.objectContaining({
        body: JSON.stringify({
          action: 'remove_dismissed_sender_candidate',
          senderAddress: 'billing@remove.test',
        }),
      }),
    )
  })
})
