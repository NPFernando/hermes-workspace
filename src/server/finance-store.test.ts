import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import {
  buildFinanceStorageHealth,
  budgetVsActualSummary,
  createEmptyFinanceDatabase,
  createTradingPlan,
  financeAlerts,
  financeSummary,
  financeStorageAlerts,
  getAverageMonthlyExpensesLkr,
  getUnifiedTransactions,
  maskSensitive,
} from './finance-store'

describe('finance-store', () => {
  it('summarises personal finance records in LKR', () => {
    const db = createEmptyFinanceDatabase()
    db.income_records.push({
      id: 'income-1',
      dateReceived: '2026-06-28',
      sourceName: 'Salary',
      incomeType: 'Salary',
      originalCurrency: 'LKR',
      originalAmount: 100_000,
      exchangeRateUsed: 1,
      convertedLkrAmount: 100_000,
      taxable: true,
      source: 'test',
      createdAt: '2026-06-28T00:00:00.000Z',
      updatedAt: '2026-06-28T00:00:00.000Z',
    })
    db.expense_records.push({
      id: 'expense-1',
      date: '2026-06-28',
      vendor: 'Cloud',
      category: 'Cloud services',
      currency: 'USD',
      amount: 10,
      convertedLkrAmount: 3_000,
      recurring: true,
      workRelated: true,
      taxDeductiblePossible: true,
      source: 'test',
      createdAt: '2026-06-28T00:00:00.000Z',
      updatedAt: '2026-06-28T00:00:00.000Z',
    })

    expect(financeSummary(db)).toMatchObject({
      totalIncomeLkr: 100_000,
      totalExpensesLkr: 3_000,
      netSavingsLkr: 97_000,
      savingsRate: 97,
    })
  })

  it('blocks executable trading plans without required risk controls', () => {
    const plan = createTradingPlan({
      platform: 'binance',
      symbol: 'BTCUSDT',
      assetType: 'crypto',
      decision: 'BUY_NOW',
      riskLevel: 'medium_risk',
      riskScore: 55,
      confidenceScore: 60,
      positionSize: 100,
    })

    expect(plan.decision).toBe('BLOCKED')
    expect(plan.status).toBe('blocked')
    expect(plan.reason).toContain('stop-loss is required')
  })

  it('masks keys and tokens before exposing payloads', () => {
    expect(
      maskSensitive({
        apiKey: 'secret',
        nested: { refreshToken: 'token', visible: 'ok' },
      }),
    ).toEqual({
      apiKey: '[masked]',
      nested: { refreshToken: '[masked]', visible: 'ok' },
    })
  })

  it('raises alerts for kill switch and blocked plans', () => {
    const db = createEmptyFinanceDatabase()
    db.trading_plans.push(
      createTradingPlan({
        decision: 'BUY_NOW',
        symbol: 'TSLA',
        riskLevel: 'blocked',
      }),
    )
    const alerts = financeAlerts(db)
    expect(
      alerts.some((alert) => alert.title === 'Emergency kill switch active'),
    ).toBe(true)
    expect(alerts.some((alert) => alert.title === 'Trading plan blocked')).toBe(
      true,
    )
  })

  it('warns when the Postgres mirror has fewer rows than JSON storage', () => {
    const jsonDb = createEmptyFinanceDatabase()
    const postgresDb = createEmptyFinanceDatabase()
    jsonDb.updatedAt = '2026-07-08T00:00:00.000Z'
    postgresDb.updatedAt = jsonDb.updatedAt
    jsonDb.historical_candles.push({
      id: 'binance:BTCUSDT:1h:1',
      platform: 'binance',
      symbol: 'BTCUSDT',
      interval: '1h',
    })

    const health = buildFinanceStorageHealth({
      jsonDb,
      postgresDb,
      postgres: {
        enabled: true,
        available: true,
        snapshotAvailable: true,
      },
    })

    expect(health.status).toBe('mirror_mismatch')
    expect(health.isPostgresBehindJson).toBe(true)
    expect(health.rowCounts.lagging.historical_candles).toEqual({
      json: 1,
      postgres: 0,
    })
    expect(health.warnings[0]).toContain('historical_candles 0/1')
  })

  it('turns unresolved storage health warnings into a visible alert', () => {
    const jsonDb = createEmptyFinanceDatabase()
    const postgresDb = createEmptyFinanceDatabase()
    jsonDb.updatedAt = '2026-07-08T00:00:30.000Z'
    postgresDb.updatedAt = '2026-07-08T00:00:00.000Z'
    const health = buildFinanceStorageHealth({
      jsonDb,
      postgresDb,
      postgres: {
        enabled: true,
        available: true,
        snapshotAvailable: true,
        lastWriteError: 'psql exited 1',
      },
      selfHeal: {
        attempted: true,
        attempts: 2,
        succeeded: false,
        lastAttemptAt: '2026-07-08T00:00:31.000Z',
      },
    })

    const [alert] = financeStorageAlerts(health)

    expect(alert).toMatchObject({
      level: 'warning',
      title: 'Finance storage mirror unhealthy',
    })
    expect(alert.detail).toContain('Postgres mirror is 30s behind')
    expect(alert.detail).toContain('Self-heal did not resolve it')
  })

  it('excludes categories with no budget set for the requested month', () => {
    const db = createEmptyFinanceDatabase()
    db.expense_records.push({
      id: 'expense-1',
      date: '2026-07-05',
      vendor: 'Cargills',
      category: 'Groceries',
      currency: 'LKR',
      amount: 5_000,
      convertedLkrAmount: 5_000,
      recurring: false,
      workRelated: false,
      taxDeductiblePossible: false,
      source: 'test',
      createdAt: '2026-07-05T00:00:00.000Z',
      updatedAt: '2026-07-05T00:00:00.000Z',
    })

    expect(budgetVsActualSummary(db, '2026-07')).toEqual([])
  })

  it('reports 0% used and not over budget when no expenses have been logged', () => {
    const db = createEmptyFinanceDatabase()
    db.budget_categories.push({
      id: 'budget-1',
      month: '2026-07',
      category: 'Groceries',
      currency: 'LKR',
      budgetAmount: 20_000,
      source: 'test',
      createdAt: '2026-07-01T00:00:00.000Z',
      updatedAt: '2026-07-01T00:00:00.000Z',
    })

    expect(budgetVsActualSummary(db, '2026-07')).toEqual([
      {
        category: 'Groceries',
        month: '2026-07',
        currency: 'LKR',
        budget: 20_000,
        actual: 0,
        variance: 20_000,
        percentUsed: 0,
        overBudget: false,
      },
    ])
  })

  it('computes percentUsed and variance when spending is under budget', () => {
    const db = createEmptyFinanceDatabase()
    db.budget_categories.push({
      id: 'budget-1',
      month: '2026-07',
      category: 'Groceries',
      currency: 'LKR',
      budgetAmount: 20_000,
      source: 'test',
      createdAt: '2026-07-01T00:00:00.000Z',
      updatedAt: '2026-07-01T00:00:00.000Z',
    })
    db.expense_records.push({
      id: 'expense-1',
      date: '2026-07-05',
      vendor: 'Cargills',
      category: 'Groceries',
      currency: 'LKR',
      amount: 15_000,
      convertedLkrAmount: 15_000,
      recurring: false,
      workRelated: false,
      taxDeductiblePossible: false,
      source: 'test',
      createdAt: '2026-07-05T00:00:00.000Z',
      updatedAt: '2026-07-05T00:00:00.000Z',
    })

    const [result] = budgetVsActualSummary(db, '2026-07')
    expect(result).toMatchObject({
      category: 'Groceries',
      budget: 20_000,
      actual: 15_000,
      variance: 5_000,
      percentUsed: 75,
      overBudget: false,
    })
  })

  it('flags overBudget with a negative variance once spending exceeds budget', () => {
    const db = createEmptyFinanceDatabase()
    db.budget_categories.push({
      id: 'budget-1',
      month: '2026-07',
      category: 'Groceries',
      currency: 'LKR',
      budgetAmount: 20_000,
      source: 'test',
      createdAt: '2026-07-01T00:00:00.000Z',
      updatedAt: '2026-07-01T00:00:00.000Z',
    })
    db.expense_records.push({
      id: 'expense-1',
      date: '2026-07-05',
      vendor: 'Cargills',
      category: 'Groceries',
      currency: 'LKR',
      amount: 25_000,
      convertedLkrAmount: 25_000,
      recurring: false,
      workRelated: false,
      taxDeductiblePossible: false,
      source: 'test',
      createdAt: '2026-07-05T00:00:00.000Z',
      updatedAt: '2026-07-05T00:00:00.000Z',
    })

    const [result] = budgetVsActualSummary(db, '2026-07')
    expect(result).toMatchObject({
      budget: 20_000,
      actual: 25_000,
      variance: -5_000,
      percentUsed: 125,
      overBudget: true,
    })
  })

  it('de-duplicates a category submitted twice for the same month (form double-submit)', () => {
    const db = createEmptyFinanceDatabase()
    db.budget_categories.push(
      {
        id: 'budget-1',
        month: '2026-07',
        category: 'Groceries',
        currency: 'LKR',
        budgetAmount: 20_000,
        source: 'test',
        createdAt: '2026-07-01T00:00:00.000Z',
        updatedAt: '2026-07-01T00:00:00.000Z',
      },
      {
        id: 'budget-2',
        month: '2026-07',
        category: 'Groceries',
        currency: 'LKR',
        budgetAmount: 99_999,
        source: 'test',
        createdAt: '2026-07-01T00:00:01.000Z',
        updatedAt: '2026-07-01T00:00:01.000Z',
      },
    )

    const results = budgetVsActualSummary(db, '2026-07')
    expect(results).toHaveLength(1)
    expect(results[0]).toMatchObject({ category: 'Groceries', budget: 20_000 })
  })
})

