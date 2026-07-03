import { describe, expect, it } from 'vitest'

import { shouldShowFriendlyId, stripTrailingDateSuffix } from './session-item'

describe('stripTrailingDateSuffix', () => {
  it('strips a "· Mon D" suffix', () => {
    expect(stripTrailingDateSuffix('atlas_prompt_update · Jul 2')).toBe(
      'atlas_prompt_update',
    )
  })

  it('strips full-month, year, and time variants', () => {
    expect(stripTrailingDateSuffix('report · July 2, 2026')).toBe('report')
    expect(stripTrailingDateSuffix('report · Jul 2 3:45 PM')).toBe('report')
    expect(stripTrailingDateSuffix('report • Dec 31')).toBe('report')
  })

  it('strips ISO date/datetime suffixes', () => {
    expect(stripTrailingDateSuffix('backup · 2026-07-02')).toBe('backup')
    expect(stripTrailingDateSuffix('backup · 2026-07-02 14:30')).toBe('backup')
    expect(stripTrailingDateSuffix('backup · 2026-07-02T14:30:05')).toBe(
      'backup',
    )
  })

  it('leaves titles without a date suffix untouched', () => {
    expect(stripTrailingDateSuffix('Fix Docker publish')).toBe(
      'Fix Docker publish',
    )
    expect(stripTrailingDateSuffix('May day planning notes')).toBe(
      'May day planning notes',
    )
    expect(stripTrailingDateSuffix('metrics · dashboard')).toBe(
      'metrics · dashboard',
    )
  })

  it('never strips down to an empty title', () => {
    expect(stripTrailingDateSuffix(' · Jul 2')).toBe(' · Jul 2')
  })
})

describe('shouldShowFriendlyId', () => {
  it('hides the id when the title already contains it', () => {
    expect(
      shouldShowFriendlyId('atlas_prompt_update', 'atlas_prompt_update'),
    ).toBe(false)
    expect(
      shouldShowFriendlyId('Atlas_Prompt_Update run', 'atlas_prompt_update'),
    ).toBe(false)
  })

  it('shows the id for unrelated titles', () => {
    expect(shouldShowFriendlyId('Fix Docker publish', 'main')).toBe(true)
  })
})
