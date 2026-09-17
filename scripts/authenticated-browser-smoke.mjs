#!/usr/bin/env node
/**
 * Authenticated route smoke test. Credentials are supplied only through the
 * environment; this script never reads a password from disk.
 *
 * AUTH_E2E_PASSWORD='...' AUTH_E2E_BASE_URL=https://... \
 *   node scripts/authenticated-browser-smoke.mjs
 *
 * Set AUTH_E2E_EXPECTED_BUILD to the build header captured before a rollback
 * to prove the authenticated browser is served by the restored artifact.
 */
import { chromium } from 'playwright'

const baseUrl = (
  process.env.AUTH_E2E_BASE_URL ||
  process.env.BASE_URL ||
  'http://127.0.0.1:3000'
).replace(/\/$/, '')
const password = process.env.AUTH_E2E_PASSWORD
const expectedBuild = process.env.AUTH_E2E_EXPECTED_BUILD?.trim() || null
if (!password) {
  console.error(
    'Set AUTH_E2E_PASSWORD explicitly; no credential files are read.',
  )
  process.exit(2)
}

const routes = [
  { path: '/dashboard', pattern: /Hermes Workspace|Dashboard/i },
  { path: '/ops-cost', pattern: /Cost & Routing/i, timeout: 90_000 },
  {
    path: '/personal-finance',
    pattern: /Your money at a glance/i,
    timeout: 45_000,
  },
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
page.setDefaultNavigationTimeout(90_000)
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

async function bodyMatches(pattern, message, timeout = 15_000) {
  await page
    .waitForFunction(
      ({ source, flags }) =>
        new RegExp(source, flags).test(document.body?.innerText || ''),
      { source: pattern.source, flags: pattern.flags },
      { timeout },
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
  if (expectedBuild) {
    check(
      initial?.headers()['x-workspace-build'] === expectedBuild,
      `authenticated browser is served by expected build ${expectedBuild}`,
    )
  }
  const login = page.locator('#lp-pw')
  const workspaceHeading = page.getByRole('heading', {
    name: /Hermes Workspace/i,
    level: 1,
  })
  // The login panel is rendered after client hydration. Race it against the
  // authenticated surface so a fast DOMContentLoaded does not skip sign-in.
  const initialAuthTimeout = 60_000
  const initialAuthState = await Promise.race([
    login
      .waitFor({ state: 'visible', timeout: initialAuthTimeout })
      .then(() => 'login')
      .catch(() => null),
    workspaceHeading
      .waitFor({ state: 'visible', timeout: initialAuthTimeout })
      .then(() => 'authenticated')
      .catch(() => null),
  ])
  if (!initialAuthState) {
    throw new Error(
      `dashboard did not hydrate within ${initialAuthTimeout}ms; ` +
        `login=${await login.isVisible().catch(() => false)} ` +
        `heading=${await workspaceHeading.isVisible().catch(() => false)} ` +
        `body=${(
          await page
            .locator('body')
            .innerText()
            .catch(() => '')
        ).slice(0, 500)}`,
    )
  }
  if (initialAuthState === 'login') {
    await login.fill(password)
    await page.getByRole('button', { name: 'Sign In', exact: true }).click()
  }
  await workspaceHeading.waitFor({
    state: 'visible',
    timeout: initialAuthTimeout,
  })
  const splashVisible = await page
    .locator('#splash-screen')
    .evaluate((element) => getComputedStyle(element).display !== 'none')
  check(!splashVisible, 'pre-hydration splash is hidden after app mount')
  check(
    (await page
      .locator('[data-testid="connection-startup-screen"]:visible')
      .count()) === 0,
    'connection startup overlay is not duplicated over the authenticated workspace',
  )
  check(
    pageErrors.length === 0,
    `dashboard has no uncaught browser errors${pageErrors.length ? `: ${pageErrors.join('; ')}` : ''}`,
  )
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
      route.timeout,
    )
    if (route.path === '/ops-cost') {
      await bodyMatches(
        /Agent control plane|HARP memory readiness|Dispatch queue/i,
        'ops dashboard renders its read-only agent control-plane section',
      )
    }
  }

  const authenticatedApiChecks = [
    {
      path: '/api/finance/summary',
      valid: (body) => body?.ok === true && body?.summary,
      label: 'Finance summary API returns an authenticated payload',
    },
    {
      path: '/api/dify-status',
      valid: (body) =>
        body?.ok === true && typeof body?.available === 'boolean',
      label: 'Dify status API returns an authenticated provider result',
    },
    {
      path: '/api/swarm-dispatch',
      valid: (body) =>
        Array.isArray(body?.waiting) && Array.isArray(body?.recent),
      label: 'queue API returns an authenticated recovery snapshot',
    },
  ]
  for (const api of authenticatedApiChecks) {
    const result = await page.evaluate(async (path) => {
      const response = await fetch(path, { cache: 'no-store' })
      return {
        status: response.status,
        body: await response.json().catch(() => null),
      }
    }, api.path)
    check(result.status === 200 && api.valid(result.body), api.label)
  }

  // Keep the smoke test side-effect free: exercise `/queue` parsing/UI while
  // preventing a real prompt from reaching an agent backend.
  await page.route('**/api/send-stream', (route) =>
    route.abort('blockedbyclient'),
  )
  await page.goto(`${baseUrl}/chat/main`, { waitUntil: 'domcontentloaded' })
  const promptInput = page.locator('textarea:visible').last()
  await promptInput.waitFor({ state: 'visible', timeout: 30_000 })
  await promptInput.fill('/queue browser smoke')
  await page.getByRole('button', { name: 'Send message', exact: true }).click()
  await page.waitForFunction(
    () =>
      Object.entries(window.localStorage).some(([key, value]) => {
        if (!key.startsWith('claude.chat-queue.v1.')) return false
        try {
          const prompts = JSON.parse(value)
          return (
            Array.isArray(prompts) &&
            prompts.some((prompt) => prompt?.text === 'browser smoke')
          )
        } catch {
          return false
        }
      }),
    undefined,
    { timeout: 15_000 },
  )
  check(
    true,
    '/queue command is accepted and persisted in the authenticated chat',
  )
  await page.unroute('**/api/send-stream')

  await page.reload({ waitUntil: 'domcontentloaded' })
  await page.waitForFunction(
    () =>
      Object.entries(window.localStorage).some(([key, value]) => {
        if (!key.startsWith('claude.chat-queue.v1.')) return false
        try {
          const prompts = JSON.parse(value)
          return (
            Array.isArray(prompts) &&
            prompts.some((prompt) => prompt?.text === 'browser smoke')
          )
        } catch {
          return false
        }
      }),
    undefined,
    { timeout: 15_000 },
  )
  check(true, '/queue item survives an authenticated page reload')

  // Verify the touch-first command path and recover back to the dashboard.
  await page.setViewportSize({ width: 390, height: 844 })
  // The dashboard route uses the shared command palette without rendering the
  // non-chat mobile page header. Exercise the same touch-first command path
  // through its stable open event instead of a route-specific button that may
  // not exist on this screen.
  const commandInput = page.getByPlaceholder(
    'Search screens, sessions, and commands',
  )
  // A full reload can finish DOMContentLoaded before the shared palette has
  // mounted its event listener. Retry the idempotent open request instead of
  // treating that hydration race as an authenticated smoke failure.
  for (let attempt = 0; attempt < 3; attempt += 1) {
    await page.evaluate(() => {
      window.dispatchEvent(new CustomEvent('workspace:open-command-palette'))
    })
    if (await commandInput.isVisible().catch(() => false)) break
    await commandInput
      .waitFor({ state: 'visible', timeout: 10_000 })
      .catch(() => {})
  }
  await commandInput.fill('Settings')
  await page.getByText('Settings', { exact: true }).last().click()
  await page.waitForURL(/\/settings(?:[/?]|$)/)
  check(true, 'mobile command search opens Settings')
  await page.setViewportSize({ width: 1280, height: 900 })
} finally {
  await context.close()
  await browser.close()
}

process.exitCode = failures > 0 ? 1 : 0
