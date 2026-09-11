/**
 * Pure release-smoke predicates. Keep these independent of fetch so they can
 * be regression-tested without starting or contacting a workspace server.
 */
export function inspectDashboardStartup(html) {
  const legacySplashTimers = (
    html.match(/setTimeout\(function\(\)\{\s*window\.__dismissSplash/g) || []
  ).length
  const visibleSplashMarker =
    /id=["']splash-screen["'][^>]*style=["'][^"']*display\s*:\s*flex/i.test(
      html,
    )
  return {
    legacySplashTimers,
    visibleSplashMarker,
    healthy: legacySplashTimers === 0 && !visibleSplashMarker,
  }
}
