// @vitest-environment jsdom
import React, { act } from 'react'
import { afterEach, describe, expect, it } from 'vitest'
import { createRoot } from 'react-dom/client'
import type { Root } from 'react-dom/client'
import { WorkflowHelpModal } from './workflow-help-modal'

describe('WorkflowHelpModal accessibility', () => {
  let root: Root | undefined
  let host: HTMLDivElement | undefined

  afterEach(() => {
    if (root) act(() => root?.unmount())
    host?.remove()
  })

  it('labels the dialog and restores focus after Escape closes it', () => {
    host = document.createElement('div')
    document.body.append(host)
    root = createRoot(host)
    act(() =>
      root?.render(
        React.createElement(WorkflowHelpModal, {
          title: 'How it works',
          sections: [{ title: 'Step one', bullets: ['Read this'] }],
        }),
      ),
    )
    const trigger = host.querySelector('button') as HTMLButtonElement
    act(() => trigger.focus())
    act(() => trigger.click())
    const dialog = host.querySelector('[role="dialog"]') as HTMLDivElement
    const close = host.querySelector(
      'button[aria-label^="Close"]',
    ) as HTMLButtonElement
    expect(dialog.getAttribute('aria-labelledby')).toBeTruthy()
    expect(document.activeElement).toBe(close)
    act(() =>
      dialog.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }),
      ),
    )
    expect(host.querySelector('[role="dialog"]')).toBeNull()
    expect(document.activeElement).toBe(trigger)
  })
})
