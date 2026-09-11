// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest'
import React from 'react'
import { createRoot } from 'react-dom/client'

const state = vi.hoisted(() => ({
  navigate: vi.fn(),
}))

vi.mock('@tanstack/react-router', () => ({
  useNavigate: () => state.navigate,
}))

const { default: KeyboardShortcuts } = await import('./KeyboardShortcuts')

describe('KeyboardShortcuts', () => {
  it('focuses the composer on Ctrl/Cmd+Shift+Q', () => {
    const onFocusComposer = vi.fn()
    const rootElement = document.createElement('div')
    document.body.appendChild(rootElement)
    const root = createRoot(rootElement)

    React.act(() => {
      root.render(React.createElement(KeyboardShortcuts, { onFocusComposer }))
    })

    const event = new KeyboardEvent('keydown', {
      key: 'q',
      ctrlKey: true,
      shiftKey: true,
      bubbles: true,
      cancelable: true,
    })
    window.dispatchEvent(event)

    expect(event.defaultPrevented).toBe(true)
    expect(onFocusComposer).toHaveBeenCalledTimes(1)

    React.act(() => root.unmount())
    rootElement.remove()
  })
})