// Same isolation pattern as trading-summary.test.ts / rebalance-engine.test.ts —
// point HOME at a temp dir so these never touch the real ~/.hermes/finance store.
describe('addFinanceRecord / updateFinanceRecord / deleteFinanceRecord', () => {
  let tmp: string
  let realHome: string | undefined
  beforeEach(() => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'finance-store-records-'))
    realHome = process.env.HOME
    process.env.HOME = tmp
    vi.resetModules()
  })
  afterEach(() => {
    if (realHome === undefined) delete process.env.HOME
    else process.env.HOME = realHome
    fs.rmSync(tmp, { recursive: true, force: true })
  })

  it('adds, then edits, then deletes an expense record', async () => {
    const store = await import('./finance-store')
    store.addFinanceRecord('expense', { vendor: 'Cafe', category: 'Dining', amount: 500 })

    let db = store.readFinanceStore()
    expect(db.expense_records).toHaveLength(1)
    const id = db.expense_records[0].id

    store.updateFinanceRecord('expense', id, { amount: 750 })
    db = store.readFinanceStore()
    expect(db.expense_records[0].amount).toBe(750)

    store.deleteFinanceRecord('expense', id)
    db = store.readFinanceStore()
    expect(db.expense_records).toHaveLength(0)
  })

  it('throws when deleting an id that does not exist, instead of silently no-oping', async () => {
    const store = await import('./finance-store')
    store.addFinanceRecord('income', { sourceName: 'Salary', originalAmount: 1000 })

    expect(() => store.deleteFinanceRecord('income', 'does-not-exist')).toThrow(/not found/)
    const db = store.readFinanceStore()
    expect(db.income_records).toHaveLength(1)
  })

  it('throws for an unsupported kind on delete', async () => {
    const store = await import('./finance-store')
    expect(() => store.deleteFinanceRecord('trading_plan', 'some-id')).toThrow(/Unsupported/)
  })

  it('throws when updating a record that does not exist', async () => {
    const store = await import('./finance-store')
    expect(() => store.updateFinanceRecord('expense', 'does-not-exist', { amount: 1 })).toThrow(/not found/)
  })
})

