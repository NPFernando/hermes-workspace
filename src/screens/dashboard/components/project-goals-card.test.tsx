// @vitest-environment jsdom
import React, { act } from 'react'
import { afterEach, describe, expect, it } from 'vitest'
import { createRoot } from 'react-dom/client'
import type { Root } from 'react-dom/client'
import { ProjectGoalsCard } from './project-goals-card'

describe('ProjectGoalsCard', () => {
  let root: Root | undefined
  let host: HTMLDivElement | undefined

  afterEach(() => {
    if (root) act(() => root?.unmount())
    host?.remove()
    root = undefined
    host = undefined
  })

  it('exposes evidence and next actions and keeps filters keyboard-addressable', () => {
    host = document.createElement('div')
    document.body.append(host)
    root = createRoot(host)
    act(() => root?.render(React.createElement(ProjectGoalsCard)))

    expect(host.textContent).toContain('Evidence:')
    expect(host.textContent).toContain('Next:')
    const filter = host.querySelector(
      'button[aria-controls="project-goals-list"]',
    )
    expect(filter?.getAttribute('aria-pressed')).toBe('true')
    expect(
      host.querySelector('#project-goals-list')?.getAttribute('aria-live'),
    ).toBe('polite')
  })
})
