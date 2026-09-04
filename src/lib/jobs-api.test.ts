import { describe, expect, it } from 'vitest'
import {
  buildJobMutationPayload,
  getJobErrorText,
  isFailedJobState,
  normalizeJobState,
  normalizeJobsResponse,
} from './jobs-api'
import type { ClaudeJob } from './jobs-api'

const job = {
  id: 'job-1',
  name: 'Example job',
  prompt: 'Run the example job',
  schedule: {},
  enabled: true,
  state: 'scheduled',
} satisfies ClaudeJob

describe('normalizeJobsResponse', () => {
  it('accepts dashboard cron jobs returned as a top-level array', () => {
    expect(normalizeJobsResponse([job])).toEqual([job])
  })

  it('accepts gateway jobs returned in an object wrapper', () => {
    expect(normalizeJobsResponse({ jobs: [job] })).toEqual([job])
  })

  it('falls back to an empty list for unexpected payloads', () => {
    expect(normalizeJobsResponse({ jobs: null })).toEqual([])
  })
})

describe('job helpers', () => {
  it('normalizes and classifies job states', () => {
    expect(normalizeJobState(' Running ')).toBe('running')
    expect(isFailedJobState('errored')).toBe(true)
    expect(isFailedJobState('running')).toBe(false)
  })

  it('prefers explicit job error text', () => {
    expect(getJobErrorText({ ...job, last_run_error: '  boom  ' })).toBe('boom')
    expect(
      getJobErrorText({ ...job, last_run_error: null, error: 'oops' }),
    ).toBe('oops')
    expect(getJobErrorText(null)).toBeNull()
  })
})

describe('job mutation payloads', () => {
  it('sends prompt as input for Hermes cron APIs that require an input string', () => {
    expect(
      buildJobMutationPayload({
        name: 'Daily summary',
        schedule: 'every 30m',
        prompt: 'summarize the latest notes',
        deliver: ['local'],
      }),
    ).toEqual({
      name: 'Daily summary',
      schedule: 'every 30m',
      prompt: 'summarize the latest notes',
      input: 'summarize the latest notes',
      deliver: 'local',
    })
  })

  it('serializes multiple delivery targets into the string format expected by Hermes cron APIs', () => {
    expect(
      buildJobMutationPayload({
        name: 'Push updates',
        schedule: '0 9 * * *',
        prompt: 'send the daily sync',
        deliver: ['local', 'discord'],
      }),
    ).toEqual({
      name: 'Push updates',
      schedule: '0 9 * * *',
      prompt: 'send the daily sync',
      input: 'send the daily sync',
      deliver: 'local,discord',
    })
  })
})