describe('findPossibleDuplicate', () => {
  let tmp: string
  let realHome: string | undefined
  beforeEach(() => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'finance-store-dupes-'))
    realHome = process.env.HOME
    process.env.HOME = tmp
    vi.resetModules()
  })
  afterEach(() => {
    if (realHome === undefined) delete process.env.HOME
    else process.env.HOME = realHome
    fs.rmSync(tmp, { recursive: true, force: true })
  })

  it('finds a same-day/vendor/amount expense match, case-insensitive on vendor', async () => {
    const store = await import('./finance-store')
    store.addFinanceRecord('expense', { date: '2026-03-01', vendor: 'Cafe Nero', category: 'Dining', amount: 500 })

    const match = store.findPossibleDuplicate('expense', 'cafe nero', '2026-03-01', 500)
    expect(match).toMatchObject({ vendorOrSource: 'Cafe Nero', date: '2026-03-01', amount: 500 })
  })

  it('treats amounts within 1% as the same', async () => {
    const store = await import('./finance-store')
    store.addFinanceRecord('expense', { date: '2026-03-01', vendor: 'Cafe Nero', category: 'Dining', amount: 500 })
    expect(store.findPossibleDuplicate('expense', 'Cafe Nero', '2026-03-01', 502)).not.toBeNull()
  })

  it('does not match a different date, vendor, or amount beyond tolerance', async () => {
    const store = await import('./finance-store')
    store.addFinanceRecord('expense', { date: '2026-03-01', vendor: 'Cafe Nero', category: 'Dining', amount: 500 })

    expect(store.findPossibleDuplicate('expense', 'Cafe Nero', '2026-03-02', 500)).toBeNull()
    expect(store.findPossibleDuplicate('expense', 'Different Cafe', '2026-03-01', 500)).toBeNull()
    expect(store.findPossibleDuplicate('expense', 'Cafe Nero', '2026-03-01', 600)).toBeNull()
  })

  it('checks income and expense collections independently', async () => {
    const store = await import('./finance-store')
    store.addFinanceRecord('income', { dateReceived: '2026-03-01', sourceName: 'Client A', originalAmount: 1000 })

    expect(store.findPossibleDuplicate('income', 'Client A', '2026-03-01', 1000)).not.toBeNull()
    expect(store.findPossibleDuplicate('expense', 'Client A', '2026-03-01', 1000)).toBeNull()
  })
})

describe('recordCategoryCorrection / getCategoryCorrections', () => {
  let tmp: string
  let realHome: string | undefined
  beforeEach(() => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'finance-store-corrections-'))
    realHome = process.env.HOME
    process.env.HOME = tmp
    vi.resetModules()
  })
  afterEach(() => {
    if (realHome === undefined) delete process.env.HOME
    else process.env.HOME = realHome
    fs.rmSync(tmp, { recursive: true, force: true })
  })

  it('records and retrieves a vendor -> category correction, keyed case-insensitively', async () => {
    const store = await import('./finance-store')
    expect(store.getCategoryCorrections()).toEqual({})

    store.recordCategoryCorrection('Keells Super', 'Groceries')
    expect(store.getCategoryCorrections()).toEqual({ 'keells super': 'Groceries' })
  })

  it('overwrites a prior correction for the same vendor', async () => {
    const store = await import('./finance-store')
    store.recordCategoryCorrection('Keells Super', 'Groceries')
    store.recordCategoryCorrection('keells super', 'Household')
    expect(store.getCategoryCorrections()).toEqual({ 'keells super': 'Household' })
  })

  it('ignores an empty vendor or category', async () => {
    const store = await import('./finance-store')
    store.recordCategoryCorrection('', 'Groceries')
    store.recordCategoryCorrection('Vendor', '')
    expect(store.getCategoryCorrections()).toEqual({})
  })
})

