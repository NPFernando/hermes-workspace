import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { mkdtemp, rm } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'
import { chromium } from 'playwright'

const port = process.env.FINANCE_E2E_PORT || '4178'
const baseUrl = `http://127.0.0.1:${port}`
const bundledChromium = chromium.executablePath()
const browserExecutable =
  process.env.FINANCE_E2E_CHROMIUM_PATH ||
  (existsSync(bundledChromium) ? bundledChromium : '/usr/bin/chromium-browser')
const testPassword = 'finance-e2e-only-password'
const financePayload = {
  ok: true,
  checkedAt: Date.now(),
  baseCurrency: 'LKR',
  fxToBase: 1,
  summary: {
    baseCurrency: 'LKR',
    netWorthBase: 110_000,
    cashBalanceBase: 100_000,
    netSavingsBase: 5_000,
    savingsRate: 25,
    totalIncomeBase: 30_000,
    totalExpensesBase: 25_000,
    taxReserveBase: 0,
    stockHoldingsValueBase: 10_000,
    fixedDepositsValueBase: 0,
    debtBase: 0,
    unrealizedStockPnlBase: 1_500,
    unrealizedStockPnlPct: 15,
    accountCount: 1,
  },
  budgetVsActual: [],
  alerts: [],
  trends: { series: [], categoriesThisMonth: [] },
  recurringBills: [],
  cashFlowForecast: {
    averageMonthlyIncomeLkr: 30_000,
    averageMonthlyExpenseLkr: 25_000,
    recurringMonthlyLkr: 0,
    safeToSpendLkr: 5_000,
    months: [],
    alerts: [],
  },
  upcomingMoney: {
    paydays: [],
    contracts: [],
    fdMaturities: [],
    scheduled: [],
  },
  currencyExposure: [],
  fxGainLoss: {
    entries: [
      {
        id: 'holding-1',
        symbol: 'ABC',
        currency: 'USD',
        quantity: 2,
        assetGainLkr: 1_000,
        fxGainLkr: 500,
        totalReturnLkr: 1_500,
        insufficientHistory: false,
      },
    ],
    totalAssetGainLkr: 1_000,
    totalFxGainLkr: 500,
    totalReturnLkr: 1_500,
    excludedCount: 0,
  },
  netWorthHistory: [
    {
      date: '2026-07-01',
      netWorthBase: 100_000,
      cashBase: 90_000,
      investmentsBase: 10_000,
      debtBase: 0,
    },
    {
      date: '2026-08-01',
      netWorthBase: 110_000,
      cashBase: 100_000,
      investmentsBase: 10_000,
      debtBase: 0,
    },
  ],
  netWorthForecast: {
    hasData: true,
    currentNetWorthBase: 110_000,
    monthlyDeltaBase: 5_000,
    monthsOfHistoryUsed: 3,
    points: [{ month: '2026-09', projectedNetWorthBase: 115_000 }],
    accountBreakdown: [
      {
        accountId: 'checking',
        accountName: 'Everyday checking',
        type: 'bank',
        currentBalanceBase: 100_000,
        projectedBalanceBase: 115_000,
      },
    ],
  },
  transactionsWindowMonths: 12,
  emergencyFund: {
    targetMonths: 6,
    avgMonthlyExpensesBase: 25_000,
    currentBase: 100_000,
    targetBase: 150_000,
    coverageMonths: 4,
    progressPct: 66.7,
  },
  savingsRateTarget: {
    targetPct: 20,
    actualPct: 25,
    progressPct: 100,
    hasData: true,
  },
  wealthGoal: {
    targetBase: 1_000_000,
    targetDate: null,
    currentBase: 110_000,
    progressPct: 11,
  },
  financeQaHistory: [],
  storage: {
    active: 'postgres',
    postgres: { enabled: true, available: true, snapshotAvailable: true },
    health: {
      status: 'healthy',
      warnings: [],
      postgresUpdatedAt: null,
      rowCounts: { postgres: {} },
    },
  },
  data: {
    finance_accounts: [
      {
        id: 'checking',
        name: 'Everyday checking',
        type: 'bank',
        currency: 'LKR',
        balance: 100_000,
      },
    ],
    income_records: [],
    expense_records: [],
    transfers: [],
    scheduled_transactions: [],
    budget_categories: [],
    categories: [],
    subcategories: [],
    merchants: [],
    tags: [],
    savings_goals: [
      {
        id: 'emergency-fund',
        name: 'Emergency fund',
        targetAmount: 50_000,
        currentAmount: 10_000,
        monthlyContribution: 10_000,
        currency: 'LKR',
        targetDate: '',
        priority: 1,
        status: 'active',
        goalKind: 'general',
      },
    ],
    tax_records: [],
    income_sources: [],
    stock_holdings: [
      {
        id: 'holding-1',
        symbol: 'ABC',
        currency: 'USD',
        quantity: 2,
        buyPrice: 40,
        lastKnownPrice: 45,
      },
    ],
    fixed_deposits: [],
    loans: [],
    properties: [],
    beneficiaries: [],
    exchange_rates: [
      { base: 'USD', target: 'LKR', rate: 300, date: '2026-08-01' },
    ],
  },
}

