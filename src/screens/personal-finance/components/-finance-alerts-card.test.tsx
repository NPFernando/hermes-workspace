// @vitest-environment jsdom
/**
 * FinanceAlertsCard — renders the aggregated alert list from financeAlerts()
 * / financeStorageAlerts(). Covers: empty state (renders nothing), plain
 * alerts with no dismissKey (no Snooze button), and the FX-exposure-style
 * snoozable alert (Snooze button POSTs snooze_fx_exposure_alert and
 * optimistically removes the alert from view).
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import React from 'react'
import { createRoot } from 'react-dom/client'

import { FinanceAlertsCard } from './finance-alerts-card'
import type { PersonalFinancePayload } from '../types'

function payload(
  alerts: PersonalFinancePayload['alerts'],
): PersonalFinancePayload {
  return { alerts } as unknown as PersonalFinancePayload
}

let fetchMock: ReturnType<typeof vi.fn>

function mockFetch() {
  fetchMock = vi.fn(async () => new Response(JSON.stringify({ ok: true }), { status: 200 }))
  vi.stubGlobal('fetch', fetchMock)
}

afterEach(() => {
  vi.unstubAllGlobals()
})

async function render(p: PersonalFinancePayload) {
  const container = document.createElement('div')
  document.body.appendChild(container)
  const root = createRoot(container)
  await React.act(async () => {
    root.render(<FinanceAlertsCard payload={p} />)
  })
  return { container, root }
}

describe('FinanceAlertsCard', () => {
  it('renders nothing when there are no alerts', async () => {
    mockFetch()
    const { container } = await render(payload([]))
    expect(container.textContent).toBe('')
  })

  it('renders a plain alert with no Snooze button', async () => {
    mockFetch()
    const { container } = await render(
      payload([
        { level: 'warning', title: 'Over budget: Groceries', detail: 'Spent too much.' },
      ]),
    )
    expect(container.textContent).toContain('Over budget: Groceries')
    expect(container.textContent).not.toContain('Snooze')
  })

  it('shows a Snooze button on an alert with a dismissKey', async () => {
    mockFetch()
    const { container } = await render(
      payload([
        {
          level: 'warning',
          title: 'FX exposure: AAPL',
          detail: 'USD has moved against this holding by 16.7% of its cost basis.',
          dismissKey: 'h-1',
        },
      ]),
    )
    expect(container.textContent).toContain('Snooze')
  })

  it('POSTs snooze_fx_exposure_alert with the holdingId and parsed fxPct, and removes the alert', async () => {
    mockFetch()
    const { container } = await render(
      payload([
        {
          level: 'warning',
          title: 'FX exposure: AAPL',
          detail: 'USD has moved against this holding by 16.7% of its cost basis.',
          dismissKey: 'h-1',
        },
      ]),
    )
    const button = container.querySelector('button') as HTMLButtonElement
    await React.act(async () => {
      button.click()
      await Promise.resolve()
    })
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/finance',
      expect.objectContaining({
        body: JSON.stringify({
          action: 'snooze_fx_exposure_alert',
          holdingId: 'h-1',
          fxPct: 16.7,
        }),
      }),
    )
    expect(container.textContent).toBe('')
  })

  it('leaves other alerts visible after snoozing one', async () => {
    mockFetch()
    const { container } = await render(
      payload([
        {
          level: 'warning',
          title: 'FX exposure: AAPL',
          detail: 'USD has moved against this holding by 16.7% of its cost basis.',
          dismissKey: 'h-1',
        },
        { level: 'critical', title: 'Over budget: Rent', detail: 'Over.' },
      ]),
    )
    const button = container.querySelector('button') as HTMLButtonElement
    await React.act(async () => {
      button.click()
      await Promise.resolve()
    })
    expect(container.textContent).not.toContain('FX exposure')
    expect(container.textContent).toContain('Over budget: Rent')
  })
})
