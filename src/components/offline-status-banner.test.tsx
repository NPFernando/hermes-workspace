// @vitest-environment jsdom
import React, { act } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createRoot } from 'react-dom/client'
import { OfflineStatusBanner } from './offline-status-banner'
import type { Root } from 'react-dom/client'

describe('OfflineStatusBanner', () => {
  let root: Root
  let host: HTMLDivElement
  const originalOnline = navigator.onLine

  beforeEach(() => {
    host = document.createElement('div')
    document.body.append(host)
    root = createRoot(host)
    Object.defineProperty(navigator, 'onLine', {
      configurable: true,
      value: false,
    })
  })

  afterEach(() => {
    act(() => root.unmount())
    document.body.replaceChildren()
    Object.defineProperty(navigator, 'onLine', {
      configurable: true,
      value: originalOnline,
    })
    vi.restoreAllMocks()
  })

  it('announces offline mode and hides it after connectivity returns', () => {
    act(() => root.render(React.createElement(OfflineStatusBanner)))
    expect(host.textContent).toContain('Offline mode')
    Object.defineProperty(navigator, 'onLine', {
      configurable: true,
      value: true,
    })
    act(() => window.dispatchEvent(new Event('online')))
    expect(host.textContent).toBe('')
  })
})