describe('income_sources / stock_holdings / fixed_deposits (add/update/delete)', () => {
  let tmp: string
  let realHome: string | undefined
  beforeEach(() => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'finance-store-newkinds-'))
    realHome = process.env.HOME
    process.env.HOME = tmp
    vi.resetModules()
  })
  afterEach(() => {
    if (realHome === undefined) delete process.env.HOME
    else process.env.HOME = realHome
    fs.rmSync(tmp, { recursive: true, force: true })
  })

  it('adds, edits, then deletes an income source (job)', async () => {
    const store = await import('./finance-store')
    store.addFinanceRecord('income_source', {
      employerName: 'Acme Corp',
      employmentType: 'contract',
      monthlyIncomeAmount: 5000,
      currency: 'USD',
      contractStartDate: '2026-01-01',
      contractEndDate: '2026-12-31',
    })
    let db = store.readFinanceStore()
    expect(db.income_sources).toHaveLength(1)
    expect(db.income_sources[0]).toMatchObject({
      employerName: 'Acme Corp',
      employmentType: 'contract',
      monthlyIncomeAmount: 5000,
      status: 'active',
    })
    const id = db.income_sources[0].id

    store.updateFinanceRecord('income_source', id, { status: 'ended' })
    db = store.readFinanceStore()
    expect(db.income_sources[0].status).toBe('ended')

    store.deleteFinanceRecord('income_source', id)
    db = store.readFinanceStore()
    expect(db.income_sources).toHaveLength(0)
  })

  it('persists jobTitle through add and update (e.g. contract-driven intake)', async () => {
    const store = await import('./finance-store')
    store.addFinanceRecord('income_source', {
      employerName: 'Acme Corp',
      employmentType: 'contract',
      jobTitle: 'Software Engineer',
    })
    let db = store.readFinanceStore()
    expect(db.income_sources[0].jobTitle).toBe('Software Engineer')
    const id = db.income_sources[0].id

    store.updateFinanceRecord('income_source', id, { jobTitle: 'Senior Software Engineer' })
    db = store.readFinanceStore()
    expect(db.income_sources[0].jobTitle).toBe('Senior Software Engineer')
  })

  it('persists documentRef so the original uploaded contract can be retrieved later', async () => {
    const store = await import('./finance-store')
    store.addFinanceRecord('income_source', {
      employerName: 'Acme Corp',
      employmentType: 'contract',
      documentRef: '/home/ubuntu/.hermes/finance/ingestion-uploads/some-contract.pdf',
    })
    const db = store.readFinanceStore()
    expect(db.income_sources[0].documentRef).toBe('/home/ubuntu/.hermes/finance/ingestion-uploads/some-contract.pdf')
  })

  it('persists expectedPaydayDayOfMonth/paySchedule on a job, and incomeSourceId on an income record', async () => {
    const store = await import('./finance-store')
    store.addFinanceRecord('income_source', {
      employerName: 'Acme Corp',
      employmentType: 'full_time',
      expectedPaydayDayOfMonth: 30,
      paySchedule: 'Last business day of each month',
    })
    const job = store.readFinanceStore().income_sources[0]
    expect(job.expectedPaydayDayOfMonth).toBe(30)
    expect(job.paySchedule).toBe('Last business day of each month')

    store.addFinanceRecord('income', {
      dateReceived: '2026-08-30',
      sourceName: 'Acme Corp',
      originalAmount: 150000,
      originalCurrency: 'LKR',
      incomeSourceId: job.id,
    })
    const income = store.readFinanceStore().income_records[0]
    expect(income.incomeSourceId).toBe(job.id)
  })

  it('a partial contract-renewal update merges onto the existing job without clobbering untouched fields', async () => {
    const store = await import('./finance-store')
    store.addFinanceRecord('income_source', {
      employerName: 'Acme Corp',
      employmentType: 'contract',
      jobTitle: 'Software Engineer',
      monthlyIncomeAmount: 150000,
      currency: 'LKR',
      contractStartDate: '2025-01-01',
      contractEndDate: '2026-01-01',
    })
    const id = store.readFinanceStore().income_sources[0].id

    // Simulates confirming a renewal contract: only the fields present in the
    // extracted/edited payload are sent, same as confirm_pending_ingestion.
    store.updateFinanceRecord('income_source', id, {
      contractEndDate: '2027-01-01',
      monthlyIncomeAmount: 175000,
    })
    const db = store.readFinanceStore()
    expect(db.income_sources[0]).toMatchObject({
      employerName: 'Acme Corp',
      employmentType: 'contract',
      jobTitle: 'Software Engineer',
      contractStartDate: '2025-01-01',
      contractEndDate: '2027-01-01',
      monthlyIncomeAmount: 175000,
    })
  })

  it('defaults employmentType to other for an unrecognized value', async () => {
    const store = await import('./finance-store')
    store.addFinanceRecord('income_source', { employerName: 'X', employmentType: 'bogus' })
    const db = store.readFinanceStore()
    expect(db.income_sources[0].employmentType).toBe('other')
  })

  it('supports an income source with no monthlyIncomeAmount (irregular income)', async () => {
    const store = await import('./finance-store')
    store.addFinanceRecord('income_source', { employerName: 'Freelance Clients', employmentType: 'freelance' })
    const db = store.readFinanceStore()
    expect(db.income_sources[0].monthlyIncomeAmount).toBeUndefined()
  })

  it('adds, edits, then deletes a stock holding', async () => {
    const store = await import('./finance-store')
    store.addFinanceRecord('stock_holding', {
      symbol: 'JKH.N0000',
      platform: 'NDB Zone X',
      quantity: 100,
      buyPrice: 150,
      buyDate: '2026-01-15',
      currency: 'LKR',
    })
    let db = store.readFinanceStore()
    expect(db.stock_holdings).toHaveLength(1)
    expect(db.stock_holdings[0]).toMatchObject({ symbol: 'JKH.N0000', quantity: 100, buyPrice: 150, priceSource: 'manual' })
    const id = db.stock_holdings[0].id

    store.updateFinanceRecord('stock_holding', id, { lastKnownPrice: 165, priceSource: 'cse_api' })
    db = store.readFinanceStore()
    expect(db.stock_holdings[0]).toMatchObject({ lastKnownPrice: 165, priceSource: 'cse_api' })

    store.deleteFinanceRecord('stock_holding', id)
    db = store.readFinanceStore()
    expect(db.stock_holdings).toHaveLength(0)
  })

  it('adds, edits, then deletes a fixed deposit', async () => {
    const store = await import('./finance-store')
    store.addFinanceRecord('fixed_deposit', {
      bankName: 'Sampath Bank',
      principal: 500_000,
      currency: 'LKR',
      interestRatePct: 12.5,
      interestPayout: 'monthly',
      startDate: '2026-01-01',
      maturityDate: '2027-01-01',
    })
    let db = store.readFinanceStore()
    expect(db.fixed_deposits).toHaveLength(1)
    expect(db.fixed_deposits[0]).toMatchObject({ bankName: 'Sampath Bank', principal: 500_000, status: 'active' })
    const id = db.fixed_deposits[0].id

    store.updateFinanceRecord('fixed_deposit', id, { status: 'matured' })
    db = store.readFinanceStore()
    expect(db.fixed_deposits[0].status).toBe('matured')

    store.deleteFinanceRecord('fixed_deposit', id)
    db = store.readFinanceStore()
    expect(db.fixed_deposits).toHaveLength(0)
  })
})

