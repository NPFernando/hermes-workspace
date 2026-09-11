import { describe, expect, it } from 'vitest'
import { normalizeCronOutput } from './use-agent-outputs'

describe('normalizeCronOutput', () => {
  it('maps a successful cron run into an output card model', () => {
    const output = normalizeCronOutput(
      { id: 'job-1', name: 'ops:trader:hourly' },
      {
        id: 'run-1',
        status: 'success',
        startedAt: '2026-09-11T06:00:00.000Z',
        finishedAt: '2026-09-11T06:00:04.000Z',
        durationMs: 4000,
        output: { signal: 'HOLD', confidence: 0.72 },
        chatSessionKey: 'chat-1',
      },
    )

    expect(output).toMatchObject({
      id: 'job-1:run-1',
      agentId: 'trader',
      agentName: 'Trader',
      status: 'ok',
      summary: 'No summary available',
      sessionKey: 'chat-1',
    })
    expect(output.fullOutput).toContain('"signal": "HOLD"')
    expect(output.timestamp).toBe(Date.parse('2026-09-11T06:00:00.000Z'))
  })

  it('keeps errors and delivery summaries visible when output is absent', () => {
    const output = normalizeCronOutput(
      { id: 'job-2', name: 'nightly-research' },
      {
        id: 'run-2',
        status: 'error',
        startedAt: null,
        finishedAt: '2026-09-11T06:05:00.000Z',
        error: 'Gateway unavailable',
        deliverySummary: 'Delivery was not attempted',
      },
    )

    expect(output).toMatchObject({
      agentId: 'nightly-research',
      agentName: 'Nightly Research',
      status: 'error',
      summary: 'Gateway unavailable',
      error: 'Gateway unavailable',
    })
    expect(output.fullOutput).toBe('Delivery was not attempted')
    expect(output.timestamp).toBe(Date.parse('2026-09-11T06:05:00.000Z'))
  })
})
