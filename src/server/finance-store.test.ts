import { describe, expect, it } from 'vitest'
import {
  buildFinanceStorageHealth,
  budgetVsActualSummary,
  createEmptyFinanceDatabase,
  createTradingPlan,
  financeAlerts,
  financeSummary,
  financeStorageAlerts,
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
