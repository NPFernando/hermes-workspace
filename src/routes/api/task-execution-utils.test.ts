import { describe, expect, it } from 'vitest'
import { parseWorkSummary } from './task-execution-utils'

describe('parseWorkSummary', () => {
  it('classifies null exit status as a timed-out execution', () => {
    const parsed = parseWorkSummary('', '', null)

    expect(parsed.status).toBe('timed_out')
    expect(parsed.actionLabel).toBe('timed_out')
    expect(parsed.newColumn).toBe('blocked')
    expect(parsed.note).toContain('Execution timed out after 20 min')
    expect(parsed.note).not.toContain('hermes exited with code null')
  })

  it('keeps explicit done summaries as completed', () => {
    const parsed = parseWorkSummary(
      '<WORK_SUMMARY>\nSTATUS: done\nSUMMARY: already implemented\nNEXT:\n</WORK_SUMMARY>',
      '',
      0,
    )

    expect(parsed.status).toBe('done')
    expect(parsed.actionLabel).toBe('completed')
    expect(parsed.newColumn).toBe('review')
  })
})
