#!/usr/bin/env node
/**
 * Authenticated queue smoke test.
 *
 * Holds the first send-stream request open so the second `/queue` command is
 * submitted while the agent is busy. No prompt reaches the agent backend.
 * Usage: AUTH_E2E_PASSWORD='...' node scripts/queue-browser-smoke.mjs
 */
import { chromium } from 'playwright'

const baseUrl = (
  process.env.AUTH_E2E_BASE_URL ||
  process.env.BASE_URL ||
  'http://127.0.0.1:3000'
).replace(/\/$/, '')
const password = process.env.AUTH_E2E_PASSWORD

if (!password) {
  console.error(
    '❌ Set AUTH_E2E_PASSWORD explicitly; no credential files are read.',
  )
  process.exit(2)
}

const browser = await chromium.launch({ headless: true })
const context = await browser.newContext({
  viewport: { width: 1280, height: 900 },
})
const page = await context.newPage()
let secondPage = null
let failures = 0

function fail(message) {
  console.error(`❌ ${message}`)
  failures++
}

async function expectVisible(locator, message, timeout = 15_000) {
  try {
    await locator.waitFor({ state: 'visible', timeout })
    console.log(`✅ ${message}`)
  } catch {
    fail(message)
  }
}

try {
  await page.goto(`${baseUrl}/dashboard`, { waitUntil: 'domcontentloaded' })
  const passwordInput = page.locator('#lp-pw')
  if (await passwordInput.isVisible().catch(() => false)) {
    await passwordInput.fill(password)
    await page.getByRole('button', { name: 'Sign In', exact: true }).click()
  }
  await expectVisible(
    page.getByRole('heading', { name: 'Hermes Workspace', level: 1 }),
    'authenticated workspace loads',
  )

  const heldRequests = []
  await page.route('**/api/send-stream', async (route) => {
    heldRequests.push(route)
    await new Promise(() => {})
  })

  await page.goto(`${baseUrl}/chat/main`, { waitUntil: 'domcontentloaded' })
  const composer = page.locator('textarea').first()
  await expectVisible(composer, 'chat composer is available')

  await composer.fill('/queue first smoke prompt')
  await composer.press('Enter')
  await expectVisible(
    page.getByRole('status', { name: /sending one queued message/i }),
    'first queued prompt enters the active busy state',
  )

  await composer.fill('/queue second smoke prompt')
  await composer.press('Enter')
  await expectVisible(
    page.getByText('second smoke prompt', { exact: false }),
    'second /queue prompt is accepted while the agent is busy',
  )

  // A second tab must observe the persisted queue but must not drain it while
  // this tab owns the in-flight lease. This catches duplicate execution that
  // a single-tab smoke test cannot see.
  secondPage = await context.newPage()
  let secondTabRequests = 0
  await secondPage.route('**/api/send-stream', async (route) => {
    secondTabRequests += 1
    await route.abort('failed')
  })
  await secondPage.goto(`${baseUrl}/chat/main`, { waitUntil: 'domcontentloaded' })
  await expectVisible(
    secondPage.getByText('second smoke prompt', { exact: false }),
    'second tab sees the persisted queued prompt',
  )
  await secondPage.waitForTimeout(1_000)
  if (secondTabRequests > 0) {
    fail('second tab attempted to execute a queue item already owned by the first tab')
  } else {
    console.log('✅ second tab does not duplicate the active queued prompt')
  }

  await page.getByRole('button', { name: 'Stop generation' }).first().click()
  await expectVisible(
    page.getByRole('status', { name: /paused.*chat messages/i }),
    'stopping an active queued prompt preserves and pauses the queue',
  )
} finally {
  await page.unroute('**/api/send-stream').catch(() => undefined)
  await secondPage?.close().catch(() => undefined)
  await context.close()
  await browser.close()
}

if (failures > 0) process.exit(1)
