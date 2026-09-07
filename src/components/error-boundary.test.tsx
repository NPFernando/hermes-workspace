// @vitest-environment jsdom
/**
 * Tests for ErrorBoundary's auto-recovery behavior.
 * Covers: existing React-DOM-reconciliation auto-reload (regression guard),
 * new stale-asset-error auto-reload (fixes "session inaccessible after a
 * live deploy, only a manual restart/reload works"), and the sessionStorage
 * TTL guard that prevents an infinite reload loop.
 *
 * Uses React.act + createRoot directly (not @testing-library/react), same
 * convention as other component tests in this repo, to avoid the vitest
 * ESM/CJS dual-instance issue with React 19 hooks in jsdom.
 */
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest'
import React from 'react'
import { createRoot } from 'react-dom/client'

// Mock the Button primitive before importing the component under test: the
// real Button pulls in @base-ui/react, which triggers a dual React-instance
// crash (`useRef` on null) under vitest+jsdom. The factory reuses this
// test's own React import (ESM) to avoid that dual-instance issue.
vi.mock('@/components/ui/button', () => ({
  Button: ({
    children,
    onClick,
  }: {
    children: React.ReactNode
    onClick?: () => void
  }) => React.createElement('button', { onClick }, children),
}))

const { ErrorBoundary, isStaleAssetError } = await import('./error-boundary')

function ThrowingChild({ error }: { error: Error }): never {
  throw error
}

function renderBoundary(error: Error) {
  const container = document.createElement('div')
  document.body.appendChild(container)
  const root = createRoot(container)
  React.act(() => {
    root.render(
      React.createElement(
        ErrorBoundary,
        null,
        React.createElement(ThrowingChild, { error }),
      ),
    )
  })
  return { container, root }
}

describe('isStaleAssetError', () => {
  it('matches the common stale-chunk/module bundler error strings', () => {
    expect(
      isStaleAssetError(
        new TypeError('Failed to fetch dynamically imported module: x.js'),
      ),
    ).toBe(true)
    expect(
      isStaleAssetError(new Error('Loading chunk 42 failed after 3 tries')),
    ).toBe(true)
    expect(isStaleAssetError(new Error('Loading CSS chunk 7 failed'))).toBe(
      true,
    )
    expect(
      isStaleAssetError(new Error('Importing a module script failed')),
    ).toBe(true)
    expect(
      isStaleAssetError(new Error('Unable to preload CSS for main.css')),
    ).toBe(true)
  })

  it('does not match unrelated errors', () => {
    expect(isStaleAssetError(new Error('Network request timed out'))).toBe(
      false,
    )
    expect(isStaleAssetError(new TypeError('Cannot read undefined'))).toBe(
      false,
    )
  })
})

describe('ErrorBoundary auto-recovery', () => {
  const originalReload = window.location.reload

  beforeEach(() => {
    window.sessionStorage.clear()
    // jsdom's window.location.reload throws "Not implemented" by default.
    Object.defineProperty(window, 'location', {
      value: { ...window.location, reload: vi.fn() },
      writable: true,
    })
    vi.spyOn(console, 'error').mockImplementation(() => {})
  })

  afterEach(() => {
    vi.restoreAllMocks()
    Object.defineProperty(window, 'location', {
      value: { ...window.location, reload: originalReload },
      writable: true,
    })
  })

  it('auto-reloads once for a React-DOM reconciliation error', async () => {
    renderBoundary(
      new Error(
        "Failed to execute 'insertBefore' on 'Node': The node to be inserted is not a child of this node.",
      ),
    )
    await vi.waitFor(() => {
      expect(window.location.reload).toHaveBeenCalledTimes(1)
    })
  })

  it('auto-reloads once for a stale-asset (chunk load) error', async () => {
    renderBoundary(
      new Error('Failed to fetch dynamically imported module: /assets/main-abc123.js'),
    )
    await vi.waitFor(() => {
      expect(window.location.reload).toHaveBeenCalledTimes(1)
    })
  })

  it('does not auto-reload a second time within the TTL window (no reload loop)', async () => {
    window.sessionStorage.setItem(
      'hermes-stale-asset-recovery-at',
      String(Date.now()),
    )
    renderBoundary(new Error('Loading chunk 3 failed'))
    // Give any pending microtasks a chance to run, then confirm reload was
    // never invoked because the TTL guard short-circuited recovery.
    await new Promise((resolve) => setTimeout(resolve, 10))
    expect(window.location.reload).not.toHaveBeenCalled()
  })

  it('shows the manual reload button for errors it does not recognize', () => {
    const { container } = renderBoundary(new Error('Some unrelated crash'))
    expect(container.textContent).toContain('Reload')
    expect(window.location.reload).not.toHaveBeenCalled()
  })
})
