import { test, expect } from '@playwright/test'

/**
 * Dashboard loading-animation rebuild.
 *
 * Delays /api/dashboard/overview so the first-load skeleton pass is
 * observable, then lets it through and asserts skeletons are replaced by
 * real content. Requires an authed storage state
 * (scripts/create-e2e-auth-state.mjs) and a reachable workspace — skips
 * cleanly otherwise so the suite stays portable.
 */
test.describe('Dashboard loading state', () => {
  test('shows widget skeletons on first load, then real content', async ({
    page,
  }) => {
    // Hold the overview aggregate ~2s so the first-load skeletons are
    // guaranteed to paint, then let the real request through.
    await page.route('**/api/dashboard/overview*', async (route) => {
      await new Promise((r) => setTimeout(r, 2000))
      await route.continue()
    })

    await page.goto('/dashboard')
    await page.waitForLoadState('domcontentloaded')

    // Dismiss the "Hermes updated" modal if it appears.
    const continueBtn = page.getByRole('button', { name: 'Continue' })
    if (await continueBtn.isVisible({ timeout: 5000 }).catch(() => false)) {
      await continueBtn.click()
    }

    // If we're on the password gate there's no auth state — skip.
    const gated = await page
      .locator('#lp-pw')
      .isVisible({ timeout: 5000 })
      .catch(() => false)
    test.skip(gated, 'No authed storage state; run scripts/create-e2e-auth-state.mjs')

    const skeletons = page.locator('[data-slot="skeleton"]')
    const loadingWidgets = page.getByRole('status', { name: 'Loading widget' })

    // First load: overview-backed widgets show shape-matched skeletons.
    await expect(skeletons.first()).toBeVisible({ timeout: 10_000 })
    await expect(loadingWidgets.first()).toBeVisible()

    // Once the aggregate resolves, every widget skeleton is gone and a real
    // card has rendered in its place.
    await expect
      .poll(() => skeletons.count(), { timeout: 30_000, intervals: [500] })
      .toBe(0)
    await expect(page.getByRole('heading', { name: 'Top models' })).toBeVisible()

    // The brand lockup (never skeletoned) is present throughout.
    await expect(
      page.getByRole('heading', { name: 'Hermes Workspace', level: 1 }),
    ).toBeVisible()
  })

  test('period switch keeps the grid — no full skeleton flash', async ({
    page,
  }) => {
    let overviewHits = 0
    await page.route('**/api/dashboard/overview*', async (route) => {
      overviewHits += 1
      // Fast initial load; hold every later refetch long enough that the
      // background state is unambiguously observable regardless of dev-server
      // compile jitter.
      if (overviewHits > 1) await new Promise((r) => setTimeout(r, 6000))
      await route.continue()
    })

    await page.goto('/dashboard')
    await page.waitForLoadState('domcontentloaded')

    const gated = await page
      .locator('#lp-pw')
      .isVisible({ timeout: 5000 })
      .catch(() => false)
    test.skip(gated, 'No authed storage state')

    const topModels = page.getByRole('heading', { name: 'Top models' })
    await expect(topModels).toBeVisible({ timeout: 30_000 })

    // Switch to a different period (default is 30d) and watch the refetch.
    const activeBefore = await page
      .getByRole('tab', { selected: true })
      .textContent()
    const target = activeBefore?.trim() === '7d' ? '14d' : '7d'
    await page.getByRole('tab', { name: target, exact: true }).click()

    // The low-key refresh bar appears during the (6s-held) refetch.
    await expect
      .poll(() => page.locator('.refresh-bar').count(), { timeout: 8_000 })
      .toBeGreaterThan(0)

    // …and throughout that window the grid never drops to skeletons — the
    // card stays mounted with the previous period's data.
    let maxSkeletons = 0
    for (let i = 0; i < 15; i++) {
      maxSkeletons = Math.max(
        maxSkeletons,
        await page.locator('[data-slot="skeleton"]').count(),
      )
      await page.waitForTimeout(200)
    }
    expect(maxSkeletons).toBe(0)
    await expect(topModels).toBeVisible()
  })
})