describe('account (PF-100 Account Model)', () => {
  let tmp: string
  let realHome: string | undefined
  beforeEach(() => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'finance-store-accounts-'))
    realHome = process.env.HOME
    process.env.HOME = tmp
    vi.resetModules()
  })
  afterEach(() => {
    if (realHome === undefined) delete process.env.HOME
    else process.env.HOME = realHome
    fs.rmSync(tmp, { recursive: true, force: true })
  })

  it('persists openingBalance/openingBalanceDate through add and update', async () => {
    const store = await import('./finance-store')
    store.addFinanceRecord('account', {
      name: 'Test Savings',
      type: 'bank',
      currency: 'LKR',
      balance: 150000,
      openingBalance: 100000,
      openingBalanceDate: '2026-01-01',
    })
    let db = store.readFinanceStore()
    expect(db.finance_accounts[0]).toMatchObject({
      name: 'Test Savings',
      type: 'bank',
      balance: 150000,
      openingBalance: 100000,
      openingBalanceDate: '2026-01-01',
    })
    const id = db.finance_accounts[0].id

    store.updateFinanceRecord('account', id, { balance: 175000 })
    db = store.readFinanceStore()
    expect(db.finance_accounts[0].balance).toBe(175000)
    // Untouched fields survive the shallow-merge update, same as every other kind.
    expect(db.finance_accounts[0].openingBalance).toBe(100000)
    expect(db.finance_accounts[0].openingBalanceDate).toBe('2026-01-01')
  })

  it('supports an account with no opening balance (optional field)', async () => {
    const store = await import('./finance-store')
    store.addFinanceRecord('account', { name: 'Wallet Cash', type: 'cash', currency: 'LKR', balance: 5000 })
    const db = store.readFinanceStore()
    expect(db.finance_accounts[0].openingBalance).toBeUndefined()
    expect(db.finance_accounts[0].openingBalanceDate).toBeUndefined()
  })

  it('defaults account type to other for an unrecognized value', async () => {
    const store = await import('./finance-store')
    store.addFinanceRecord('account', { name: 'Mystery', type: 'bogus', currency: 'LKR', balance: 0 })
    const db = store.readFinanceStore()
    expect(db.finance_accounts[0].type).toBe('other')
  })

  it('adds, edits, then deletes an account', async () => {
    const store = await import('./finance-store')
    store.addFinanceRecord('account', { name: 'Crypto Wallet', type: 'crypto_wallet', currency: 'USD', balance: 100 })
    let db = store.readFinanceStore()
    expect(db.finance_accounts).toHaveLength(1)
    const id = db.finance_accounts[0].id

    store.updateFinanceRecord('account', id, { balance: 250 })
    db = store.readFinanceStore()
    expect(db.finance_accounts[0].balance).toBe(250)

    store.deleteFinanceRecord('account', id)
    db = store.readFinanceStore()
    expect(db.finance_accounts).toHaveLength(0)
  })
})

describe('category (PF-109 Categories)', () => {
  let tmp: string
  let realHome: string | undefined
  beforeEach(() => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'finance-store-categories-'))
    realHome = process.env.HOME
    process.env.HOME = tmp
    vi.resetModules()
  })
  afterEach(() => {
    if (realHome === undefined) delete process.env.HOME
    else process.env.HOME = realHome
    fs.rmSync(tmp, { recursive: true, force: true })
  })

  it('adds, edits, then deletes a category', async () => {
    const store = await import('./finance-store')
    store.addFinanceRecord('category', { name: 'Groceries', kind: 'expense', color: '#22c55e' })
    let db = store.readFinanceStore()
    expect(db.categories).toHaveLength(1)
    expect(db.categories[0]).toMatchObject({ name: 'Groceries', kind: 'expense', color: '#22c55e' })
    const id = db.categories[0].id

    store.updateFinanceRecord('category', id, { name: 'Groceries & Household' })
    db = store.readFinanceStore()
    expect(db.categories[0].name).toBe('Groceries & Household')
    // Untouched fields survive the shallow-merge update, same as every other kind.
    expect(db.categories[0].kind).toBe('expense')

    store.deleteFinanceRecord('category', id)
    db = store.readFinanceStore()
    expect(db.categories).toHaveLength(0)
  })

  it('defaults kind to both for an unrecognized or missing value', async () => {
    const store = await import('./finance-store')
    store.addFinanceRecord('category', { name: 'Misc' })
    let db = store.readFinanceStore()
    expect(db.categories[0].kind).toBe('both')

    store.addFinanceRecord('category', { name: 'Bogus Kind', kind: 'not-a-real-kind' })
    db = store.readFinanceStore()
    expect(db.categories[1].kind).toBe('both')
  })

  it('supports a category with no color or notes (optional fields)', async () => {
    const store = await import('./finance-store')
    store.addFinanceRecord('category', { name: 'Salary', kind: 'income' })
    const db = store.readFinanceStore()
    expect(db.categories[0].color).toBeUndefined()
    expect(db.categories[0].notes).toBeUndefined()
  })
})

