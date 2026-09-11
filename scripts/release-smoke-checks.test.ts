import { describe, expect, it } from 'vitest'
import { inspectDashboardStartup } from './release-smoke-checks.mjs'

describe('dashboard release smoke predicates', () => {
  it('accepts the single-owner startup contract', () => {
    expect(
      inspectDashboardStartup(
        '<div id="splash-screen" style="display:none"></div><script>window.__dismissSplash=function(){}</script>',
      ),
    ).toEqual({
      legacySplashTimers: 0,
      visibleSplashMarker: false,
      healthy: true,
    })
  })

  it('rejects legacy delayed splash dismissal', () => {
    const result = inspectDashboardStartup(
      '<script>setTimeout(function(){ window.__dismissSplash && window.__dismissSplash(); }, 5000)</script>',
    )
    expect(result.legacySplashTimers).toBe(1)
    expect(result.healthy).toBe(false)
  })

  it('rejects a visible splash marker', () => {
    const result = inspectDashboardStartup(
      '<div id="splash-screen" style="display:flex"></div>',
    )
    expect(result).toMatchObject({
      legacySplashTimers: 0,
      visibleSplashMarker: true,
      healthy: false,
    })
  })
})
