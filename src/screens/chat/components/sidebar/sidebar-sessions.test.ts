import { describe, expect, it } from 'vitest'

import { shouldShowSessionSkeleton } from './sidebar-sessions'

describe('shouldShowSessionSkeleton', () => {
  it('returns true when loading and no sessions', () => {
    expect(shouldShowSessionSkeleton(true, false, 0)).toBe(true)
  })

  it('returns true when loading even with cached sessions', () => {
    expect(shouldShowSessionSkeleton(true, false, 5)).toBe(true)
  })

  it('returns true during background refresh with no data yet', () => {
    expect(shouldShowSessionSkeleton(false, true, 0)).toBe(true)
  })

  it('returns false during background refresh with existing data', () => {
    expect(shouldShowSessionSkeleton(false, true, 3)).toBe(false)
  })

  it('returns false when not loading and not fetching', () => {
    expect(shouldShowSessionSkeleton(false, false, 0)).toBe(false)
  })

  it('returns false when not loading, not fetching, has data', () => {
    expect(shouldShowSessionSkeleton(false, false, 10)).toBe(false)
  })

  it('returns false when error and not loading', () => {
    expect(shouldShowSessionSkeleton(false, false, 0)).toBe(false)
  })
})