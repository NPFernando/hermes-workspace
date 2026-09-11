import { describe, expect, it } from 'vitest'
import { extractEventData, streamFailureMessage } from './dify-workbench-screen'

describe('Dify stream parsing', () => {
  it('parses a final event without requiring a trailing blank line', () => {
    expect(extractEventData('data: {"event":"workflow_finished"}')).toEqual({
      event: 'workflow_finished',
    })
  })

  it('recognizes Dify error and failed events', () => {
    expect(
      streamFailureMessage({ event: 'error', message: 'Provider failed' }),
    ).toBe('Provider failed')
    expect(
      streamFailureMessage({
        event: 'workflow_failed',
        data: { message: 'Workflow failed' },
      }),
    ).toBe('Workflow failed')
    expect(streamFailureMessage({ event: 'message' })).toBeNull()
  })
})
