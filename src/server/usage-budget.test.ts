import { describe, expect, it } from 'vitest'
import { detectUsageAnomalies } from './usage-budget'

function sample(day: string, used: number) {
  return {
    day,
    provider: 'openrouter',
    displayName: 'OpenRouter',
    label: 'Daily spend',
    measure: 'spend' as const,
    used,
  }
}

describe('usage anomaly detection', () => {
  it('reports a latest-day spike against a non-zero recent baseline', () => {
    const anomalies = detectUsageAnomalies([
      sample('2026-09-10', 1),
      sample('2026-09-11', 1.2),
      sample('2026-09-12', 0.8),
      sample('2026-09-13', 4),
    ])
    expect(anomalies).toHaveLength(1)
    expect(anomalies[0]).toMatchObject({
      severity: 'critical',
      day: '2026-09-13',
    })
    expect(anomalies[0].ratio).toBeGreaterThan(3)
  })

  it('does not turn missing or zero history into a false positive', () => {
    expect(
      detectUsageAnomalies([
        sample('2026-09-10', 0),
        sample('2026-09-11', 0),
        sample('2026-09-12', 0),
        sample('2026-09-13', 10),
      ]),
    ).toEqual([])
    expect(
      detectUsageAnomalies([
        sample('2026-09-10', 1),
        sample('2026-09-11', 1),
        sample('2026-09-13', 5),
      ]),
    ).toEqual([])
  })
})
