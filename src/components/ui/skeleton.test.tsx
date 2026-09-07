// @vitest-environment jsdom
/**
 * Tests for <Skeleton> — the single loading-placeholder primitive.
 *
 * Uses React.act + createRoot directly (not @testing-library/react) to match
 * the repo's other jsdom tests, which avoid the vitest ESM/CJS dual-instance
 * issue with React hooks in jsdom.
 */
import React from 'react'
import { createRoot } from 'react-dom/client'
import { act } from 'react'
import { afterEach, describe, expect, it } from 'vitest'

import { Skeleton } from './skeleton'

let container: HTMLDivElement | null = null

function mount(node: React.ReactElement) {
  container = document.createElement('div')
  document.body.appendChild(container)
  const root = createRoot(container)
  act(() => {
    root.render(node)
  })
  return container
}

afterEach(() => {
  if (container) {
    container.remove()
    container = null
  }
})

describe('Skeleton', () => {
  it('renders a single theme-aware shimmer block by default', () => {
    const el = mount(<Skeleton className="h-4 w-20" />).querySelector(
      '[data-slot="skeleton"]',
    )
    expect(el).not.toBeNull()
    expect(el!.classList.contains('skeleton-shimmer')).toBe(true)
    expect(el!.classList.contains('h-4')).toBe(true)
    expect(el!.classList.contains('w-20')).toBe(true)
    expect(el!.getAttribute('aria-hidden')).not.toBeNull()
  })

  it('renders `count` stacked lines, last one shortened', () => {
    const wrapper = mount(<Skeleton count={4} />).querySelector(
      '[data-slot="skeleton"]',
    )
    expect(wrapper).not.toBeNull()
    const lines = wrapper!.querySelectorAll('.skeleton-shimmer')
    expect(lines).toHaveLength(4)
    expect(lines[lines.length - 1].classList.contains('w-3/5')).toBe(true)
  })

  it('treats count <= 0 as the single-block form', () => {
    const el = mount(<Skeleton count={0} />).querySelector(
      '[data-slot="skeleton"]',
    )
    expect(el!.classList.contains('skeleton-shimmer')).toBe(true)
    expect(el!.querySelectorAll('.skeleton-shimmer')).toHaveLength(0)
  })
})