async function startServer() {
  const hermesHome = await mkdtemp(join(tmpdir(), 'hermes-finance-e2e-'))
  const viteCli = fileURLToPath(
    new URL('../node_modules/vite/bin/vite.js', import.meta.url),
  )
  const server = spawn(
    process.execPath,
    [viteCli, 'dev', '--host', '127.0.0.1', '--port', port, '--strictPort'],
    {
      cwd: process.cwd(),
      stdio: 'inherit',
      env: {
        ...process.env,
        HERMES_HOME: hermesHome,
        HERMES_PASSWORD: testPassword,
        VITEST: 'true',
      },
    },
  )
  const deadline = Date.now() + 60_000
  while (Date.now() < deadline) {
    if (server.exitCode !== null) {
      await rm(hermesHome, { recursive: true, force: true })
      throw new Error(`Vite exited with ${server.exitCode}`)
    }
    try {
      const response = await fetch(baseUrl)
      if (response.ok) return { server, hermesHome }
    } catch {}
    await delay(500)
  }
  server.kill('SIGTERM')
  await rm(hermesHome, { recursive: true, force: true })
  throw new Error(`Vite did not become ready at ${baseUrl}`)
}

let server
let hermesHome
let browser
try {
  const started = await startServer()
  server = started.server
  hermesHome = started.hermesHome
  browser = await chromium.launch({
    executablePath: browserExecutable,
    headless: true,
  })
  const page = await browser.newPage()
  const pageErrors = []
  const consoleErrors = []
  const unmockedEndpoints = []
  const imports = []
  // Keep this journey focused on finance; a fresh browser profile otherwise
  // pauses at the unrelated first-run provider setup screen.
  await page.addInitScript(() => {
    localStorage.setItem('claude-onboarding-complete', 'true')
  })
  page.on('pageerror', (error) => pageErrors.push(error.message))
  page.on('response', async (response) => {
    if (new URL(response.url()).pathname === '/api/auth') {
      const result = await response.json().catch(() => ({}))
      console.log(
        `Test login response: HTTP ${response.status()} ok=${result.ok === true}`,
      )
    }
  })
  page.on('console', (message) => {
    if (message.type() === 'error') consoleErrors.push(message.text())
  })

  // Every API request is intercepted; the browser test never reaches a real
  // finance database, mailbox, or account.
  await page.route('**/api/**', async (route) => {
    const request = route.request()
    const url = new URL(request.url())
    let body = { ok: false, error: 'unmocked_test_endpoint' }

    if (url.pathname === '/api/auth' || url.pathname === '/api/auth-check') {
      await route.continue()
      return
    } else if (url.pathname === '/api/connection-status') {
      body = { ok: true, chatReady: true, modelConfigured: true }
    } else if (url.pathname === '/api/sessions') {
      body = { ok: true, sessions: [] }
    } else if (url.pathname === '/api/auth/google') {
      body = { enabled: false }
    } else if (url.pathname === '/api/finance' && request.method() === 'GET') {
      body = financePayload
    } else if (url.pathname === '/api/finance' && request.method() === 'POST') {
      const payload = request.postDataJSON()
      if (payload.action === 'list_pending_ingestions') {
        body = { ok: true, pendingIngestions: [] }
      } else if (payload.action === 'list_finance_memories') {
        body = { ok: true, harpEnabled: false, memories: [], pending: [] }
      } else if (payload.action === 'import_transactions_csv') {
        imports.push(payload)
        body =
          payload.force === true
            ? {
                ...financePayload,
                created: 1,
                skippedDuplicates: 0,
                errors: [],
              }
            : {
                ...financePayload,
                created: 0,
                skippedDuplicates: 0,
                possibleDuplicates: [
                  {
                    index: 0,
                    match: {
                      vendorOrSource: 'Cafe Nero',
                      date: '2026-08-01',
                      amount: 1_500,
                    },
                  },
                ],
                errors: [],
              }
      } else {
        body = { ok: true }
      }
    } else if (url.pathname === '/api/auth/gmail-connect') {
      body = {
        enabled: true,
        connected: true,
        email: 'finance@example.test',
        connectedAt: null,
        lastSyncedAtSeconds: Math.floor(Date.now() / 1_000),
        syncHistory: [],
        lastError: null,
      }
    } else {
      unmockedEndpoints.push(`${request.method()} ${url.pathname}`)
    }

    await route.fulfill({
      status: body.error ? 404 : 200,
      contentType: 'application/json',
      body: JSON.stringify(body),
    })
  })

  await page.goto(`${baseUrl}/personal-finance`)
  const login = page.locator('#lp-pw')
  await login.waitFor({ state: 'visible', timeout: 15_000 })
  await login.fill(testPassword)
  await page.getByRole('button', { name: 'Sign In', exact: true }).click()
  try {
    await page
      .getByRole('heading', { name: 'Your money at a glance' })
      .waitFor()
  } catch (error) {
    const body = await page
      .locator('body')
      .innerText()
      .catch(() => '(no body text)')
    console.error(`Finance page did not render at ${page.url()}: ${body}`)
    console.error(`Browser errors: ${pageErrors.join(' | ') || '(none)'}`)
    throw error
  }
  await page
    .getByText('Where the projected growth lands', { exact: true })
    .waitFor()
  await page.getByRole('button', { name: 'breakdown', exact: true }).click()
  await page
    .getByText('Where the projected growth lands', { exact: true })
    .waitFor({ state: 'hidden' })
  await page.getByRole('button', { name: 'total', exact: true }).click()
  await page
    .getByText('Where the projected growth lands', { exact: true })
    .waitFor()

  await page
    .getByText('Settings, assistant memory & data health', { exact: true })
    .click()
  await page.getByRole('status').getByText('Fresh', { exact: true }).waitFor()

  await page.getByRole('button', { name: 'Accounts & Records' }).click()
  await page.getByRole('heading', { name: 'Accounts', exact: true }).waitFor()
  await page.getByText(/about 4 months/).waitFor()

  await page.getByRole('button', { name: 'Investments' }).click()
  const rateMove = page.getByLabel('Foreign currency rate move against LKR')
  const initialFx = await page.getByText('FX-only change:').textContent()
  await rateMove.selectOption('-10')
  await page.waitForFunction((before) => {
    const node = [...document.querySelectorAll('span')].find((span) =>
      span.textContent.includes('FX-only change:'),
    )
    return node && node.textContent !== before
  }, initialFx)

  await page.getByRole('button', { name: 'Ingestion' }).click()
  await page
    .locator('input[type="file"][accept=".csv,text/csv"]')
    .setInputFiles({
      name: 'review.csv',
      mimeType: 'text/csv',
      buffer: Buffer.from('Date,Amount,Vendor\n2026-08-01,-1500,Cafe Nreo\n'),
    })
  try {
    await page.getByText(/1 row\(s\) found/).waitFor({ timeout: 5_000 })
  } catch (error) {
    console.error(
      `CSV import screen: ${await page.locator('body').innerText()}`,
    )
    throw error
  }
  await page.getByRole('button', { name: /Import 1 row/ }).click()
  try {
    await page
      .getByText(/1 row\(s\) held for review/)
      .waitFor({ timeout: 5_000 })
  } catch (error) {
    console.error(
      `CSV review result: ${await page.locator('body').innerText()}`,
    )
    console.error(`Import requests: ${JSON.stringify(imports)}`)
    throw error
  }
  assert.equal(imports.length, 1)
  assert.equal(imports[0].force, undefined)
  await page.getByRole('button', { name: /reviewed row\(s\) anyway/ }).click()
  await page.getByText(/1 record\(s\) created/).waitFor()
  assert.equal(imports.length, 2)
  assert.equal(imports[1].force, true)

  assert.deepEqual(pageErrors, [])
  if (unmockedEndpoints.length > 0) {
    console.log(
      `Other API requests safely intercepted as 404: ${[...new Set(unmockedEndpoints)].join(', ')}`,
    )
  }
  if (consoleErrors.length > 0) {
    console.log(`Browser console errors (non-fatal): ${consoleErrors.length}`)
  }
  console.log(
    'Finance browser journey passed: forecast, goal timeline, FX scenario, Gmail freshness, duplicate review.',
  )
} finally {
  await browser?.close()
  if (server && server.exitCode === null) {
    server.kill('SIGTERM')
    await Promise.race([
      new Promise((resolve) => server.once('exit', resolve)),
      delay(5_000),
    ])
  }
  if (hermesHome) await rm(hermesHome, { recursive: true, force: true })
}