describe('subcategory_entry (PF-110 Subcategories)', () => {
  let tmp: string
  let realHome: string | undefined
  beforeEach(() => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'finance-store-subcategories-'))
    realHome = process.env.HOME
    process.env.HOME = tmp
    vi.resetModules()
  })
  afterEach(() => {
    if (realHome === undefined) delete process.env.HOME
    else process.env.HOME = realHome
    fs.rmSync(tmp, { recursive: true, force: true })
  })

  it('adds, edits, then deletes a subcategory', async () => {
    const store = await import('./finance-store')
    store.addFinanceRecord('subcategory_entry', { name: 'Coffee', parentCategory: 'Dining' })
    let db = store.readFinanceStore()
    expect(db.subcategories).toHaveLength(1)
    expect(db.subcategories[0]).toMatchObject({ name: 'Coffee', parentCategory: 'Dining' })
    const id = db.subcategories[0].id

    store.updateFinanceRecord('subcategory_entry', id, { name: 'Coffee & Tea' })
    db = store.readFinanceStore()
    expect(db.subcategories[0].name).toBe('Coffee & Tea')
    // Untouched fields survive the shallow-merge update, same as every other kind.
    expect(db.subcategories[0].parentCategory).toBe('Dining')

    store.deleteFinanceRecord('subcategory_entry', id)
    db = store.readFinanceStore()
    expect(db.subcategories).toHaveLength(0)
  })

  it('defaults parentCategory to Other when missing', async () => {
    const store = await import('./finance-store')
    store.addFinanceRecord('subcategory_entry', { name: 'Misc Sub' })
    const db = store.readFinanceStore()
    expect(db.subcategories[0].parentCategory).toBe('Other')
  })
})

describe('merchant (PF-111 Merchant Registry)', () => {
  let tmp: string
  let realHome: string | undefined
  beforeEach(() => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'finance-store-merchants-'))
    realHome = process.env.HOME
    process.env.HOME = tmp
    vi.resetModules()
  })
  afterEach(() => {
    if (realHome === undefined) delete process.env.HOME
    else process.env.HOME = realHome
    fs.rmSync(tmp, { recursive: true, force: true })
  })

  it('adds, edits, then deletes a merchant', async () => {
    const store = await import('./finance-store')
    store.addFinanceRecord('merchant', { name: 'Cargills', defaultCategory: 'Groceries' })
    let db = store.readFinanceStore()
    expect(db.merchants).toHaveLength(1)
    expect(db.merchants[0]).toMatchObject({ name: 'Cargills', defaultCategory: 'Groceries' })
    const id = db.merchants[0].id

    store.updateFinanceRecord('merchant', id, { name: 'Cargills Food City' })
    db = store.readFinanceStore()
    expect(db.merchants[0].name).toBe('Cargills Food City')
    // Untouched fields survive the shallow-merge update, same as every other kind.
    expect(db.merchants[0].defaultCategory).toBe('Groceries')

    store.deleteFinanceRecord('merchant', id)
    db = store.readFinanceStore()
    expect(db.merchants).toHaveLength(0)
  })

  it('supports a merchant with no default category or notes (optional fields)', async () => {
    const store = await import('./finance-store')
    store.addFinanceRecord('merchant', { name: 'Unknown Vendor' })
    const db = store.readFinanceStore()
    expect(db.merchants[0].defaultCategory).toBeUndefined()
    expect(db.merchants[0].notes).toBeUndefined()
  })
})

describe('tag (PF-112 Tags)', () => {
  let tmp: string
  let realHome: string | undefined
  beforeEach(() => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'finance-store-tags-'))
    realHome = process.env.HOME
    process.env.HOME = tmp
    vi.resetModules()
  })
  afterEach(() => {
    if (realHome === undefined) delete process.env.HOME
    else process.env.HOME = realHome
    fs.rmSync(tmp, { recursive: true, force: true })
  })

  it('adds, edits, then deletes a tag', async () => {
    const store = await import('./finance-store')
    store.addFinanceRecord('tag', { name: 'Travel', notes: 'Trip-related spending' })
    let db = store.readFinanceStore()
    expect(db.tags).toHaveLength(1)
    expect(db.tags[0]).toMatchObject({ name: 'Travel', notes: 'Trip-related spending' })
    const id = db.tags[0].id

    store.updateFinanceRecord('tag', id, { name: 'Travel & Leisure' })
    db = store.readFinanceStore()
    expect(db.tags[0].name).toBe('Travel & Leisure')
    // Untouched fields survive the shallow-merge update, same as every other kind.
    expect(db.tags[0].notes).toBe('Trip-related spending')

    store.deleteFinanceRecord('tag', id)
    db = store.readFinanceStore()
    expect(db.tags).toHaveLength(0)
  })

  it('supports a tag with no notes (optional field)', async () => {
    const store = await import('./finance-store')
    store.addFinanceRecord('tag', { name: 'Work' })
    const db = store.readFinanceStore()
    expect(db.tags[0].notes).toBeUndefined()
  })

  it('round-trips tags on expense and income records through add/update', async () => {
    const store = await import('./finance-store')
    store.addFinanceRecord('expense', { vendor: 'Test', category: 'Other', amount: 10, tags: 'work, travel' })
    let db = store.readFinanceStore()
    expect(db.expense_records[0].tags).toBe('work, travel')
    const expenseId = db.expense_records[0].id
    store.updateFinanceRecord('expense', expenseId, { vendor: 'Test Updated' })
    db = store.readFinanceStore()
    // Untouched tags survive the shallow-merge update.
    expect(db.expense_records[0].tags).toBe('work, travel')

    store.addFinanceRecord('income', { sourceName: 'Test', incomeType: 'Other income', originalAmount: 10, tags: 'bonus' })
    db = store.readFinanceStore()
    expect(db.income_records[0].tags).toBe('bonus')
  })
})

