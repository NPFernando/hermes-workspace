import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import {
  buildFinanceStorageHealth,
  captureNetWorthSnapshot,
  annualBudgetVsActualSummary,
  applyBudgetTemplate,
  buildTransactionsCsv,
  budgetVsActualSummary,
  cseProviderHealth,
  createEmptyFinanceDatabase,
  createTradingPlan,
  financeAlerts,
  financeSummary,
  financeStorageAlerts,
  getAverageMonthlyExpensesLkr,
  getAverageMonthlySavingsRatePct,
  financialHealthSummary,
  financialRuleAlerts,
  buildFinanceQueryContext,
  buildFinanceAgentContext,
  deleteBudgetTemplate,
  getMonthlySummary,
  getUnifiedTransactions,
  maskSensitive,
  migrateFinanceStore,
  safeToSpendSummary,
  saveBudgetTemplate,
  tradingPerformanceSummary,
} from './finance-store'

describe('OPS-103 CSE provider health', () => {
  const now = new Date('2026-09-10T12:00:00.000Z')

  function holding(overrides: Record<string, unknown> = {}) {
    return {
      id: 'holding-1',
      symbol: 'JKH.N0000',
      platform: 'Broker',
      quantity: 10,
      buyPrice: 100,
      buyDate: '2026-01-01',
      currency: 'LKR' as const,
      priceSource: 'manual' as const,
      source: 'test',
      createdAt: now.toISOString(),
      updatedAt: now.toISOString(),
      ...overrides,
    }
  }

  it('reports unknown when there are no holdings', () => {
    expect(cseProviderHealth(createEmptyFinanceDatabase(), now)).toEqual({
      status: 'unknown',
      holdingsCount: 0,
      cseQuoteCount: 0,
      manualFallbackCount: 0,
      staleQuoteCount: 0,
      latestQuoteAt: null,
    })
  })

  it('reports healthy for fresh CSE quotes only', () => {
    const db = createEmptyFinanceDatabase()
    db.stock_holdings = [
      holding({
        priceSource: 'cse_api',
        lastPriceUpdatedAt: '2026-09-10T10:00:00.000Z',
      }),
    ]

    expect(cseProviderHealth(db, now)).toMatchObject({
      status: 'healthy',
      holdingsCount: 1,
      cseQuoteCount: 1,
      manualFallbackCount: 0,
      staleQuoteCount: 0,
      latestQuoteAt: '2026-09-10T10:00:00.000Z',
    })
  })

  it('reports stale when a CSE quote is missing or older than one day', () => {
    const db = createEmptyFinanceDatabase()
    db.stock_holdings = [
      holding({
        id: 'old',
        priceSource: 'cse_api',
        lastPriceUpdatedAt: '2026-09-08T11:59:59.000Z',
      }),
      holding({ id: 'missing', priceSource: 'cse_api' }),
    ]

    expect(cseProviderHealth(db, now)).toMatchObject({
      status: 'stale',
      holdingsCount: 2,
      cseQuoteCount: 2,
      staleQuoteCount: 2,
      latestQuoteAt: '2026-09-08T11:59:59.000Z',
    })
  })

  it('reports manual or degraded when holdings use manual fallback', () => {
    const manualDb = createEmptyFinanceDatabase()
    manualDb.stock_holdings = [holding()]
    expect(cseProviderHealth(manualDb, now).status).toBe('manual')

    const mixedDb = createEmptyFinanceDatabase()
    mixedDb.stock_holdings = [
      holding({
        id: 'cse',
        priceSource: 'cse_api',
        lastPriceUpdatedAt: '2026-09-10T10:00:00.000Z',
      }),
      holding({ id: 'manual', priceSource: 'manual' }),
    ]
    expect(cseProviderHealth(mixedDb, now)).toMatchObject({
      status: 'degraded',
      holdingsCount: 2,
      cseQuoteCount: 1,
      manualFallbackCount: 1,
      staleQuoteCount: 0,
    })
  })
})

describe('AI-106 finance task records', () => {
  let tmp: string
  let realHome: string | undefined
  beforeEach(() => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'finance-ai-task-'))
    realHome = process.env.HOME
    process.env.HOME = tmp
    vi.resetModules()
  })
  afterEach(() => {
    if (realHome === undefined) delete process.env.HOME
    else process.env.HOME = realHome
    fs.rmSync(tmp, { recursive: true, force: true })
  })

  it('keeps scheduled rows out of totals until explicitly posted', async () => {
    const store = await import('./finance-store')
    store.addFinanceRecord('scheduled_transaction', {
      id: 'scheduled-rent',
      dueDate: '2026-10-01',
      kind: 'expense',
      counterparty: 'Landlord',
      category: 'Rent',
      amount: 100000,
    })
    let db = store.readFinanceStore()
    expect(db.scheduled_transactions).toHaveLength(1)
    expect(store.financeSummary(db).totalExpensesLkr).toBe(0)

    store.updateFinanceRecord('scheduled_transaction', 'scheduled-rent', {
      amount: 110000,
    })
    db = store.readFinanceStore()
    expect(db.scheduled_transactions[0].amount).toBe(110000)

    store.deleteFinanceRecord('scheduled_transaction', 'scheduled-rent')
    expect(store.readFinanceStore().scheduled_transactions).toHaveLength(0)
  })

  it('persists a task and enforces its lifecycle transitions', async () => {
    const store = await import('./finance-store')
    store.addFinanceRecord('ai_task', {
      taskType: 'budget_review',
      title: 'Review September budget',
      requestedAction: 'summarize_overspend',
      inputSummary: 'Review masked monthly budget and transaction totals.',
      risk: 'low',
      approvalRequired: false,
    })
    let db = store.readFinanceStore()
    expect(db.ai_tasks[0]).toMatchObject({
      taskType: 'budget_review',
      status: 'queued',
      risk: 'low',
    })
    expect(db.ai_tasks[0].auditCorrelationId).toEqual(expect.any(String))
    const id = db.ai_tasks[0].id

    store.updateFinanceRecord('ai_task', id, { status: 'running' })
    store.updateFinanceRecord('ai_task', id, {
      status: 'completed',
      resultSummary: 'No budget categories exceeded the configured threshold.',
    })
    db = store.readFinanceStore()
    expect(db.ai_tasks[0]).toMatchObject({ status: 'completed' })
    expect(db.ai_tasks[0].completedAt).toEqual(expect.any(String))
    expect(db.ai_tasks[0].statusHistory?.at(-1)).toMatchObject({
      status: 'completed',
      by: 'human',
    })

    expect(() =>
      store.updateFinanceRecord('ai_task', id, { status: 'running' }),
    ).toThrow('Invalid AI task status transition')
  })

  it('lists terminal history with pagination and omits task summaries', async () => {
    const store = await import('./finance-store')
    store.addFinanceRecord('ai_task', {
      title: 'Completed review',
      status: 'running',
      resultSummary: 'private result',
      agentName: 'finance-manager',
    })
    let db = store.readFinanceStore()
    const id = db.ai_tasks[0].id
    store.updateFinanceRecord('ai_task', id, { status: 'completed' })

    const page = store.listFinanceAiTasks({ terminalOnly: true, limit: 1 })
    expect(page.total).toBe(1)
    expect(page.items[0]).toMatchObject({
      id,
      status: 'completed',
      agentName: 'finance-manager',
    })
    expect(page.items[0]).not.toHaveProperty('resultSummary')
    expect(page.items[0].statusHistory).toHaveLength(2)
    expect(page.hasMore).toBe(false)
    const csv = store.buildAiTaskReviewCsv(db)
    expect(csv).toContain('auditCorrelationId')
    expect(csv).toContain('Completed review')
    expect(csv).not.toContain('private result')
  })

  it('verifies the audit hash chain and detects tampering', async () => {
    const store = await import('./finance-store')
    store.appendAuditLog('review_started', { source: 'test' })
    store.appendAuditLog('review_completed', { source: 'test' })
    expect(store.verifyFinanceAuditChain()).toMatchObject({
      valid: true,
      entries: 2,
      chainedEntries: 2,
      legacyEntries: 0,
    })

    const lines = fs
      .readFileSync(store.FINANCE_AUDIT_PATH, 'utf8')
      .trim()
      .split('\n')
    const tampered = JSON.parse(lines[0]) as Record<string, unknown>
    tampered.action = 'tampered'
    lines[0] = JSON.stringify(tampered)
    fs.writeFileSync(store.FINANCE_AUDIT_PATH, `${lines.join('\n')}\n`)
    expect(store.verifyFinanceAuditChain().valid).toBe(false)
  })
})

