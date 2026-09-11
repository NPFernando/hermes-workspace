// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest'
import React from 'react'
import { createRoot } from 'react-dom/client'
import { DashboardUnavailableState } from './dashboard-empty-state'
import { DashboardRefreshProvider } from '@/screens/dashboard/lib/dashboard-refresh-context'

describe('DashboardUnavailableState', () => {
  it('offers a local retry action when dashboard refresh is available', () => {
    const rootElement = document.createElement('div')
    document.body.appendChild(rootElement)
    const root = createRoot(rootElement)
    const refresh = vi.fn()

    React.act(() => {
      root.render(
        React.createElement(
          DashboardRefreshProvider,
          { refresh },
          React.createElement(DashboardUnavailableState, {
            title: 'Usage analytics',
          }),
        ),
      )
    })

    const retry = rootElement.querySelector('button')
    expect(retry?.getAttribute('aria-label')).toBe('Retry Usage analytics')
    expect(retry?.hasAttribute('disabled')).toBe(false)
    retry?.click()
    expect(refresh).toHaveBeenCalledTimes(1)

    React.act(() => root.unmount())
    rootElement.remove()
  })

  it('disables local retry while a dashboard refresh is running', () => {
    const rootElement = document.createElement('div')
    document.body.appendChild(rootElement)
    const root = createRoot(rootElement)

    React.act(() => {
      root.render(
        React.createElement(
          DashboardRefreshProvider,
          { refresh: vi.fn(), isRefreshing: true },
          React.createElement(DashboardUnavailableState, {
            title: 'Provider mix',
          }),
        ),
      )
    })

    const retry = rootElement.querySelector('button')
    expect(retry?.hasAttribute('disabled')).toBe(true)
    expect(retry?.getAttribute('aria-label')).toBe('Retrying Provider mix')

    React.act(() => root.unmount())
    rootElement.remove()
  })

  it('defers recovery to the global banner during an overview outage', () => {
    const rootElement = document.createElement('div')
    document.body.appendChild(rootElement)
    const root = createRoot(rootElement)

    React.act(() => {
      root.render(
        React.createElement(
          DashboardRefreshProvider,
          { refresh: vi.fn(), globalUnavailable: true },
          React.createElement(DashboardUnavailableState, {
            title: 'Top models',
          }),
        ),
      )
    })

    expect(rootElement.querySelector('button')).toBeNull()
    expect(rootElement.textContent).toContain(
      'Use Retry sync in the banner above.',
    )

    React.act(() => root.unmount())
    rootElement.remove()
  })
})
