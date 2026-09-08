import { test, expect } from '@playwright/test'

/**
 * Route Combos editor on the HARP settings screen.
 *
 * Stubs /api/harp-config (GET fixture + PATCH interception) so the test needs
 * no real harp-config.yaml, then drives Add combo -> Add step -> toggle
 * Enabled and asserts each fires the right patch body. Requires an authed
 * storage state; skips cleanly otherwise.
 */

const BASE_VIEW = {
  ok: true,
  available: true,
  configPath: '/tmp/harp-config.yaml',
  candidatePaths: ['/tmp/harp-config.yaml'],
  global: {
    enabled: true,
    mode: 'tiered_with_degradation',
    auto_route: true,
    route_delegation_only: false,
    allow_paid_benchmarking: false,
    paid_benchmark_daily_cap_usd: 0.1,
    require_paid_final_review_for_production: false,
  },
  tiers: [],
  blocklist: [],
  autoImprove: { enabled: false, script: '', trigger: [], min_evals_to_rank: 3, report_dir: '', deliver: '' },
  combos: { enabled: false, enforce: false, entries: [] as Array<unknown> },
}

test.describe('HARP Route Combos editor', () => {
  test('add combo, add step, toggle enabled — patch bodies', async ({ page }) => {
    const patches: Array<Record<string, unknown>> = []
    let combos = { enabled: false, enforce: false, entries: [] as Array<any> }

    await page.route('**/api/harp-config', async (route) => {
      const req = route.request()
      if (req.method() === 'GET') {
        await route.fulfill({ json: { ...BASE_VIEW, combos } })
        return
      }
      const body = req.postDataJSON() as Record<string, unknown>
      patches.push(body)
      // maintain just enough state for the UI to re-render
      if (body.action === 'add-combo') {
        combos = { ...combos, entries: [...combos.entries, { name: body.name, steps: [] }] }
      } else if (body.action === 'add-combo-step') {
        combos = {
          ...combos,
          entries: combos.entries.map((c) =>
            c.name === body.name ? { ...c, steps: [...c.steps, body.step] } : c,
          ),
        }
      } else if (body.action === 'set-combos-global') {
        combos = { ...combos, [body.field as string]: body.value }
      }
      await route.fulfill({ json: { ...BASE_VIEW, combos } })
    })

    await page.goto('/settings?section=harp')
    await page.waitForLoadState('domcontentloaded')

    const gated = await page
      .locator('#lp-pw')
      .isVisible({ timeout: 5000 })
      .catch(() => false)
    test.skip(gated, 'No authed storage state; run scripts/create-e2e-auth-state.mjs')

    const section = page.locator('div', { has: page.getByRole('heading', { name: 'Route Combos' }) })
    await expect(page.getByRole('heading', { name: 'Route Combos' })).toBeVisible({ timeout: 15_000 })

    // Add a combo
    await section.getByRole('button', { name: 'Add combo' }).click()
    await section.getByPlaceholder('combo name (kebab-case)').fill('cr')
    await section.getByRole('button', { name: 'Create' }).click()
    await expect.poll(() => patches.at(-1)).toEqual({ action: 'add-combo', name: 'cr' })

    // Add a step
    await section.getByPlaceholder(/provider\/model-id/).fill('openrouter/deepseek/deepseek-v4-flash')
    await section.getByRole('button', { name: 'Add step' }).click()
    await expect
      .poll(() => patches.at(-1))
      .toEqual({ action: 'add-combo-step', name: 'cr', step: 'openrouter/deepseek/deepseek-v4-flash' })

    // Toggle enabled
    await section.getByRole('button', { name: 'Combos enabled' }).click()
    await expect
      .poll(() => patches.at(-1))
      .toEqual({ action: 'set-combos-global', field: 'enabled', value: true })
  })
})
