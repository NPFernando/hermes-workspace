#!/usr/bin/env node
/**
 * Unauthenticated responsive/browser smoke test.
 * Usage: node scripts/browser-smoke.mjs [baseUrl]
 * Authenticated product-flow QA still requires a browser session with login.
 */

import { chromium } from 'playwright'

const baseUrl = (
  process.argv[2] ||
  process.env.BASE_URL ||
  'http://localhost:3000'
).replace(/\/$/, '')
const viewports = [
  { name: 'mobile', width: 390, height: 844 },
  { name: 'tablet', width: 768, height: 1024 },
  { name: 'desktop', width: 1280, height: 900 },
]

const browser = await chromium.launch({ headless: true })
const page = await browser.newPage()
let failures = 0

try {
  for (const viewport of viewports) {
    await page.setViewportSize(viewport)
    const response = await page.goto(baseUrl, { waitUntil: 'domcontentloaded' })
    if (!response || !response.ok()) {
      console.error(
        `❌ ${viewport.name}: HTTP ${response?.status() ?? 'no response'}`,
      )
      failures++
      continue
    }

    // SSR intentionally leaves the app shell empty until hydration decides
    // whether to show login or the workspace. Wait for either surface before
    // evaluating accessibility so this smoke test does not race hydration.
    await page.waitForFunction(
      () =>
        Boolean(
          document.querySelector(
            '#root, .lp-root, .lp-card, #lp-pw, main, [role="main"], nav',
          ),
        ),
      { timeout: 5000 },
    )
    await page.waitForFunction(
      () =>
        Array.from(
          document.querySelectorAll(
            'button, a[href], input, textarea, select, [role="button"]',
          ),
        )
          .filter((element) => {
            const style = window.getComputedStyle(element)
            return style.display !== 'none' && style.visibility !== 'hidden'
          })
          .every((element) => {
            const labelledBy = element.getAttribute('aria-labelledby')
            const labelledText = labelledBy
              ? labelledBy
                  .split(/\s+/)
                  .map((id) => document.getElementById(id)?.textContent || '')
                  .join(' ')
              : ''
            const label = element.closest('label')?.textContent || ''
            return Boolean(
              (
                element.getAttribute('aria-label') ||
                labelledText ||
                element.getAttribute('title') ||
                element.getAttribute('placeholder') ||
                label ||
                element.innerText ||
                element.textContent ||
                ''
              ).trim(),
            )
          }),
      { timeout: 5000 },
    )
    await page.waitForTimeout(250)

    const result = await page.evaluate(() => ({
      hasSurface: Boolean(
        document.getElementById('root') ||
        document.querySelector(
          '#lp-pw, .lp-root, .lp-card, main, [role="main"], nav, [data-testid]',
        ),
      ),
      hasHorizontalOverflow:
        document.documentElement.scrollWidth > window.innerWidth + 1,
      hasMainContent: Boolean(
        document.querySelector('main, [role="main"], body'),
      ),
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
            element.innerText ||
            element.textContent ||
            ''
          return value.trim().length === 0
        })
        .slice(0, 10)
        .map((element) => element.outerHTML.slice(0, 160)),
    }))

    if (!result.hasSurface || !result.hasMainContent) {
      console.error(`❌ ${viewport.name}: missing application surface`)
      failures++
      continue
    }
    if (result.hasHorizontalOverflow) {
      console.error(`❌ ${viewport.name}: horizontal overflow detected`)
      failures++
      continue
    }
    if (result.unnamedInteractive.length > 0) {
      console.error(
        `❌ ${viewport.name}: unnamed interactive elements: ${result.unnamedInteractive.join(' | ')}`,
      )
      failures++
      continue
    }
    console.log(`✅ ${viewport.name}: ${viewport.width}px layout healthy`)
  }
} finally {
  await browser.close()
}

if (failures > 0) process.exit(1)
