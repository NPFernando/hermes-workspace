import { describe, expect, it } from 'vitest'
import { quotaAlert } from './ai-usage-panel'

describe('quotaAlert', () => {
  const line = (used: number, limit = 100) => ({
    type: 'progress' as const,
    label: 'Weekly',
    used,
    limit,
    format: 'percent' as const,
  })

  it('warns at 75 percent and marks 90 percent as critical', () => {
    expect(quotaAlert(line(74.9))).toBeNull()
    expect(quotaAlert(line(75))).toBe('warning')
    expect(quotaAlert(line(90))).toBe('critical')
  })

  it('marks exhausted and over-limit usage as reached', () => {
    expect(quotaAlert(line(100))).toBe('limit')
    expect(quotaAlert(line(125))).toBe('limit')
  })

  it('does not alert on text, badges, or unusable limits', () => {
    expect(
      quotaAlert({ type: 'text', label: 'Tokens', used: 100, limit: 100 }),
    ).toBeNull()
    expect(quotaAlert(line(10, 0))).toBeNull()
  })
})
