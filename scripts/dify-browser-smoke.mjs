#!/usr/bin/env node
/**
 * Optional unauthenticated browser smoke for the Dify Workbench shell.
 * Usage: DIFY_BROWSER_SMOKE=1 BASE_URL=http://localhost:3000 pnpm smoke:dify:browser
 */
if (process.env.DIFY_BROWSER_SMOKE !== '1') {
  console.log('⏭️ Dify browser smoke skipped: set DIFY_BROWSER_SMOKE=1')
  process.exit(0)
}

const { chromium } = await import('playwright')
const baseUrl = (process.env.BASE_URL || 'http://localhost:3000').replace(
  /\/$/,
  '',
)
const browser = await chromium.launch({ headless: true })
const page = await browser.newPage()
try {
  const response = await page.goto(`${baseUrl}/dify`, {
    waitUntil: 'domcontentloaded',
  })
  if (!response || response.status() >= 500) {
    throw new Error(
      `Workbench returned HTTP ${response?.status() ?? 'no response'}`,
    )
  }
  const text = await page.locator('body').innerText()
  if (!/Dify Workbench|sign in|log in|login/i.test(text)) {
    throw new Error(
      'Workbench shell or authentication surface was not rendered',
    )
  }
  console.log(`✅ Dify Workbench browser shell (${response.status()})`)
} finally {
  await browser.close()
}