describe('budget templates', () => {
  it('saves, applies without overwriting, and deletes a template', () => {
    const db = createEmptyFinanceDatabase()
    const template = saveBudgetTemplate(db, {
      name: 'Normal month',
      lines: [
        { category: 'Food', currency: 'LKR', budgetAmount: 30_000 },
        { category: 'Rent', currency: 'LKR', budgetAmount: 80_000 },
      ],
    })
    db.budget_categories.push({
      id: 'existing',
      month: '2026-09',
      category: 'Food',
      currency: 'LKR',
      budgetAmount: 35_000,
      source: 'manual',
      createdAt: '2026-09-01T00:00:00.000Z',
      updatedAt: '2026-09-01T00:00:00.000Z',
    })
    expect(applyBudgetTemplate(db, template.id, '2026-09')).toMatchObject({
      appliedCount: 1,
      skippedCount: 1,
    })
    expect(
      db.budget_categories.map((row) => [row.category, row.budgetAmount]),
    ).toEqual([
      ['Food', 35_000],
      ['Rent', 80_000],
    ])
    expect(deleteBudgetTemplate(db, template.id)).toBe(true)
    expect(db.settings.budgetTemplates).toEqual([])
  })
})

describe('financialRuleAlerts', () => {
  it('reports configured large transactions and investment progress transparently', () => {
    const db = createEmptyFinanceDatabase()
    const month = new Date().toISOString().slice(0, 7)
    db.settings.financialRules = {
      largeTransactionThresholdLkr: 10_000,
      monthlyInvestmentTargetLkr: 50_000,
    }
    db.expense_records.push({
      id: 'large-expense',
      date: `${month}-05`,
      vendor: 'Large purchase',
      category: 'Other',
      currency: 'LKR',
      amount: 12_000,
      convertedLkrAmount: 12_000,
      recurring: false,
      workRelated: false,
      taxDeductiblePossible: false,
      source: 'test',
      createdAt: `${month}-05T00:00:00.000Z`,
      updatedAt: `${month}-05T00:00:00.000Z`,
    })
    db.expense_records.push({
      id: 'transfer-leg',
      date: `${month}-06`,
      vendor: 'Internal transfer',
      category: 'Other',
      currency: 'LKR',
      amount: 90_000,
      convertedLkrAmount: 90_000,
      transactionType: 'transfer',
      recurring: false,
      workRelated: false,
      taxDeductiblePossible: false,
      source: 'test',
      createdAt: `${month}-06T00:00:00.000Z`,
      updatedAt: `${month}-06T00:00:00.000Z`,
    })
    db.fixed_deposits.push({
      id: 'monthly-fd',
      bankName: 'Test bank',
      principal: 25_000,
      currency: 'LKR',
      interestRatePct: 5,
      interestPayout: 'monthly',
      startDate: `${month}-01`,
      maturityDate: '2027-01-01',
      status: 'active',
      source: 'test',
      createdAt: `${month}-01T00:00:00.000Z`,
      updatedAt: `${month}-01T00:00:00.000Z`,
    })
    const alerts = financialRuleAlerts(db)
    expect(alerts.map((alert) => alert.title)).toEqual([
      'Large transaction review',
      'Monthly investment target behind',
    ])
    expect(alerts[1].detail).toContain('LKR 25,000')
  })

  it('uses only explicit discretionary categories and evaluates LKR allocation', () => {
    const db = createEmptyFinanceDatabase()
    const month = new Date().toISOString().slice(0, 7)
    db.settings.financialRules = {
      discretionarySpendingThresholdLkr: 1_000,
      investmentAllocationTargetPct: 50,
    }
    db.expense_records.push({
      id: 'dining',
      date: `${month}-05`,
      vendor: 'Cafe',
      category: 'Dining',
      currency: 'LKR',
      amount: 1_250,
      convertedLkrAmount: 1_250,
      recurring: false,
      workRelated: false,
      taxDeductiblePossible: false,
      source: 'test',
      createdAt: `${month}-05T00:00:00.000Z`,
      updatedAt: `${month}-05T00:00:00.000Z`,
    })
    db.expense_records.push({
      id: 'other',
      date: `${month}-06`,
      vendor: 'Other',
      category: 'Other',
      currency: 'LKR',
      amount: 9_000,
      convertedLkrAmount: 9_000,
      recurring: false,
      workRelated: false,
      taxDeductiblePossible: false,
      source: 'test',
      createdAt: `${month}-06T00:00:00.000Z`,
      updatedAt: `${month}-06T00:00:00.000Z`,
    })
    db.fixed_deposits.push({
      id: 'allocation-fd',
      bankName: 'Test bank',
      principal: 25_000,
      currency: 'LKR',
      interestRatePct: 5,
      interestPayout: 'monthly',
      startDate: `${month}-01`,
      maturityDate: '2027-01-01',
      status: 'active',
      source: 'test',
      createdAt: `${month}-01T00:00:00.000Z`,
      updatedAt: `${month}-01T00:00:00.000Z`,
    })
    const alerts = financialRuleAlerts(db)
    expect(alerts.map((alert) => alert.title)).toEqual([
      'Discretionary spending threshold exceeded',
      'Investment allocation target reached',
    ])
  })
})

