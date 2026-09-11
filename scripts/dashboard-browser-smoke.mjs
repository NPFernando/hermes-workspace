#!/usr/bin/env node
/**
 * Authenticated dashboard browser smoke using deterministic gateway fixtures.
 *
 * The real dashboard is intentionally auth-gated, so this checks the rendered
 * product surface with the same response boundary the browser receives. The
 * fixture is deliberately partial/malformed in analytics to catch regressions
 * where a widget trusts the TypeScript shape instead of runtime JSON.
 *
 * Usage:
 *   DASHBOARD_BROWSER_SMOKE=1 BASE_URL=http://localhost:3000 \
 *     node scripts/dashboard-browser-smoke.mjs
 *
 * Degraded-state check:
 *   DASHBOARD_BROWSER_SMOKE=1 DASHBOARD_OVERVIEW_FAILURE=1 \
 *     node scripts/dashboard-browser-smoke.mjs
 *
 * Alternate theme check:
 *   DASHBOARD_BROWSER_SMOKE=1 DASHBOARD_THEME=claude-nous-light \
 *     node scripts/dashboard-browser-smoke.mjs
 *
 * Top viewport capture:
 *   DASHBOARD_SCREENSHOT_POSITION=top DASHBOARD_SCREENSHOT_DIR=/tmp/dashboard \
 *     DASHBOARD_BROWSER_SMOKE=1 node scripts/dashboard-browser-smoke.mjs
 *
 * Narrow-phone check:
 *   DASHBOARD_MOBILE_WIDTH=320 DASHBOARD_BROWSER_SMOKE=1 \
 *     node scripts/dashboard-browser-smoke.mjs
 */

if (process.env.DASHBOARD_BROWSER_SMOKE !== '1') {
  console.log(
    '⏭️ Dashboard browser smoke skipped: set DASHBOARD_BROWSER_SMOKE=1',
  )
  process.exit(0)
}

const { chromium } = await import('playwright')
const baseUrl = (process.env.BASE_URL || 'http://localhost:3000').replace(
  /\/$/,
  '',
)
const overviewFailure = process.env.DASHBOARD_OVERVIEW_FAILURE === '1'
const completeAnalytics = process.env.DASHBOARD_COMPLETE_ANALYTICS === '1'
const completeSessions = process.env.DASHBOARD_COMPLETE_SESSIONS === '1'
// The full interaction matrix needs populated widgets; the default fixture
// intentionally exercises partial/empty telemetry and should only validate
// that the rendered dashboard remains usable.
const richFixture = completeAnalytics && completeSessions
const dashboardTheme = process.env.DASHBOARD_THEME || ''
const screenshotDir = process.env.DASHBOARD_SCREENSHOT_DIR
const screenshotPosition = process.env.DASHBOARD_SCREENSHOT_POSITION || 'bottom'
const mobileWidth = Number(process.env.DASHBOARD_MOBILE_WIDTH || 390)
const viewports = [
  {
    name: 'mobile',
    width: Number.isFinite(mobileWidth) ? mobileWidth : 390,
    height: 844,
  },
  { name: 'tablet', width: 768, height: 1024 },
  { name: 'desktop', width: 1280, height: 900 },
]

const now = Date.now()
const populatedSessions = [
  {
    key: 'chat_primary_workspace',
    derivedTitle: 'Production dashboard visual QA and refinement',
    kind: 'chat',
    status: 'active',
    source: 'workspace',
    model: 'gpt-5',
    messageCount: 18,
    toolCallCount: 24,
    tokenCount: 68200,
    startedAt: now - 18 * 60_000,
    updatedAt: now - 2 * 60_000,
  },
  {
    key: 'cron_nightly_1742',
    derivedTitle: 'Nightly workspace health sweep',
    kind: 'cron',
    status: 'ended',
    source: 'cron',
    model: 'claude-3-5-sonnet',
    messageCount: 7,
    toolCallCount: 5,
    tokenCount: 12400,
    startedAt: now - 3 * 60 * 60_000,
    updatedAt: now - 3 * 60 * 60_000,
  },
  {
    key: 'api_long_research_session',
    derivedTitle:
      'A deliberately long session title that should truncate cleanly',
    kind: 'api',
    status: 'error',
    source: 'api',
    model: 'nemotron-3-super-120b-a12b:free',
    messageCount: 31,
    toolCallCount: 2,
    tokenCount: 91000,
    startedAt: now - 9 * 86_400_000,
    updatedAt: now - 9 * 86_400_000,
  },
]
const overview = {
  status: {
    gatewayState: 'connected',
    activeSessions: 2,
    activeAgents: 1,
    restartRequested: false,
    updatedAt: new Date(now).toISOString(),
    lastHeartbeatAt: new Date(now).toISOString(),
    configVersion: '1.0.0',
    latestConfigVersion: '1.0.0',
  },
  platforms: [{ name: 'codex', state: 'connected' }],
  cron: { total: 1, paused: 0, running: 0, nextRuns: [] },
  kanban: { total: 1, ready: 1, running: 0, blocked: 0 },
  achievements: { totalUnlocked: 0, recentUnlocks: [] },
  modelInfo: {
    provider: 'OpenAI',
    model: 'gpt-5',
    effectiveContextLength: 128000,
    capabilities: null,
  },
  // Deliberately malformed optional arrays and omitted estimatedCostUsd.
  analytics: {
    windowDays: 30,
    totalTokens: 1000,
    inputTokens: 400,
    outputTokens: 300,
    cacheReadTokens: 300,
    reasoningTokens: 0,
    totalSessions: 2,
    totalApiCalls: 3,
    topModels: completeAnalytics
      ? [{ id: 'gpt-5', tokens: 1000, calls: 3, cost: 1.2, sessions: 2 }]
      : {},
    daily: completeAnalytics
      ? [
          {
            day: '2026-09-09',
            inputTokens: 400,
            outputTokens: 300,
            cacheReadTokens: 300,
            reasoningTokens: 0,
            sessions: 2,
            apiCalls: 3,
            estimatedCost: 1.2,
          },
        ]
      : {},
    estimatedCostUsd: completeAnalytics ? 1.2 : undefined,
    costLabel: 'unknown',
    source: 'analytics',
  },
  logs: { file: 'agent.log', lines: [], errorCount: 0, warnCount: 0 },
  skillsUsage: {
    totalLoads: 0,
    totalEdits: 0,
    totalActions: 0,
    distinctSkills: 0,
    topSkills: [],
  },
  insights: [],
  incidents: [],
  financeStorageMonitor: null,
  financeStorageSmokeCron: null,
}

