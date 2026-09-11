// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest'
import React from 'react'
import { createRoot } from 'react-dom/client'
import { MobileSessionsPanel } from './mobile-sessions-panel'

describe('MobileSessionsPanel', () => {
  it('traps focus, closes on Escape, and restores launcher focus', async () => {
    const launcher = document.createElement('button')
    document.body.appendChild(launcher)
    launcher.focus()

    const rootElement = document.createElement('div')
    document.body.appendChild(rootElement)
    const root = createRoot(rootElement)
    const onClose = vi.fn()

    await React.act(async () => {
      root.render(
        React.createElement(MobileSessionsPanel, {
          open: true,
          onClose,
          sessions: [],
          activeFriendlyId: 'main',
          onSelectSession: vi.fn(),
          onNewChat: vi.fn(),
        }),
      )
      await new Promise<void>((resolve) =>
        requestAnimationFrame(() => resolve()),
      )
    })

    const dialog = rootElement.querySelector('[role="dialog"]')
    expect(dialog).not.toBeNull()
    if (!dialog) throw new Error('Sessions dialog did not render')
    expect(dialog.getAttribute('aria-modal')).toBe('true')
    expect(
      dialog.querySelector('button[aria-label="Close sessions panel"]'),
    ).not.toBeNull()

    const buttons = dialog.querySelectorAll('button')
    expect(buttons.length).toBeGreaterThan(0)
    const first = buttons[0]
    const last = buttons[buttons.length - 1]

    last.focus()
    const wrapForward = new KeyboardEvent('keydown', {
      key: 'Tab',
      bubbles: true,
      cancelable: true,
    })
    window.dispatchEvent(wrapForward)
    expect(wrapForward.defaultPrevented).toBe(true)
    expect(document.activeElement).toBe(first)

    first.focus()
    const wrapBackward = new KeyboardEvent('keydown', {
      key: 'Tab',
      shiftKey: true,
      bubbles: true,
      cancelable: true,
    })
    window.dispatchEvent(wrapBackward)
    expect(wrapBackward.defaultPrevented).toBe(true)
    expect(document.activeElement).toBe(last)

    const escape = new KeyboardEvent('keydown', {
      key: 'Escape',
      bubbles: true,
      cancelable: true,
    })
    window.dispatchEvent(escape)
    expect(escape.defaultPrevented).toBe(true)
    expect(onClose).toHaveBeenCalledTimes(1)

    React.act(() => {
      root.render(
        React.createElement(MobileSessionsPanel, {
          open: false,
          onClose,
          sessions: [],
          activeFriendlyId: 'main',
          onSelectSession: vi.fn(),
          onNewChat: vi.fn(),
        }),
      )
    })
    expect(document.activeElement).toBe(launcher)

    React.act(() => {
      root.unmount()
    })
    rootElement.remove()
    launcher.remove()
  })
})
