import { describe, expect, it } from 'vitest'

import {
  doesJobMatchHealthFilter,
  formatJobActionLabel,
  formatJobFreshnessCopy,
  getJobHealthFilterButtonLabel,
  getJobHealthFilterCounts,
  getJobsEmptyStateCopy,
} from './jobs-screen'
import type { ClaudeJob } from '@/lib/jobs-api'

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

describe('job health filters', () => {
  const now = Date.UTC(2026, 6, 2, 12, 0, 0)
  const makeJob = (overrides: Partial<ClaudeJob>): ClaudeJob => ({
    id: overrides.id ?? 'job-1',
    name: overrides.name ?? 'Daily monitor',
    prompt: overrides.prompt ?? 'Run the monitor',
    schedule: overrides.schedule ?? {},
    enabled: overrides.enabled ?? true,
    state: overrides.state ?? 'active',
    last_run_at:
      overrides.last_run_at ?? new Date(now - 6 * 60 * 60 * 1000).toISOString(),
    last_run_success: overrides.last_run_success ?? true,
    ...overrides,
  })

  it('classifies jobs by health state', () => {
    expect(
      doesJobMatchHealthFilter(
        makeJob({ last_run_at: new Date(now - 3 * 86_400_000).toISOString() }),
        'stale',
        now,
      ),
    ).toBe(true)
    expect(
      doesJobMatchHealthFilter(
        makeJob({ last_run_success: false }),
        'failed',
        now,
      ),
    ).toBe(true)
    expect(
      doesJobMatchHealthFilter(makeJob({ enabled: false }), 'paused', now),
    ).toBe(true)
    expect(
      doesJobMatchHealthFilter(makeJob({ last_run_at: null }), 'neverRun', now),
    ).toBe(true)
  })

  it('counts jobs for each health filter', () => {
    const counts = getJobHealthFilterCounts(
      [
        makeJob({ id: 'recent' }),
        makeJob({
          id: 'stale',
          last_run_at: new Date(now - 4 * 86_400_000).toISOString(),
        }),
        makeJob({ id: 'failed', last_run_success: false }),
        makeJob({ id: 'paused', enabled: false }),
        makeJob({ id: 'never', last_run_at: null }),
      ],
      now,
    )

    expect(counts).toMatchObject({
      all: 5,
      stale: 1,
      failed: 1,
      paused: 1,
      neverRun: 1,
    })
  })

  it('builds accessible button labels and empty-state copy', () => {
    expect(getJobHealthFilterButtonLabel('failed', 1, false)).toBe(
      'Show failed scheduled jobs (1 job)',
    )
    expect(getJobHealthFilterButtonLabel('stale', 3, true)).toBe(
      'Showing stale scheduled jobs (3 jobs)',
    )
    expect(getJobsEmptyStateCopy('monitor', 'paused')).toEqual({
      title: 'No paused jobs',
      description:
        'No scheduled jobs match both the search text and selected health filter.',
    })
  })
})
