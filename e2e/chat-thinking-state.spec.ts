import { test, expect } from '@playwright/test'

const completedSessionKey =
  process.env.HERMES_WORKSPACE_E2E_COMPLETED_SESSION?.trim() || ''

test.describe('Chat thinking state #449', () => {
  test.skip(
    !completedSessionKey,
    'Set HERMES_WORKSPACE_E2E_COMPLETED_SESSION to a completed chat session key.',
  )

  test('should not show stale thinking state after page refresh for completed session', async ({
    page,
  }) => {
    // This test simulates the exact bug scenario described in Issue #449:
    // User had a conversation, the stream completed (clearing waiting state),
    // page refreshes, and the assistant briefly shows "thinking" state.

    // CI provides a completed session fixture; no production session is baked
    // into the suite, so the test remains reproducible across environments.
    const sessionPath = `/chat/${encodeURIComponent(completedSessionKey)}`

    // Inject a stale waiting entry for THIS session before the page loads
    await page.addInitScript(
      (sessionKey) => {
        window.sessionStorage.setItem(
          `claude_waiting_${sessionKey}`,
          JSON.stringify({
            since: Date.now() - 30000, // 30s ago — within the 120s TTL
            runId: 'stale-run-id',
          }),
        )
      },
      completedSessionKey,
    )

    // Navigate directly to the session
    await page.goto(sessionPath)
    await page.waitForLoadState('load')

    // Dismiss the "Hermes updated" modal if present
    const continueBtn = page.getByRole('button', { name: 'Continue' })
    if (await continueBtn.isVisible({ timeout: 5000 }).catch(() => false)) {
      await continueBtn.click()
    }

    // Wait for app rehydration, Zustand store init, sessionStorage restore,
    // and the active-run API check to complete
    await page.waitForTimeout(5000)

    // VERIFY: No thinking indicator is visible after page refresh.
    // The stale sessionStorage entry should have been cleared by the
    // active-run API check, and the fix gates thinking on that check.
    const thinkingIndicator = page.locator(
      '[data-testid="thinking-indicator"], [aria-label="Assistant thinking"], .thinking-indicator, [data-thinking="true"]',
    )
    const thinkingCount = await thinkingIndicator.count()
    expect(thinkingCount).toBe(0)

    // VERIFY: The stale sessionStorage entry was cleaned up
    await expect
      .poll(
        () =>
          page.evaluate((key) => {
            return window.sessionStorage.getItem(`claude_waiting_${key}`)
          }, completedSessionKey),
        { timeout: 5_000 },
      )
      .toBeNull()
  })
})
