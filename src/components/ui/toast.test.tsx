// @vitest-environment jsdom
import React from 'react'
import { createRoot } from 'react-dom/client'
import { describe, expect, it } from 'vitest'
import { toast, Toaster } from './toast'

describe('Toaster', () => {
  it('deduplicates visible messages and exposes an accessible dismiss action', async () => {
    const rootElement = document.createElement('div')
    document.body.appendChild(rootElement)
    const root = createRoot(rootElement)

    await React.act(async () => {
      root.render(React.createElement(Toaster))
      await Promise.resolve()
    })

    await React.act(async () => {
      toast('Dashboard refreshed', { duration: 60_000 })
      toast('Dashboard refreshed', { duration: 60_000 })
      await Promise.resolve()
    })

    const status = document.body.querySelector('[role="status"]')
    expect(status?.textContent).toContain('Dashboard refreshed')
    expect(document.body.querySelectorAll('[role="status"]')).toHaveLength(1)

    const dismiss = document.body.querySelector(
      'button[aria-label="Dismiss notification"]',
    )
    expect(dismiss).toBeTruthy()

    await React.act(async () => {
      dismiss?.dispatchEvent(new MouseEvent('click', { bubbles: true }))
      await Promise.resolve()
    })
    expect(document.body.querySelector('[role="status"]')).toBeNull()

    await React.act(async () => root.unmount())
    rootElement.remove()
  })
})
