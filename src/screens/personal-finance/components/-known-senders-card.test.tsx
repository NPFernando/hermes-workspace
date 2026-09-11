// @vitest-environment jsdom
/**
 * KnownSendersCard — Gmail known-sender registry management (add/edit/
 * delete, set/clear password). Covers: empty state, list rendering
 * (never shows the encrypted password, only hasPassword), add-sender
 * validation + the upsert_known_sender POST, and set_known_sender_password
 * wiring.
 *
 * React.act + createRoot, no react-query mock needed — plain fetch card,
 * same pattern as -gmail-connection-card.test.tsx.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import React from 'react'
import { createRoot } from 'react-dom/client'

import { KnownSendersCard } from './known-senders-card'
import type { KnownSender } from '../types'

function sender(over: Partial<KnownSender> = {}): KnownSender {
  return {
    id: 's-1',
    label: 'ComBank',
    matchAddress: 'e-statement@example-bank.test',
    hasPassword: false,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...over,
  }
}

let fetchMock: ReturnType<typeof vi.fn>

/** Every call after the first (the initial list_known_senders load) gets `nextResponses` in order; the list load always returns `senders`. */
function mockFetch(senders: Array<KnownSender>, ...nextResponses: Array<unknown>) {
  let call = 0
  fetchMock = vi.fn(async (_url: string, init?: RequestInit) => {
    const body = init?.body ? (JSON.parse(init.body as string) as { action: string }) : null
    if (body?.action === 'list_known_senders') {
      // Re-fetched after every mutation too — always return the latest
      // `senders` the test configured, not just on the first call.
      return new Response(JSON.stringify({ ok: true, knownSenders: senders }), {
        status: 200,
      })
    }
    const next = nextResponses[call] ?? { ok: true }
    call += 1
    return new Response(JSON.stringify(next), { status: 200 })
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
    root.render(React.createElement(KnownSendersCard))
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

function click(el: Element | null | undefined) {
  return React.act(async () => {
    el!.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    await Promise.resolve()
  })
}

function button(container: HTMLElement, text: string) {
  return [...container.querySelectorAll('button')].find((b) => b.textContent === text)
}

function bodyOf(call: Array<unknown>): { action?: string } | null {
  const init = call[1] as RequestInit | undefined
  return init?.body ? JSON.parse(init.body as string) : null
}

function findCall(action: string) {
  return fetchMock.mock.calls.find((call) => bodyOf(call)?.action === action)
}

// React patches HTMLInputElement's `value` setter to track changes for its
// synthetic event system. Assigning `.value` directly goes through that same
// patched setter, so React's tracker sees "no change" and never fires
// onChange when the 'input' event is dispatched afterward. Using the
// *native* prototype setter (captured before React patches it, or just
// always the real one via getOwnPropertyDescriptor) bypasses that tracker.
function setInputValue(input: HTMLInputElement, value: string) {
  const nativeSetter = Object.getOwnPropertyDescriptor(
    window.HTMLInputElement.prototype,
    'value',
  )!.set!
  nativeSetter.call(input, value)
  input.dispatchEvent(new Event('input', { bubbles: true }))
}

describe('KnownSendersCard', () => {
  it('shows an empty-state message when there are no senders', async () => {
    mockFetch([])
    const { container, unmount } = await render()
    expect(container.textContent).toContain('No senders registered yet.')
    await unmount()
  })

  it('renders a sender with hasPassword status, never a password value', async () => {
    mockFetch([sender({ hasPassword: true, passwordScheme: 'date of birth' })])
    const { container, unmount } = await render()
    expect(container.textContent).toContain('ComBank')
    expect(container.textContent).toContain('e-statement@example-bank.test')
    expect(container.textContent).toContain('date of birth')
    expect(container.textContent).toContain('Password set — auto-unlock enabled')
    // No password input anywhere carries a real secret — only the draft field, which starts empty.
    const passwordInputs = [
      ...container.querySelectorAll('input[type="password"]'),
    ] as Array<HTMLInputElement>
    expect(passwordInputs.every((i) => i.value === '')).toBe(true)
    await unmount()
  })

  it('shows the "Clear password" button only when hasPassword is true', async () => {
    mockFetch([sender({ hasPassword: false })])
    const { container, unmount } = await render()
    expect(button(container, 'Clear password')).toBeUndefined()
    await unmount()
  })

  it('rejects an Add-sender save with no label', async () => {
    mockFetch([])
    const { container, unmount } = await render()
    await click(button(container, 'Add sender'))
    await click(button(container, 'Save'))
    expect(container.textContent).toContain('Label is required.')
    // No upsert POST should have gone out.
    expect(findCall('upsert_known_sender')).toBeUndefined()
    await unmount()
  })

  it('rejects an Add-sender save with a label but no domain/address', async () => {
    mockFetch([])
    const { container, unmount } = await render()
    await click(button(container, 'Add sender'))
    const labelInput = container.querySelector(
      'input[placeholder^="Label"]',
    ) as HTMLInputElement
    await React.act(async () => {
      setInputValue(labelInput, 'New Bank')
    })
    await click(button(container, 'Save'))
    expect(container.textContent).toContain(
      'Set at least a domain or an address to match on.',
    )
    await unmount()
  })

  it('POSTs upsert_known_sender with the entered fields on a valid save', async () => {
    mockFetch([], { ok: true, knownSender: sender() })
    const { container, unmount } = await render()
    await click(button(container, 'Add sender'))

    const labelInput = container.querySelector(
      'input[placeholder^="Label"]',
    ) as HTMLInputElement
    const addressInput = container.querySelector(
      'input[placeholder^="Match address"]',
    ) as HTMLInputElement
    await React.act(async () => {
      setInputValue(labelInput, 'ComBank')
      setInputValue(addressInput, 'e-statement@example-bank.test')
    })
    await click(button(container, 'Save'))

    const upsertCall = findCall('upsert_known_sender')
    expect(upsertCall).toBeTruthy()
    const body = bodyOf(upsertCall!)
    expect(body).toMatchObject({
      action: 'upsert_known_sender',
      label: 'ComBank',
      matchAddress: 'e-statement@example-bank.test',
    })
    await unmount()
  })

  it('POSTs set_known_sender_password with the id and typed password', async () => {
    mockFetch([sender({ id: 's-9', hasPassword: false })], { ok: true })
    const { container, unmount } = await render()

    const pwInput = container.querySelector(
      'input[type="password"]',
    ) as HTMLInputElement
    await React.act(async () => {
      setInputValue(pwInput, 'my-real-password')
    })
    await click(button(container, 'Save password'))

    const call = findCall('set_known_sender_password')
    expect(call).toBeTruthy()
    expect(bodyOf(call!)).toEqual({
      action: 'set_known_sender_password',
      id: 's-9',
      password: 'my-real-password',
    })
    await unmount()
  })

  it('does not POST set_known_sender_password when the draft is blank', async () => {
    mockFetch([sender({ id: 's-9' })])
    const { container, unmount } = await render()
    await click(button(container, 'Save password'))
    expect(findCall('set_known_sender_password')).toBeUndefined()
    await unmount()
  })

  it('POSTs delete_known_sender with the right id', async () => {
    mockFetch([sender({ id: 's-del' })], { ok: true })
    const { container, unmount } = await render()
    await click(button(container, 'Delete'))
    const call = findCall('delete_known_sender')
    expect(call).toBeTruthy()
    expect(bodyOf(call!)).toEqual({
      action: 'delete_known_sender',
      id: 's-del',
    })
    await unmount()
  })
})