describe('net-worth snapshots', () => {
  it('captures a deterministic manual snapshot and de-duplicates a date', () => {
    const db = createEmptyFinanceDatabase()
    db.finance_accounts.push({
      id: 'cash-1',
      name: 'Cash',
      type: 'cash',
      currency: 'LKR',
      balance: 100_000,
      source: 'test',
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
    })
    db.stock_holdings.push({
      id: 'holding-1',
      symbol: 'JKH.N0000',
      platform: 'Test broker',
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
    const first = captureNetWorthSnapshot(db, '2026-09-10')
    const second = captureNetWorthSnapshot(db, '2026-09-10')
    expect(first).toEqual(second)
    expect(first.netWorthLkr).toBe(101_200)
    expect(first.portfolioPositions).toEqual([
      expect.objectContaining({
        holdingId: 'holding-1',
        marketValue: 1200,
        costBasis: 1000,
        priceSource: 'cse_api',
      }),
    ])
    expect(db.net_worth_snapshots).toHaveLength(1)
    expect(captureNetWorthSnapshot(db, '2026-09-11', 'scheduled').source).toBe(
      'scheduled',
    )
  })
})

describe('finance-store', () => {
  it('migrates legacy snapshots by restoring missing collections', () => {
    const legacy = {
      schemaVersion: 0,
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
      settings: { baseCurrency: 'USD' },
      finance_accounts: [],
      income_records: [],
      expense_records: [],
      budget_categories: [],
      // Older snapshots did not have these collections.
    } as unknown as ReturnType<typeof createEmptyFinanceDatabase>

    const migrated = migrateFinanceStore(legacy)
    expect(migrated.schemaVersion).toBe(1)
    expect(migrated.settings.baseCurrency).toBe('USD')
    expect(migrated.properties).toEqual([])
    expect(migrated.beneficiaries).toEqual([])
  })

  it('rejects snapshots from a newer unsupported schema', () => {
    const future = {
      ...createEmptyFinanceDatabase(),
      schemaVersion: 999,
    }
    expect(() => migrateFinanceStore(future)).toThrow(
      /newer than the supported version/,
    )
  })

  it.each([
    ['negative', -1],
    ['fractional', 0.5],
    ['text', '1'],
  ])('rejects a malformed %s schema version', (_label, schemaVersion) => {
    expect(() =>
      migrateFinanceStore({
        ...createEmptyFinanceDatabase(),
        schemaVersion,
      } as unknown as Parameters<typeof migrateFinanceStore>[0]),
    ).toThrow(/schema version must be a non-negative integer/)
  })

  it('repairs malformed settings and collection values without losing valid data', () => {
    const migrated = migrateFinanceStore({
      schemaVersion: 0,
      settings: null,
      finance_accounts: [{ id: 'account-1', name: 'Savings' }],
      stock_holdings: 'not-an-array',
    } as unknown as Parameters<typeof migrateFinanceStore>[0])
    expect(migrated.settings.baseCurrency).toBe('LKR')
    expect(migrated.finance_accounts).toEqual([
      { id: 'account-1', name: 'Savings' },
    ])
    expect(migrated.stock_holdings).toEqual([])
    expect(migrated.insurance_policies).toEqual([])
  })

  it('normalizes legacy currency casing without changing stored amounts', () => {
    const migrated = migrateFinanceStore({
      ...createEmptyFinanceDatabase(),
      settings: { baseCurrency: ' usd ', reportingCurrencies: ['lkr', ' aud'] },
      finance_accounts: [{ id: 'account-1', currency: 'usd', balance: 125 }],
      expense_records: [{ id: 'expense-1', currency: ' aud ', amount: 50 }],
      exchange_rates: [{ base: 'lkr', target: ' usd ', rate: 0.003 }],
    } as unknown as Parameters<typeof migrateFinanceStore>[0])
    expect(migrated.settings.baseCurrency).toBe('USD')
    expect(migrated.settings.reportingCurrencies).toEqual(['LKR', 'AUD'])
    expect(migrated.finance_accounts[0]).toMatchObject({
      currency: 'USD',
      balance: 125,
    })
    expect(migrated.expense_records[0]).toMatchObject({
      currency: 'AUD',
      amount: 50,
    })
    expect(migrated.exchange_rates[0]).toMatchObject({
      base: 'LKR',
      target: 'USD',
      rate: 0.003,
    })
  })

  it('repairs a malformed reporting-currency list during migration', () => {
    const migrated = migrateFinanceStore({
      ...createEmptyFinanceDatabase(),
      settings: { reportingCurrencies: null },
    } as unknown as Parameters<typeof migrateFinanceStore>[0])
    expect(migrated.settings.reportingCurrencies).toEqual(['LKR', 'AUD', 'USD'])
  })

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
        approachingBudget: false,
      },
    ])
  })

  it('uses the configured threshold for approaching-budget warnings', () => {
    const db = createEmptyFinanceDatabase()
    db.settings.budgetAlertThresholdPct = 70
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

    expect(budgetVsActualSummary(db, '2026-07')[0]).toMatchObject({
      percentUsed: 75,
      overBudget: false,
      approachingBudget: true,
    })
  })

  it('returns an explainable financial health score with bounded components', () => {
    const db = createEmptyFinanceDatabase()
    db.income_records.push({
      id: 'income-1',
      dateReceived: '2026-07-01',
      sourceName: 'Salary',
      incomeType: 'Salary',
      originalCurrency: 'LKR',
      originalAmount: 100_000,
      exchangeRateUsed: 1,
      convertedLkrAmount: 100_000,
      taxable: true,
      source: 'test',
      createdAt: '2026-07-01T00:00:00.000Z',
      updatedAt: '2026-07-01T00:00:00.000Z',
    })
    const result = financialHealthSummary(db)
    expect(result.score).toBeGreaterThanOrEqual(0)
    expect(result.score).toBeLessThanOrEqual(100)
    expect(result.band).toBe('stable')
    expect(result.components.map((component) => component.key)).toEqual([
      'savings',
      'emergency',
      'budget',
      'debt',
      'data',
    ])
    for (const component of result.components) {
      expect(component.score).toBeGreaterThanOrEqual(0)
      expect(component.score).toBeLessThanOrEqual(component.maxScore)
    }
  })

  it('calculates safe-to-spend as cash minus reserve and recorded commitments', () => {
    const db = createEmptyFinanceDatabase()
    db.finance_accounts.push({
      id: 'cash-1',
      name: 'Cash',
      type: 'cash',
      currency: 'LKR',
      balance: 100_000,
      source: 'test',
      createdAt: '2026-07-01T00:00:00.000Z',
      updatedAt: '2026-07-01T00:00:00.000Z',
    })
    const month = new Date().toISOString().slice(0, 7)
    db.expense_records.push({
      id: 'recurring-1',
      date: `${month}-05`,
      vendor: 'Internet',
      category: 'Utilities',
      currency: 'LKR',
      amount: 5_000,
      convertedLkrAmount: 5_000,
      recurring: true,
      workRelated: false,
      taxDeductiblePossible: false,
      source: 'test',
      createdAt: `${month}-05T00:00:00.000Z`,
      updatedAt: `${month}-05T00:00:00.000Z`,
    })
    db.settings.minimumCashReserveLkr = 60_000
    expect(safeToSpendSummary(db)).toMatchObject({
      cashLkr: 100_000,
      reserveLkr: 60_000,
      committedLkr: 5_000,
      amountLkr: 35_000,
      configured: true,
    })
  })

  it('does not treat deleted or transfer expenses as committed obligations', () => {
    const db = createEmptyFinanceDatabase()
    const month = new Date().toISOString().slice(0, 7)
    db.expense_records.push(
      {
        id: 'recurring-deleted',
        date: `${month}-05`,
        vendor: 'Cancelled Internet',
        category: 'Utilities',
        currency: 'LKR',
        amount: 5_000,
        convertedLkrAmount: 5_000,
        recurring: true,
        workRelated: false,
        taxDeductiblePossible: false,
        deletedAt: `${month}-06T00:00:00.000Z`,
        source: 'test',
        createdAt: `${month}-05T00:00:00.000Z`,
        updatedAt: `${month}-06T00:00:00.000Z`,
      },
      {
        id: 'recurring-transfer',
        date: `${month}-07`,
        vendor: 'Own Account',
        category: 'Transfer',
        currency: 'LKR',
        amount: 9_000,
        convertedLkrAmount: 9_000,
        recurring: true,
        transactionType: 'transfer',
        workRelated: false,
        taxDeductiblePossible: false,
        source: 'test',
        createdAt: `${month}-07T00:00:00.000Z`,
        updatedAt: `${month}-07T00:00:00.000Z`,
      },
    )
    expect(safeToSpendSummary(db).committedLkr).toBe(0)
  })

  it('aggregates annual budgets by category without double-counting duplicate months', () => {
    const db = createEmptyFinanceDatabase()
    db.budget_categories.push(
      {
        id: 'budget-1',
        month: '2026-01',
        category: 'Groceries',
        currency: 'LKR',
        budgetAmount: 20_000,
        source: 'test',
        createdAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-01-01T00:00:00.000Z',
      },
      {
        id: 'budget-duplicate',
        month: '2026-01',
        category: 'Groceries',
        currency: 'LKR',
        budgetAmount: 99_999,
        source: 'test',
        createdAt: '2026-01-01T00:00:01.000Z',
        updatedAt: '2026-01-01T00:00:01.000Z',
      },
      {
        id: 'budget-2',
        month: '2026-02',
        category: 'Groceries',
        currency: 'LKR',
        budgetAmount: 20_000,
        source: 'test',
        createdAt: '2026-02-01T00:00:00.000Z',
        updatedAt: '2026-02-01T00:00:00.000Z',
      },
    )
    db.expense_records.push({
      id: 'expense-1',
      date: '2026-01-05',
      vendor: 'Cargills',
      category: 'Groceries',
      currency: 'LKR',
      amount: 15_000,
      convertedLkrAmount: 15_000,
      recurring: false,
      workRelated: false,
      taxDeductiblePossible: false,
      source: 'test',
      createdAt: '2026-01-05T00:00:00.000Z',
      updatedAt: '2026-01-05T00:00:00.000Z',
    })
    const [result] = annualBudgetVsActualSummary(db, 2026)
    expect(result).toMatchObject({
      category: 'Groceries',
      budget: 40_000,
      actual: 15_000,
      monthsTracked: 2,
      percentUsed: 37.5,
      overBudget: false,
      approachingBudget: false,
    })
  })

  it('upserts a dated exchange rate and keeps historical dates available', async () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'finance-store-rates-'))
    const realHome = process.env.HOME
    process.env.HOME = tmp
    vi.resetModules()
    try {
      const store = await import('./finance-store')
      const db = store.createEmptyFinanceDatabase()
      db.exchange_rates.push(
        { base: 'LKR', target: 'USD', rate: 0.0031, date: '2026-01-01' },
        { base: 'LKR', target: 'USD', rate: 0.0032, date: '2026-02-01' },
      )
      store.writeFinanceStore(db)
      store.updateExchangeRate('lkr', ' usd ', 0.0033, '2026-02-01')
      const saved = store.readFinanceStore()
      expect(saved.exchange_rates).toEqual([
        { base: 'LKR', target: 'USD', rate: 0.0031, date: '2026-01-01' },
        expect.objectContaining({
          base: 'LKR',
          target: 'USD',
          rate: 0.0033,
          date: '2026-02-01',
        }),
      ])
    } finally {
      if (realHome === undefined) delete process.env.HOME
      else process.env.HOME = realHome
      fs.rmSync(tmp, { recursive: true, force: true })
    }
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

  it('adds, edits, soft-deletes, and restores an expense record', async () => {
    const store = await import('./finance-store')
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
    expect(db.expense_records).toHaveLength(1)
    expect(db.expense_records[0].deletedAt).toBeTruthy()
    expect(store.getUnifiedTransactions(db)).toHaveLength(0)

    store.restoreFinanceRecord('expense', id)
    db = store.readFinanceStore()
    expect(db.expense_records[0].deletedAt).toBeUndefined()
    expect(store.getUnifiedTransactions(db)).toHaveLength(1)
  })

  it('resolves dated transaction FX and preserves explicit overrides', async () => {
    const store = await import('./finance-store')
    store.updateExchangeRate('LKR', 'USD', 0.003, '2026-09-01')

    store.addFinanceRecord('expense', {
      id: 'dated-fx-expense',
      date: '2026-09-10',
      vendor: 'Travel desk',
      category: 'Travel',
      currency: 'USD',
      amount: 10,
      convertedLkrAmount: 10,
    })
    store.addFinanceRecord('income', {
      id: 'dated-fx-income',
      dateReceived: '2026-09-10',
      sourceName: 'Contract',
      incomeType: 'Freelance',
      originalCurrency: 'USD',
      originalAmount: 10,
      convertedLkrAmount: 10,
    })
    store.addFinanceRecord('expense', {
      id: 'override-fx-expense',
      date: '2026-09-10',
      vendor: 'Manual quote',
      category: 'Travel',
      currency: 'USD',
      amount: 10,
      exchangeRateUsed: 300,
      convertedLkrAmount: 10,
    })

    const db = store.readFinanceStore()
    expect(db.expense_records[0]).toMatchObject({
      exchangeRateUsed: expect.closeTo(333.333333, 5),
      convertedLkrAmount: expect.closeTo(3333.333333, 5),
    })
    expect(db.income_records[0]).toMatchObject({
      exchangeRateUsed: expect.closeTo(333.333333, 5),
      convertedLkrAmount: expect.closeTo(3333.333333, 5),
    })
    expect(db.expense_records[1]).toMatchObject({
      exchangeRateUsed: 300,
      convertedLkrAmount: 3000,
    })
  })

  it('stores a transfer as a linked balanced pair and soft-deletes both sides', async () => {
    const store = await import('./finance-store')
    store.addFinanceRecord('account', {
      id: 'source-account',
      name: 'Checking',
      type: 'bank',
      currency: 'LKR',
      balance: 10000,
    })
    store.addFinanceRecord('account', {
      id: 'destination-account',
      name: 'Savings',
      type: 'bank',
      currency: 'LKR',
      balance: 0,
    })

    store.addFinanceTransfer({
      sourceAccountId: 'source-account',
      destinationAccountId: 'destination-account',
      date: '2026-09-10',
      amount: 2500,
    })

    let db = store.readFinanceStore()
    expect(db.income_records).toHaveLength(1)
    expect(db.expense_records).toHaveLength(1)
    expect(db.income_records[0].transactionType).toBe('transfer')
    expect(db.expense_records[0].transactionType).toBe('transfer')
    expect(db.income_records[0].transferId).toBe(
      db.expense_records[0].transferId,
    )
    expect(
      db.finance_accounts.find((a) => a.id === 'source-account')?.balance,
    ).toBe(7500)
    expect(
      db.finance_accounts.find((a) => a.id === 'destination-account')?.balance,
    ).toBe(2500)
    expect(store.financeSummary(db)).toMatchObject({
      totalIncomeLkr: 0,
      totalExpensesLkr: 0,
      netSavingsLkr: 0,
    })
    expect(store.getUnifiedTransactions(db)).toHaveLength(2)

    store.deleteFinanceRecord('expense', db.expense_records[0].id)
    db = store.readFinanceStore()
    expect(db.income_records).toHaveLength(1)
    expect(db.expense_records).toHaveLength(1)
    expect(db.income_records[0].deletedAt).toBeTruthy()
    expect(db.expense_records[0].deletedAt).toBeTruthy()
    expect(
      db.finance_accounts.find((a) => a.id === 'source-account')?.balance,
    ).toBe(10000)
    expect(
      db.finance_accounts.find((a) => a.id === 'destination-account')?.balance,
    ).toBe(0)

    store.restoreFinanceRecord('expense', db.expense_records[0].id)
    db = store.readFinanceStore()
    expect(db.income_records[0].deletedAt).toBeUndefined()
    expect(db.expense_records[0].deletedAt).toBeUndefined()
    expect(
      db.finance_accounts.find((a) => a.id === 'source-account')?.balance,
    ).toBe(7500)
    expect(
      db.finance_accounts.find((a) => a.id === 'destination-account')?.balance,
    ).toBe(2500)
  })

  it('rejects transfers between different currencies', async () => {
    const store = await import('./finance-store')
    store.addFinanceRecord('account', {
      id: 'lkr-account',
      name: 'LKR',
      type: 'bank',
      currency: 'LKR',
      balance: 10000,
    })
    store.addFinanceRecord('account', {
      id: 'usd-account',
      name: 'USD',
      type: 'bank',
      currency: 'USD',
      balance: 0,
    })
    expect(() =>
      store.addFinanceTransfer({
        sourceAccountId: 'lkr-account',
        destinationAccountId: 'usd-account',
        amount: 100,
      }),
    ).toThrow(/same currency/)
  })

  it('stores split expenses by category and deletes the full split group', async () => {
    const store = await import('./finance-store')
    store.addFinanceRecord('account', {
      id: 'split-account',
      name: 'Checking',
      type: 'bank',
      currency: 'LKR',
      balance: 10000,
    })

    store.addFinanceSplit({
      date: '2026-09-10',
      vendor: 'Supermarket',
      accountId: 'split-account',
      currency: 'LKR',
      splits: [
        { category: 'Groceries', amount: 1800 },
        { category: 'Household', amount: 700 },
      ],
    })

    let db = store.readFinanceStore()
    expect(db.expense_records).toHaveLength(2)
    expect(
      new Set(db.expense_records.map((row) => row.splitGroupId)).size,
    ).toBe(1)
    expect(db.expense_records.map((row) => row.category)).toEqual(
      expect.arrayContaining(['Groceries', 'Household']),
    )
    expect(db.finance_accounts[0].balance).toBe(7500)
    expect(store.financeSummary(db).totalExpensesLkr).toBe(2500)

    store.deleteFinanceRecord('expense', db.expense_records[0].id)
    db = store.readFinanceStore()
    expect(db.expense_records).toHaveLength(2)
    expect(db.expense_records.every((row) => row.deletedAt)).toBe(true)
    expect(db.finance_accounts[0].balance).toBe(10000)

    store.restoreFinanceRecord('expense', db.expense_records[0].id)
    db = store.readFinanceStore()
    expect(db.expense_records.every((row) => !row.deletedAt)).toBe(true)
    expect(db.finance_accounts[0].balance).toBe(7500)
  })

  it('exposes redacted transaction audit history with before/after snapshots', async () => {
    const store = await import('./finance-store')
    store.addFinanceRecord('expense', {
      id: 'audited-expense',
      vendor: 'Cafe',
      category: 'Dining',
      amount: 500,
      currency: 'LKR',
    })
    store.updateFinanceRecord('expense', 'audited-expense', { amount: 750 })
    store.deleteFinanceRecord('expense', 'audited-expense')

    const history = store.readTransactionAudit()
    expect(history.slice(0, 3).map((entry) => entry.action)).toEqual([
      'record_deleted:expense',
      'record_updated:expense',
      'record_added:expense',
    ])
    expect(history[0].details.before).toMatchObject({
      id: 'audited-expense',
      amount: 750,
      category: 'Dining',
    })
    expect(history[1].details).toMatchObject({
      before: { amount: 500 },
      after: { amount: 750 },
    })
  })

  it('keeps valid transaction history when an audit line is malformed', async () => {
    const store = await import('./finance-store')
    store.addFinanceRecord('expense', {
      id: 'valid-audit-entry',
      vendor: 'Cafe',
      category: 'Dining',
      amount: 500,
      currency: 'LKR',
    })
    fs.appendFileSync(store.FINANCE_AUDIT_PATH, '{malformed-json}\n')

    expect(store.readTransactionAudit()).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          action: 'record_added:expense',
          details: expect.objectContaining({
            after: expect.objectContaining({ id: 'valid-audit-entry' }),
          }),
        }),
      ]),
    )
  })

  it('throws when deleting an id that does not exist, instead of silently no-oping', async () => {
    const store = await import('./finance-store')
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
    const store = await import('./finance-store')
    expect(() => store.deleteFinanceRecord('trading_plan', 'some-id')).toThrow(
      /Unsupported/,
    )
  })

  it('throws when updating a record that does not exist', async () => {
    const store = await import('./finance-store')
    expect(() =>
      store.updateFinanceRecord('expense', 'does-not-exist', { amount: 1 }),
    ).toThrow(/not found/)
  })

  it('goalKind (PF-1007 Sinking Funds) defaults to general and accepts sinking', async () => {
    const store = await import('./finance-store')
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

  it('records a bounded completion event only when a goal crosses its target', async () => {
    const store = await import('./finance-store')
    store.addFinanceRecord('goal', {
      id: 'completion-goal',
      name: 'Emergency buffer',
      targetAmount: 100_000,
      currentAmount: 50_000,
      currency: 'LKR',
    })
    store.updateFinanceRecord('goal', 'completion-goal', {
      currentAmount: 100_000,
    })
    store.updateFinanceRecord('goal', 'completion-goal', {
      currentAmount: 120_000,
    })
    const db = store.readFinanceStore()
    expect(db.settings.goalCompletionEvents).toHaveLength(1)
    expect(db.settings.goalCompletionEvents?.[0]).toMatchObject({
      goalId: 'completion-goal',
      goalName: 'Emergency buffer',
      targetAmount: 100_000,
      currency: 'LKR',
    })
  })

  it('loan (Phase 40) round-trips through add, update, delete, and defaults status to active', async () => {
    const store = await import('./finance-store')
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
    const store = await import('./finance-store')
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
    const store = await import('./finance-store')
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

  it('insurance policy (DOC-109) round-trips through add, update, and delete', async () => {
    const store = await import('./finance-store')
    store.addFinanceRecord('insurance_policy', {
      provider: 'Acme Assurance',
      policyType: 'health',
      insuredItem: 'Family health cover',
      premiumAmount: 12_000,
      premiumFrequency: 'annual',
      coverageAmount: 1_000_000,
      currency: 'LKR',
      documentRef: '/tmp/finance/policy.pdf',
    })
    let db = store.readFinanceStore()
    expect(db.insurance_policies).toHaveLength(1)
    const policy = db.insurance_policies[0]
    expect(policy).toMatchObject({
      provider: 'Acme Assurance',
      status: 'active',
      documentRef: '/tmp/finance/policy.pdf',
    })

    store.updateFinanceRecord('insurance_policy', policy.id, {
      status: 'expired',
      coverageAmount: 900_000,
    })
    db = store.readFinanceStore()
    expect(db.insurance_policies[0]).toMatchObject({
      status: 'expired',
      coverageAmount: 900_000,
    })

    store.deleteFinanceRecord('insurance_policy', policy.id)
    expect(store.readFinanceStore().insurance_policies).toHaveLength(0)
  })

  it('propertyType defaults to residential on add when omitted or invalid', async () => {
    const store = await import('./finance-store')
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
    const store = await import('./finance-store')
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
    const store = await import('./finance-store')
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
    const store = await import('./finance-store')
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
    const store = await import('./finance-store')
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
    const store = await import('./finance-store')
    expect(store.getCategoryCorrections()).toEqual({})

    store.recordCategoryCorrection('Keells Super', 'Groceries')
    expect(store.getCategoryCorrections()).toEqual({
      'keells super': 'Groceries',
    })
  })

  it('overwrites a prior correction for the same vendor', async () => {
    const store = await import('./finance-store')
    store.recordCategoryCorrection('Keells Super', 'Groceries')
    store.recordCategoryCorrection('keells super', 'Household')
    expect(store.getCategoryCorrections()).toEqual({
      'keells super': 'Household',
    })
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

  it('supports the expanded contract lifecycle states and defaults invalid values safely', async () => {
    const store = await import('./finance-store')
    store.addFinanceRecord('income_source', {
      employerName: 'Lifecycle Co',
      status: 'notice_period',
    })
    store.addFinanceRecord('income_source', {
      employerName: 'Invalid Co',
      status: 'not-a-status',
    })
    let db = store.readFinanceStore()
    expect(
      db.income_sources.find((row) => row.employerName === 'Lifecycle Co')
        ?.status,
    ).toBe('notice_period')
    expect(
      db.income_sources.find((row) => row.employerName === 'Invalid Co')
        ?.status,
    ).toBe('active')
    const id = db.income_sources.find(
      (row) => row.employerName === 'Lifecycle Co',
    )?.id as string
    store.updateFinanceRecord('income_source', id, { status: 'paused' })
    db = store.readFinanceStore()
    expect(db.income_sources.find((row) => row.id === id)?.status).toBe(
      'paused',
    )
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

    store.updateFinanceRecord('income_source', id, {
      jobTitle: 'Senior Software Engineer',
    })
    db = store.readFinanceStore()
    expect(db.income_sources[0].jobTitle).toBe('Senior Software Engineer')
  })

  it('persists a structured dividend or interest income subtype', async () => {
    const store = await import('./finance-store')
    store.addFinanceRecord('income', {
      sourceName: 'Sampath Bank',
      incomeType: 'FD interest',
      incomeSubtype: 'interest',
      originalAmount: 2500,
      originalCurrency: 'LKR',
    })
    expect(store.readFinanceStore().income_records[0].incomeSubtype).toBe(
      'interest',
    )

    store.addFinanceRecord('income', {
      sourceName: 'John Keells',
      incomeType: 'Dividend income',
      incomeSubtype: 'dividend',
      stockHoldingId: 'holding-1',
      originalAmount: 250,
      originalCurrency: 'LKR',
      convertedLkrAmount: 250,
    })
    expect(store.readFinanceStore().income_records[1]).toMatchObject({
      incomeSubtype: 'dividend',
      stockHoldingId: 'holding-1',
    })
  })

  it('persists documentRef so the original uploaded contract can be retrieved later', async () => {
    const store = await import('./finance-store')
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
    store.addFinanceRecord('income_source', {
      employerName: 'X',
      employmentType: 'bogus',
    })
    const db = store.readFinanceStore()
    expect(db.income_sources[0].employmentType).toBe('other')
  })

  it('supports an income source with no monthlyIncomeAmount (irregular income)', async () => {
    const store = await import('./finance-store')
    store.addFinanceRecord('income_source', {
      employerName: 'Freelance Clients',
      employmentType: 'freelance',
    })
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
    expect(db.stock_holdings[0]).toMatchObject({
      symbol: 'JKH.N0000',
      quantity: 100,
      buyPrice: 150,
      priceSource: 'manual',
    })
    const id = db.stock_holdings[0].id

    store.updateFinanceRecord('stock_holding', id, {
      lastKnownPrice: 165,
      lastPriceUpdatedAt: '2026-09-10T10:00:00.000Z',
      priceSource: 'cse_api',
    })
    db = store.readFinanceStore()
    expect(db.stock_holdings[0]).toMatchObject({
      lastKnownPrice: 165,
      priceSource: 'cse_api',
    })
    expect(db.stock_holdings[0].priceHistory).toEqual([
      {
        price: 165,
        observedAt: '2026-09-10T10:00:00.000Z',
        source: 'cse_api',
      },
    ])

    store.updateFinanceRecord('stock_holding', id, {
      lastKnownPrice: 170,
      lastPriceUpdatedAt: '2026-09-11T10:00:00.000Z',
      priceSource: 'manual',
    })
    db = store.readFinanceStore()
    expect(db.stock_holdings[0].priceHistory).toHaveLength(2)
    expect(db.stock_holdings[0].priceHistory?.at(-1)).toMatchObject({
      price: 170,
      source: 'manual',
    })

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
      interestReceived: 2500,
      taxDeducted: 250,
      payoutAccountId: 'account-1',
      autoRenew: true,
      startDate: '2026-01-01',
      maturityDate: '2027-01-01',
    })
    let db = store.readFinanceStore()
    expect(db.fixed_deposits).toHaveLength(1)
    expect(db.fixed_deposits[0]).toMatchObject({
      bankName: 'Sampath Bank',
      principal: 500_000,
      interestReceived: 2500,
      taxDeducted: 250,
      payoutAccountId: 'account-1',
      autoRenew: true,
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

  it('adds, edits, then deletes a linked investment journal entry', async () => {
    const store = await import('./finance-store')
    store.addFinanceRecord('investment_journal', {
      stockHoldingId: 'holding-1',
      symbol: 'JKH.N0000',
      entryDate: '2026-09-10',
      entryType: 'thesis',
      content: 'Review earnings growth before adding exposure.',
      thesis: 'Earnings growth should support long-term value.',
      invalidationCondition: 'Two consecutive quarters of declining revenue.',
      nextReviewDate: '2026-12-10',
    })
    let db = store.readFinanceStore()
    expect(db.investment_journal[0]).toMatchObject({
      stockHoldingId: 'holding-1',
      entryType: 'thesis',
      content: 'Review earnings growth before adding exposure.',
      thesis: 'Earnings growth should support long-term value.',
      invalidationCondition: 'Two consecutive quarters of declining revenue.',
    })
    const id = db.investment_journal[0].id

    store.updateFinanceRecord('investment_journal', id, {
      entryType: 'review',
      content: 'Earnings still support the original thesis.',
    })
    db = store.readFinanceStore()
    expect(db.investment_journal[0]).toMatchObject({
      entryType: 'review',
      content: 'Earnings still support the original thesis.',
      nextReviewDate: '2026-12-10',
    })

    store.deleteFinanceRecord('investment_journal', id)
    expect(store.readFinanceStore().investment_journal).toHaveLength(0)
  })

  it('finds upload duplicates by checksum but permits rejected documents to retry', async () => {
    const store = await import('./finance-store')
    const checksum = 'a'.repeat(64)
    const pending = store.addPendingIngestion({
      source: 'upload',
      sourceRef: '/tmp/receipt.pdf',
      checksumSha256: checksum,
    })
    expect(store.findPendingIngestionByChecksum(checksum)?.id).toBe(pending.id)

    store.updatePendingIngestion(pending.id, { status: 'rejected' })
    expect(store.findPendingIngestionByChecksum(checksum)).toBeNull()
    expect(store.findPendingIngestionByChecksum('not-a-checksum')).toBeNull()
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
    const store = await import('./finance-store')
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
    const store = await import('./finance-store')
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
    const store = await import('./finance-store')
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
    const store = await import('./finance-store')
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
    const store = await import('./finance-store')
    store.addFinanceRecord('tag', { name: 'Work' })
    const db = store.readFinanceStore()
    expect(db.tags[0].notes).toBeUndefined()
  })

  it('round-trips tags on expense and income records through add/update', async () => {
    const store = await import('./finance-store')
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
    const store = await import('./finance-store')
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
    const store = await import('./finance-store')
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
    const store = await import('./finance-store')
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

describe('getUnifiedTransactions (PF-104 Unified Transaction Model)', () => {
  it('exports a formula-safe CSV for unified transactions', () => {
    const db = createEmptyFinanceDatabase()
    db.expense_records.push({
      id: 'csv-1',
      date: '2026-09-10',
      vendor: '=IMPORTDATA("secret")',
      category: 'Dining, out',
      currency: 'LKR',
      amount: 12,
      convertedLkrAmount: 12,
      recurring: false,
      workRelated: false,
      taxDeductiblePossible: false,
      notes: 'not exported',
      status: 'cleared',
      source: 'test',
      createdAt: '2026-09-10T00:00:00.000Z',
      updatedAt: '2026-09-10T00:00:00.000Z',
    })

    const csv = buildTransactionsCsv(db)
    expect(csv).toContain('"counterparty"')
    expect(csv).toContain('"\'=IMPORTDATA(""secret"")"')
    expect(csv).toContain('"Dining, out"')
    expect(csv).not.toContain('not exported')
  })

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
      transactionType: 'income',
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
      transactionType: 'expense',
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

  it('excludes transfer legs and soft-deleted expenses from agent aggregates', () => {
    const db = createEmptyFinanceDatabase()
    pushExpense(db, 0, 3000, 'Groceries', 'Store A')
    pushExpense(db, 0, 9000, 'Transfer', 'Own Account')
    const transfer = db.expense_records.at(-1)
    if (!transfer) throw new Error('expected transfer fixture')
    transfer.transactionType = 'transfer'

    pushExpense(db, 0, 7000, 'Deleted', 'Old Store')
    const deleted = db.expense_records.at(-1)
    if (!deleted) throw new Error('expected deleted fixture')
    deleted.deletedAt = '2026-09-11T00:00:00.000Z'

    const context = buildFinanceQueryContext(db)
    expect(context.categoryBreakdown.thisMonth).toEqual({ Groceries: 3000 })
    expect(context.topVendors.thisMonth).toEqual([
      { vendor: 'Store A', amount: 3000 },
    ])
  })

  it('passes through the already-tested summary and monthlySummary unchanged', () => {
    const db = createEmptyFinanceDatabase()
    const context = buildFinanceQueryContext(db)
    expect(context.summary).toEqual(financeSummary(db))
    expect(context.monthlySummary).toEqual(getMonthlySummary(db).slice(-6))
    expect(context.budgetVsActual).toEqual(budgetVsActualSummary(db))
    expect(context.budgetAlertThresholdPct).toBe(80)
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

describe('buildFinanceAgentContext (AI-109)', () => {
  it('returns versioned bounded aggregates and excludes task contents', () => {
    const db = createEmptyFinanceDatabase()
    db.ai_tasks.push({
      id: 'task-1',
      auditCorrelationId: 'task-1-correlation',
      taskType: 'review',
      title: 'Review',
      status: 'awaiting_approval',
      risk: 'high',
      requestedAction: 'commit',
      inputSummary: 'private input',
      resultSummary: 'private result',
      approvalRequired: true,
      source: 'test',
      createdAt: '2026-09-10T00:00:00.000Z',
      updatedAt: '2026-09-10T00:00:00.000Z',
    })

    const context = buildFinanceAgentContext(db)
    expect(context).toMatchObject({
      contextVersion: 'finance-agent-v1',
      sensitivity: 'aggregated_personal_finance',
      dataClassification: {
        'context.aiTaskSummary': 'internal',
        'credentials, tokens, and secrets': 'secret',
      },
      data: {
        aiTaskSummary: {
          total: 1,
          awaitingApproval: 1,
          highRisk: 1,
        },
      },
    })
    expect(JSON.stringify(context)).not.toContain('private input')
    expect(JSON.stringify(context)).not.toContain('private result')
    expect(context.excludedFields).toContain(
      'raw income/expense transaction rows',
    )
    expect(context.aiRoutingPolicy).toEqual({
      policyVersion: 'finance-ai-routing-v1',
      externalProvider: {
        allowedDataClasses: ['public', 'aggregated_personal_finance'],
        explicitUserActionRequired: ['personal', 'highly_sensitive'],
        prohibitedDataClasses: ['secret'],
      },
      agentContext: { rawRecordsAllowed: false, secretsAllowed: false },
    })
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
    expect(summary.stockHoldingsValueLkr).toBe(1200) // 10 * 120 (current price, not buy price)
    expect(summary.fixedDepositsValueLkr).toBe(50_000) // withdrawn FD excluded
    expect(summary.netWorthLkr).toBe(1200 + 50_000)
    expect(summary.liquidNetWorthLkr).toBe(1200)
    expect(summary.lockedWealthLkr).toBe(50_000)
  })

  it('converts foreign cash, holdings, deposits, and property using current dated FX', () => {
    const db = createEmptyFinanceDatabase()
    db.exchange_rates.push({
      base: 'LKR',
      target: 'USD',
      rate: 0.003,
      date: '2026-09-01',
    })
    db.finance_accounts.push({
      id: 'usd-cash',
      name: 'USD cash',
      type: 'bank',
      currency: 'USD',
      balance: 100,
      source: 'test',
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
    })
    db.stock_holdings.push({
      id: 'usd-stock',
      symbol: 'US-TEST',
      platform: 'Test',
      quantity: 2,
      buyPrice: 80,
      buyDate: '2026-01-01',
      currency: 'USD',
      lastKnownPrice: 100,
      priceSource: 'manual',
      source: 'test',
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
    })
    db.fixed_deposits.push({
      id: 'usd-fd',
      bankName: 'USD Bank',
      principal: 1_000,
      currency: 'USD',
      interestRatePct: 2,
      interestPayout: 'at_maturity',
      startDate: '2026-01-01',
      maturityDate: '2027-01-01',
      status: 'active',
      source: 'test',
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
    })

    const summary = financeSummary(db)
    expect(summary.cashBalanceLkr).toBeCloseTo(33_333.333, 3)
    expect(summary.stockHoldingsValueLkr).toBeCloseTo(66_666.667, 3)
    expect(summary.fixedDepositsValueLkr).toBeCloseTo(333_333.333, 3)
    expect(summary.unrealizedStockPnlLkr).toBeCloseTo(13_333.333, 3)
    db.settings.baseCurrency = 'USD'
    const usdSummary = financeSummary(db)
    expect(usdSummary.baseCurrency).toBe('USD')
    expect(usdSummary.baseSummary.netWorth).toBeCloseTo(1_300, 3)
    expect(usdSummary.baseSummary.stockHoldingsValue).toBeCloseTo(200, 3)
  })

  it('debtLkr (Phase 40) sums active loan currentBalance and card account balances, excluding loan-type accounts and paid-off loans', () => {
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
    expect(summary.debtLkr).toBe(75_000)
  })

  it('propertyValueLkr (Phase 40) sums current property values and adds to netWorthLkr', () => {
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
    expect(summary.propertyValueLkr).toBe(6_700_000)
    expect(summary.netWorthLkr).toBe(6_700_000)
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
    expect(summary.stockHoldingsValueLkr).toBe(1000) // 5 * 200 (buy price fallback)
  })

  it('computes unrealizedStockPnlLkr as (current - buy) * quantity, summed across holdings', () => {
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
    expect(summary.unrealizedStockPnlLkr).toBe(-50)
    // cost basis = 10*100 + 5*300 = 2500; pct = -50/2500*100 = -2
    expect(summary.unrealizedStockPnlPct).toBe(-2)
  })

  it('unrealizedStockPnlLkr is 0 when there is no cached current price (falls back to buy price)', () => {
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
    expect(summary.unrealizedStockPnlLkr).toBe(0)
    expect(summary.unrealizedStockPnlPct).toBe(0)
  })

  it('unrealizedStockPnlPct is 0 when there are no stock holdings (division-by-zero guard)', () => {
    const db = createEmptyFinanceDatabase()
    const summary = financeSummary(db)
    expect(summary.unrealizedStockPnlPct).toBe(0)
  })
})

// Postgres Migration Phase C/D: overlaySplitStores() tries Postgres first
// for personal-finance collections/settings; Phase D removed the JSON
// split-store middle tier, so a failed Postgres read now falls through to
// whatever's already in the base file (no explicit override). Mock
// readPersonalFinancePostgresStore (real Postgres access is already
// disabled under VITEST by that module's own guard, so without this mock
// these tests would just exercise the Postgres-unavailable path
// unconditionally) and isolate HOME so writeFinanceStore()/readFinanceStore()
// never touch the real ~/.hermes/finance store.
describe('overlaySplitStores (Postgres Migration Phase D)', () => {
  let tmp: string
  let realHome: string | undefined
  beforeEach(() => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'finance-store-pg-overlay-'))
    realHome = process.env.HOME
    process.env.HOME = tmp
    vi.resetModules()
  })
  afterEach(() => {
    if (realHome === undefined) delete process.env.HOME
    else process.env.HOME = realHome
    delete process.env.HERMES_PERSONAL_FINANCE_READ_SOURCE
    fs.rmSync(tmp, { recursive: true, force: true })
    vi.doUnmock('./personal-finance-postgres-store')
  })

  it('uses the Postgres result for personal-finance collections and settings when it succeeds', async () => {
    vi.doMock('./personal-finance-postgres-store', () => ({
      readPersonalFinancePostgresStore: () => ({
        finance_accounts: [{ id: 'pg-acc-1', name: 'From Postgres' }],
        income_records: [],
        expense_records: [],
        budget_categories: [],
        savings_goals: [],
        tax_records: [],
        exchange_rates: [],
        investment_accounts: [],
        pending_ingestions: [],
        income_sources: [],
        stock_holdings: [],
        fixed_deposits: [],
        personalFinanceSettings: {
          savingsRateTargetPct: 42,
          financeQaHistory: [{ at: 1, question: 'Q', answer: 'A' }],
        },
      }),
      writePersonalFinancePostgresStore: () => true,
    }))
    const store = await import('./finance-store')
    store.writeFinanceStore(store.createEmptyFinanceDatabase())

    const db = store.readFinanceStore()
    expect(db.finance_accounts).toEqual([
      { id: 'pg-acc-1', name: 'From Postgres' },
    ])
    expect(db.settings.savingsRateTargetPct).toBe(42)
    expect(db.settings.financeQaHistory).toEqual([
      { at: 1, question: 'Q', answer: 'A' },
    ])
  })

  it('falls back to the base file when the Postgres read returns null', async () => {
    vi.doMock('./personal-finance-postgres-store', () => ({
      readPersonalFinancePostgresStore: () => null,
      writePersonalFinancePostgresStore: () => true,
    }))
    const store = await import('./finance-store')
    store.addFinanceRecord('account', {
      name: 'From base file fallback',
      type: 'bank',
      currency: 'LKR',
      balance: 100,
    })

    const db = store.readFinanceStore()
    expect(db.finance_accounts).toHaveLength(1)
    expect(db.finance_accounts[0].name).toBe('From base file fallback')
  })

  it('HERMES_PERSONAL_FINANCE_READ_SOURCE=json bypasses Postgres even when it would succeed', async () => {
    process.env.HERMES_PERSONAL_FINANCE_READ_SOURCE = 'json'
    vi.doMock('./personal-finance-postgres-store', () => ({
      readPersonalFinancePostgresStore: () => ({
        finance_accounts: [{ id: 'pg-acc-1', name: 'Should be ignored' }],
        income_records: [],
        expense_records: [],
        budget_categories: [],
        savings_goals: [],
        tax_records: [],
        exchange_rates: [],
        investment_accounts: [],
        pending_ingestions: [],
        income_sources: [],
        stock_holdings: [],
        fixed_deposits: [],
      }),
      writePersonalFinancePostgresStore: () => true,
    }))
    const store = await import('./finance-store')
    store.addFinanceRecord('account', {
      name: 'From base file via kill switch',
      type: 'bank',
      currency: 'LKR',
      balance: 100,
    })

    const db = store.readFinanceStore()
    expect(
      db.finance_accounts.some((a) => a.name === 'Should be ignored'),
    ).toBe(false)
    expect(
      db.finance_accounts.some(
        (a) => a.name === 'From base file via kill switch',
      ),
    ).toBe(true)
  })
})
