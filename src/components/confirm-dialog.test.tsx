// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest'
import React from 'react'
import { createRoot } from 'react-dom/client'
import { ConfirmDialog } from './confirm-dialog'

describe('ConfirmDialog', () => {
  it('provides accessible naming and keeps keyboard focus inside the dialog', async () => {
    const launcher = document.createElement('button')
    document.body.appendChild(launcher)
    launcher.focus()

    const rootElement = document.createElement('div')
    document.body.appendChild(rootElement)
    const root = createRoot(rootElement)
    const onCancel = vi.fn()
    const onConfirm = vi.fn()

    React.act(() => {
      root.render(
        React.createElement(ConfirmDialog, {
          title: 'Restore defaults?',
          body: 'This replaces your current layout.',
          confirmLabel: 'Restore',
          onCancel,
          onConfirm,
        }),
      )
    })

    const dialog = rootElement.querySelector('[role="alertdialog"]')
    expect(dialog?.getAttribute('aria-labelledby')).toBeTruthy()
    expect(dialog?.getAttribute('aria-describedby')).toBeTruthy()
    expect(dialog?.querySelector('h2')?.textContent).toBe('Restore defaults?')

    await vi.waitFor(() => {
      expect(document.activeElement?.textContent).toBe('Cancel')
    })

    const buttons = rootElement.querySelectorAll('button')
    const cancel = buttons[0]
    const confirm = buttons[1]
    confirm.focus()
    const forward = new KeyboardEvent('keydown', {
      key: 'Tab',
      bubbles: true,
      cancelable: true,
    })
    document.dispatchEvent(forward)
    expect(forward.defaultPrevented).toBe(true)
    expect(document.activeElement).toBe(cancel)

    const escape = new KeyboardEvent('keydown', {
      key: 'Escape',
      bubbles: true,
      cancelable: true,
    })
    document.dispatchEvent(escape)
    expect(escape.defaultPrevented).toBe(true)
    expect(onCancel).toHaveBeenCalledTimes(1)

    React.act(() => root.unmount())
    expect(document.activeElement).toBe(launcher)
    rootElement.remove()
    launcher.remove()
  })
})
