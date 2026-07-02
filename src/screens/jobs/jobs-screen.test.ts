import { describe, expect, it } from 'vitest'

import { formatJobActionLabel, formatJobFreshnessCopy } from './jobs-screen'

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
    expect(formatJobActionLabel('   ', 'resume')).toBe(
      'Resume job: unnamed job',
    )
    expect(formatJobActionLabel(undefined, 'delete')).toBe(
      'Delete job: unnamed job',
    )
  })
})

describe('formatJobFreshnessCopy', () => {
  const now = Date.UTC(2026, 6, 2, 12, 0, 0)

  it('calls out enabled jobs that have never produced a run', () => {
    expect(
      formatJobFreshnessCopy(
        {
          enabled: true,
          last_run_at: null,
          name: 'Daily monitor',
          state: 'active',
        },
        now,
      ),
    ).toBe('Daily monitor has not produced a run yet.')
  })

  it('returns null for recent successful runs', () => {
    expect(
      formatJobFreshnessCopy(
        {
          enabled: true,
          last_run_at: new Date(now - 6 * 60 * 60 * 1000).toISOString(),
          name: 'Daily monitor',
          state: 'active',
        },
        now,
      ),
    ).toBeNull()
  })

  it('warns when active jobs have not run recently', () => {
    expect(
      formatJobFreshnessCopy(
        {
          enabled: true,
          last_run_at: new Date(now - 3 * 86_400_000).toISOString(),
          name: 'Daily monitor',
          state: 'active',
        },
        now,
      ),
    ).toBe(
      'Daily monitor has not run in 3 days; check the schedule if it should be recurring.',
    )
  })

  it('stays quiet for paused, completed, and invalid-date jobs', () => {
    expect(
      formatJobFreshnessCopy(
        {
          enabled: false,
          last_run_at: null,
          name: 'Paused job',
          state: 'paused',
        },
        now,
      ),
    ).toBeNull()
    expect(
      formatJobFreshnessCopy(
        {
          enabled: true,
          last_run_at: null,
          name: 'Done job',
          state: 'completed',
        },
        now,
      ),
    ).toBeNull()
    expect(
      formatJobFreshnessCopy(
        {
          enabled: true,
          last_run_at: 'not-a-date',
          name: 'Odd job',
          state: 'active',
        },
        now,
      ),
    ).toBeNull()
  })
})
