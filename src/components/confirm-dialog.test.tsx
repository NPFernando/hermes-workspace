// @vitest-environment jsdom
import React, { act } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createRoot } from 'react-dom/client'
import type { Root } from 'react-dom/client'
import { ConfirmDialog } from './confirm-dialog'

describe('ConfirmDialog accessibility', () => {
  let root: Root | undefined
  let host: HTMLDivElement | undefined

  afterEach(() => {
    if (root) act(() => root?.unmount())
    host?.remove()
  })

  it('labels the alert, focuses cancel, handles Escape, and traps Tab', () => {
    host = document.createElement('div')
    document.body.append(host)
    root = createRoot(host)
    const onCancel = vi.fn()
    act(() =>
      root?.render(
        React.createElement(ConfirmDialog, {
          title: 'Delete item',
          body: 'This cannot be undone.',
          onCancel,
          onConfirm: vi.fn(),
        }),
      ),
    )
    const dialog = host.querySelector('[role="alertdialog"]') as HTMLDivElement
    const cancel = host.querySelector('button') as HTMLButtonElement
    expect(dialog.getAttribute('aria-labelledby')).toBeTruthy()
    expect(dialog.getAttribute('aria-describedby')).toBeTruthy()
    expect(document.activeElement).toBe(cancel)
    act(() =>
      dialog.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }),
      ),
    )
    expect(onCancel).toHaveBeenCalledOnce()
    act(() => cancel.focus())
    act(() =>
      dialog.dispatchEvent(
        new KeyboardEvent('keydown', {
          key: 'Tab',
          shiftKey: true,
          bubbles: true,
        }),
      ),
    )
    expect(document.activeElement).not.toBe(cancel)
  })
})
