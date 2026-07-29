import { mkdir } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { chromium } from 'playwright'

const baseURL = process.env.HERMES_WORKSPACE_URL || 'http://127.0.0.1:3000'
const password = process.env.HERMES_WORKSPACE_E2E_PASSWORD
const storageStatePath = resolve(
  process.env.HERMES_WORKSPACE_E2E_STORAGE_STATE || 'e2e/.auth/storage-state.json',
)

if (!password) {
  throw new Error(
    'Set HERMES_WORKSPACE_E2E_PASSWORD; this script never reads passwords from files.',
  )
}

await mkdir(dirname(storageStatePath), { recursive: true })

const browser = await chromium.launch({ headless: true })
try {
  const context = await browser.newContext()
  const page = await context.newPage()
  await page.goto(baseURL, { waitUntil: 'domcontentloaded' })

  const passwordInput = page.locator('#lp-pw')
  if (await passwordInput.isVisible({ timeout: 2_000 }).catch(() => false)) {
    await passwordInput.fill(password)
    await page.getByRole('button', { name: 'Sign In' }).click()
    await passwordInput.waitFor({ state: 'hidden', timeout: 10_000 })
  }

  await context.storageState({ path: storageStatePath })
  console.log(`Saved Playwright auth storage state to ${storageStatePath}`)
} finally {
  await browser.close()
}
