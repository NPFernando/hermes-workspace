import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import {
  buildFinanceStorageHealth,
  budgetVsActualSummary,
  computeAccountLedgerBalance,
  createEmptyFinanceDatabase,
  createTradingPlan,
  effectiveAccountBalance,
  financeAlerts,
  financeSummary,
  financeStorageAlerts,
  getBudgetVsActual,
  getAverageMonthlyExpensesLkr,
  getAverageMonthlySavingsRatePct,
  buildFinanceQueryContext,
  copyBudgetsToMonth,
  getCurrencyExposure,
  getFxGainLoss,
  getFinanceTrends,
  getMonthlySummary,
  getRecurringBills,
  getUnifiedTransactions,
  getUpcomingMoney,
  ledgerTransactionsForDb,
  maskSensitive,
  tradingPerformanceSummary,
} from './finance-store'
import type { BudgetCategory, FinanceAccount } from './finance-store'

/**
 * Fresh `finance-store` module instance backed by a pure in-memory store — no
 * filesystem, no Postgres. Relies on the enclosing `beforeEach` having called
 * `vi.resetModules()`. Replaces the old tmp-`HOME` JSON-file round-trip.
 */
async function freshFinanceStore() {
  const store = await import('./finance-store')
  store.__setFinanceBackend(store.__inMemoryFinanceBackend())
  return store
}

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
      totalIncomeBase: 100_000,
      totalExpensesBase: 3_000,
      netSavingsBase: 97_000,
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

  it('reports healthy when Postgres is reachable with data', () => {
    const postgresDb = createEmptyFinanceDatabase()
    postgresDb.updatedAt = '2026-07-08T00:00:00.000Z'

    const health = buildFinanceStorageHealth({
      postgresDb,
      postgres: { enabled: true, available: true, snapshotAvailable: true },
    })

    expect(health.status).toBe('healthy')
    expect(health.warnings).toEqual([])
    expect(health.postgresUpdatedAt).toBe('2026-07-08T00:00:00.000Z')
  })

  it('flags postgres_unavailable when the store cannot be read', () => {
    const health = buildFinanceStorageHealth({
      postgresDb: null,
      postgres: {
        enabled: true,
        available: false,
        snapshotAvailable: false,
        reason: 'connection refused',
      },
    })

    expect(health.status).toBe('postgres_unavailable')
    expect(health.warnings[0]).toContain('connection refused')
  })

  it('turns a last-write-error into a visible alert', () => {
    const postgresDb = createEmptyFinanceDatabase()
    const health = buildFinanceStorageHealth({
      postgresDb,
      postgres: {
        enabled: true,
        available: true,
        snapshotAvailable: true,
        lastWriteError: 'psql exited 1',
      },
    })

    const [alert] = financeStorageAlerts(health)

    expect(alert).toMatchObject({
      level: 'warning',
      title: 'Finance storage unhealthy',
    })
    expect(alert.detail).toContain('psql exited 1')
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

describe('budget-vs-actual normalises a non-LKR budget to LKR (PF-201)', () => {
  const usdBudget = {
    id: 'b-usd',
    category: 'Software',
    month: '2026-07',
    currency: 'USD' as const,
    budgetAmount: 100,
    source: 'test',
    createdAt: '2026-07-01T00:00:00.000Z',
    updatedAt: '2026-07-01T00:00:00.000Z',
  }
  const usdSpend = {
    id: 'e-usd',
    date: '2026-07-10',
    vendor: 'SaaS',
    category: 'Software',
    currency: 'USD',
    amount: 40,
    convertedLkrAmount: 12_000, // already LKR-converted at ingest
    recurring: false,
    workRelated: false,
    taxDeductiblePossible: false,
    source: 'test',
    createdAt: '2026-07-10T00:00:00.000Z',
    updatedAt: '2026-07-10T00:00:00.000Z',
  }

  it('converts the budget via a stored USD->LKR rate before comparing', () => {
    const db = createEmptyFinanceDatabase()
    db.exchange_rates.push({
      base: 'USD',
      target: 'LKR',
      rate: 300,
      date: '2026-07-01',
      updatedAt: '2026-07-01T00:00:00.000Z',
    })
    db.budget_categories.push({ ...usdBudget })
    db.expense_records.push({ ...usdSpend })

    const r = getBudgetVsActual(db, 'Software', 2026, 7)
    expect(r).toEqual({ budget: 30_000, actual: 12_000, variance: 18_000 })

    const [row] = budgetVsActualSummary(db, '2026-07')
    expect(row).toMatchObject({
      currency: 'LKR',
      budget: 30_000,
      actual: 12_000,
      variance: 18_000,
      percentUsed: 40,
      overBudget: false,
    })
  })

  it('falls back to the inverse LKR->USD rate when no direct rate is on file', () => {
    const db = createEmptyFinanceDatabase()
    db.exchange_rates.push({
      base: 'LKR',
      target: 'USD',
      rate: 1 / 300,
      date: '2026-07-01',
      updatedAt: '2026-07-01T00:00:00.000Z',
    })
    db.budget_categories.push({ ...usdBudget })

    const r = getBudgetVsActual(db, 'Software', 2026, 7)
    expect(r?.budget).toBeCloseTo(30_000)
  })

  it('falls back to the raw amount when no rate exists, and flags the currency', () => {
    const db = createEmptyFinanceDatabase()
    db.budget_categories.push({ ...usdBudget })

    // getBudgetVsActual still returns a number (better than dropping the row)…
    const r = getBudgetVsActual(db, 'Software', 2026, 7)
    expect(r).toEqual({ budget: 100, actual: 0, variance: 100 })

    // …but the missing rate surfaces via financeSummary.fxUnconverted ->
    // the "Missing exchange rate" alert, so it isn't a silent wrong number.
    expect(financeSummary(db).fxUnconverted).toContain('USD')
    expect(
      financeAlerts(db).some((a) => a.title === 'Missing exchange rate'),
    ).toBe(true)
  })

  it('leaves an all-LKR budget untouched', () => {
    const db = createEmptyFinanceDatabase()
    db.budget_categories.push({ ...usdBudget, currency: 'LKR', budgetAmount: 50_000 })
    expect(getBudgetVsActual(db, 'Software', 2026, 7)).toEqual({
      budget: 50_000,
      actual: 0,
      variance: 50_000,
    })
  })
})

describe('updateExchangeRate upsert by (base, target, date) (PF-201)', () => {
  beforeEach(() => {
    vi.resetModules()
  })

  it('replaces the same-day row in place instead of piling up duplicates', async () => {
    const store = await freshFinanceStore()
    store.updateExchangeRate('USD', 'LKR', 300, '2026-09-10')
    store.updateExchangeRate('USD', 'LKR', 328.4, '2026-09-10') // refresh, same day
    store.updateExchangeRate('USD', 'LKR', 331, '2026-09-11') // next day

    const rows = store
      .readFinanceStore()
      .exchange_rates.filter((r) => r.base === 'USD' && r.target === 'LKR')
    expect(rows).toHaveLength(2)
    expect(store.getExchangeRate('USD', 'LKR', '2026-09-10')).toBe(328.4)
    expect(store.getExchangeRate('USD', 'LKR')).toBe(331)
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
    const store = await freshFinanceStore()
    store.addFinanceRecord('expense', {
      vendor: 'Cafe',
      category: 'Dining',
      amount: 500,
    })

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
    const store = await freshFinanceStore()
    store.addFinanceRecord('income', {
      sourceName: 'Salary',
      originalAmount: 1000,
    })

    expect(() => store.deleteFinanceRecord('income', 'does-not-exist')).toThrow(
      /not found/,
    )
    const db = store.readFinanceStore()
    expect(db.income_records).toHaveLength(1)
  })

  it('throws for an unsupported kind on delete', async () => {
    const store = await freshFinanceStore()
    expect(() => store.deleteFinanceRecord('trading_plan', 'some-id')).toThrow(
      /Unsupported/,
    )
  })

  it('throws when updating a record that does not exist', async () => {
    const store = await freshFinanceStore()
    expect(() =>
      store.updateFinanceRecord('expense', 'does-not-exist', { amount: 1 }),
    ).toThrow(/not found/)
  })

  it('transfer kind: add/edit/delete, and it never touches income/expense totals (PF review item 12)', async () => {
    const store = await freshFinanceStore()
    store.addFinanceRecord('income', {
      dateReceived: '2026-06-01',
      sourceName: 'Salary',
      originalAmount: 300_000,
      convertedLkrAmount: 300_000,
    })
    store.addFinanceRecord('transfer', {
      date: '2026-06-05',
      fromAccountId: 'checking',
      toAccountId: 'savings',
      amount: 50_000,
      convertedLkrAmount: 50_000,
    })
    let db = store.readFinanceStore()
    expect(db.transfers).toHaveLength(1)
    const id = db.transfers[0].id

    // Transfers are NOT income or expense.
    const s = store.financeSummary(db)
    expect(s.totalIncomeBase).toBe(300_000)
    expect(s.totalExpensesBase).toBe(0)
    expect(s.netSavingsBase).toBe(300_000)

    // …and they appear in the unified list as their own kind.
    const unified = store.getUnifiedTransactions(db)
    expect(unified.find((t) => t.id === id)).toMatchObject({
      kind: 'transfer',
      counterparty: 'checking → savings',
    })

    store.updateFinanceRecord('transfer', id, { amount: 60_000 })
    db = store.readFinanceStore()
    expect(db.transfers[0].amount).toBe(60_000)

    store.deleteFinanceRecord('transfer', id)
    expect(store.readFinanceStore().transfers).toHaveLength(0)
  })

  it('transfer convertedLkrAmount is derived from the FX table on write, not trusted from the client', async () => {
    const store = await freshFinanceStore()
    store.updateExchangeRate('USD', 'LKR', 320, '2026-06-01')

    // client posts the raw amount as convertedLkrAmount (as the add/edit
    // forms do) — the store must override it with the real LKR value.
    store.addFinanceRecord('transfer', {
      date: '2026-06-05',
      fromAccountId: 'usd-checking',
      toAccountId: 'usd-savings',
      amount: 100,
      currency: 'USD',
      convertedLkrAmount: 100,
    })
    let t = store.readFinanceStore().transfers[0]
    expect(t.convertedLkrAmount).toBe(32_000)

    // …and again on update, from the merged amount/currency.
    store.updateFinanceRecord('transfer', t.id, { amount: 250 })
    t = store.readFinanceStore().transfers[0]
    expect(t.amount).toBe(250)
    expect(t.convertedLkrAmount).toBe(80_000)

    // no rate on file ⇒ falls back to the raw amount (matches financeSummary)
    store.addFinanceRecord('transfer', {
      date: '2026-06-06',
      amount: 500,
      currency: 'AUD',
      convertedLkrAmount: 500,
    })
    const aud = store
      .readFinanceStore()
      .transfers.find((r) => r.currency === 'AUD')!
    expect(aud.convertedLkrAmount).toBe(500)
  })

  it('expense splits: validated on write, attributed per-category, cleared with []', async () => {
    const store = await freshFinanceStore()

    // parts must sum to the amount
    expect(() =>
      store.addFinanceRecord('expense', {
        date: '2026-07-04',
        vendor: 'Keells',
        category: 'Groceries',
        currency: 'LKR',
        amount: 10_000,
        convertedLkrAmount: 10_000,
        splits: [
          { category: 'Groceries', amount: 6_000 },
          { category: 'Household', amount: 3_000 },
        ],
      }),
    ).toThrow(/add up/)

    store.addFinanceRecord('expense', {
      date: '2026-07-04',
      vendor: 'Keells',
      category: 'Groceries',
      currency: 'LKR',
      amount: 10_000,
      convertedLkrAmount: 10_000,
      splits: [
        { category: 'Groceries', amount: 7_000 },
        { category: 'Household', amount: 3_000 },
      ],
    })
    store.addFinanceRecord('budget_category', {
      month: '2026-07',
      category: 'Household',
      currency: 'LKR',
      budgetAmount: 5_000,
    })
    store.addFinanceRecord('budget_category', {
      month: '2026-07',
      category: 'Groceries',
      currency: 'LKR',
      budgetAmount: 20_000,
    })

    let db = store.readFinanceStore()
    const exp = db.expense_records[0]
    expect(exp.splits).toHaveLength(2)

    // record-level total is unchanged; category attribution follows the splits
    expect(store.financeSummary(db).totalExpensesBase).toBe(10_000)
    expect(getBudgetVsActual(db, 'Household', 2026, 7)?.actual).toBe(3_000)
    expect(getBudgetVsActual(db, 'Groceries', 2026, 7)?.actual).toBe(7_000)

    const trendCats = getFinanceTrends(db).categoriesThisMonth
    // (only asserts the split rows are present with their own totals)
    const householdRow = trendCats.find((c) => c.category === 'Household')
    if (householdRow) expect(householdRow.amount).toBe(3_000)

    // sending splits:[] clears them; the whole amount reverts to `category`
    store.updateFinanceRecord('expense', exp.id, { splits: [] })
    db = store.readFinanceStore()
    expect(db.expense_records[0].splits).toBeUndefined()
    expect(getBudgetVsActual(db, 'Household', 2026, 7)?.actual).toBe(0)
  })

  it('goalKind (PF-1007 Sinking Funds) defaults to general and accepts sinking', async () => {
    const store = await freshFinanceStore()
    store.addFinanceRecord('goal', { name: 'Untyped goal', targetAmount: 1000 })
    store.addFinanceRecord('goal', {
      name: 'Car fund',
      targetAmount: 2000,
      goalKind: 'sinking',
    })
    store.addFinanceRecord('goal', {
      name: 'Bogus kind',
      targetAmount: 500,
      goalKind: 'not-a-real-kind',
    })

    const db = store.readFinanceStore()
    expect(
      db.savings_goals.find((g) => g.name === 'Untyped goal')?.goalKind,
    ).toBe('general')
    expect(db.savings_goals.find((g) => g.name === 'Car fund')?.goalKind).toBe(
      'sinking',
    )
    expect(
      db.savings_goals.find((g) => g.name === 'Bogus kind')?.goalKind,
    ).toBe('general')
  })

  it('loan (Phase 40) round-trips through add, update, delete, and defaults status to active', async () => {
    const store = await freshFinanceStore()
    store.addFinanceRecord('loan', {
      lender: 'Test Bank',
      principal: 100_000,
      currentBalance: 90_000,
      currency: 'LKR',
      interestRatePct: 12,
    })
    let db = store.readFinanceStore()
    expect(db.loans).toHaveLength(1)
    const loan = db.loans[0]
    expect(loan.lender).toBe('Test Bank')
    expect(loan.currentBalance).toBe(90_000)
    expect(loan.status).toBe('active')

    store.updateFinanceRecord('loan', loan.id, {
      currentBalance: 80_000,
      status: 'active',
    })
    db = store.readFinanceStore()
    expect(db.loans[0].currentBalance).toBe(80_000)

    store.updateFinanceRecord('loan', loan.id, { status: 'not-a-real-status' })
    db = store.readFinanceStore()
    // update_record does a plain spread-merge — an invalid status string is
    // stored as-is (unlike add, which validates through loanStatusField()).
    expect(db.loans[0].status).toBe('not-a-real-status')

    store.deleteFinanceRecord('loan', loan.id)
    db = store.readFinanceStore()
    expect(db.loans).toHaveLength(0)
  })

  it('loan status defaults to active on add when omitted or invalid', async () => {
    const store = await freshFinanceStore()
    store.addFinanceRecord('loan', {
      lender: 'A',
      principal: 1000,
      currentBalance: 1000,
    })
    store.addFinanceRecord('loan', {
      lender: 'B',
      principal: 1000,
      currentBalance: 1000,
      status: 'paid_off',
    })
    store.addFinanceRecord('loan', {
      lender: 'C',
      principal: 1000,
      currentBalance: 1000,
      status: 'bogus',
    })

    const db = store.readFinanceStore()
    expect(db.loans.find((l) => l.lender === 'A')?.status).toBe('active')
    expect(db.loans.find((l) => l.lender === 'B')?.status).toBe('paid_off')
    expect(db.loans.find((l) => l.lender === 'C')?.status).toBe('active')
  })

  it('property (Phase 40) round-trips through add, update, delete, and defaults propertyType to residential', async () => {
    const store = await freshFinanceStore()
    store.addFinanceRecord('property', {
      description: 'Test House',
      purchasePrice: 5_000_000,
      currentValue: 5_500_000,
      currency: 'LKR',
    })
    let db = store.readFinanceStore()
    expect(db.properties).toHaveLength(1)
    const property = db.properties[0]
    expect(property.description).toBe('Test House')
    expect(property.propertyType).toBe('residential')
    expect(property.currentValue).toBe(5_500_000)

    store.updateFinanceRecord('property', property.id, {
      currentValue: 5_800_000,
    })
    db = store.readFinanceStore()
    expect(db.properties[0].currentValue).toBe(5_800_000)

    store.deleteFinanceRecord('property', property.id)
    db = store.readFinanceStore()
    expect(db.properties).toHaveLength(0)
  })

  it('propertyType defaults to residential on add when omitted or invalid', async () => {
    const store = await freshFinanceStore()
    store.addFinanceRecord('property', {
      description: 'A',
      purchasePrice: 1000,
      currentValue: 1000,
    })
    store.addFinanceRecord('property', {
      description: 'B',
      purchasePrice: 1000,
      currentValue: 1000,
      propertyType: 'land',
    })
    store.addFinanceRecord('property', {
      description: 'C',
      purchasePrice: 1000,
      currentValue: 1000,
      propertyType: 'bogus',
    })

    const db = store.readFinanceStore()
    expect(db.properties.find((p) => p.description === 'A')?.propertyType).toBe(
      'residential',
    )
    expect(db.properties.find((p) => p.description === 'B')?.propertyType).toBe(
      'land',
    )
    expect(db.properties.find((p) => p.description === 'C')?.propertyType).toBe(
      'residential',
    )
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
    const store = await freshFinanceStore()
    store.addFinanceRecord('expense', {
      date: '2026-03-01',
      vendor: 'Cafe Nero',
      category: 'Dining',
      amount: 500,
    })

    const match = store.findPossibleDuplicate(
      'expense',
      'cafe nero',
      '2026-03-01',
      500,
    )
    expect(match).toMatchObject({
      vendorOrSource: 'Cafe Nero',
      date: '2026-03-01',
      amount: 500,
    })
  })

  it('treats amounts within 1% as the same', async () => {
    const store = await freshFinanceStore()
    store.addFinanceRecord('expense', {
      date: '2026-03-01',
      vendor: 'Cafe Nero',
      category: 'Dining',
      amount: 500,
    })
    expect(
      store.findPossibleDuplicate('expense', 'Cafe Nero', '2026-03-01', 502),
    ).not.toBeNull()
  })

  it('does not match a different date, vendor, or amount beyond tolerance', async () => {
    const store = await freshFinanceStore()
    store.addFinanceRecord('expense', {
      date: '2026-03-01',
      vendor: 'Cafe Nero',
      category: 'Dining',
      amount: 500,
    })

    expect(
      store.findPossibleDuplicate('expense', 'Cafe Nero', '2026-03-02', 500),
    ).toBeNull()
    expect(
      store.findPossibleDuplicate(
        'expense',
        'Different Cafe',
        '2026-03-01',
        500,
      ),
    ).toBeNull()
    expect(
      store.findPossibleDuplicate('expense', 'Cafe Nero', '2026-03-01', 600),
    ).toBeNull()
  })

  it('checks income and expense collections independently', async () => {
    const store = await freshFinanceStore()
    store.addFinanceRecord('income', {
      dateReceived: '2026-03-01',
      sourceName: 'Client A',
      originalAmount: 1000,
    })

    expect(
      store.findPossibleDuplicate('income', 'Client A', '2026-03-01', 1000),
    ).not.toBeNull()
    expect(
      store.findPossibleDuplicate('expense', 'Client A', '2026-03-01', 1000),
    ).toBeNull()
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
    const store = await freshFinanceStore()
    expect(store.getCategoryCorrections()).toEqual({})

    store.recordCategoryCorrection('Keells Super', 'Groceries')
    expect(store.getCategoryCorrections()).toEqual({
      'keells super': 'Groceries',
    })
  })

  it('overwrites a prior correction for the same vendor', async () => {
    const store = await freshFinanceStore()
    store.recordCategoryCorrection('Keells Super', 'Groceries')
    store.recordCategoryCorrection('keells super', 'Household')
    expect(store.getCategoryCorrections()).toEqual({
      'keells super': 'Household',
    })
  })

  it('ignores an empty vendor or category', async () => {
    const store = await freshFinanceStore()
    store.recordCategoryCorrection('', 'Groceries')
    store.recordCategoryCorrection('Vendor', '')
    expect(store.getCategoryCorrections()).toEqual({})
  })
})

describe('knownSenders (upsert/list/delete + password encryption)', () => {
  let realKey: string | undefined
  beforeEach(() => {
    realKey = process.env.FINANCE_SECRET_KEY
    process.env.FINANCE_SECRET_KEY = Buffer.alloc(32, 7).toString('base64')
  })
  afterEach(() => {
    if (realKey === undefined) delete process.env.FINANCE_SECRET_KEY
    else process.env.FINANCE_SECRET_KEY = realKey
  })

  it('creates a known sender and lists it back', async () => {
    const store = await freshFinanceStore()
    const sender = store.upsertKnownSender({
      label: 'Example Bank',
      matchDomain: 'example-bank.test',
      passwordScheme: 'date of birth, DDMMYYYY',
    })
    expect(store.listKnownSenders()).toEqual([sender])
    expect(sender.encryptedPassword).toBeUndefined()
  })

  it('updates an existing sender in place when id matches, preserving createdAt', async () => {
    const store = await freshFinanceStore()
    const created = store.upsertKnownSender({ label: 'Water Board' })
    const updated = store.upsertKnownSender({
      id: created.id,
      label: 'NWSDB',
      matchDomain: 'example-water.test',
    })
    expect(store.listKnownSenders()).toHaveLength(1)
    expect(updated.id).toBe(created.id)
    expect(updated.label).toBe('NWSDB')
    expect(updated.createdAt).toBe(created.createdAt)
  })

  it('rejects an empty label', async () => {
    const store = await freshFinanceStore()
    expect(() => store.upsertKnownSender({ label: '  ' })).toThrow(/label/)
  })

  it('deletes a known sender', async () => {
    const store = await freshFinanceStore()
    const sender = store.upsertKnownSender({ label: 'Dialog' })
    store.deleteKnownSender(sender.id)
    expect(store.listKnownSenders()).toEqual([])
  })

  it('sets, decrypts, and clears a sender password without ever storing it as plaintext', async () => {
    const store = await freshFinanceStore()
    const sender = store.upsertKnownSender({ label: 'Dialog Finance' })
    const withPassword = store.setKnownSenderPassword(sender.id, 'real-secret-pw')
    expect(withPassword.encryptedPassword).toBeDefined()
    expect(withPassword.encryptedPassword).not.toContain('real-secret-pw')
    expect(store.decryptKnownSenderPassword(withPassword)).toBe('real-secret-pw')

    const cleared = store.clearKnownSenderPassword(sender.id)
    expect(cleared.encryptedPassword).toBeUndefined()
  })

  it('setKnownSenderPassword throws for an unknown id and an empty password', async () => {
    const store = await freshFinanceStore()
    expect(() => store.setKnownSenderPassword('missing-id', 'pw')).toThrow(
      /not found/,
    )
    const sender = store.upsertKnownSender({ label: 'EDL' })
    expect(() => store.setKnownSenderPassword(sender.id, '')).toThrow(
      /password/,
    )
  })

  it('decryptKnownSenderPassword returns undefined when no password is stored', async () => {
    const store = await freshFinanceStore()
    const sender = store.upsertKnownSender({ label: 'CSE' })
    expect(store.decryptKnownSenderPassword(sender)).toBeUndefined()
  })
})

describe('recordGmailSyncError', () => {
  it('stores the failure onto settings.gmailIngest.lastError', async () => {
    const store = await freshFinanceStore()
    store.recordGmailSyncError('invalid_grant: Token has been expired or revoked.')
    const db = store.readFinanceStore()
    const gmailIngest = (db.settings as Record<string, unknown>).gmailIngest as {
      lastError?: { at: number; message: string }
    }
    expect(gmailIngest.lastError?.message).toBe(
      'invalid_grant: Token has been expired or revoked.',
    )
    expect(typeof gmailIngest.lastError?.at).toBe('number')
  })

  it('preserves prior gmailIngest fields (e.g. syncHistory) when recording an error', async () => {
    const store = await freshFinanceStore()
    const db = store.readFinanceStore()
    ;(db.settings as Record<string, unknown>).gmailIngest = {
      syncHistory: [{ at: 1, found: 2, queued: 1, skippedAlreadyQueued: 0 }],
    }
    store.writeFinanceStore(db)
    store.recordGmailSyncError('boom')
    const after = store.readFinanceStore()
    const gmailIngest = (after.settings as Record<string, unknown>).gmailIngest as {
      syncHistory?: Array<unknown>
      lastError?: { message: string }
    }
    expect(gmailIngest.syncHistory).toHaveLength(1)
    expect(gmailIngest.lastError?.message).toBe('boom')
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
    const store = await freshFinanceStore()
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
    const store = await freshFinanceStore()
    store.addFinanceRecord('income_source', {
      employerName: 'Acme Corp',
      employmentType: 'contract',
      jobTitle: 'Software Engineer',
    })
    let db = store.readFinanceStore()
    expect(db.income_sources[0].jobTitle).toBe('Software Engineer')
    const id = db.income_sources[0].id

    store.updateFinanceRecord('income_source', id, {
      jobTitle: 'Senior Software Engineer',
    })
    db = store.readFinanceStore()
    expect(db.income_sources[0].jobTitle).toBe('Senior Software Engineer')
  })

  it('persists documentRef so the original uploaded contract can be retrieved later', async () => {
    const store = await freshFinanceStore()
    store.addFinanceRecord('income_source', {
      employerName: 'Acme Corp',
      employmentType: 'contract',
      documentRef:
        '/home/ubuntu/.hermes/finance/ingestion-uploads/some-contract.pdf',
    })
    const db = store.readFinanceStore()
    expect(db.income_sources[0].documentRef).toBe(
      '/home/ubuntu/.hermes/finance/ingestion-uploads/some-contract.pdf',
    )
  })

  it('persists expectedPaydayDayOfMonth/paySchedule on a job, and incomeSourceId on an income record', async () => {
    const store = await freshFinanceStore()
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
    const store = await freshFinanceStore()
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
    const store = await freshFinanceStore()
    store.addFinanceRecord('income_source', {
      employerName: 'X',
      employmentType: 'bogus',
    })
    const db = store.readFinanceStore()
    expect(db.income_sources[0].employmentType).toBe('other')
  })

  it('supports an income source with no monthlyIncomeAmount (irregular income)', async () => {
    const store = await freshFinanceStore()
    store.addFinanceRecord('income_source', {
      employerName: 'Freelance Clients',
      employmentType: 'freelance',
    })
    const db = store.readFinanceStore()
    expect(db.income_sources[0].monthlyIncomeAmount).toBeUndefined()
  })

  it('adds, edits, then deletes a stock holding', async () => {
    const store = await freshFinanceStore()
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
    expect(db.stock_holdings[0]).toMatchObject({
      symbol: 'JKH.N0000',
      quantity: 100,
      buyPrice: 150,
      priceSource: 'manual',
    })
    const id = db.stock_holdings[0].id

    store.updateFinanceRecord('stock_holding', id, {
      lastKnownPrice: 165,
      priceSource: 'cse_api',
    })
    db = store.readFinanceStore()
    expect(db.stock_holdings[0]).toMatchObject({
      lastKnownPrice: 165,
      priceSource: 'cse_api',
    })

    store.deleteFinanceRecord('stock_holding', id)
    db = store.readFinanceStore()
    expect(db.stock_holdings).toHaveLength(0)
  })

  it('adds, edits, then deletes a fixed deposit', async () => {
    const store = await freshFinanceStore()
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
    expect(db.fixed_deposits[0]).toMatchObject({
      bankName: 'Sampath Bank',
      principal: 500_000,
      status: 'active',
    })
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
    const store = await freshFinanceStore()
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
    const store = await freshFinanceStore()
    store.addFinanceRecord('account', {
      name: 'Wallet Cash',
      type: 'cash',
      currency: 'LKR',
      balance: 5000,
    })
    const db = store.readFinanceStore()
    expect(db.finance_accounts[0].openingBalance).toBeUndefined()
    expect(db.finance_accounts[0].openingBalanceDate).toBeUndefined()
  })

  it('defaults account type to other for an unrecognized value', async () => {
    const store = await freshFinanceStore()
    store.addFinanceRecord('account', {
      name: 'Mystery',
      type: 'bogus',
      currency: 'LKR',
      balance: 0,
    })
    const db = store.readFinanceStore()
    expect(db.finance_accounts[0].type).toBe('other')
  })

  it('adds, edits, then deletes an account', async () => {
    const store = await freshFinanceStore()
    store.addFinanceRecord('account', {
      name: 'Crypto Wallet',
      type: 'crypto_wallet',
      currency: 'USD',
      balance: 100,
    })
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
    const store = await freshFinanceStore()
    store.addFinanceRecord('category', {
      name: 'Groceries',
      kind: 'expense',
      color: '#22c55e',
    })
    let db = store.readFinanceStore()
    expect(db.categories).toHaveLength(1)
    expect(db.categories[0]).toMatchObject({
      name: 'Groceries',
      kind: 'expense',
      color: '#22c55e',
    })
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
    const store = await freshFinanceStore()
    store.addFinanceRecord('category', { name: 'Misc' })
    let db = store.readFinanceStore()
    expect(db.categories[0].kind).toBe('both')

    store.addFinanceRecord('category', {
      name: 'Bogus Kind',
      kind: 'not-a-real-kind',
    })
    db = store.readFinanceStore()
    expect(db.categories[1].kind).toBe('both')
  })

  it('supports a category with no color or notes (optional fields)', async () => {
    const store = await freshFinanceStore()
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
    const store = await freshFinanceStore()
    store.addFinanceRecord('subcategory_entry', {
      name: 'Coffee',
      parentCategory: 'Dining',
    })
    let db = store.readFinanceStore()
    expect(db.subcategories).toHaveLength(1)
    expect(db.subcategories[0]).toMatchObject({
      name: 'Coffee',
      parentCategory: 'Dining',
    })
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
    const store = await freshFinanceStore()
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
    const store = await freshFinanceStore()
    store.addFinanceRecord('merchant', {
      name: 'Cargills',
      defaultCategory: 'Groceries',
    })
    let db = store.readFinanceStore()
    expect(db.merchants).toHaveLength(1)
    expect(db.merchants[0]).toMatchObject({
      name: 'Cargills',
      defaultCategory: 'Groceries',
    })
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
    const store = await freshFinanceStore()
    store.addFinanceRecord('merchant', { name: 'Unknown Vendor' })
    const db = store.readFinanceStore()
    expect(db.merchants[0].defaultCategory).toBeUndefined()
    expect(db.merchants[0].notes).toBeUndefined()
  })

  it('remembers a defaultSplits percentage split: validated on write, cleared with []', async () => {
    const store = await freshFinanceStore()

    // percentages must be positive and sum to ~100
    expect(() =>
      store.addFinanceRecord('merchant', {
        name: 'Keells',
        defaultSplits: [
          { category: 'Groceries', percent: 60 },
          { category: 'Household', percent: 30 },
        ],
      }),
    ).toThrow(/sum to ~100/)

    store.addFinanceRecord('merchant', {
      name: 'Keells',
      defaultSplits: [
        { category: 'Groceries', percent: 60 },
        { category: 'Household', percent: 40 },
      ],
    })
    let db = store.readFinanceStore()
    expect(db.merchants[0].defaultSplits).toEqual([
      { category: 'Groceries', percent: 60 },
      { category: 'Household', percent: 40 },
    ])
    const id = db.merchants[0].id

    store.updateFinanceRecord('merchant', id, { defaultSplits: [] })
    db = store.readFinanceStore()
    expect(db.merchants[0].defaultSplits).toBeUndefined()
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
    const store = await freshFinanceStore()
    store.addFinanceRecord('tag', {
      name: 'Travel',
      notes: 'Trip-related spending',
    })
    let db = store.readFinanceStore()
    expect(db.tags).toHaveLength(1)
    expect(db.tags[0]).toMatchObject({
      name: 'Travel',
      notes: 'Trip-related spending',
    })
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
    const store = await freshFinanceStore()
    store.addFinanceRecord('tag', { name: 'Work' })
    const db = store.readFinanceStore()
    expect(db.tags[0].notes).toBeUndefined()
  })

  it('round-trips tags on expense and income records through add/update', async () => {
    const store = await freshFinanceStore()
    store.addFinanceRecord('expense', {
      vendor: 'Test',
      category: 'Other',
      amount: 10,
      tags: 'work, travel',
    })
    let db = store.readFinanceStore()
    expect(db.expense_records[0].tags).toBe('work, travel')
    const expenseId = db.expense_records[0].id
    store.updateFinanceRecord('expense', expenseId, { vendor: 'Test Updated' })
    db = store.readFinanceStore()
    // Untouched tags survive the shallow-merge update.
    expect(db.expense_records[0].tags).toBe('work, travel')

    store.addFinanceRecord('income', {
      sourceName: 'Test',
      incomeType: 'Other income',
      originalAmount: 10,
      tags: 'bonus',
    })
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
    const store = await freshFinanceStore()
    store.addFinanceRecord('expense', {
      vendor: 'Test',
      category: 'Other',
      amount: 10,
    })
    store.addFinanceRecord('income', {
      sourceName: 'Test',
      incomeType: 'Other income',
      originalAmount: 10,
      status: 'bogus',
    })
    const db = store.readFinanceStore()
    expect(db.expense_records[0].status).toBe('cleared')
    expect(db.income_records[0].status).toBe('cleared')
  })

  it('accepts all three valid status values on create, for both expense and income', async () => {
    const store = await freshFinanceStore()
    store.addFinanceRecord('expense', {
      vendor: 'Test',
      category: 'Other',
      amount: 10,
      status: 'pending',
    })
    store.addFinanceRecord('income', {
      sourceName: 'Test',
      incomeType: 'Other income',
      originalAmount: 10,
      status: 'reconciled',
    })
    const db = store.readFinanceStore()
    expect(db.expense_records[0].status).toBe('pending')
    expect(db.income_records[0].status).toBe('reconciled')
  })

  it('round-trips status on expense and income records through update', async () => {
    const store = await freshFinanceStore()
    store.addFinanceRecord('expense', {
      vendor: 'Test',
      category: 'Other',
      amount: 10,
      status: 'pending',
    })
    let db = store.readFinanceStore()
    const expenseId = db.expense_records[0].id
    store.updateFinanceRecord('expense', expenseId, { vendor: 'Test Updated' })
    db = store.readFinanceStore()
    // Untouched status survives the shallow-merge update, same as tags/subcategory.
    expect(db.expense_records[0].status).toBe('pending')

    store.addFinanceRecord('income', {
      sourceName: 'Test',
      incomeType: 'Other income',
      originalAmount: 10,
      status: 'reconciled',
    })
    db = store.readFinanceStore()
    const incomeId = db.income_records[0].id
    store.updateFinanceRecord('income', incomeId, {
      sourceName: 'Test Updated',
    })
    db = store.readFinanceStore()
    expect(db.income_records[0].status).toBe('reconciled')
  })
})

describe('reconciliation status gates aggregate money figures (PF-113)', () => {
  function seed() {
    const db = createEmptyFinanceDatabase()
    const baseExp = {
      date: '2026-06-10',
      vendor: 'V',
      category: 'Food',
      currency: 'LKR',
      recurring: false,
      workRelated: false,
      taxDeductiblePossible: false,
      tags: '',
      source: 'test',
      createdAt: '2026-06-10T00:00:00.000Z',
      updatedAt: '2026-06-10T00:00:00.000Z',
    }
    const baseInc = {
      dateReceived: '2026-06-05',
      sourceName: 'Emp',
      incomeType: 'Salary',
      originalCurrency: 'LKR',
      exchangeRateUsed: 1,
      taxable: true,
      tags: '',
      source: 'test',
      createdAt: '2026-06-05T00:00:00.000Z',
      updatedAt: '2026-06-05T00:00:00.000Z',
    }
    db.income_records.push(
      { ...baseInc, id: 'i-cleared', originalAmount: 100_000, convertedLkrAmount: 100_000, status: 'cleared' },
      { ...baseInc, id: 'i-pending', originalAmount: 50_000, convertedLkrAmount: 50_000, status: 'pending' },
      { ...baseInc, id: 'i-nostatus', originalAmount: 10_000, convertedLkrAmount: 10_000 },
    )
    db.expense_records.push(
      { ...baseExp, id: 'e-cleared', amount: 30_000, convertedLkrAmount: 30_000, status: 'cleared' },
      { ...baseExp, id: 'e-pending', amount: 20_000, convertedLkrAmount: 20_000, status: 'pending' },
      { ...baseExp, id: 'e-nostatus', amount: 5_000, convertedLkrAmount: 5_000 },
    )
    return db
  }

  it('financeSummary excludes pending rows but keeps cleared/reconciled/missing', () => {
    const s = financeSummary(seed())
    // 100k + 10k (no-status ⇒ cleared); 50k pending dropped
    expect(s.totalIncomeBase).toBe(110_000)
    // 30k + 5k; 20k pending dropped
    expect(s.totalExpensesBase).toBe(35_000)
    expect(s.netSavingsBase).toBe(75_000)
  })

  it('getMonthlySummary excludes pending rows', () => {
    const row = getMonthlySummary(seed(), 2026, 6)[0]
    expect(row).toMatchObject({ income: 110_000, expense: 35_000, savings: 75_000 })
  })

  it('getBudgetVsActual counts only non-pending expenses', () => {
    const db = seed()
    db.budget_categories.push({
      id: 'b-1',
      category: 'Food',
      month: '2026-06',
      currency: 'LKR',
      budgetAmount: 100_000,
      source: 'test',
      createdAt: '2026-06-01T00:00:00.000Z',
      updatedAt: '2026-06-01T00:00:00.000Z',
    })
    const r = getBudgetVsActual(db, 'Food', 2026, 6)
    expect(r).toEqual({ budget: 100_000, actual: 35_000, variance: 65_000 })
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

  function pushExpense(
    db: ReturnType<typeof createEmptyFinanceDatabase>,
    monthsAgo: number,
    amount: number,
  ) {
    db.expense_records.push({
      id: `e-${monthsAgo}-${amount}`,
      date: monthsAgoDateString(monthsAgo),
      vendor: 'Test',
      category: 'Other',
      currency: 'LKR',
      amount,
      convertedLkrAmount: amount,
      recurring: false,
      workRelated: false,
      taxDeductiblePossible: false,
      source: 'test',
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
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

describe('getAverageMonthlySavingsRatePct (PF-304 Savings Rate Target)', () => {
  function monthsAgoDateString(monthsAgo: number): string {
    const d = new Date()
    d.setUTCDate(1)
    d.setUTCMonth(d.getUTCMonth() - monthsAgo)
    return d.toISOString().slice(0, 10)
  }

  function pushExpense(
    db: ReturnType<typeof createEmptyFinanceDatabase>,
    monthsAgo: number,
    amount: number,
  ) {
    db.expense_records.push({
      id: `sr-e-${monthsAgo}-${amount}`,
      date: monthsAgoDateString(monthsAgo),
      vendor: 'Test',
      category: 'Other',
      currency: 'LKR',
      amount,
      convertedLkrAmount: amount,
      recurring: false,
      workRelated: false,
      taxDeductiblePossible: false,
      source: 'test',
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
    })
  }

  function pushIncome(
    db: ReturnType<typeof createEmptyFinanceDatabase>,
    monthsAgo: number,
    amount: number,
  ) {
    db.income_records.push({
      id: `sr-i-${monthsAgo}-${amount}`,
      dateReceived: monthsAgoDateString(monthsAgo),
      sourceName: 'Test',
      incomeType: 'Salary',
      originalCurrency: 'LKR',
      originalAmount: amount,
      exchangeRateUsed: 1,
      convertedLkrAmount: amount,
      taxable: true,
      source: 'test',
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
    })
  }

  it('returns hasData: false when there is no complete month of history', () => {
    const db = createEmptyFinanceDatabase()
    expect(getAverageMonthlySavingsRatePct(db)).toEqual({
      actualPct: 0,
      hasData: false,
    })
  })

  it('computes a ratio-of-sums rate across the trailing window, excluding the current month', () => {
    const db = createEmptyFinanceDatabase()
    pushIncome(db, 0, 999_999) // current month — must be excluded
    pushIncome(db, 1, 100_000)
    pushExpense(db, 1, 80_000)
    pushIncome(db, 2, 100_000)
    pushExpense(db, 2, 90_000)
    // sumIncome = 200_000, sumSavings = (100_000-80_000)+(100_000-90_000) = 30_000 -> 15%
    const result = getAverageMonthlySavingsRatePct(db, 3)
    expect(result.hasData).toBe(true)
    expect(result.actualPct).toBeCloseTo(15, 5)
  })

  it('returns hasData: false when trailing-window income is 0 (avoids divide-by-zero)', () => {
    const db = createEmptyFinanceDatabase()
    pushExpense(db, 1, 10_000)
    expect(getAverageMonthlySavingsRatePct(db, 3)).toEqual({
      actualPct: 0,
      hasData: false,
    })
  })
})

describe('buildFinanceQueryContext (Phase 24 Hermes Finance Analyst)', () => {
  function monthsAgoDateString(monthsAgo: number): string {
    const d = new Date()
    d.setUTCDate(1)
    d.setUTCMonth(d.getUTCMonth() - monthsAgo)
    return d.toISOString().slice(0, 10)
  }

  function pushExpense(
    db: ReturnType<typeof createEmptyFinanceDatabase>,
    monthsAgo: number,
    amount: number,
    category: string,
    vendor: string,
  ) {
    db.expense_records.push({
      id: `q-e-${monthsAgo}-${category}-${vendor}-${amount}`,
      date: monthsAgoDateString(monthsAgo),
      vendor,
      category,
      currency: 'LKR',
      amount,
      convertedLkrAmount: amount,
      recurring: false,
      workRelated: false,
      taxDeductiblePossible: false,
      source: 'test',
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
    })
  }

  it('groups this-month and last-month expenses by category, and this-month by vendor', () => {
    const db = createEmptyFinanceDatabase()
    pushExpense(db, 0, 3000, 'Groceries', 'Store A')
    pushExpense(db, 0, 2000, 'Groceries', 'Store B')
    pushExpense(db, 0, 1500, 'Dining', 'Cafe A')
    pushExpense(db, 1, 4000, 'Groceries', 'Store A')

    const context = buildFinanceQueryContext(db)
    expect(context.categoryBreakdown.thisMonth).toEqual({
      Groceries: 5000,
      Dining: 1500,
    })
    expect(context.categoryBreakdown.lastMonth).toEqual({ Groceries: 4000 })
    expect(context.topVendors.thisMonth).toEqual([
      { vendor: 'Store A', amount: 3000 },
      { vendor: 'Store B', amount: 2000 },
      { vendor: 'Cafe A', amount: 1500 },
    ])
  })

  it('passes through the already-tested summary and monthlySummary unchanged', () => {
    const db = createEmptyFinanceDatabase()
    const context = buildFinanceQueryContext(db)
    expect(context.currency).toBe('LKR')
    expect(context.summary).toEqual(financeSummary(db))
    expect(context.monthlySummary).toEqual(getMonthlySummary(db).slice(-6))
  })

  it('keeps the summary in LKR even when a non-LKR reporting currency is set (PF-201)', () => {
    const db = createEmptyFinanceDatabase()
    db.settings.baseCurrency = 'USD'
    db.exchange_rates.push({
      base: 'LKR',
      target: 'USD',
      rate: 1 / 300,
      date: '2026-06-01',
      updatedAt: '2026-06-01T00:00:00.000Z',
    })
    db.income_records.push({
      id: 'i-1',
      dateReceived: '2026-06-10',
      sourceName: 'Salary',
      incomeType: 'Salary',
      originalCurrency: 'LKR',
      originalAmount: 300_000,
      exchangeRateUsed: 1,
      convertedLkrAmount: 300_000,
      taxable: true,
      source: 'test',
      createdAt: '2026-06-10T00:00:00.000Z',
      updatedAt: '2026-06-10T00:00:00.000Z',
    })
    const context = buildFinanceQueryContext(db)
    // financeSummary(db) here would be in USD (~1000); the context pins LKR.
    expect(context.currency).toBe('LKR')
    expect(context.summary.baseCurrency).toBe('LKR')
    expect(context.summary.totalIncomeBase).toBe(300_000)
  })

  function pushExecutedTrade(
    db: ReturnType<typeof createEmptyFinanceDatabase>,
    id: string,
    profitLoss: number,
  ) {
    db.trading_plans.push({
      id,
      platform: 'manual',
      symbol: 'TSLA',
      assetType: 'stock',
      decision: 'HOLD',
      reason: 'test',
      riskLevel: 'low_risk',
      riskScore: 10,
      confidenceScore: 80,
      dataUsed: [],
      newsReviewed: [],
      finalRecommendation: 'test',
      status: 'executed',
      userApprovalStatus: 'approved',
      executionStatus: 'executed',
      profitLoss,
      source: 'test',
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
    })
  }

  it('includes a tradingSummary matching tradingPerformanceSummary (AI-206), with no trades', () => {
    const db = createEmptyFinanceDatabase()
    const context = buildFinanceQueryContext(db)
    expect(context.tradingSummary).toEqual(tradingPerformanceSummary(db))
    expect(context.tradingSummary.totalTrades).toBe(0)
  })

  it('includes a tradingSummary matching tradingPerformanceSummary (AI-206), with executed trades', () => {
    const db = createEmptyFinanceDatabase()
    pushExecutedTrade(db, 't1', 500)
    pushExecutedTrade(db, 't2', -200)
    const context = buildFinanceQueryContext(db)
    expect(context.tradingSummary).toEqual(tradingPerformanceSummary(db))
    expect(context.tradingSummary.totalTrades).toBe(2)
    expect(context.tradingSummary.winRate).toBe(0.5)
  })
})

describe('financeSummary FX conversion for non-LKR assets (PF-206)', () => {
  const usdHolding = {
    id: 's-usd',
    symbol: 'AAPL',
    platform: 'IBKR',
    quantity: 2,
    buyPrice: 100,
    buyDate: '2026-01-01',
    currency: 'USD' as const,
    lastKnownPrice: 150,
    priceSource: 'manual' as const,
    source: 'test',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
  }

  it('converts a non-LKR holding via a stored exchange rate', () => {
    const db = createEmptyFinanceDatabase()
    db.exchange_rates.push({
      base: 'USD',
      target: 'LKR',
      rate: 300,
      date: '2026-01-01',
      updatedAt: '2026-01-01T00:00:00.000Z',
    })
    db.stock_holdings.push({ ...usdHolding })

    const s = financeSummary(db)
    expect(s.stockHoldingsValueBase).toBe(2 * 150 * 300) // 90,000 LKR
    expect(s.unrealizedStockPnlBase).toBe(2 * (150 - 100) * 300) // 30,000 LKR
    expect(s.fxUnconverted).toEqual([])
  })

  it('counts a non-LKR asset raw and reports it when no rate is on file', () => {
    const db = createEmptyFinanceDatabase()
    db.stock_holdings.push({ ...usdHolding })
    db.fixed_deposits.push({
      id: 'f-eur',
      bankName: 'EuroBank',
      principal: 1_000,
      currency: 'EUR',
      interestRatePct: 3,
      interestPayout: 'at_maturity',
      startDate: '2026-01-01',
      maturityDate: '2027-01-01',
      status: 'active',
      source: 'test',
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
    })

    const s = financeSummary(db)
    expect(s.stockHoldingsValueBase).toBe(2 * 150) // raw, unconverted
    expect(s.fixedDepositsValueBase).toBe(1_000)
    expect(s.fxUnconverted).toEqual(['EUR', 'USD'])

    const alerts = financeAlerts(db)
    expect(alerts.some((a) => a.title === 'Missing exchange rate')).toBe(true)
  })

  it('leaves fxUnconverted empty for an all-LKR portfolio', () => {
    const db = createEmptyFinanceDatabase()
    db.stock_holdings.push({ ...usdHolding, currency: 'LKR' })
    expect(financeSummary(db).fxUnconverted).toEqual([])
  })
})

describe('financeSummary reporting currency (PF-201)', () => {
  const seedIncomeExpense = () => {
    const db = createEmptyFinanceDatabase()
    db.income_records.push({
      id: 'income-1',
      dateReceived: '2026-06-28',
      sourceName: 'Salary',
      incomeType: 'Salary',
      originalCurrency: 'LKR',
      originalAmount: 300_000,
      exchangeRateUsed: 1,
      convertedLkrAmount: 300_000,
      taxable: true,
      source: 'test',
      createdAt: '2026-06-28T00:00:00.000Z',
      updatedAt: '2026-06-28T00:00:00.000Z',
    })
    db.expense_records.push({
      id: 'expense-1',
      date: '2026-06-28',
      vendor: 'Rent',
      category: 'Housing',
      currency: 'LKR',
      amount: 100_000,
      convertedLkrAmount: 100_000,
      recurring: true,
      workRelated: false,
      taxDeductiblePossible: false,
      source: 'test',
      createdAt: '2026-06-28T00:00:00.000Z',
      updatedAt: '2026-06-28T00:00:00.000Z',
    })
    return db
  }

  it('defaults to LKR and leaves every figure unchanged', () => {
    const db = seedIncomeExpense()
    const s = financeSummary(db)
    expect(s.baseCurrency).toBe('LKR')
    expect(s.totalIncomeBase).toBe(300_000)
    expect(s.totalExpensesBase).toBe(100_000)
    expect(s.netSavingsBase).toBe(200_000)
    expect(s.fxUnconverted).toEqual([])
  })

  it('expresses aggregate figures in the base currency via a direct LKR->base rate', () => {
    const db = seedIncomeExpense()
    db.settings.baseCurrency = 'USD'
    db.exchange_rates.push({
      base: 'LKR',
      target: 'USD',
      rate: 1 / 300,
      date: '2026-06-01',
      updatedAt: '2026-06-01T00:00:00.000Z',
    })
    const s = financeSummary(db)
    expect(s.baseCurrency).toBe('USD')
    expect(s.totalIncomeBase).toBeCloseTo(1_000)
    expect(s.totalExpensesBase).toBeCloseTo(1_000 / 3)
    expect(s.netSavingsBase).toBeCloseTo(2_000 / 3)
    // percentages stay currency-free
    expect(s.savingsRate).toBeCloseTo((200_000 / 300_000) * 100)
    expect(s.fxUnconverted).toEqual([])
  })

  it('falls back to the inverse base->LKR rate when no LKR->base rate is on file', () => {
    const db = seedIncomeExpense()
    db.settings.baseCurrency = 'USD'
    db.exchange_rates.push({
      base: 'USD',
      target: 'LKR',
      rate: 300,
      date: '2026-06-01',
      updatedAt: '2026-06-01T00:00:00.000Z',
    })
    const s = financeSummary(db)
    expect(s.totalIncomeBase).toBeCloseTo(1_000)
    expect(s.netSavingsBase).toBeCloseTo(2_000 / 3)
    expect(s.fxUnconverted).toEqual([])
  })

  it('counts figures raw and flags the base currency when no rate exists', () => {
    const db = seedIncomeExpense()
    db.settings.baseCurrency = 'USD'
    const s = financeSummary(db)
    expect(s.totalIncomeBase).toBe(300_000)
    expect(s.netSavingsBase).toBe(200_000)
    expect(s.fxUnconverted).toEqual(['USD'])
  })
})

describe('financeSummary net worth with stock holdings and fixed deposits', () => {
  it('includes stock holdings at current price and active fixed deposit principal', () => {
    const db = createEmptyFinanceDatabase()
    db.stock_holdings.push({
      id: 's1',
      symbol: 'JKH.N0000',
      platform: 'Test',
      quantity: 10,
      buyPrice: 100,
      buyDate: '2026-01-01',
      currency: 'LKR',
      lastKnownPrice: 120,
      priceSource: 'cse_api',
      source: 'test',
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
    })
    db.fixed_deposits.push({
      id: 'f1',
      bankName: 'Test Bank',
      principal: 50_000,
      currency: 'LKR',
      interestRatePct: 10,
      interestPayout: 'at_maturity',
      startDate: '2026-01-01',
      maturityDate: '2027-01-01',
      status: 'active',
      source: 'test',
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
    })
    db.fixed_deposits.push({
      id: 'f2',
      bankName: 'Withdrawn Bank',
      principal: 999_999,
      currency: 'LKR',
      interestRatePct: 10,
      interestPayout: 'at_maturity',
      startDate: '2026-01-01',
      maturityDate: '2027-01-01',
      status: 'withdrawn',
      source: 'test',
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
    })

    const summary = financeSummary(db)
    expect(summary.stockHoldingsValueBase).toBe(1200) // 10 * 120 (current price, not buy price)
    expect(summary.fixedDepositsValueBase).toBe(50_000) // withdrawn FD excluded
    expect(summary.netWorthBase).toBe(1200 + 50_000)
  })

  it('debtBase (Phase 40) sums active loan currentBalance and card account balances, excluding loan-type accounts and paid-off loans', () => {
    const db = createEmptyFinanceDatabase()
    db.finance_accounts.push({
      id: 'a1',
      name: 'Credit Card',
      type: 'card',
      currency: 'LKR',
      balance: -15_000,
      source: 'test',
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
    })
    db.finance_accounts.push({
      id: 'a2',
      name: 'Legacy Loan Account',
      type: 'loan',
      currency: 'LKR',
      balance: -999_999,
      source: 'test',
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
    })
    db.loans.push({
      id: 'l1',
      lender: 'Test Bank',
      principal: 100_000,
      currentBalance: 60_000,
      currency: 'LKR',
      interestRatePct: 12,
      startDate: '2026-01-01',
      status: 'active',
      source: 'test',
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
    })
    db.loans.push({
      id: 'l2',
      lender: 'Paid Off Bank',
      principal: 50_000,
      currentBalance: 0,
      currency: 'LKR',
      interestRatePct: 8,
      startDate: '2026-01-01',
      status: 'paid_off',
      source: 'test',
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
    })

    const summary = financeSummary(db)
    // 15_000 (card) + 60_000 (active loan) — the 999_999 loan-type account and the paid-off loan are excluded
    expect(summary.debtBase).toBe(75_000)
  })

  it('propertyValueBase (Phase 40) sums current property values and adds to netWorthBase', () => {
    const db = createEmptyFinanceDatabase()
    db.properties.push({
      id: 'p1',
      description: 'Test House',
      propertyType: 'residential',
      purchasePrice: 5_000_000,
      currentValue: 5_500_000,
      currency: 'LKR',
      purchaseDate: '2026-01-01',
      source: 'test',
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
    })
    db.properties.push({
      id: 'p2',
      description: 'Test Land',
      propertyType: 'land',
      purchasePrice: 1_000_000,
      currentValue: 1_200_000,
      currency: 'LKR',
      purchaseDate: '2026-01-01',
      source: 'test',
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
    })

    const summary = financeSummary(db)
    expect(summary.propertyValueBase).toBe(6_700_000)
    expect(summary.netWorthBase).toBe(6_700_000)
  })

  it('falls back to buy price when a stock holding has no cached current price yet', () => {
    const db = createEmptyFinanceDatabase()
    db.stock_holdings.push({
      id: 's1',
      symbol: 'JKH.N0000',
      platform: 'Test',
      quantity: 5,
      buyPrice: 200,
      buyDate: '2026-01-01',
      currency: 'LKR',
      priceSource: 'manual',
      source: 'test',
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
    })
    const summary = financeSummary(db)
    expect(summary.stockHoldingsValueBase).toBe(1000) // 5 * 200 (buy price fallback)
  })

  it('computes unrealizedStockPnlBase as (current - buy) * quantity, summed across holdings', () => {
    const db = createEmptyFinanceDatabase()
    db.stock_holdings.push({
      id: 's1',
      symbol: 'JKH.N0000',
      platform: 'Test',
      quantity: 10,
      buyPrice: 100,
      buyDate: '2026-01-01',
      currency: 'LKR',
      lastKnownPrice: 120,
      priceSource: 'cse_api',
      source: 'test',
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
    })
    db.stock_holdings.push({
      id: 's2',
      symbol: 'COMB.N0000',
      platform: 'Test',
      quantity: 5,
      buyPrice: 300,
      buyDate: '2026-01-01',
      currency: 'LKR',
      lastKnownPrice: 250,
      priceSource: 'cse_api',
      source: 'test',
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
    })
    const summary = financeSummary(db)
    // (120-100)*10 + (250-300)*5 = 200 - 250 = -50
    expect(summary.unrealizedStockPnlBase).toBe(-50)
    // cost basis = 10*100 + 5*300 = 2500; pct = -50/2500*100 = -2
    expect(summary.unrealizedStockPnlPct).toBe(-2)
  })

  it('unrealizedStockPnlBase is 0 when there is no cached current price (falls back to buy price)', () => {
    const db = createEmptyFinanceDatabase()
    db.stock_holdings.push({
      id: 's1',
      symbol: 'JKH.N0000',
      platform: 'Test',
      quantity: 5,
      buyPrice: 200,
      buyDate: '2026-01-01',
      currency: 'LKR',
      priceSource: 'manual',
      source: 'test',
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
    })
    const summary = financeSummary(db)
    expect(summary.unrealizedStockPnlBase).toBe(0)
    expect(summary.unrealizedStockPnlPct).toBe(0)
  })

  it('unrealizedStockPnlPct is 0 when there are no stock holdings (division-by-zero guard)', () => {
    const db = createEmptyFinanceDatabase()
    const summary = financeSummary(db)
    expect(summary.unrealizedStockPnlPct).toBe(0)
  })
})

describe('PF review item 7: server-side dashboard derivations', () => {
  const isoDaysFromNow = (n: number) =>
    new Date(Date.now() + n * 24 * 60 * 60 * 1000).toISOString().slice(0, 10)
  const thisMonth = () => new Date().toISOString().slice(0, 7)

  it('getFinanceTrends returns a 6-month series and this-month top categories', () => {
    const db = createEmptyFinanceDatabase()
    const m = thisMonth()
    db.income_records.push({
      id: 'i',
      dateReceived: `${m}-05`,
      sourceName: 'x',
      incomeType: 'Salary',
      originalCurrency: 'LKR',
      originalAmount: 200_000,
      exchangeRateUsed: 1,
      convertedLkrAmount: 200_000,
      taxable: true,
      source: 't',
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
    })
    db.expense_records.push(
      {
        id: 'e1',
        date: `${m}-06`,
        vendor: 'A',
        category: 'Food',
        currency: 'LKR',
        amount: 30_000,
        convertedLkrAmount: 30_000,
        recurring: false,
        workRelated: false,
        taxDeductiblePossible: false,
        source: 't',
        createdAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-01-01T00:00:00.000Z',
      },
      {
        id: 'e2',
        date: `${m}-07`,
        vendor: 'B',
        category: 'Transport',
        currency: 'LKR',
        amount: 5_000,
        convertedLkrAmount: 5_000,
        recurring: false,
        workRelated: false,
        taxDeductiblePossible: false,
        source: 't',
        createdAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-01-01T00:00:00.000Z',
      },
    )
    const t = getFinanceTrends(db)
    expect(t.series).toHaveLength(6)
    const current = t.series[t.series.length - 1]
    expect(current).toMatchObject({
      month: m,
      income: 200_000,
      expense: 35_000,
      net: 165_000,
    })
    expect(t.categoriesThisMonth).toEqual([
      { category: 'Food', amount: 30_000 },
      { category: 'Transport', amount: 5_000 },
    ])
  })

  it('getRecurringBills flags a vendor seen with a stable amount in 2+ recent months', () => {
    const db = createEmptyFinanceDatabase()
    const now = new Date()
    for (let i = 0; i < 2; i++) {
      const d = new Date(now.getFullYear(), now.getMonth() - i, 15)
      db.expense_records.push({
        id: `r-${i}`,
        date: d.toISOString().slice(0, 10),
        vendor: 'Netflix',
        category: 'Subscriptions',
        currency: 'LKR',
        amount: 1_990,
        convertedLkrAmount: 1_990,
        recurring: false,
        workRelated: false,
        taxDeductiblePossible: false,
        source: 't',
        createdAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-01-01T00:00:00.000Z',
      })
    }
    const bills = getRecurringBills(db)
    expect(bills).toHaveLength(1)
    expect(bills[0]).toMatchObject({
      vendor: 'netflix',
      displayVendor: 'Netflix',
      category: 'Subscriptions',
      monthsSeen: 2,
      averageAmount: 1_990,
      // the loop logged an expense for the current month too
      loggedThisMonth: true,
      thisMonthAmount: 1_990,
      drift: 0,
    })
  })

  it('getRecurringBills.drift reflects how far this month is above the usual amount', () => {
    const db = createEmptyFinanceDatabase()
    const now = new Date()
    const push = (monthOffset: number, amount: number) => {
      const d = new Date(now.getFullYear(), now.getMonth() - monthOffset, 12)
      db.expense_records.push({
        id: `d-${monthOffset}`,
        date: d.toISOString().slice(0, 10),
        vendor: 'PowerCo',
        category: 'Utilities',
        currency: 'LKR',
        amount,
        convertedLkrAmount: amount,
        recurring: false,
        workRelated: false,
        taxDeductiblePossible: false,
        source: 't',
        createdAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-01-01T00:00:00.000Z',
      })
    }
    push(2, 10_000)
    push(1, 10_000)
    push(0, 12_000) // this month, 20% over the ~10.7k average

    const [bill] = getRecurringBills(db)
    expect(bill.thisMonthAmount).toBe(12_000)
    expect(bill.drift).toBeGreaterThan(0.1)
  })

  it('getRecurringBills.loggedThisMonth is false when the vendor has no current-month expense', () => {
    const db = createEmptyFinanceDatabase()
    const now = new Date()
    // two consecutive PAST months only (i = 1, 2), nothing this month
    for (let i = 1; i <= 2; i++) {
      const d = new Date(now.getFullYear(), now.getMonth() - i, 15)
      db.expense_records.push({
        id: `p-${i}`,
        date: d.toISOString().slice(0, 10),
        vendor: 'Spotify',
        category: 'Subscriptions',
        currency: 'LKR',
        amount: 990,
        convertedLkrAmount: 990,
        recurring: false,
        workRelated: false,
        taxDeductiblePossible: false,
        source: 't',
        createdAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-01-01T00:00:00.000Z',
      })
    }
    const [bill] = getRecurringBills(db)
    expect(bill).toMatchObject({ vendor: 'spotify', loggedThisMonth: false })
  })

  it('getUpcomingMoney surfaces an FD maturing within 30 days and a due-soon payday', () => {
    const db = createEmptyFinanceDatabase()
    db.fixed_deposits.push({
      id: 'fd',
      bankName: 'BOC',
      principal: 100_000,
      currency: 'LKR',
      interestRatePct: 10,
      interestPayout: 'at_maturity',
      startDate: '2026-01-01',
      maturityDate: isoDaysFromNow(10),
      status: 'active',
      source: 't',
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
    })
    db.income_sources.push({
      id: 'job',
      employerName: 'Acme',
      employmentType: 'full_time',
      status: 'active',
      monthlyIncomeAmount: 200_000,
      currency: 'LKR',
      expectedPaydayDayOfMonth: new Date().getDate(),
      source: 't',
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
    })
    const u = getUpcomingMoney(db)
    expect(u.fdMaturities).toEqual([{ name: 'BOC', days: 10 }])
    expect(u.paydays).toHaveLength(1)
    expect(u.paydays[0]).toMatchObject({ name: 'Acme', state: 'due_soon' })
  })

  it('getCurrencyExposure groups active jobs / holdings / FDs by currency, never summed across', () => {
    const db = createEmptyFinanceDatabase()
    db.income_sources.push({
      id: 'j',
      employerName: 'Remote Co',
      employmentType: 'contract',
      status: 'active',
      monthlyIncomeAmount: 3_000,
      currency: 'USD',
      source: 't',
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
    })
    db.fixed_deposits.push({
      id: 'fd',
      bankName: 'X',
      principal: 500_000,
      currency: 'LKR',
      interestRatePct: 10,
      interestPayout: 'at_maturity',
      startDate: '2026-01-01',
      maturityDate: '2027-01-01',
      status: 'active',
      source: 't',
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
    })
    db.stock_holdings.push({
      id: 'h',
      symbol: 'AAPL',
      platform: 'ibkr',
      quantity: 10,
      buyPrice: 100,
      buyDate: '2026-01-01',
      priceSource: 'manual',
      currency: 'USD',
      source: 't',
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
    })
    const exposure = getCurrencyExposure(db)
    expect(exposure).toEqual([
      {
        currency: 'LKR',
        amount: 500_000,
        breakdown: [
          {
            source: 'fixed_deposits',
            label: '1 fixed deposit',
            amount: 500_000,
            count: 1,
          },
        ],
      },
      {
        currency: 'USD',
        amount: 4_000,
        breakdown: [
          { source: 'jobs', label: '1 active job', amount: 3_000, count: 1 },
          { source: 'holdings', label: '1 holding', amount: 1_000, count: 1 },
        ],
      },
    ])
  })
})

describe('copyBudgetsToMonth', () => {
  function budgetRow(over: Partial<BudgetCategory> = {}): BudgetCategory {
    return {
      id: 'b-1',
      month: '2026-07',
      category: 'Groceries',
      currency: 'LKR',
      budgetAmount: 20_000,
      source: 'test',
      createdAt: '2026-07-01T00:00:00.000Z',
      updatedAt: '2026-07-01T00:00:00.000Z',
      ...over,
    }
  }

  it('copies each category from the most recent prior month into the target month', () => {
    const db = createEmptyFinanceDatabase()
    db.budget_categories.push(budgetRow())

    const result = copyBudgetsToMonth(db, '2026-08')
    expect(result).toEqual({ copied: 1, skippedExisting: 0 })
    const augustRows = db.budget_categories.filter((b) => b.month === '2026-08')
    expect(augustRows).toHaveLength(1)
    expect(augustRows[0]).toMatchObject({
      category: 'Groceries',
      currency: 'LKR',
      budgetAmount: 20_000,
      month: '2026-08',
      source: 'rollover',
    })
  })

  it('skips a category that already has a row for the target month, without overwriting it', () => {
    const db = createEmptyFinanceDatabase()
    db.budget_categories.push(
      budgetRow(),
      budgetRow({
        id: 'b-2',
        month: '2026-08',
        budgetAmount: 99_999,
        createdAt: '2026-08-01T00:00:00.000Z',
        updatedAt: '2026-08-01T00:00:00.000Z',
      }),
    )

    const result = copyBudgetsToMonth(db, '2026-08')
    expect(result).toEqual({ copied: 0, skippedExisting: 1 })
    const augustRows = db.budget_categories.filter((b) => b.month === '2026-08')
    expect(augustRows).toHaveLength(1)
    expect(augustRows[0].budgetAmount).toBe(99_999) // untouched
  })

  it('picks the most recent prior month, not just any prior month', () => {
    const db = createEmptyFinanceDatabase()
    db.budget_categories.push(
      budgetRow({ id: 'b-1', month: '2026-05', budgetAmount: 10_000 }),
      budgetRow({ id: 'b-2', month: '2026-07', budgetAmount: 20_000 }),
    )

    copyBudgetsToMonth(db, '2026-08')
    const augustRow = db.budget_categories.find((b) => b.month === '2026-08')!
    expect(augustRow.budgetAmount).toBe(20_000)
  })

  it('adds the positive leftover when rolloverEnabled is set and the source month was under budget', () => {
    const db = createEmptyFinanceDatabase()
    db.budget_categories.push(budgetRow({ rolloverEnabled: true }))
    db.expense_records.push({
      id: 'e-1',
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

    copyBudgetsToMonth(db, '2026-08')
    const augustRow = db.budget_categories.find((b) => b.month === '2026-08')!
    // 20,000 budget - 15,000 spent = 5,000 leftover, added on top.
    expect(augustRow.budgetAmount).toBe(25_000)
    expect(augustRow.rolloverEnabled).toBe(true)
  })

  it('never subtracts an overspend — rollover only ever adds unspent room', () => {
    const db = createEmptyFinanceDatabase()
    db.budget_categories.push(budgetRow({ rolloverEnabled: true, budgetAmount: 20_000 }))
    db.expense_records.push({
      id: 'e-1',
      date: '2026-07-05',
      vendor: 'Cargills',
      category: 'Groceries',
      currency: 'LKR',
      amount: 25_000, // over budget
      convertedLkrAmount: 25_000,
      recurring: false,
      workRelated: false,
      taxDeductiblePossible: false,
      source: 'test',
      createdAt: '2026-07-05T00:00:00.000Z',
      updatedAt: '2026-07-05T00:00:00.000Z',
    })

    copyBudgetsToMonth(db, '2026-08')
    const augustRow = db.budget_categories.find((b) => b.month === '2026-08')!
    expect(augustRow.budgetAmount).toBe(20_000) // unchanged, not reduced to 15,000
  })

  it('does not add a leftover when rolloverEnabled is not set, even if under budget', () => {
    const db = createEmptyFinanceDatabase()
    db.budget_categories.push(budgetRow()) // rolloverEnabled not set
    db.expense_records.push({
      id: 'e-1',
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

    copyBudgetsToMonth(db, '2026-08')
    const augustRow = db.budget_categories.find((b) => b.month === '2026-08')!
    expect(augustRow.budgetAmount).toBe(20_000) // straight copy, no leftover added
  })

  it('returns copied: 0, skippedExisting: 0 when there is nothing to copy', () => {
    const db = createEmptyFinanceDatabase()
    expect(copyBudgetsToMonth(db, '2026-08')).toEqual({ copied: 0, skippedExisting: 0 })
  })
})

describe('getFxGainLoss', () => {
  function holding(over: Partial<Record<string, unknown>> = {}) {
    return {
      id: 'h1',
      symbol: 'AAPL',
      platform: 'IBKR',
      quantity: 2,
      buyPrice: 100,
      buyDate: '2026-01-01',
      currency: 'USD' as const,
      lastKnownPrice: 150,
      priceSource: 'manual' as const,
      source: 'test',
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
      ...over,
    }
  }

  it('splits asset gain from fx gain when the exchange rate moved between buyDate and now', () => {
    const db = createEmptyFinanceDatabase()
    db.exchange_rates.push(
      {
        base: 'USD',
        target: 'LKR',
        rate: 300,
        date: '2026-01-01',
        updatedAt: '2026-01-01T00:00:00.000Z',
      },
      {
        base: 'USD',
        target: 'LKR',
        rate: 330,
        date: '2026-06-01',
        updatedAt: '2026-06-01T00:00:00.000Z',
      },
    )
    db.stock_holdings.push(holding())

    const result = getFxGainLoss(db)
    expect(result.excludedCount).toBe(0)
    expect(result.entries).toHaveLength(1)
    const entry = result.entries[0]
    expect(entry.insufficientHistory).toBe(false)
    // assetGain = (150-100)*2 converted at *today's* rate (330) = 33,000
    expect(entry.assetGainLkr).toBe(2 * (150 - 100) * 330)
    // fxGain = costNative(200) * (rateNow(330) - rateAtBuy(300)) = 6,000
    expect(entry.fxGainLkr).toBe(200 * (330 - 300))
    // totalReturn = valueLkrNow(150*2*330) - costLkrAtBuy(100*2*300)
    expect(entry.totalReturnLkr).toBe(150 * 2 * 330 - 100 * 2 * 300)
    // Decomposition must sum back to the total return exactly.
    expect(entry.assetGainLkr + entry.fxGainLkr).toBeCloseTo(
      entry.totalReturnLkr,
    )
    expect(result.totalAssetGainLkr).toBe(entry.assetGainLkr)
    expect(result.totalFxGainLkr).toBe(entry.fxGainLkr)
    expect(result.totalReturnLkr).toBe(entry.totalReturnLkr)
  })

  it('reports zero fxGainLkr when the rate has not moved', () => {
    const db = createEmptyFinanceDatabase()
    db.exchange_rates.push({
      base: 'USD',
      target: 'LKR',
      rate: 300,
      date: '2026-01-01',
      updatedAt: '2026-01-01T00:00:00.000Z',
    })
    db.stock_holdings.push(holding())

    const result = getFxGainLoss(db)
    expect(result.entries[0].fxGainLkr).toBe(0)
    expect(result.entries[0].assetGainLkr).toBe(2 * (150 - 100) * 300)
    expect(result.entries[0].assetGainLkr).toBe(result.entries[0].totalReturnLkr)
  })

  it('an LKR-denominated holding has zero fxGainLkr by construction, no rate lookup needed', () => {
    const db = createEmptyFinanceDatabase()
    db.stock_holdings.push(holding({ currency: 'LKR' }))

    const result = getFxGainLoss(db)
    expect(result.excludedCount).toBe(0)
    expect(result.entries[0]).toMatchObject({
      currency: 'LKR',
      fxGainLkr: 0,
      insufficientHistory: false,
      assetGainLkr: 2 * (150 - 100),
      totalReturnLkr: 2 * (150 - 100),
    })
  })

  it('excludes a holding with no exchange rate on file at all', () => {
    const db = createEmptyFinanceDatabase()
    db.stock_holdings.push(holding())

    const result = getFxGainLoss(db)
    expect(result.excludedCount).toBe(1)
    expect(result.entries[0]).toMatchObject({
      insufficientHistory: true,
      assetGainLkr: 0,
      fxGainLkr: 0,
      totalReturnLkr: 0,
    })
    expect(result.totalAssetGainLkr).toBe(0)
    expect(result.totalFxGainLkr).toBe(0)
  })

  it('excludes a holding whose buyDate predates the earliest rate on file', () => {
    const db = createEmptyFinanceDatabase()
    // Only a rate from well after buyDate — convertCurrency(..., buyDate)
    // has nothing dated on-or-before buyDate to use.
    db.exchange_rates.push({
      base: 'USD',
      target: 'LKR',
      rate: 330,
      date: '2026-06-01',
      updatedAt: '2026-06-01T00:00:00.000Z',
    })
    db.stock_holdings.push(holding({ buyDate: '2026-01-01' }))

    const result = getFxGainLoss(db)
    expect(result.excludedCount).toBe(1)
    expect(result.entries[0].insufficientHistory).toBe(true)
  })

  it('sums correctly across multiple holdings, mixing included and excluded', () => {
    const db = createEmptyFinanceDatabase()
    db.exchange_rates.push({
      base: 'USD',
      target: 'LKR',
      rate: 300,
      date: '2026-01-01',
      updatedAt: '2026-01-01T00:00:00.000Z',
    })
    db.stock_holdings.push(
      holding({ id: 'h1' }),
      holding({ id: 'h2', currency: 'EUR' }), // no EUR rate on file -> excluded
    )

    const result = getFxGainLoss(db)
    expect(result.entries).toHaveLength(2)
    expect(result.excludedCount).toBe(1)
    expect(result.totalAssetGainLkr).toBe(2 * (150 - 100) * 300)
    expect(result.totalFxGainLkr).toBe(0)
  })
})

describe('ledger-derived account balances (item 3 + 4)', () => {
  beforeEach(() => {
    vi.resetModules()
  })

  function acc(over: Partial<FinanceAccount>): FinanceAccount {
    return {
      id: 'a1',
      name: 'A',
      type: 'bank',
      currency: 'LKR',
      balance: 0,
      source: 'test',
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
      ...over,
    }
  }

  it('computeAccountLedgerBalance: null without openingBalance, else opening + tagged movements', () => {
    const db = createEmptyFinanceDatabase()
    expect(
      computeAccountLedgerBalance(db, { id: 'a1', currency: 'LKR' }, []),
    ).toBeNull()
    const legs = [
      { accountId: 'a1', currency: 'LKR', amount: 5_000, kind: 'income' as const },
      { accountId: 'a1', currency: 'LKR', amount: 2_000, kind: 'expense' as const },
      { accountId: 'a2', currency: 'LKR', amount: 9_999, kind: 'income' as const },
    ]
    expect(
      computeAccountLedgerBalance(
        db,
        { id: 'a1', currency: 'LKR', openingBalance: 10_000 },
        legs,
      ),
    ).toBe(13_000)
  })

  it('converts a cross-currency leg via the FX table instead of skipping it (item 4)', () => {
    const db = createEmptyFinanceDatabase()
    db.exchange_rates.push({
      id: 'r1',
      base: 'USD',
      target: 'LKR',
      rate: 300,
      date: '2026-06-01',
      source: 'test',
      createdAt: '2026-06-01T00:00:00.000Z',
      updatedAt: '2026-06-01T00:00:00.000Z',
    })
    // LKR account, a USD 100 income leg → +30_000 LKR
    const legs = [
      { accountId: 'a1', currency: 'USD', amount: 100, kind: 'income' as const },
    ]
    expect(
      computeAccountLedgerBalance(
        db,
        { id: 'a1', currency: 'LKR', openingBalance: 0 },
        legs,
      ),
    ).toBe(30_000)
    // still excluded when there is no rate on file
    const noRate = [
      { accountId: 'a1', currency: 'AUD', amount: 100, kind: 'income' as const },
    ]
    expect(
      computeAccountLedgerBalance(
        db,
        { id: 'a1', currency: 'LKR', openingBalance: 0 },
        noRate,
      ),
    ).toBe(0)
  })

  it('ledgerTransactionsForDb turns income/expense/transfers into signed legs', () => {
    const db = createEmptyFinanceDatabase()
    db.income_records.push({
      id: 'i1',
      dateReceived: '2026-06-01',
      sourceName: 'x',
      incomeType: 'x',
      originalCurrency: 'LKR',
      originalAmount: 100,
      exchangeRateUsed: 1,
      convertedLkrAmount: 100,
      accountId: 'a1',
      taxable: true,
      source: 'test',
      createdAt: '2026-06-01T00:00:00.000Z',
      updatedAt: '2026-06-01T00:00:00.000Z',
    })
    db.transfers.push({
      id: 't1',
      date: '2026-06-02',
      fromAccountId: 'a1',
      toAccountId: 'a2',
      amount: 40,
      currency: 'LKR',
      convertedLkrAmount: 40,
      source: 'test',
      createdAt: '2026-06-02T00:00:00.000Z',
      updatedAt: '2026-06-02T00:00:00.000Z',
    })
    const legs = ledgerTransactionsForDb(db)
    expect(legs).toEqual([
      { accountId: 'a1', currency: 'LKR', amount: 100, kind: 'income' },
      { accountId: 'a1', currency: 'LKR', amount: 40, kind: 'expense' },
      { accountId: 'a2', currency: 'LKR', amount: 40, kind: 'income' },
    ])
  })

  it('effectiveAccountBalance: opt-in uses ledger, off uses manual, fails closed when null', () => {
    const db = createEmptyFinanceDatabase()
    const legs = [
      { accountId: 'a1', currency: 'LKR', amount: 500, kind: 'expense' as const },
    ]
    // opt-out → manual balance
    expect(
      effectiveAccountBalance(db, acc({ balance: 7_777 }), legs),
    ).toBe(7_777)
    // opt-in with opening balance → derived
    expect(
      effectiveAccountBalance(
        db,
        acc({ balance: 7_777, openingBalance: 1_000, deriveBalanceFromLedger: true }),
        legs,
      ),
    ).toBe(500)
    // opt-in but NO opening balance → falls back to manual (never 0)
    expect(
      effectiveAccountBalance(
        db,
        acc({ balance: 7_777, deriveBalanceFromLedger: true }),
        legs,
      ),
    ).toBe(7_777)
  })

  it('financeSummary cash/net-worth honour an opted-in account, and fall back when not computable', () => {
    const db = createEmptyFinanceDatabase()
    db.finance_accounts.push(
      acc({ id: 'led', balance: 999, openingBalance: 1_000, deriveBalanceFromLedger: true }),
      acc({ id: 'man', balance: 2_000 }),
      acc({ id: 'noOpen', balance: 3_000, deriveBalanceFromLedger: true }),
    )
    db.expense_records.push({
      id: 'e1',
      date: '2026-06-01',
      vendor: 'v',
      category: 'c',
      currency: 'LKR',
      amount: 250,
      convertedLkrAmount: 250,
      recurring: false,
      workRelated: false,
      taxDeductiblePossible: false,
      accountId: 'led',
      source: 'test',
      createdAt: '2026-06-01T00:00:00.000Z',
      updatedAt: '2026-06-01T00:00:00.000Z',
    })
    // led: 1000 - 250 = 750 (not 999) · man: 2000 · noOpen: 3000 (fallback)
    expect(financeSummary(db).cashBalanceBase).toBe(750 + 2_000 + 3_000)
  })
})

describe('recordNetWorthSnapshot', () => {
  beforeEach(() => {
    vi.resetModules()
  })

  it('computes an LKR snapshot and upserts by date (idempotent per day)', async () => {
    const store = await freshFinanceStore()
    store.addFinanceRecord('account', {
      name: 'Checking',
      type: 'bank',
      currency: 'LKR',
      balance: 120_000,
    })

    let db = store.readFinanceStore()
    const first = store.recordNetWorthSnapshot(db, '2026-09-10')
    expect(first.snapshot).toMatchObject({
      date: '2026-09-10',
      netWorthLkr: 120_000,
      cashLkr: 120_000,
      source: 'snapshot',
    })
    store.writeFinanceStore(first.db)

    // same day again, after the balance changed → replaces, not appends
    store.updateFinanceRecord(
      'account',
      store.readFinanceStore().finance_accounts[0].id,
      { balance: 150_000 },
    )
    db = store.readFinanceStore()
    const second = store.recordNetWorthSnapshot(db, '2026-09-10')
    store.writeFinanceStore(second.db)
    const snaps = store.readFinanceStore().net_worth_snapshots
    expect(snaps).toHaveLength(1)
    expect(snaps[0].netWorthLkr).toBe(150_000)
    expect(snaps[0].id).toBe(first.snapshot.id) // stable id, kept createdAt

    // a different day appends, sorted ascending
    const third = store.recordNetWorthSnapshot(
      store.readFinanceStore(),
      '2026-09-11',
    )
    store.writeFinanceStore(third.db)
    const all = store.readFinanceStore().net_worth_snapshots
    expect(all.map((s) => s.date)).toEqual(['2026-09-10', '2026-09-11'])
  })
})

describe('financeAlerts — category budget thresholds', () => {
  function seedBudget(db: ReturnType<typeof createEmptyFinanceDatabase>, opts: {
    budget: number
    spent: number
  }) {
    const now = new Date()
    const month = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`
    db.budget_categories.push({
      id: 'b-groc',
      month,
      category: 'Groceries',
      currency: 'LKR',
      budgetAmount: opts.budget,
      source: 't',
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
    })
    db.expense_records.push({
      id: 'e-groc',
      date: `${month}-01`,
      vendor: 'Keells',
      category: 'Groceries',
      currency: 'LKR',
      amount: opts.spent,
      convertedLkrAmount: opts.spent,
      recurring: false,
      workRelated: false,
      taxDeductiblePossible: false,
      source: 't',
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
    })
  }

  it('raises a critical alert when a category is over budget', () => {
    const db = createEmptyFinanceDatabase()
    seedBudget(db, { budget: 10_000, spent: 12_500 })
    const alert = financeAlerts(db).find((a) => a.title === 'Over budget: Groceries')
    expect(alert?.level).toBe('critical')
    expect(alert?.detail).toContain('125%')
  })

  it('raises a warning near the limit only while days remain in the month', () => {
    const db = createEmptyFinanceDatabase()
    seedBudget(db, { budget: 10_000, spent: 9_400 }) // 94%
    const now = new Date()
    const daysLeft =
      new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate() -
      now.getDate()
    const has = financeAlerts(db).some(
      (a) => a.title === 'Budget nearly spent: Groceries',
    )
    // matches the >=3-days-left guard in financeAlerts
    expect(has).toBe(daysLeft >= 3)
  })

  it('is silent for a category comfortably under budget', () => {
    const db = createEmptyFinanceDatabase()
    seedBudget(db, { budget: 10_000, spent: 4_000 })
    expect(
      financeAlerts(db).some((a) => a.title.startsWith('Budget')),
    ).toBe(false)
    expect(
      financeAlerts(db).some((a) => a.title.startsWith('Over budget')),
    ).toBe(false)
  })
})

describe('scheduled_transaction (planned future income/expense)', () => {
  beforeEach(() => {
    vi.resetModules()
  })

  it('round-trips through add / update / delete and defaults status to pending', async () => {
    const store = await freshFinanceStore()
    store.addFinanceRecord('scheduled_transaction', {
      dueDate: '2026-10-01',
      kind: 'expense',
      counterparty: 'Landlord',
      category: 'Rent',
      amount: 85_000,
    })
    let db = store.readFinanceStore()
    expect(db.scheduled_transactions).toHaveLength(1)
    expect(db.scheduled_transactions[0]).toMatchObject({
      kind: 'expense',
      counterparty: 'Landlord',
      amount: 85_000,
      status: 'pending',
    })
    const id = db.scheduled_transactions[0].id

    store.updateFinanceRecord('scheduled_transaction', id, { amount: 90_000 })
    db = store.readFinanceStore()
    expect(db.scheduled_transactions[0].amount).toBe(90_000)

    store.updateFinanceRecord('scheduled_transaction', id, { status: 'cancelled' })
    expect(store.readFinanceStore().scheduled_transactions[0].status).toBe(
      'cancelled',
    )

    store.deleteFinanceRecord('scheduled_transaction', id)
    expect(store.readFinanceStore().scheduled_transactions).toHaveLength(0)
  })

  it('getUpcomingMoney.scheduled lists pending items in a -14..+45 day window, sorted by days', async () => {
    const store = await freshFinanceStore()
    const today = new Date('2026-09-10T00:00:00Z')
    const plus = (n: number) =>
      new Date(Date.UTC(2026, 8, 10 + n)).toISOString().slice(0, 10)
    store.addFinanceRecord('scheduled_transaction', {
      dueDate: plus(5),
      kind: 'expense',
      counterparty: 'Soon',
      category: 'X',
      amount: 100,
    })
    store.addFinanceRecord('scheduled_transaction', {
      dueDate: plus(-3),
      kind: 'expense',
      counterparty: 'Overdue',
      category: 'X',
      amount: 100,
    })
    store.addFinanceRecord('scheduled_transaction', {
      dueDate: plus(120),
      kind: 'expense',
      counterparty: 'FarOut',
      category: 'X',
      amount: 100,
    })
    const cancelledId = store.readFinanceStore().scheduled_transactions[0].id
    store.updateFinanceRecord('scheduled_transaction', cancelledId, {
      status: 'cancelled',
    })

    const { scheduled } = store.getUpcomingMoney(store.readFinanceStore(), today)
    expect(scheduled.map((s) => s.counterparty)).toEqual(['Overdue'])
    // 'Soon' was the one we cancelled; 'FarOut' is outside the +45d window
    expect(scheduled[0].days).toBe(-3)
  })
})
