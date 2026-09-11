#!/usr/bin/env node
/**
 * Real authenticated browser smoke against a running workspace.
 *
 * This runner never reads credentials from files. Supply them explicitly:
 *   AUTH_E2E_PASSWORD='...' AUTH_E2E_BASE_URL=https://staging.example.com \
 *     node scripts/authenticated-browser-smoke.mjs
 *
 * Default coverage is mobile (390), tablet (768), and desktop (1280). It
 * covers login, dashboard boot, navigation, refresh, invalid/expired session
 * handling, and both mobile-drawer and desktop-sidebar logout controls.
 *
 * Screenshot capture and regression checks are opt-in:
 *   AUTH_E2E_SCREENSHOT_DIR=/tmp/auth-e2e \
 *   AUTH_E2E_BASELINE_DIR=e2e/authenticated-screenshots \
 *   node scripts/authenticated-browser-smoke.mjs
 *
 * Create or refresh baselines explicitly with AUTH_E2E_UPDATE_SNAPSHOTS=1.
 * Baselines are SHA-256 digests of masked, fixed-viewport shell captures so
 * telemetry values do not make the visual check nondeterministic.
 */
import { createHash } from 'node:crypto'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { chromium } from 'playwright'

const baseUrl = (
  process.env.AUTH_E2E_BASE_URL ||
  process.env.BASE_URL ||
  'http://127.0.0.1:3000'
).replace(/\/$/, '')
const password = process.env.AUTH_E2E_PASSWORD
const screenshotDir = process.env.AUTH_E2E_SCREENSHOT_DIR
const baselineDir = process.env.AUTH_E2E_BASELINE_DIR
const updateSnapshots = process.env.AUTH_E2E_UPDATE_SNAPSHOTS === '1'
const viewportMap = {
  mobile: { width: 390, height: 844 },
  tablet: { width: 768, height: 1024 },
  desktop: { width: 1280, height: 900 },
}
const requestedViewports = (
  process.env.AUTH_E2E_VIEWPORTS || 'mobile,tablet,desktop'
)
  .split(',')
  .map((name) => name.trim())
  .filter(Boolean)

if (!password) {
  console.error(
    '❌ Set AUTH_E2E_PASSWORD explicitly; no credential files are read.',
  )
  process.exit(2)
}

const unknownViewports = requestedViewports.filter(
  (name) => !Object.hasOwn(viewportMap, name),
)
if (unknownViewports.length > 0 || requestedViewports.length === 0) {
  console.error(
    `❌ AUTH_E2E_VIEWPORTS must contain mobile, tablet, or desktop; got ${unknownViewports.join(', ') || 'none'}`,
  )
  process.exit(2)
}

if (baselineDir && !screenshotDir) {
  console.error(
    '❌ AUTH_E2E_BASELINE_DIR requires AUTH_E2E_SCREENSHOT_DIR so captures can be inspected.',
  )
  process.exit(2)
}

let failures = 0

function fail(message) {
  console.error(`❌ ${message}`)
  failures++
}

async function expect(condition, message) {
  if (await condition) console.log(`✅ ${message}`)
  else fail(message)
}

async function visible(locator, timeout = 30_000) {
  return locator
    .waitFor({ state: 'visible', timeout })
    .then(() => true)
    .catch(() => false)
}

async function captureShell(page, viewportName, state) {
  if (!screenshotDir) return

  await mkdir(screenshotDir, { recursive: true })
  const screenshotPath = join(
    screenshotDir,
    `authenticated-${viewportName}-${state}.png`,
  )

  // Mask the data-bearing content area. Sidebar/header/drawer geometry and
  // the login surface remain visible while timestamps and telemetry stay out
  // of the regression signal.
  const viewport = page.viewportSize()
  await page.screenshot({
    path: screenshotPath,
    animations: 'disabled',
    fullPage: false,
    mask: [page.locator('#main-content')],
    ...(state === 'desktop-shell' && viewport
      ? {
          clip: {
            x: 0,
            y: 0,
            width: viewport.width,
            height: Math.min(220, viewport.height),
          },
        }
      : {}),
  })

  if (!baselineDir) {
    console.log(`📸 ${viewportName}/${state}: ${screenshotPath}`)
    return
  }

  await mkdir(baselineDir, { recursive: true })
  const digest = createHash('sha256')
    .update(await readFile(screenshotPath))
    .digest('hex')
  const baselinePath = join(
    baselineDir,
    `authenticated-${viewportName}-${state}.sha256`,
  )

  if (updateSnapshots) {
    await writeFile(baselinePath, `${digest}\n`)
    console.log(`📌 ${viewportName}/${state}: baseline updated`)
    return
  }

  const expected = await readFile(baselinePath, 'utf8')
    .then((value) => value.trim())
    .catch(() => '')
  if (!expected) {
    fail(
      `${viewportName}/${state}: missing screenshot baseline at ${baselinePath}; rerun with AUTH_E2E_UPDATE_SNAPSHOTS=1`,
    )
  } else if (expected !== digest) {
    fail(
      `${viewportName}/${state}: screenshot regression (expected ${expected.slice(0, 12)}, got ${digest.slice(0, 12)})`,
    )
  } else {
    console.log(`✅ ${viewportName}/${state}: screenshot baseline matches`)
  }
}

