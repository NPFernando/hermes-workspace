import { test, expect } from '@playwright/test'

/**
 * Dashboard loading-animation rebuild.
 *
 * Stalls /api/dashboard/overview so the first-load skeleton pass is
 * observable, then releases it and asserts skeletons are replaced by real
 * content. Requires an authed storage state (scripts/create-e2e-auth-state.mjs)
 * and a reachable workspace — skipped otherwise so the suite stays portable.
 */
test.describe('Dashboard loading state', () => {
  test('shows widget skeletons on first load, then real content', async ({
    page,
  }) => {
    let release: (() => void) | undefined
    const gate = new Promise<void>((resolve) => {
      release = resolve
    })

    // Hold the overview aggregate until we've asserted the skeleton pass.
    await page.route('**/api/dashboard/overview*', async (route) => {
      await gate
      await route.continue()
    })

    await page.goto('/dashboard')
    await page.waitForLoadState('domcontentloaded')

    // Dismiss the "Hermes updated" modal if it appears.
    const continueBtn = page.getByRole('button', { name: 'Continue' })
    if (await continueBtn.isVisible({ timeout: 5000 }).catch(() => false)) {
      await continueBtn.click()
    }

    // If we landed on the password gate there is no auth state — skip.
    const gated = await page
      .locator('#lp-pw')
      .isVisible({ timeout: 2000 })
      .catch(() => false)
    test.skip(gated, 'No authed storage state; run scripts/create-e2e-auth-state.mjs')

    // Skeletons visible while the aggregate is stalled.
    const skeletons = page.locator('[data-slot="skeleton"]')
    await expect(skeletons.first()).toBeVisible({ timeout: 10_000 })

    // Release the aggregate; skeletons give way to real widgets.
    release?.()

    await expect
      .poll(() => skeletons.count(), { timeout: 15_000 })
      .toBe(0)

    // A real KPI heading renders (Hero metrics / analytics tiles).
    await expect(
      page.getByRole('heading', { name: 'Hermes Workspace' }),
    ).toBeVisible()
  })
})
