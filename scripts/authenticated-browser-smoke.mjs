#!/usr/bin/env node
/**
 * Authenticated route smoke test. Credentials are supplied only through the
 * environment; this script never reads a password from disk.
 *
 * AUTH_E2E_PASSWORD='...' AUTH_E2E_BASE_URL=https://... \
 *   node scripts/authenticated-browser-smoke.mjs
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
    'Set AUTH_E2E_PASSWORD explicitly; no credential files are read.',
  )
  process.exit(2)
}

const routes = [
  { path: '/dashboard', pattern: /Hermes Workspace|Dashboard/i },
  { path: '/ops-cost', pattern: /Cost & Routing/i },
  { path: '/personal-finance', pattern: /Money clarity|Personal finance/i },
  { path: '/dify', pattern: /Dify Workbench/i },
]
// Allow hosts with a system Chromium but no Playwright browser download.
const browser = await chromium.launch({
  headless: true,
  ...(process.env.AUTH_E2E_CHROMIUM_PATH
    ? { executablePath: process.env.AUTH_E2E_CHROMIUM_PATH }
    : {}),
})
const context = await browser.newContext({
  viewport: { width: 1280, height: 900 },
})
const page = await context.newPage()
let failures = 0
const pageErrors = []
page.on('pageerror', (error) => pageErrors.push(error.message))

function check(condition, message) {
  if (condition) console.log(`✅ ${message}`)
  else {
    console.error(`❌ ${message}`)
    failures++
  }
}

async function bodyMatches(pattern, message) {
  await page
    .waitForFunction(
      ({ source, flags }) =>
        new RegExp(source, flags).test(document.body?.innerText || ''),
      { source: pattern.source, flags: pattern.flags },
      { timeout: 15_000 },
    )
    .catch(() => {})
  const text = await page
    .locator('body')
    .innerText()
    .catch(() => '')
  check(pattern.test(text), message)
}

try {
  const initial = await page.goto(`${baseUrl}/dashboard`, {
    waitUntil: 'domcontentloaded',
  })
  check(
    Boolean(initial && initial.status() < 500),
    'dashboard responds without a server error',
  )
  const login = page.locator('#lp-pw')
  const workspaceHeading = page.getByRole('heading', {
    name: /Hermes Workspace/i,
    level: 1,
  })
  // The login panel is rendered after client hydration. Race it against the
  // authenticated surface so a fast DOMContentLoaded does not skip sign-in.
  const initialAuthState = await Promise.race([
    login
      .waitFor({ state: 'visible', timeout: 15_000 })
      .then(() => 'login')
      .catch(() => null),
    workspaceHeading
      .waitFor({ state: 'visible', timeout: 15_000 })
      .then(() => 'authenticated')
      .catch(() => null),
  ])
  if (initialAuthState === 'login') {
    await login.fill(password)
    await page.getByRole('button', { name: 'Sign In', exact: true }).click()
  }
  await workspaceHeading.waitFor({ state: 'visible', timeout: 45_000 })
  const splashVisible = await page
    .locator('#splash-screen')
    .evaluate((element) => getComputedStyle(element).display !== 'none')
  check(!splashVisible, 'pre-hydration splash is hidden after app mount')
  check(
    (await page.locator('[data-testid="connection-startup-screen"]:visible').count()) === 0,
    'connection startup overlay is not duplicated over the authenticated workspace',
  )
  check(pageErrors.length === 0, `dashboard has no uncaught browser errors${pageErrors.length ? `: ${pageErrors.join('; ')}` : ''}`)
  const auth = await page.evaluate(async () =>
    (await fetch('/api/auth-check', { cache: 'no-store' })).json(),
  )
  check(
    auth?.authenticated === true,
    'auth-check confirms the authenticated session',
  )

  for (const route of routes) {
    const response = await page.goto(`${baseUrl}${route.path}`, {
      waitUntil: 'domcontentloaded',
    })
    check(
      Boolean(response && response.status() < 500),
      `${route.path} responds without a server error`,
    )
    await bodyMatches(
      route.pattern,
      `${route.path} renders its authenticated surface`,
    )
    if (route.path === '/ops-cost') {
      await bodyMatches(
        /Agent control plane|HARP memory readiness|Dispatch queue/i,
        'ops dashboard renders its read-only agent control-plane section',
      )
    }
  }

  // Keep the smoke test side-effect free: exercise `/queue` parsing/UI while
  // preventing a real prompt from reaching an agent backend.
  await page.route('**/api/send-stream', (route) =>
    route.abort('blockedbyclient'),
  )
  await page.goto(`${baseUrl}/chat/main`, { waitUntil: 'domcontentloaded' })
  const promptInput = page.locator('textarea:visible').last()
  await promptInput
    .waitFor({ state: 'visible', timeout: 30_000 })
  await promptInput.fill('/queue browser smoke')
  await promptInput.press('Enter')
  await bodyMatches(
    /browser smoke|queue/i,
    '/queue command is accepted in the authenticated chat',
  )
  await page.unroute('**/api/send-stream')
} finally {
  await context.close()
  await browser.close()
}

process.exitCode = failures > 0 ? 1 : 0