function payloadFor(pathname) {
  if (pathname === '/api/auth-check') {
    return { authenticated: true, authRequired: true }
  }
  if (pathname === '/api/connection-status') {
    return {
      status: 'enhanced',
      label: 'Enhanced',
      detail: 'Fixture gateway ready',
      health: true,
      chatReady: true,
      modelConfigured: true,
      activeModel: 'gpt-5',
      chatMode: 'enhanced-claude',
      capabilities: {
        dashboard: true,
        sessions: true,
        skills: true,
        config: true,
        jobs: true,
        mcp: true,
        kanban: true,
      },
      claudeUrl: '',
    }
  }
  if (pathname === '/api/gateway-status') {
    return {
      capabilities: {
        dashboard: { available: true },
        sessions: true,
        skills: true,
        config: true,
        jobs: true,
        mcp: true,
        kanban: true,
      },
      mode: 'enhanced',
      gateway: { available: true },
      dashboard: { available: true },
    }
  }
  if (pathname === '/api/system-metrics') {
    return {
      checkedAt: now,
      cpu: { loadPercent: 10, loadAverage1m: 0.2, cores: 4 },
      memory: { usedBytes: 1, totalBytes: 2, usedPercent: 50 },
      disk: { path: '/', usedBytes: 1, totalBytes: 2, usedPercent: 50 },
      hermes: { status: 'enhanced', health: true, dashboard: true },
    }
  }
  if (pathname === '/api/dashboard/overview') return overview
  if (pathname === '/api/sessions') {
    return {
      sessions: completeSessions ? populatedSessions : [],
      unavailable: false,
    }
  }
  if (pathname === '/api/skills') return { skills: [] }
  if (pathname === '/api/openrouter-credits') return { available: false }
  if (pathname === '/api/update/status') return { products: {} }
  if (pathname === '/api/files') return { files: [] }
  if (pathname === '/api/user-settings' || pathname === '/api/user-profile') {
    return {}
  }
  return {}
}

const browser = await chromium.launch({ headless: true })
let failures = 0

