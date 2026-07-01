import { describe, expect, it } from 'vitest'

import { formatJobActionLabel } from './jobs-screen'

describe('formatJobActionLabel', () => {
  it('includes the job name in action labels', () => {
    expect(formatJobActionLabel('Daily monitor', 'run')).toBe(
      'Run job now: Daily monitor',
    )
    expect(formatJobActionLabel('Daily monitor', 'pause')).toBe(
      'Pause job: Daily monitor',
    )
    expect(formatJobActionLabel('Daily monitor', 'showHistory')).toBe(
      'Show run history for job: Daily monitor',
    )
  })

  it('falls back to unnamed job copy for blank titles', () => {
    expect(formatJobActionLabel('   ', 'resume')).toBe('Resume job: unnamed job')
    expect(formatJobActionLabel(undefined, 'delete')).toBe(
      'Delete job: unnamed job',
    )
  })
})
