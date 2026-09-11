// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest'
import React from 'react'
import { createRoot } from 'react-dom/client'
import { DashboardOverflowPanel } from './dashboard-overflow-panel'

const navigate = vi.fn()

vi.mock('@tanstack/react-router', () => ({
  useNavigate: () => navigate,
}))

vi.mock('@/hooks/use-settings', () => ({
  useSettingsStore: (
    selector: (state: { updateSettings: ReturnType<typeof vi.fn> }) => unknown,
  ) => selector({ updateSettings: vi.fn() }),
}))

describe('DashboardOverflowPanel', () => {
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
        React.createElement(DashboardOverflowPanel, { open: true, onClose }),
      )
      await new Promise<void>((resolve) =>
        requestAnimationFrame(() => resolve()),
      )
    })

    const dialog = rootElement.querySelector('[role="dialog"]')
    expect(dialog).not.toBeNull()
    if (!dialog) throw new Error('Overflow dialog did not render')
    expect(dialog.getAttribute('aria-modal')).toBe('true')
    expect(dialog.parentElement?.className).toContain('z-[9998]')
    expect(
      dialog.querySelector('button[aria-label="Close overflow panel"]'),
    ).not.toBeNull()

    const buttons = dialog.querySelectorAll('button')
    expect(buttons.length).toBeGreaterThan(0)
    const first = buttons[0]
    const last = buttons[buttons.length - 1]

    first.focus()
    const forward = new KeyboardEvent('keydown', {
      key: 'Tab',
      bubbles: true,
      cancelable: true,
    })
    window.dispatchEvent(forward)
    expect(forward.defaultPrevented).toBe(false)

    last.focus()
    const wrapForward = new KeyboardEvent('keydown', {
      key: 'Tab',
      bubbles: true,
      cancelable: true,
    })
    window.dispatchEvent(wrapForward)
    expect(wrapForward.defaultPrevented).toBe(true)
    expect(document.activeElement).toBe(first)

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
        React.createElement(DashboardOverflowPanel, { open: false, onClose }),
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
