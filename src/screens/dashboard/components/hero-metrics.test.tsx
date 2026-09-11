import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { HeroMetrics } from './hero-metrics'

describe('HeroMetrics', () => {
  it('gives loading tiles a single coherent accessible announcement', () => {
    const html = renderToStaticMarkup(
      React.createElement(HeroMetrics, {
        analytics: null,
        fallback: { sessions: 0, messages: 0, toolCalls: 0, tokens: 0 },
        loading: true,
      }),
    )

    expect(html).toContain(
      'role="group" aria-label="Sessions: loading, all time"',
    )
    expect(html).toContain(
      'role="group" aria-label="Tokens: loading, Hermes ledger"',
    )
    expect(html).toContain(
      'role="group" aria-label="API Calls: loading, tool calls"',
    )
  })

  it('includes the populated value, window, and delta in the accessible label', () => {
    const html = renderToStaticMarkup(
      React.createElement(HeroMetrics, {
        analytics: null,
        fallback: { sessions: 12, messages: 4, toolCalls: 8, tokens: 1500 },
      }),
    )

    expect(html).toContain('role="group" aria-label="Sessions: 12, all time"')
    expect(html).toContain(
      'role="group" aria-label="Tokens: 1.5K, Hermes ledger"',
    )
    expect(html).toContain('role="group" aria-label="API Calls: 8, tool calls"')
  })
})
