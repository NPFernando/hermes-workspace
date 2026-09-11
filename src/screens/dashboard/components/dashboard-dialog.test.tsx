// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest'
import React from 'react'
import { createRoot } from 'react-dom/client'
import { DashboardDialog } from './dashboard-dialog'

describe('DashboardDialog', () => {
  it('traps tab navigation, locks body scroll, and restores launcher focus', async () => {
    const launcher = document.createElement('button')
    document.body.appendChild(launcher)
    launcher.focus()

    const rootElement = document.createElement('div')
    document.body.appendChild(rootElement)
    const root = createRoot(rootElement)
    const onClose = vi.fn()
    document.body.style.overflow = 'auto'

    React.act(() => {
      root.render(
        React.createElement(
          DashboardDialog,
          { titleId: 'dialog-title', onClose, className: 'dialog' },
          React.createElement('h2', { id: 'dialog-title' }, 'Dashboard dialog'),
          React.createElement('button', { type: 'button' }, 'First'),
          React.createElement('button', { type: 'button' }, 'Last'),
        ),
      )
    })

    await vi.waitFor(() => {
      expect(document.body.style.overflow).toBe('hidden')
    })
    expect(rootElement.querySelector('[role="dialog"]')?.className).toContain(
      'z-[9998]',
    )

    const buttons = rootElement.querySelectorAll('button')
    const first = buttons[0]
    const last = buttons[1]
    first.focus()

    const forward = new KeyboardEvent('keydown', {
      key: 'Tab',
      bubbles: true,
      cancelable: true,
    })
    document.dispatchEvent(forward)
    expect(forward.defaultPrevented).toBe(false)

    last.focus()
    const wrapForward = new KeyboardEvent('keydown', {
      key: 'Tab',
      bubbles: true,
      cancelable: true,
    })
    document.dispatchEvent(wrapForward)
    expect(wrapForward.defaultPrevented).toBe(true)
    expect(document.activeElement).toBe(first)

    const escape = new KeyboardEvent('keydown', {
      key: 'Escape',
      bubbles: true,
      cancelable: true,
    })
    document.dispatchEvent(escape)
    expect(escape.defaultPrevented).toBe(true)
    expect(onClose).toHaveBeenCalledTimes(1)

    React.act(() => root.unmount())
    expect(document.activeElement).toBe(launcher)
    expect(document.body.style.overflow).toBe('auto')
    rootElement.remove()
    launcher.remove()
  })
})