describe('reconciliationStatus (PF-113 Pending/Cleared/Reconciled Status)', () => {
  let tmp: string
  let realHome: string | undefined
  beforeEach(() => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'finance-store-status-'))
    realHome = process.env.HOME
    process.env.HOME = tmp
    vi.resetModules()
  })
  afterEach(() => {
    if (realHome === undefined) delete process.env.HOME
    else process.env.HOME = realHome
    fs.rmSync(tmp, { recursive: true, force: true })
  })

  it('defaults to cleared when status is missing or invalid, for both expense and income', async () => {
    const store = await import('./finance-store')
    store.addFinanceRecord('expense', { vendor: 'Test', category: 'Other', amount: 10 })
    store.addFinanceRecord('income', { sourceName: 'Test', incomeType: 'Other income', originalAmount: 10, status: 'bogus' })
    const db = store.readFinanceStore()
    expect(db.expense_records[0].status).toBe('cleared')
    expect(db.income_records[0].status).toBe('cleared')
  })

  it('accepts all three valid status values on create, for both expense and income', async () => {
    const store = await import('./finance-store')
    store.addFinanceRecord('expense', { vendor: 'Test', category: 'Other', amount: 10, status: 'pending' })
    store.addFinanceRecord('income', { sourceName: 'Test', incomeType: 'Other income', originalAmount: 10, status: 'reconciled' })
    const db = store.readFinanceStore()
    expect(db.expense_records[0].status).toBe('pending')
    expect(db.income_records[0].status).toBe('reconciled')
  })

  it('round-trips status on expense and income records through update', async () => {
    const store = await import('./finance-store')
    store.addFinanceRecord('expense', { vendor: 'Test', category: 'Other', amount: 10, status: 'pending' })
    let db = store.readFinanceStore()
    const expenseId = db.expense_records[0].id
    store.updateFinanceRecord('expense', expenseId, { vendor: 'Test Updated' })
    db = store.readFinanceStore()
    // Untouched status survives the shallow-merge update, same as tags/subcategory.
    expect(db.expense_records[0].status).toBe('pending')

    store.addFinanceRecord('income', { sourceName: 'Test', incomeType: 'Other income', originalAmount: 10, status: 'reconciled' })
    db = store.readFinanceStore()
    const incomeId = db.income_records[0].id
    store.updateFinanceRecord('income', incomeId, { sourceName: 'Test Updated' })
    db = store.readFinanceStore()
    expect(db.income_records[0].status).toBe('reconciled')
  })
})

describe('getUnifiedTransactions (PF-104 Unified Transaction Model)', () => {
  it('maps income and expense records into the shared shape with renamed fields', () => {
    const db = createEmptyFinanceDatabase()
    db.income_records.push({
      id: 'income-1',
      dateReceived: '2026-06-01',
      sourceName: 'Employer Co',
      incomeType: 'Salary',
      originalCurrency: 'LKR',
      originalAmount: 100_000,
      exchangeRateUsed: 1,
      convertedLkrAmount: 100_000,
      taxable: true,
      incomeSourceId: 'job-1',
      tags: 'salary, primary',
      status: 'reconciled',
      source: 'test',
      createdAt: '2026-06-01T00:00:00.000Z',
      updatedAt: '2026-06-01T00:00:00.000Z',
    })
    db.expense_records.push({
      id: 'expense-1',
      date: '2026-06-02',
      vendor: 'Cloud Provider',
      category: 'Cloud services',
      subcategory: 'Hosting',
      currency: 'USD',
      amount: 10,
      convertedLkrAmount: 3_000,
      recurring: true,
      workRelated: true,
      taxDeductiblePossible: true,
      tags: 'work',
      status: 'pending',
      source: 'test',
      createdAt: '2026-06-02T00:00:00.000Z',
      updatedAt: '2026-06-02T00:00:00.000Z',
    })

    const txns = getUnifiedTransactions(db)
    expect(txns).toHaveLength(2)

    const income = txns.find((t) => t.kind === 'income')
    expect(income).toMatchObject({
      id: 'income-1',
      date: '2026-06-01',
      counterparty: 'Employer Co',
      category: 'Salary',
      currency: 'LKR',
      amount: 100_000,
      taxable: true,
      incomeSourceId: 'job-1',
      tags: 'salary, primary',
      status: 'reconciled',
    })
    expect(income?.recurring).toBeUndefined()

    const expense = txns.find((t) => t.kind === 'expense')
    expect(expense).toMatchObject({
      id: 'expense-1',
      date: '2026-06-02',
      counterparty: 'Cloud Provider',
      category: 'Cloud services',
      subcategory: 'Hosting',
      currency: 'USD',
      amount: 10,
      recurring: true,
      tags: 'work',
      status: 'pending',
    })
    expect(expense?.taxable).toBeUndefined()
  })

  it('sorts mixed-kind results by date descending', () => {
    const db = createEmptyFinanceDatabase()
    db.income_records.push({
      id: 'older',
      dateReceived: '2026-01-01',
      sourceName: 'A',
      incomeType: 'Salary',
      originalCurrency: 'LKR',
      originalAmount: 1,
      exchangeRateUsed: 1,
      convertedLkrAmount: 1,
      taxable: true,
      source: 'test',
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
    })
    db.expense_records.push({
      id: 'newer',
      date: '2026-06-01',
      vendor: 'B',
      category: 'X',
      currency: 'LKR',
      amount: 1,
      convertedLkrAmount: 1,
      recurring: false,
      workRelated: false,
      taxDeductiblePossible: false,
      source: 'test',
      createdAt: '2026-06-01T00:00:00.000Z',
      updatedAt: '2026-06-01T00:00:00.000Z',
    })

    const txns = getUnifiedTransactions(db)
    expect(txns.map((t) => t.id)).toEqual(['newer', 'older'])
  })

  it('does not mutate the underlying income_records/expense_records collections', () => {
    const db = createEmptyFinanceDatabase()
    db.income_records.push({
      id: 'income-1',
      dateReceived: '2026-06-01',
      sourceName: 'Employer Co',
      incomeType: 'Salary',
      originalCurrency: 'LKR',
      originalAmount: 100_000,
      exchangeRateUsed: 1,
      convertedLkrAmount: 100_000,
      taxable: true,
      source: 'test',
      createdAt: '2026-06-01T00:00:00.000Z',
      updatedAt: '2026-06-01T00:00:00.000Z',
    })
    const before = JSON.stringify(db.income_records)
    getUnifiedTransactions(db)
    expect(JSON.stringify(db.income_records)).toBe(before)
  })
})

