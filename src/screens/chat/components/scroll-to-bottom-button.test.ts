import { describe, expect, it } from 'vitest'

import { formatScrollToBottomLabel } from './scroll-to-bottom-button'

describe('formatScrollToBottomLabel', () => {
  it('uses the base action label when there are no unread messages', () => {
    expect(formatScrollToBottomLabel(0)).toBe('Scroll to bottom')
  })

  it('treats negative unread counts as no unread messages', () => {
    expect(formatScrollToBottomLabel(-3)).toBe('Scroll to bottom')
  })

  it('uses singular message copy for one unread message', () => {
    expect(formatScrollToBottomLabel(1)).toBe(
      'Scroll to bottom (1 unread message)',
    )
  })

  it('uses plural message copy for normal unread counts', () => {
    expect(formatScrollToBottomLabel(12)).toBe(
      'Scroll to bottom (12 unread messages)',
    )
  })

  it('announces capped counts without exposing the visual 99+ shorthand', () => {
    expect(formatScrollToBottomLabel(120)).toBe(
      'Scroll to bottom (99 or more unread messages)',
    )
  })
})