try {
  for (const viewport of viewports) {
    const page = await browser.newPage({ viewport })
    const errors = []
    page.on('pageerror', (error) => errors.push(error.message))
    await page.addInitScript((theme) => {
      localStorage.setItem('claude-onboarding-complete', 'true')
      if (theme) localStorage.setItem('claude-theme', theme)
    }, dashboardTheme)
    await page.route('**/api/**', async (route) => {
      const pathname = new URL(route.request().url()).pathname
      if (overviewFailure && pathname === '/api/dashboard/overview') {
        await route.fulfill({
          status: 503,
          contentType: 'application/json',
          body: JSON.stringify({ error: 'fixture unavailable' }),
        })
        return
      }
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(payloadFor(pathname)),
      })
    })

    const response = await page.goto(`${baseUrl}/dashboard`, {
      waitUntil: 'networkidle',
      timeout: 30_000,
    })
    // Capture the first settled document state as well as the later hydrated
    // state. A delayed assertion alone can miss a brief duplicate splash
    // covering login/onboarding during startup.
    const initialSplashVisible = await page.evaluate(() => {
      const splash = document.querySelector('#splash-screen')
      if (!(splash instanceof HTMLElement)) return false
      const style = getComputedStyle(splash)
      return (
        style.display !== 'none' &&
        style.visibility !== 'hidden' &&
        Number(style.opacity) > 0.01
      )
    })
    // Allow the root-owned bootstrap splash to finish its short fade. The
    // smoke test should catch regressions where it remains above the hydrated
    // app and creates a duplicate startup screen.
    await page.waitForTimeout(750)
    let result = await page.evaluate(() => {
      const scrollContainer = document.querySelector(
        'main[data-tour="chat-area"]',
      )
      const dashboard = document.querySelector('#dashboard-content')
      const splash = document.querySelector('#splash-screen')
      const splashStyle = splash ? getComputedStyle(splash) : null
      const pendingConnectionLoaderVisible = Array.from(
        document.querySelectorAll('[role="status"]'),
      ).some((element) => {
        const style = getComputedStyle(element)
        return (
          style.display !== 'none' &&
          style.visibility !== 'hidden' &&
          /Connecting to (?:your )?backend/i.test(element.textContent || '')
        )
      })
      const overlay = Array.from(
        document.querySelectorAll(
          '[data-testid="system-metrics-footer"], nav[aria-label="Mobile navigation"]',
        ),
      ).find((element) => getComputedStyle(element).display !== 'none')
      if (scrollContainer instanceof HTMLElement) {
        scrollContainer.scrollTop = scrollContainer.scrollHeight
      }
      const overlayTop =
        overlay?.getBoundingClientRect().top ?? window.innerHeight
      const contentBottom = dashboard?.getBoundingClientRect().bottom ?? 0
      const sidebarFooter = document.querySelector(
        '[data-testid="sidebar-user-footer"]',
      )
      const sidebarOverlapElements =
        sidebarFooter instanceof HTMLElement
          ? (() => {
              const footerRect = sidebarFooter.getBoundingClientRect()
              const sidebar = sidebarFooter.closest(
                '[data-tour="sidebar-container"]',
              )
              if (!(sidebar instanceof HTMLElement)) return []
              return Array.from(sidebar.querySelectorAll('a, button'))
                .filter((element) => !sidebarFooter.contains(element))
                .filter((element) => {
                  const style = getComputedStyle(element)
                  const rect = element.getBoundingClientRect()
                  if (
                    style.display !== 'none' &&
                    style.visibility !== 'hidden' &&
                    rect.width > 0 &&
                    rect.height > 0 &&
                    rect.bottom > footerRect.top + 1 &&
                    rect.top < footerRect.bottom
                  ) {
                    const x = Math.round(rect.left + rect.width / 2)
                    const y = Math.round(
                      Math.max(footerRect.top + 2, rect.top + 2),
                    )
                    const topmost = document.elementFromPoint(x, y)
                    return !sidebarFooter.contains(topmost)
                  }
                  return false
                })
            })()
          : []
      const sidebarContentOverlap = sidebarOverlapElements.length > 0
      const sidebarFooterButtons = sidebarFooter
        ? Array.from(sidebarFooter.querySelectorAll('button'))
        : []
      const sidebarFooterTouchTargets =
        window.innerWidth < 1024 && sidebarFooterButtons.length > 0
          ? sidebarFooterButtons.every(
              (button) => button.getBoundingClientRect().height >= 40,
            )
          : true
      const mobileNav = document.querySelector(
        'nav[aria-label="Mobile navigation"]',
      )
      const mobileNavDebug =
        mobileNav instanceof HTMLElement
          ? (() => {
              const style = getComputedStyle(mobileNav)
              const rect = mobileNav.getBoundingClientRect()
              return {
                display: style.display,
                visibility: style.visibility,
                opacity: style.opacity,
                pointerEvents: style.pointerEvents,
                transform: style.transform,
                top: Math.round(rect.top),
                bottom: Math.round(rect.bottom),
                height: Math.round(rect.height),
              }
            })()
          : null
      const mobileNavVisible =
        mobileNav instanceof HTMLElement &&
        (() => {
          const style = getComputedStyle(mobileNav)
          const rect = mobileNav.getBoundingClientRect()
          return (
            style.display !== 'none' &&
            style.visibility !== 'hidden' &&
            style.opacity !== '0' &&
            style.pointerEvents !== 'none' &&
            rect.width > 0 &&
            rect.height > 0 &&
            rect.bottom > 0 &&
            rect.top < window.innerHeight
          )
        })()
      const mobileNavTop =
        mobileNav instanceof HTMLElement
          ? mobileNav.getBoundingClientRect().top
          : window.innerHeight
      const lowestDashboardCard = Array.from(
        document.querySelectorAll(
          '#dashboard-content [class*="rounded-xl"][class*="border"]',
        ),
      )
        .map((element) => ({
          element,
          rect: element.getBoundingClientRect(),
        }))
        .filter(
          ({ rect }) => rect.width > 0 && rect.height > 0 && rect.bottom > 0,
        )
        .sort((a, b) => b.rect.bottom - a.rect.bottom)[0]
      const mobileNavOverlapsLastCard = Boolean(
        mobileNavVisible &&
        lowestDashboardCard &&
        lowestDashboardCard.rect.bottom > mobileNavTop + 1 &&
        lowestDashboardCard.rect.top < window.innerHeight,
      )
      const mobileNavLinks = mobileNav
        ? Array.from(mobileNav.querySelectorAll('a, button'))
        : []
      const mobileNavAccessible =
        window.innerWidth >= 768 ||
        (mobileNavVisible &&
          mobileNavLinks.length > 0 &&
          mobileNavLinks.every(
            (link) =>
              Boolean(link.getAttribute('aria-label')) &&
              link.getBoundingClientRect().height >= 40,
          ) &&
          mobileNavLinks.filter(
            (link) => link.getAttribute('aria-current') === 'page',
          ).length === 1)
      const mobileNavActiveFullyVisible =
        window.innerWidth >= 768 ||
        (mobileNavVisible &&
          (() => {
            const strip = mobileNav?.querySelector('[class*="overflow-x-auto"]')
            const active = mobileNav?.querySelector('a[aria-current="page"]')
            if (
              !(strip instanceof HTMLElement) ||
              !(active instanceof HTMLElement)
            ) {
              return false
            }
            const stripRect = strip.getBoundingClientRect()
            const activeRect = active.getBoundingClientRect()
            return (
              activeRect.left >= stripRect.left + 2 &&
              activeRect.right <= stripRect.right - 2 &&
              active.scrollWidth <= active.clientWidth + 1
            )
          })())
      const toolbarTargets = Array.from(
        document.querySelectorAll(
          '#dashboard-content button, #dashboard-content a[href]',
        ),
      ).filter((button) => {
        const label =
          button.getAttribute('aria-label') || button.textContent || ''
        return (
          /^(Refresh dashboard|Edit layout|Settings)$/i.test(label.trim()) ||
          /^(New Chat|Terminal|Skills)$/i.test(label.trim())
        )
      })
      const toolbarTouchTargets =
        window.innerWidth >= 1024 ||
        (toolbarTargets.length >= 6 &&
          toolbarTargets.every(
            (button) => button.getBoundingClientRect().height >= 40,
          ))
      const opsStatus = document.querySelector(
        'section[aria-label="Workspace operations status"]',
      )
      const opsButtons = opsStatus
        ? Array.from(opsStatus.querySelectorAll('button'))
        : []
      const opsTouchTargets =
        window.innerWidth >= 1024 ||
        !opsStatus ||
        opsButtons.every(
          (button) => button.getBoundingClientRect().height >= 40,
        )
      const chatToggle = document.querySelector(
        'button[aria-label="Open chat"]',
      )
      const chatRect = chatToggle?.getBoundingClientRect()
      const chatGeometry = chatRect
        ? {
            top: Math.round(chatRect.top),
            bottom: Math.round(chatRect.bottom),
          }
        : null
      const notificationToggle = document.querySelector(
        'button[aria-label^="Notifications"]',
      )
      const notificationRect = notificationToggle?.getBoundingClientRect()
      const notificationOverlapsContent = Boolean(
        notificationRect &&
        dashboard &&
        Array.from(
          dashboard.querySelectorAll(
            'section, article, [class*="rounded-xl"][class*="border"]',
          ),
        ).some((target) => {
          const rect = target.getBoundingClientRect()
          return (
            rect.width > 0 &&
            rect.height > 0 &&
            notificationRect.left < rect.right &&
            notificationRect.right > rect.left &&
            notificationRect.top < rect.bottom &&
            notificationRect.bottom > rect.top
          )
        }),
      )
      const chatOverlapPanels =
        chatRect && dashboard
          ? Array.from(
              dashboard.querySelectorAll(
                'section, article, [class*="rounded-xl"][class*="border"]',
              ),
            )
              .filter((panel) => {
                const rect = panel.getBoundingClientRect()
                return (
                  rect.width > 0 &&
                  rect.height > 0 &&
                  chatRect.left < rect.right &&
                  chatRect.right > rect.left &&
                  chatRect.top < rect.bottom &&
                  chatRect.bottom > rect.top
                )
              })
              .map((panel) => {
                const rect = panel.getBoundingClientRect()
                return {
                  label: panel.textContent?.trim().slice(0, 80) || 'panel',
                  top: Math.round(rect.top),
                  bottom: Math.round(rect.bottom),
                }
              })
          : []
      const chatOverlapsContent = Boolean(
        chatRect && chatOverlapPanels.length > 0,
      )
      const skipLinkPresent = Boolean(
        document.querySelector('a[href="#main-content"]'),
      )
      const singleSkipLink =
        document.querySelectorAll('a[href="#main-content"]').length === 1
      const activePageSemantics =
        document.querySelectorAll('[aria-current="page"]').length > 0
      const mainContentFocusable =
        document.querySelector('#main-content')?.getAttribute('tabindex') ===
        '-1'
      const headingStructure = (() => {
        const headings = Array.from(
          document.querySelectorAll(
            '#dashboard-content h1, #dashboard-content h2, #dashboard-content h3, #dashboard-content h4, #dashboard-content h5, #dashboard-content h6',
          ),
        ).filter((element) => {
          const style = getComputedStyle(element)
          const rect = element.getBoundingClientRect()
          return (
            style.display !== 'none' &&
            style.visibility !== 'hidden' &&
            rect.width > 0
          )
        })
        const levels = headings.map((element) =>
          Number(element.tagName.slice(1)),
        )
        const firstH2 = levels.indexOf(2)
        return {
          valid:
            levels.filter((level) => level === 1).length === 1 &&
            firstH2 >= 0 &&
            levels.slice(0, firstH2).every((level) => level <= 2),
          h1Count: levels.filter((level) => level === 1).length,
          h2Count: levels.filter((level) => level === 2).length,
          h3BeforeH2:
            firstH2 >= 0 &&
            levels.slice(0, firstH2).some((level) => level === 3),
        }
      })()
      const smallDashboardButtons =
        window.innerWidth >= 1024
          ? []
          : Array.from(document.querySelectorAll('#dashboard-content button'))
              .filter((button) => {
                const style = window.getComputedStyle(button)
                const rect = button.getBoundingClientRect()
                return (
                  style.display !== 'none' &&
                  style.visibility !== 'hidden' &&
                  rect.width > 0 &&
                  rect.height > 0 &&
                  rect.height < 40
                )
              })
              .slice(0, 12)
              .map((button) => ({
                label:
                  button.getAttribute('aria-label') ||
                  button.textContent?.trim().slice(0, 80) ||
                  'unlabelled',
                height: Math.round(button.getBoundingClientRect().height),
              }))

      return {
        hasErrorBoundary: /Something went wrong|Return Home/i.test(
          document.body.innerText,
        ),
        overflow: document.documentElement.scrollWidth > window.innerWidth + 1,
        dashboard: Boolean(dashboard),
        theme: document.documentElement.getAttribute('data-theme'),
        startupSplashVisible: Boolean(
          splash &&
          splashStyle?.display !== 'none' &&
          splashStyle?.visibility !== 'hidden' &&
          Number(splashStyle?.opacity ?? '1') > 0.01,
        ),
        pendingConnectionLoaderVisible,
        degradedBannerOpaque: (() => {
          const banner = document.querySelector(
            '[data-testid="dashboard-degraded-banner"]',
          )
          if (!(banner instanceof HTMLElement)) return false
          const backgroundColor = getComputedStyle(banner).backgroundColor
          const alpha = backgroundColor.match(
            /rgba?\([^,]+,[^,]+,[^,]+(?:,\s*([\d.]+))?\)/,
          )?.[1]
          return alpha === undefined || Number(alpha) >= 0.9
        })(),
        recoveryAction: Boolean(
          document.querySelector(
            'button[aria-label="Retry dashboard telemetry"]',
          ),
        ),
        mobileNavAccessible,
        mobileNavActiveFullyVisible,
        skipLinkPresent,
        singleSkipLink,
        activePageSemantics,
        mainContentFocusable,
        headingStructure,
        mobileNavDebug,
        mobileNavOverlapsLastCard,
        toolbarTouchTargets,
        opsTouchTargets,
        chatOverlapsContent,
        chatOverlapPanels,
        chatGeometry,
        notificationOverlapsContent,
        smallDashboardButtons,
        bottomOccluded: contentBottom > overlayTop + 1,
        sidebarContentOverlap,
        sidebarFooterTouchTargets,
        contentBottom: Math.round(contentBottom),
        overlayTop: Math.round(overlayTop),
        unnamedInteractive: Array.from(
          document.querySelectorAll(
            'button, a[href], input, textarea, select, [role="button"]',
          ),
        )
          .filter((element) => {
            const style = window.getComputedStyle(element)
            return style.display !== 'none' && style.visibility !== 'hidden'
          })
          .filter((element) => {
            const labelledBy = element.getAttribute('aria-labelledby')
            const labelledText = labelledBy
              ? labelledBy
                  .split(/\s+/)
                  .map((id) => document.getElementById(id)?.textContent || '')
                  .join(' ')
              : ''
            const label = element.closest('label')?.textContent || ''
            const value =
              element.getAttribute('aria-label') ||
              labelledText ||
              element.getAttribute('title') ||
              element.getAttribute('placeholder') ||
              label ||
              element.textContent ||
              ''
            return value.trim().length === 0
          })
          .slice(0, 5)
          .map((element) => element.outerHTML.slice(0, 160)),
      }
    })
    result.initialSplashVisible = initialSplashVisible
    let mobileMenuInteraction = {
      checked: false,
      opened: false,
      scrollContained: false,
      footerVisible: false,
      closedWithEscape: false,
      focusRestored: false,
    }
    if (viewport.name === 'mobile') {
      const launcher = page
        .getByRole('button', {
          name: 'Open navigation menu',
        })
        .first()
      if (await launcher.count()) {
        mobileMenuInteraction.checked = true
        await launcher.focus()
        await launcher.click()
        const drawer = page.getByRole('dialog', {
          name: 'Navigation menu',
        })
        await drawer.waitFor({ state: 'visible' })
        await page.waitForTimeout(350)
        mobileMenuInteraction.opened = true
        mobileMenuInteraction = {
          ...mobileMenuInteraction,
          ...(await drawer.evaluate((element) => {
            const nav = element.querySelector('nav')
            const footerButtons = Array.from(
              element.querySelectorAll('button'),
            ).filter((button) =>
              /Settings|Switch to (light|dark) theme/.test(
                button.getAttribute('aria-label') || '',
              ),
            )
            return {
              scrollContained:
                nav instanceof HTMLElement &&
                nav.scrollHeight > nav.clientHeight,
              footerVisible:
                footerButtons.length > 0 &&
                footerButtons.every((button) => {
                  const rect = button.getBoundingClientRect()
                  return rect.top >= 0 && rect.bottom <= window.innerHeight
                }),
            }
          })),
        }
        if (
          screenshotDir &&
          process.env.DASHBOARD_SCREENSHOT_LAYOUT === 'menu'
        ) {
          await page.screenshot({
            path: `${screenshotDir}/dashboard-mobile-menu-open.png`,
            fullPage: false,
          })
        }
        await page.keyboard.press('Escape')
        await page.waitForFunction(
          () =>
            document
              .querySelector('[role="dialog"][aria-label="Navigation menu"]')
              ?.getAttribute('aria-hidden') === 'true',
        )
        mobileMenuInteraction.closedWithEscape = true
        mobileMenuInteraction.focusRestored = await launcher.evaluate(
          (element) => document.activeElement === element,
        )
      }
    }
    let chartInteraction = {
      checked: false,
      expanded: false,
      periodChanged: false,
      periodKeyboardChanged: false,
      touchTargets: false,
      closedWithEscape: false,
      focusRestored: false,
    }
    if (completeAnalytics && !overviewFailure) {
      const expand = page.getByRole('button', { name: 'Expand' }).first()
      if (await expand.count()) {
        chartInteraction.checked = true
        await expand.focus()
        const period14 = page.getByRole('tab', {
          name: 'Show 14-day usage trend',
        })
        if (await period14.count()) {
          chartInteraction.touchTargets = await page.evaluate(() => {
            if (window.innerWidth >= 1024) return true
            const periodTabs = Array.from(
              document.querySelectorAll('[role="tab"]'),
            )
            return (
              periodTabs.length > 0 &&
              periodTabs.every(
                (tab) => tab.getBoundingClientRect().height >= 40,
              )
            )
          })
          await period14.click()
          await page.waitForFunction(() => {
            const selected = document.querySelector(
              '[role="tab"][aria-label="Show 14-day usage trend"][aria-selected="true"]',
            )
            return selected instanceof HTMLElement
          })
          chartInteraction.periodChanged =
            (await period14.getAttribute('aria-selected')) === 'true'
          await period14.focus()
          await page.keyboard.press('ArrowRight')
          await page.waitForFunction(
            () =>
              document.activeElement?.getAttribute('aria-label') ===
                'Show 30-day usage trend' &&
              document.activeElement?.getAttribute('aria-selected') === 'true',
          )
          const period30 = page.getByRole('tab', {
            name: 'Show 30-day usage trend',
          })
          chartInteraction.periodKeyboardChanged =
            (await period30.getAttribute('aria-selected')) === 'true' &&
            (await period30.evaluate(
              (element) => document.activeElement === element,
            ))
        }

        await expand.focus()
        await expand.click()
        const analyticsDialog = page.locator(
          '[role="dialog"][aria-labelledby]',
        )
        await analyticsDialog.waitFor({ state: 'visible' })
        chartInteraction.expanded = true
        await page.keyboard.press('Escape')
        await analyticsDialog.waitFor({ state: 'hidden' })
        await page.evaluate(() => {
          const main = document.querySelector('main[data-tour="chat-area"]')
          if (main instanceof HTMLElement) main.scrollTop = main.scrollHeight
        })
        await page.evaluate(
          () => new Promise((resolve) => requestAnimationFrame(resolve)),
        )
        chartInteraction.closedWithEscape = true
        chartInteraction.focusRestored = await expand.evaluate(
          (element) => document.activeElement === element,
        )
      }
    }
    let layoutInteraction = {
      checked: false,
      opened: false,
      touchTargets: false,
      mobileBottomClearance: false,
      focusEntered: false,
      groupingAccurate: false,
      allHiddenRecovery: false,
      allWidgetsVisible: false,
      persistenceStatus: false,
      persistedAcrossReload: false,
      closedWithEscape: false,
    }
    const editLayout = page.getByRole('button', { name: 'Edit layout' }).first()
    if (richFixture && (await editLayout.count())) {
      layoutInteraction.checked = true
      await editLayout.focus()
      await editLayout.click()
      const layoutControls = page.locator('#dashboard-layout-controls')
      await layoutControls.waitFor({ state: 'visible' })
      layoutInteraction.opened = true
      await page.evaluate(
        () => new Promise((resolve) => requestAnimationFrame(resolve)),
      )
      layoutInteraction.focusEntered = await page.evaluate(() => {
        const panel = document.querySelector('#dashboard-layout-controls')
        return Boolean(panel && panel.contains(document.activeElement))
      })
      layoutInteraction.mobileBottomClearance = await page.evaluate(() => {
        if (window.innerWidth >= 768) return true
        const main = document.querySelector('main[data-tour="chat-area"]')
        const panel = document.querySelector('#dashboard-layout-controls')
        const nav = document.querySelector(
          'nav[aria-label="Mobile navigation"]',
        )
        if (
          !(main instanceof HTMLElement) ||
          !(panel instanceof HTMLElement) ||
          !(nav instanceof HTMLElement)
        ) {
          return false
        }
        main.scrollTop = main.scrollHeight
        const buttons = panel.querySelectorAll('button')
        const lastButton = buttons.item(buttons.length - 1)
        if (!(lastButton instanceof HTMLElement)) return false
        return (
          lastButton.getBoundingClientRect().bottom <=
          nav.getBoundingClientRect().top - 4
        )
      })
      layoutInteraction.persistenceStatus = await layoutControls
        .getByText(/saved locally|session only|saving…/i)
        .count()
        .then((count) => count > 0)
      if (process.env.DASHBOARD_SCREENSHOT_LAYOUT === 'edit' && screenshotDir) {
        await page.screenshot({
          path: `${screenshotDir}/dashboard-${viewport.name}-edit-mode.png`,
          fullPage: false,
        })
      }
      layoutInteraction.touchTargets = await layoutControls.evaluate(
        (element) => {
          if (window.innerWidth >= 1024) return true
          const buttons = Array.from(element.querySelectorAll('button'))
          return (
            buttons.length > 0 &&
            buttons.every(
              (button) => button.getBoundingClientRect().height >= 40,
            )
          )
        },
      )
      layoutInteraction.groupingAccurate = await layoutControls.evaluate(
        (element) => {
          const topModels = element.querySelector(
            'button[aria-label^="Hide Top models"]',
          )
          const sideRail = Array.from(element.querySelectorAll('span')).find(
            (node) => node.textContent?.trim() === 'Side rail',
          )
          return Boolean(
            topModels && sideRail?.parentElement?.contains(topModels),
          )
        },
      )
      const hideButtons = layoutControls.locator('button[aria-label^="Hide "]')
      while ((await hideButtons.count()) > 0) {
        await hideButtons.first().click()
      }
      layoutInteraction.allHiddenRecovery = await layoutControls
        .getByRole('status')
        .filter({ hasText: 'All dashboard widgets are hidden' })
        .count()
        .then((count) => count > 0)
      const showButtons = layoutControls.locator('button[aria-label^="Show "]')
      while ((await showButtons.count()) > 0) {
        await showButtons.first().click()
      }
      layoutInteraction.allWidgetsVisible = await page.evaluate(() => {
        const dashboard = document.querySelector('#dashboard-content')
        return Boolean(
          dashboard &&
          document.documentElement.scrollWidth <= window.innerWidth + 1 &&
          dashboard.querySelectorAll('button[aria-label^="Hide "]').length >=
            10,
        )
      })
      if (process.env.DASHBOARD_SCREENSHOT_LAYOUT === 'all' && screenshotDir) {
        await page.screenshot({
          path: `${screenshotDir}/dashboard-${viewport.name}-all-widgets.png`,
          fullPage: false,
        })
      }
      await page
        .getByRole('button', { name: 'Restore default dashboard layout' })
        .click()
      await page
        .locator('[role="alertdialog"]')
        .getByRole('button', { name: 'Restore defaults' })
        .click()
      await hideButtons.first().waitFor({ state: 'visible' })
      await layoutControls
        .getByRole('button', { name: /^Hide Top models/ })
        .click()
      await page.keyboard.press('Escape')
      await layoutControls.waitFor({ state: 'hidden' })
      await page.reload({ waitUntil: 'networkidle' })
      await page.waitForTimeout(750)
      await page.getByRole('button', { name: 'Edit layout' }).first().click()
      const reloadedLayoutControls = page.locator('#dashboard-layout-controls')
      await reloadedLayoutControls.waitFor({ state: 'visible' })
      layoutInteraction.persistedAcrossReload =
        (await reloadedLayoutControls
          .getByRole('button', { name: /^Show Top models/ })
          .count()) > 0
      await reloadedLayoutControls
        .getByRole('button', { name: 'Restore default dashboard layout' })
        .click()
      await page
        .locator('[role="alertdialog"]')
        .getByRole('button', { name: 'Restore defaults' })
        .click()
      await page.keyboard.press('Escape')
      await reloadedLayoutControls.waitFor({ state: 'hidden' })
      await page.waitForFunction(
        () =>
          document.activeElement?.getAttribute('aria-label') === 'Edit layout',
      )
      layoutInteraction.closedWithEscape = true
      layoutInteraction.focusRestored = true
    }
    let notificationInteraction = {
      checked: false,
      opened: false,
      closedWithEscape: false,
      focusRestored: false,
      touchTarget: false,
    }
    await page.evaluate(() => {
      const main = document.querySelector('main[data-tour="chat-area"]')
      if (main instanceof HTMLElement) main.scrollTop = 0
    })
    await page.waitForTimeout(80)
    const notificationToggle = page
      .getByRole('button', { name: /^Notifications/ })
      .first()
    if (await notificationToggle.count()) {
      notificationInteraction.checked = true
      notificationInteraction.touchTarget = await notificationToggle.evaluate(
        (element) =>
          window.innerWidth > 767 ||
          (element.getBoundingClientRect().width >= 40 &&
            element.getBoundingClientRect().height >= 40),
      )
      await notificationToggle.focus()
      await notificationToggle.click()
      const notificationDialog = page.locator(
        '[role="dialog"][aria-labelledby]',
      )
      await notificationDialog.waitFor({ state: 'visible' })
      notificationInteraction.opened = true
      await page.keyboard.press('Escape')
      await notificationDialog.waitFor({ state: 'hidden' })
      await page.evaluate(
        () => new Promise((resolve) => requestAnimationFrame(resolve)),
      )
      notificationInteraction.closedWithEscape = true
      notificationInteraction.focusRestored = await notificationToggle.evaluate(
        (element) => document.activeElement === element,
      )
    }
    await page.evaluate(() => {
      const main = document.querySelector('main[data-tour="chat-area"]')
      if (main instanceof HTMLElement) main.scrollTop = main.scrollHeight
    })
    // The notification bell reacts to the scroll event asynchronously. Give
    // its state update a frame before asserting that the fixed control is out
    // of the way at the bottom of the dashboard.
    await page.waitForTimeout(120)
    let copyHintInteraction = {
      checked: false,
      copied: false,
      confirmed: false,
    }
    const copyHint = page
      .getByRole('button', { name: 'Copy full optimization hint' })
      .first()
    if (await copyHint.count()) {
      copyHintInteraction.checked = true
      await page.evaluate(() => {
        Object.defineProperty(navigator, 'clipboard', {
          configurable: true,
          value: {
            writeText: async (value) => {
              window.__dashboardCopiedHint = value
            },
          },
        })
      })
      await copyHint.click()
      copyHintInteraction.copied = await page.evaluate(
        () =>
          typeof window.__dashboardCopiedHint === 'string' &&
          window.__dashboardCopiedHint.length > 0,
      )
      copyHintInteraction.confirmed =
        (await page.getByRole('button', { name: 'Hint copied' }).count()) > 0
    }
    result = {
      ...result,
      chartInteraction,
      layoutInteraction,
      mobileMenuInteraction,
      notificationInteraction,
      copyHintInteraction,
      mobileNavScrollInteraction: await page.evaluate(() => {
        const nav = document.querySelector(
          'nav[aria-label="Mobile navigation"]',
        )
        const strip = nav?.querySelector('[class*="overflow-x-auto"]')
        if (!(strip instanceof HTMLElement) || window.innerWidth >= 768) {
          return { checked: false, leftAffordance: false }
        }
        if (strip.scrollWidth <= strip.clientWidth + 1) {
          return { checked: false, leftAffordance: false }
        }
        strip.scrollTo({
          left: Math.max(0, strip.scrollWidth - strip.clientWidth),
          behavior: 'auto',
        })
        strip.dispatchEvent(new Event('scroll', { bubbles: true }))
        return new Promise((resolve) => {
          setTimeout(() => {
            const leftAffordance = Boolean(
              nav?.querySelector('[data-testid="mobile-nav-scroll-left"]'),
            )
            strip.scrollTo({ left: 0, behavior: 'auto' })
            strip.dispatchEvent(new Event('scroll', { bubbles: true }))
            // Allow React to consume the reset scroll event before the caller
            // captures a screenshot; otherwise the stale left gradient can
            // briefly cover the active first tab.
            setTimeout(() => resolve({ checked: true, leftAffordance }), 100)
          }, 150)
        })
      }),
      notificationOverlapsContent: await page.evaluate(() => {
        const bell = document.querySelector(
          'button[aria-label^="Notifications"]',
        )
        if (!(bell instanceof HTMLElement)) return false
        const style = getComputedStyle(bell)
        return style.display !== 'none' && style.visibility !== 'hidden'
      }),
    }
    if (screenshotDir) {
      if (screenshotPosition === 'top') {
        await page.evaluate(() => {
          const main = document.querySelector('main[data-tour="chat-area"]')
          if (main instanceof HTMLElement) main.scrollTop = 0
        })
        await page.waitForTimeout(60)
      } else {
        // Interactions above can trigger layout updates after the earlier
        // scroll assertion. Re-seek the owning scroll container immediately
        // before a bottom capture so fixed mobile navigation clearance is
        // measured at the true end of the dashboard.
        await page.evaluate(() => {
          const main = document.querySelector('main[data-tour="chat-area"]')
          if (main instanceof HTMLElement) main.scrollTop = main.scrollHeight
        })
        await page.waitForTimeout(120)
      }
      await page.screenshot({
        path: `${screenshotDir}/dashboard-${viewport.name}.png`,
        fullPage: false,
      })
    }

    if (!response || response.status() >= 500) {
      console.error(`❌ ${viewport.name}: HTTP ${response?.status() ?? 'none'}`)
      failures++
    } else if (
      !result.dashboard ||
      result.theme !== (dashboardTheme || 'claude-nous') ||
      result.startupSplashVisible ||
      result.initialSplashVisible ||
      result.pendingConnectionLoaderVisible ||
      (overviewFailure && !result.degradedBannerOpaque) ||
      result.chatOverlapsContent ||
      result.notificationOverlapsContent ||
      result.hasErrorBoundary ||
      result.overflow ||
      result.bottomOccluded ||
      result.sidebarContentOverlap ||
      !result.sidebarFooterTouchTargets ||
      !result.mobileNavAccessible ||
      !result.mobileNavActiveFullyVisible ||
      !result.skipLinkPresent ||
      !result.singleSkipLink ||
      !result.activePageSemantics ||
      !result.mainContentFocusable ||
      !result.headingStructure.valid ||
      result.mobileNavOverlapsLastCard ||
      !result.toolbarTouchTargets ||
      !result.opsTouchTargets ||
      result.smallDashboardButtons.length > 0 ||
      (result.chartInteraction.checked &&
        (!result.chartInteraction.expanded ||
          !result.chartInteraction.periodChanged ||
          !result.chartInteraction.periodKeyboardChanged ||
          !result.chartInteraction.touchTargets ||
          !result.chartInteraction.closedWithEscape ||
          !result.chartInteraction.focusRestored)) ||
      (result.layoutInteraction.checked &&
        (!result.layoutInteraction.opened ||
          !result.layoutInteraction.touchTargets ||
          !result.layoutInteraction.mobileBottomClearance ||
          !result.layoutInteraction.focusEntered ||
          !result.layoutInteraction.groupingAccurate ||
          !result.layoutInteraction.allHiddenRecovery ||
          !result.layoutInteraction.allWidgetsVisible ||
          !result.layoutInteraction.persistenceStatus ||
          !result.layoutInteraction.persistedAcrossReload ||
          !result.layoutInteraction.closedWithEscape ||
          !result.layoutInteraction.focusRestored)) ||
      (result.notificationInteraction.checked &&
        (!result.notificationInteraction.opened ||
          !result.notificationInteraction.touchTarget ||
          !result.notificationInteraction.closedWithEscape ||
          !result.notificationInteraction.focusRestored)) ||
      (result.mobileMenuInteraction.checked &&
        (!result.mobileMenuInteraction.opened ||
          !result.mobileMenuInteraction.scrollContained ||
          !result.mobileMenuInteraction.footerVisible ||
          !result.mobileMenuInteraction.closedWithEscape ||
          !result.mobileMenuInteraction.focusRestored)) ||
      (result.mobileNavScrollInteraction.checked &&
        !result.mobileNavScrollInteraction.leftAffordance) ||
      (result.copyHintInteraction.checked &&
        (!result.copyHintInteraction.copied ||
          !result.copyHintInteraction.confirmed)) ||
      result.unnamedInteractive.length > 0 ||
      errors.length > 0
    ) {
      console.error(
        `❌ ${viewport.name}: ${JSON.stringify({ ...result, errors })}`,
      )
      failures++
    } else if (overviewFailure && !result.recoveryAction) {
      console.error(
        `❌ ${viewport.name}: degraded overview has no retry action`,
      )
      failures++
    } else {
      console.log(`✅ ${viewport.name}: dashboard fixture healthy`)
    }
    await page.close()
  }
} finally {
  await browser.close()
}

if (failures > 0) process.exit(1)