describe('getAverageMonthlyExpensesLkr (PF-303 Emergency Fund Target)', () => {
  function monthsAgoDateString(monthsAgo: number): string {
    const d = new Date()
    d.setUTCDate(1) // avoid month-length rollover surprises
    d.setUTCMonth(d.getUTCMonth() - monthsAgo)
    return d.toISOString().slice(0, 10)
  }

  function pushExpense(db: ReturnType<typeof createEmptyFinanceDatabase>, monthsAgo: number, amount: number) {
    db.expense_records.push({
      id: `e-${monthsAgo}-${amount}`, date: monthsAgoDateString(monthsAgo), vendor: 'Test', category: 'Other',
      currency: 'LKR', amount, convertedLkrAmount: amount, recurring: false, workRelated: false,
      taxDeductiblePossible: false, source: 'test', createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z',
    })
  }

  it('returns 0 when there is no complete month of expense history', () => {
    const db = createEmptyFinanceDatabase()
    expect(getAverageMonthlyExpensesLkr(db)).toBe(0)
  })

  it('ignores the current in-progress month and averages the trailing complete months', () => {
    const db = createEmptyFinanceDatabase()
    pushExpense(db, 0, 999_999) // current month — must be excluded
    pushExpense(db, 1, 30_000)
    pushExpense(db, 2, 60_000)
    pushExpense(db, 3, 30_000)
    expect(getAverageMonthlyExpensesLkr(db, 3)).toBe(40_000)
  })

  it('averages only what history exists when fewer than the requested months are available', () => {
    const db = createEmptyFinanceDatabase()
    pushExpense(db, 1, 50_000)
    expect(getAverageMonthlyExpensesLkr(db, 3)).toBe(50_000)
  })
})

describe('financeSummary net worth with stock holdings and fixed deposits', () => {
  it('includes stock holdings at current price and active fixed deposit principal', () => {
    const db = createEmptyFinanceDatabase()
    db.stock_holdings.push({
      id: 's1', symbol: 'JKH.N0000', platform: 'Test', quantity: 10, buyPrice: 100, buyDate: '2026-01-01',
      currency: 'LKR', lastKnownPrice: 120, priceSource: 'cse_api', source: 'test',
      createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z',
    })
    db.fixed_deposits.push({
      id: 'f1', bankName: 'Test Bank', principal: 50_000, currency: 'LKR', interestRatePct: 10,
      interestPayout: 'at_maturity', startDate: '2026-01-01', maturityDate: '2027-01-01', status: 'active',
      source: 'test', createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z',
    })
    db.fixed_deposits.push({
      id: 'f2', bankName: 'Withdrawn Bank', principal: 999_999, currency: 'LKR', interestRatePct: 10,
      interestPayout: 'at_maturity', startDate: '2026-01-01', maturityDate: '2027-01-01', status: 'withdrawn',
      source: 'test', createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z',
    })

    const summary = financeSummary(db)
    expect(summary.stockHoldingsValueLkr).toBe(1200) // 10 * 120 (current price, not buy price)
    expect(summary.fixedDepositsValueLkr).toBe(50_000) // withdrawn FD excluded
    expect(summary.netWorthLkr).toBe(1200 + 50_000)
  })

  it('falls back to buy price when a stock holding has no cached current price yet', () => {
    const db = createEmptyFinanceDatabase()
    db.stock_holdings.push({
      id: 's1', symbol: 'JKH.N0000', platform: 'Test', quantity: 5, buyPrice: 200, buyDate: '2026-01-01',
      currency: 'LKR', priceSource: 'manual', source: 'test',
      createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z',
    })
    const summary = financeSummary(db)
    expect(summary.stockHoldingsValueLkr).toBe(1000) // 5 * 200 (buy price fallback)
  })

  it('computes unrealizedStockPnlLkr as (current - buy) * quantity, summed across holdings', () => {
    const db = createEmptyFinanceDatabase()
    db.stock_holdings.push({
      id: 's1', symbol: 'JKH.N0000', platform: 'Test', quantity: 10, buyPrice: 100, buyDate: '2026-01-01',
      currency: 'LKR', lastKnownPrice: 120, priceSource: 'cse_api', source: 'test',
      createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z',
    })
    db.stock_holdings.push({
      id: 's2', symbol: 'COMB.N0000', platform: 'Test', quantity: 5, buyPrice: 300, buyDate: '2026-01-01',
      currency: 'LKR', lastKnownPrice: 250, priceSource: 'cse_api', source: 'test',
      createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z',
    })
    const summary = financeSummary(db)
    // (120-100)*10 + (250-300)*5 = 200 - 250 = -50
    expect(summary.unrealizedStockPnlLkr).toBe(-50)
    // cost basis = 10*100 + 5*300 = 2500; pct = -50/2500*100 = -2
    expect(summary.unrealizedStockPnlPct).toBe(-2)
  })

  it('unrealizedStockPnlLkr is 0 when there is no cached current price (falls back to buy price)', () => {
    const db = createEmptyFinanceDatabase()
    db.stock_holdings.push({
      id: 's1', symbol: 'JKH.N0000', platform: 'Test', quantity: 5, buyPrice: 200, buyDate: '2026-01-01',
      currency: 'LKR', priceSource: 'manual', source: 'test',
      createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z',
    })
    const summary = financeSummary(db)
    expect(summary.unrealizedStockPnlLkr).toBe(0)
    expect(summary.unrealizedStockPnlPct).toBe(0)
  })

  it('unrealizedStockPnlPct is 0 when there are no stock holdings (division-by-zero guard)', () => {
    const db = createEmptyFinanceDatabase()
    const summary = financeSummary(db)
    expect(summary.unrealizedStockPnlPct).toBe(0)
  })
})
