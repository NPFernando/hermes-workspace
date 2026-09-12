import { describe, expect, it } from 'vitest'
import { formatSyncAge, gmailSyncHealth } from './gmail-sync-health'

describe('Gmail sync health', () => {
  const now = 1_800_000_000

  it('distinguishes never synced, fresh, stale, and a newer failed run', () => {
    expect(gmailSyncHealth(null, null, now)).toBe('never')
    expect(gmailSyncHealth(now - 3_600, null, now)).toBe('healthy')
    expect(gmailSyncHealth(now - 27 * 3_600, null, now)).toBe('stale')
    expect(gmailSyncHealth(now - 3_600, now - 1_800, now)).toBe('failed')
    expect(gmailSyncHealth(now - 3_600, now - 7_200, now)).toBe('healthy')
  })

  it('formats the age of the last successful run for people', () => {
    expect(formatSyncAge(now - 20, now)).toBe('just now')
    expect(formatSyncAge(now - 5 * 60, now)).toBe('5 minutes ago')
    expect(formatSyncAge(now - 3 * 3_600, now)).toBe('3 hours ago')
    expect(formatSyncAge(now - 2 * 86_400, now)).toBe('2 days ago')
  })
})
