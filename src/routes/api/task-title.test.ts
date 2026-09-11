import { describe, expect, it } from 'vitest'

import { normalizeTaskTitle } from './task-title'

describe('normalizeTaskTitle', () => {
  it('normalizes casing and runs of whitespace without changing words', () => {
    expect(normalizeTaskTitle('  Review   Monthly\nReport ')).toBe(
      'review monthly report',
    )
  })

  it('returns an empty key for blank titles', () => {
    expect(normalizeTaskTitle(' \t\n ')).toBe('')
  })
})