async function login(page) {
  await page.locator('#lp-pw').fill(password)
  await page.getByRole('button', { name: 'Sign In', exact: true }).click()
  const dashboardVisible = await visible(
    page.getByRole('heading', { name: 'Hermes Workspace', level: 1 }),
  )
  if (!dashboardVisible) throw new Error('dashboard did not appear after login')
  return true
}

async function authStatus(page) {
  return page.evaluate(async () => {
    const response = await fetch('/api/auth-check', { cache: 'no-store' })
    return response.json()
  })
}

async function logoutFromVisibleControl(page, viewportName) {
  const mobileMenu = page.getByRole('button', {
    name: 'Open navigation menu',
    exact: true,
  })

  if (viewportName === 'mobile' && (await mobileMenu.count())) {
    await mobileMenu.click()
    await expect(
      visible(page.getByRole('dialog', { name: 'Navigation menu' })),
      'mobile navigation drawer opens',
    )
    await page.getByRole('button', { name: 'Sign out', exact: true }).click()
    return
  }

  const labelledSignOut = page.getByRole('button', {
    name: 'Sign out',
    exact: true,
  })
  if (await labelledSignOut.count()) {
    await labelledSignOut.click()
    return
  }

  // The compact desktop sidebar uses the shorter visible label.
  await page.getByRole('button', { name: 'Exit', exact: true }).click()
}

async function runViewport(browser, viewportName, simulateExpiry) {
  const viewport = viewportMap[viewportName]
  const context = await browser.newContext({ viewport })
  const page = await context.newPage()

  try {
    const initial = await page.goto(`${baseUrl}/dashboard`, {
      waitUntil: 'domcontentloaded',
    })
    await expect(
      initial?.ok() === true,
      `${viewportName}: dashboard responds successfully`,
    )
    await expect(
      visible(page.locator('#lp-pw')),
      `${viewportName}: unauthenticated dashboard reaches the login gate`,
    )
    await captureShell(page, viewportName, 'login')

    await expect(
      await login(page),
      `${viewportName}: password login creates a dashboard session`,
    )
    await expect(
      (await authStatus(page))?.authenticated === true,
      `${viewportName}: auth-check confirms the live session`,
    )

    if (viewportName === 'mobile') {
      await page.getByRole('button', { name: 'Open navigation menu' }).click()
      await captureShell(page, viewportName, 'mobile-drawer')
      await page.getByRole('button', { name: 'Close menu' }).click()
    } else {
      await captureShell(page, viewportName, 'desktop-shell')
    }

    await page.goto(`${baseUrl}/jobs`, { waitUntil: 'domcontentloaded' })
    await expect(
      page.url().includes('/jobs'),
      `${viewportName}: authenticated navigation reaches Jobs`,
    )
    await page.goto(`${baseUrl}/dashboard`, { waitUntil: 'domcontentloaded' })
    await expect(
      page.url().includes('/dashboard'),
      `${viewportName}: navigation returns to Dashboard`,
    )

    await page
      .reload({ waitUntil: 'commit', timeout: 10_000 })
      .catch(() => undefined)
    await expect(
      visible(
        page.getByRole('heading', { name: 'Hermes Workspace', level: 1 }),
      ),
      `${viewportName}: refresh preserves the authenticated dashboard session`,
    )

    if (simulateExpiry) {
      await context.clearCookies()
      const liveUrl = new URL(baseUrl)
      await context.addCookies([
        {
          name: 'claude-auth',
          value: 'expired-e2e-session',
          domain: liveUrl.hostname,
          path: '/',
          secure: liveUrl.protocol === 'https:',
          httpOnly: true,
          sameSite: 'Strict',
        },
      ])
      await page
        .reload({ waitUntil: 'commit', timeout: 10_000 })
        .catch(() => undefined)
      await expect(
        visible(page.locator('#lp-pw'), 45_000),
        `${viewportName}: invalid/expired session returns to the login gate`,
      )
      await expect(
        (await authStatus(page))?.authenticated === false,
        `${viewportName}: expired session is rejected by auth-check`,
      )
      await expect(
        login(page),
        `${viewportName}: re-login succeeds after session expiry`,
      )
    }

    await logoutFromVisibleControl(page, viewportName)
    await expect(
      visible(page.locator('#lp-pw'), 45_000),
      `${viewportName}: user-facing sign out returns to login`,
    )
    await expect(
      page.url().includes('/login'),
      `${viewportName}: logout updates the browser URL to login`,
    )
    await page.waitForLoadState('domcontentloaded').catch(() => undefined)
    await expect(
      (await authStatus(page))?.authenticated === false,
      `${viewportName}: logout revokes the live session`,
    )
  } catch (error) {
    fail(
      `${viewportName}: ${error instanceof Error ? error.message : String(error)}`,
    )
  } finally {
    await context.close()
  }
}

const browser = await chromium.launch({ headless: true })
try {
  for (const [index, viewportName] of requestedViewports.entries()) {
    // Expiry is a full auth-state transition; run it once in the matrix while
    // every viewport still gets independent login/navigation/refresh/logout.
    await runViewport(
      browser,
      viewportName,
      index === requestedViewports.length - 1,
    )
  }
} finally {
  await browser.close()
}

if (failures > 0) process.exit(1)
