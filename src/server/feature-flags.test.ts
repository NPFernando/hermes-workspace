import { describe, expect, it } from 'vitest'
import { getFeatureFlag, getFeatureFlagSnapshot } from './feature-flags'

describe('staged feature flags', () => {
  it('is deterministic for the same subject and supports full rollout', () => {
    const env = { HERMES_FEATURE_FLAGS: '{"dashboard-dr-evidence":{"enabled":true,"rolloutPercent":100}}' }
    const first = getFeatureFlag('dashboard-dr-evidence', 'operator-1', env)
    const second = getFeatureFlag('dashboard-dr-evidence', 'operator-1', env)
    expect(first).toEqual(second)
    expect(first.enabledForSubject).toBe(true)
  })

  it('fails closed for disabled flags and clamps rollout values', () => {
    const env = {
      HERMES_FEATURE_FLAGS:
        '{"dashboard-dr-evidence":{"enabled":false,"rolloutPercent":200},"dashboard-service-health-history":{"enabled":true,"rolloutPercent":-10}}',
    }
    expect(getFeatureFlag('dashboard-dr-evidence', 'operator-1', env)).toMatchObject({
      enabled: false,
      rolloutPercent: 100,
      enabledForSubject: false,
    })
    expect(getFeatureFlag('dashboard-service-health-history', 'operator-1', env)).toMatchObject({
      enabled: true,
      rolloutPercent: 0,
      enabledForSubject: false,
    })
  })

  it('returns only value-blind decisions for known dashboard flags', () => {
    const snapshot = getFeatureFlagSnapshot('operator-1', {})
    expect(snapshot.map((flag) => flag.name)).toEqual([
      'dashboard-dr-evidence',
      'dashboard-service-health-history',
    ])
    expect(snapshot[0]).not.toHaveProperty('secret')
  })
})
