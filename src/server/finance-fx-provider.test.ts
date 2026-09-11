import { describe, expect, it } from 'vitest'
import { assessFxProviderHealth } from './finance-fx-provider'

describe('assessFxProviderHealth', () => {
  const now = Date.parse('2026-09-10T12:00:00.000Z')

  it('reports unknown when no provider quote exists', () => {
    expect(assessFxProviderHealth([], now).status).toBe('unknown')
  })

  it('reports healthy for a recent provider observation', () => {
    expect(
      assessFxProviderHealth(
        [{ source: 'frankfurter:v2', date: '2026-09-09', observedAt: '2026-09-10T09:00:00.000Z' }],
        now,
      ),
    ).toMatchObject({ status: 'healthy', source: 'frankfurter:v2', latestRateDate: '2026-09-09' })
  })

  it('uses the newest observation and reports stale data', () => {
    expect(
      assessFxProviderHealth(
        [
          { source: 'frankfurter:v2', date: '2026-08-01', observedAt: '2026-08-02T09:00:00.000Z' },
          { source: 'frankfurter:v2', date: '2026-08-03', observedAt: '2026-08-04T09:00:00.000Z' },
        ],
        now,
      ),
    ).toMatchObject({ status: 'stale', latestRateDate: '2026-08-03' })
  })

  it('does not treat manual rates as provider health evidence', () => {
    expect(
      assessFxProviderHealth([
        { source: 'manual', date: '2026-09-10', observedAt: '2026-09-10T09:00:00.000Z' },
      ], now).status,
    ).toBe('unknown')
  })
})
