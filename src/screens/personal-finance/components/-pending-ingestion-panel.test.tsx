// @vitest-environment jsdom
/**
 * PendingIngestionPanel — review queue shows only items needing a decision;
 * duplicates are hidden behind a count, rule-recorded items get an Undo, and
 * confirming a Gmail item from a known sender asks the server to create an
 * automatic rule (unless the user unticks it).
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import React from 'react'
import { createRoot } from 'react-dom/client'

import { PendingIngestionPanel } from './pending-ingestion-panel'
import type { PendingIngestion, PersonalFinancePayload } from '../types'

const bill = {
  kind: 'expense' as const,
  amount: 2840.48,
  currency: 'LKR',
  vendorOrSource: 'Dialog',
  date: '2026-09-10',
  confidence: 'high' as const,
}

const queue: Array<PendingIngestion> = [
  {
    id: 'review-1',
    status: 'awaiting_review',
    source: 'gmail',
    documentType: 'transaction',
    senderAddress: 'billing@dialog.test',
    matchedSenderLabel: 'Dialog Mobile',
    extracted: bill,
  },
  {
    id: 'dup-1',
    status: 'duplicate',
    source: 'gmail',
    documentType: 'transaction',
    extracted: bill,
  },
  {
    id: 'auto-1',
    status: 'auto_confirmed',
    source: 'gmail',
    documentType: 'transaction',
    extracted: { ...bill, vendorOrSource: 'CEB', amount: 544.43 },
  },
  {
    id: 'done-1',
    status: 'confirmed',
    source: 'gmail',
    documentType: 'transaction',
    extracted: { ...bill, vendorOrSource: 'Old confirmed' },
  },
]

let posts: Array<Record<string, unknown>> = []

function mockFetch() {
  posts = []
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init?: RequestInit) => {
      if (url.startsWith('/api/auth/gmail-connect'))
        return new Response(JSON.stringify({ connected: true }))
      const body = JSON.parse((init?.body as string) || '{}') as Record<
        string,
        unknown
      >
      posts.push(body)
      if (body.action === 'list_pending_ingestions')
        return new Response(JSON.stringify({ ok: true, pendingIngestions: queue }))
      if (body.action === 'list_ingestion_rules')
        return new Response(
          JSON.stringify({
            ok: true,
            rules: [
              {
                id: 'rule-1',
                label: 'EDL Electricity',
                kind: 'expense',
                vendorOrSource: 'CEB',
                enabled: true,
                maxAmount: 10000,
                matchCount: 2,
                createdAt: '',
                updatedAt: '',
              },
            ],
          }),
        )
      return new Response(JSON.stringify({ ok: true }))
    }),
  )
}

afterEach(() => {
  vi.unstubAllGlobals()
  document.body.innerHTML = ''
})

async function render() {
  const container = document.createElement('div')
  document.body.appendChild(container)
  const root = createRoot(container)
  const onConfirmed = vi.fn()
  await React.act(async () => {
    root.render(
      <PendingIngestionPanel
        payload={{} as PersonalFinancePayload}
        onConfirmed={onConfirmed}
      />,
    )
  })
  return { container, onConfirmed }
}

describe('PendingIngestionPanel', () => {
  it('shows only items needing review, hides duplicates behind a count, and lists auto-added items and rules', async () => {
    mockFetch()
    const { container } = await render()
    const buttons = [...container.querySelectorAll('button')].map((b) => b.textContent)
    expect(buttons.filter((t) => t === 'Confirm')).toHaveLength(1)
    expect(container.textContent).not.toContain('Old confirmed')
    expect(container.querySelector('[data-testid="duplicates"]')?.textContent).toContain(
      '1 duplicate hidden',
    )
    expect(container.querySelector('[data-testid="auto-added"]')?.textContent).toContain('CEB')
    expect(container.querySelector('[data-testid="auto-rules"]')?.textContent).toContain(
      'EDL Electricity',
    )
    expect(container.textContent).toContain(
      'Record future bills from Dialog Mobile automatically',
    )
  })

  it('confirms with autoRule on by default, and off when unticked', async () => {
    mockFetch()
    const { container } = await render()
    const confirm = () =>
      [...container.querySelectorAll('button')].find((b) => b.textContent === 'Confirm')!
    await React.act(async () => {
      confirm().click()
    })
    expect(posts.find((p) => p.action === 'confirm_pending_ingestion')?.autoRule).toBe(true)

    posts.length = 0
    const checkbox = container.querySelector<HTMLInputElement>('input[type="checkbox"]')!
    await React.act(async () => {
      checkbox.click()
    })
    await React.act(async () => {
      confirm().click()
    })
    expect(posts.find((p) => p.action === 'confirm_pending_ingestion')?.autoRule).toBe(false)
  })

  it('Undo posts undo_auto_ingestion for the auto-added item', async () => {
    mockFetch()
    const { container } = await render()
    const undo = [...container.querySelectorAll('button')].find((b) => b.textContent === 'Undo')!
    await React.act(async () => {
      undo.click()
    })
    expect(posts).toContainEqual({ action: 'undo_auto_ingestion', id: 'auto-1' })
  })
})
