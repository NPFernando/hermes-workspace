import { describe, expect, it } from 'vitest'
import { summarizeLifecycleSweep } from './swarm-lifecycle'

describe('summarizeLifecycleSweep', () => {
  it('returns only aggregate scheduler-safe metadata', () => {
    expect(
      summarizeLifecycleSweep([
        { action: 'none' },
        { action: 'request-handoff', result: { ok: true } },
        { action: 'renew', result: { ok: false } },
        { action: 'renew', result: { ok: true } },
      ]),
    ).toEqual({
      processed: 4,
      actions: { none: 1, 'request-handoff': 1, renew: 2 },
      failed: 1,
    })
  })

  it('handles an empty sweep without inventing worker details', () => {
    expect(summarizeLifecycleSweep([])).toEqual({
      processed: 0,
      actions: {},
      failed: 0,
    })
  })
})
