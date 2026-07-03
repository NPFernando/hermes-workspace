import { describe, expect, it } from 'vitest'

import { shouldRenderContextBar } from './context-bar'

describe('shouldRenderContextBar', () => {
  const base = { contextPercent: 0, model: '', maxTokens: 0, usedTokens: 0 }

  it('stays hidden before any data loads', () => {
    expect(shouldRenderContextBar(base)).toBe(false)
  })

  it('stays hidden on a fresh session with a known model but no usage', () => {
    expect(
      shouldRenderContextBar({
        ...base,
        model: 'hermes-agent',
        maxTokens: 200_000,
      }),
    ).toBe(false)
  })

  it('renders once tokens have been consumed', () => {
    expect(
      shouldRenderContextBar({
        contextPercent: 3,
        model: 'hermes-agent',
        maxTokens: 200_000,
        usedTokens: 6_000,
      }),
    ).toBe(true)
  })
})
