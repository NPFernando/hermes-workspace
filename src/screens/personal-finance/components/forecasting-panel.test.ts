import { describe, expect, it } from 'vitest'
import { buildBaselineForecast, buildForecastAccuracy, buildForecastAlerts, buildForecastConfidence, buildForecastExplanation, buildForecastExportCsv, buildScenarioComparison, buildScenarioForecast } from './forecasting-panel'

describe('buildForecastConfidence', () => {
  it('rewards repeated coverage and downgrades sparse data', () => {
    expect(buildForecastConfidence(3, 3, 3, 3)).toMatchObject({ score: 85, level: 'high' })
    expect(buildForecastConfidence(3, 0, 0, 0)).toMatchObject({ score: 0, level: 'low' })
  })
})

describe('buildForecastAlerts', () => {
  it('raises negative cash flow and sparse-evidence alerts', () => {
    const alerts = buildForecastAlerts({
      averageIncomeLkr: 100_000,
      averageNetCashFlowLkr: -10_000,
      recurringCommitmentLkr: 70_000,
      confidence: { score: 20, level: 'low', reasons: [] },
      forecast: [{ month: '2026-10', incomeLkr: 100_000, expensesLkr: 110_000, netCashFlowLkr: -10_000 }],
    })
    expect(alerts.map((alert) => alert.title)).toEqual([
      'Baseline cash flow is negative',
      'Forecast evidence is sparse',
      'Recurring commitments are concentrated',
    ])
  })

  it('returns an informational result when no threshold is crossed', () => {
    expect(buildForecastAlerts({
      averageIncomeLkr: 100_000,
      averageNetCashFlowLkr: 40_000,
      recurringCommitmentLkr: 10_000,
      confidence: { score: 85, level: 'high', reasons: [] },
      forecast: [{ month: '2026-10', incomeLkr: 100_000, expensesLkr: 60_000, netCashFlowLkr: 40_000 }],
    })).toEqual([{ level: 'info', title: 'No forecast alert detected', detail: 'The baseline is currently positive and no configured alert threshold was crossed.' }])
  })
})

describe('buildForecastAccuracy', () => {
  it('back-tests prior complete months and reports absolute errors', () => {
    const accuracy = buildForecastAccuracy(
      new Date('2026-09-15T12:00:00.000Z'),
      [
        { dateReceived: '2026-05-10', convertedLkrAmount: 100_000 },
        { dateReceived: '2026-06-10', convertedLkrAmount: 100_000 },
        { dateReceived: '2026-07-10', convertedLkrAmount: 120_000 },
        { dateReceived: '2026-08-10', convertedLkrAmount: 80_000 },
      ],
      [
        { date: '2026-05-11', convertedLkrAmount: 50_000 },
        { date: '2026-06-11', convertedLkrAmount: 50_000 },
        { date: '2026-07-11', convertedLkrAmount: 60_000 },
        { date: '2026-08-11', convertedLkrAmount: 70_000 },
      ],
      2,
      2,
    )
    expect(accuracy.evaluatedMonths).toBe(2)
    expect(accuracy.rows.map((row) => row.month)).toEqual(['2026-07', '2026-08'])
    expect(accuracy.rows[0].absoluteErrorLkr).toBe(10_000)
    expect(accuracy.rows[1].absoluteErrorLkr).toBe(45_000)
    expect(accuracy.meanAbsoluteErrorLkr).toBe(27_500)
  })

  it('skips months with no recorded activity', () => {
    expect(buildForecastAccuracy(new Date('2026-09-15T12:00:00.000Z'), [], []).evaluatedMonths).toBe(0)
  })
})

describe('buildForecastExportCsv', () => {
  it('exports forecast sections and neutralizes formula-like text', () => {
    const csv = buildForecastExportCsv(
      {
        averageIncomeLkr: 100_000,
        averageExpensesLkr: 60_000,
        averageNetCashFlowLkr: 40_000,
        recurringCommitmentLkr: 20_000,
        confidence: { score: 80, level: 'high', reasons: [] },
        forecast: [{ month: '2026-10', incomeLkr: 100_000, expensesLkr: 60_000, netCashFlowLkr: 40_000 }],
        categoryForecast: [{ category: '=unsafe', averageMonthlyLkr: 10_000, nextThreeMonthsLkr: 30_000, monthsWithActivity: 3 }],
        incomeSourceForecast: [],
        recurringExpenseForecast: [],
      },
      [],
      { evaluatedMonths: 0, meanAbsoluteErrorLkr: 0, meanAbsolutePercentageError: 0, rows: [] },
    )
    expect(csv).toContain('"section","name","month","value","secondary","notes"')
    expect(csv).toContain('"\'=unsafe"')
    expect(csv).toContain('"baseline","net cash flow","2026-10"')
  })
})

describe('buildForecastExplanation', () => {
  it('explains evidence, drivers, commitments, and measured accuracy', () => {
    const explanation = buildForecastExplanation(
      {
        monthsWithActivity: 3,
        historicalMonths: 3,
        averageIncomeLkr: 100_000,
        averageExpensesLkr: 60_000,
        averageNetCashFlowLkr: 40_000,
        recurringCommitmentLkr: 20_000,
        categoryForecast: [{ category: 'Food', averageMonthlyLkr: 10_000, nextThreeMonthsLkr: 30_000, monthsWithActivity: 3 }],
        confidence: { score: 85, level: 'high', reasons: [] },
      },
      { evaluatedMonths: 2, meanAbsoluteErrorLkr: 5_000, meanAbsolutePercentageError: 10, rows: [] },
    )
    expect(explanation).toContain('positive net cash flow')
    expect(explanation).toContain('Food')
    expect(explanation).toContain('LKR 20,000')
    expect(explanation).toContain('mean absolute error of LKR 5,000')
  })

  it('does not overstate a forecast with no activity', () => {
    expect(buildForecastExplanation(
      {
        monthsWithActivity: 0,
        historicalMonths: 3,
        averageIncomeLkr: 0,
        averageExpensesLkr: 0,
        averageNetCashFlowLkr: 0,
        recurringCommitmentLkr: 0,
        categoryForecast: [],
        confidence: { score: 0, level: 'low', reasons: [] },
      },
      { evaluatedMonths: 0, meanAbsoluteErrorLkr: 0, meanAbsolutePercentageError: 0, rows: [] },
    )).toContain('not enough recorded activity')
  })
})

describe('buildScenarioForecast', () => {
  it('applies explicit income and expense adjustments without mutating the baseline', () => {
    const baseline = { averageIncomeLkr: 100_000, averageExpensesLkr: 60_000, averageNetCashFlowLkr: 40_000 }
    expect(buildScenarioForecast(baseline, 10, 20)).toEqual({
      incomeAdjustmentPct: 10,
      expenseAdjustmentPct: 20,
      monthlyIncomeLkr: 110_000,
      monthlyExpensesLkr: 72_000,
      monthlyNetCashFlowLkr: 38_000,
      horizonNetCashFlowLkr: 114_000,
      changeVsBaselineLkr: -2_000,
    })
    expect(baseline).toEqual({ averageIncomeLkr: 100_000, averageExpensesLkr: 60_000, averageNetCashFlowLkr: 40_000 })
  })
})

describe('buildScenarioComparison', () => {
  it('returns named baseline and what-if comparisons from one baseline', () => {
    const comparison = buildScenarioComparison({
      averageIncomeLkr: 100_000,
      averageExpensesLkr: 60_000,
      averageNetCashFlowLkr: 40_000,
    })
    expect(comparison.map((row) => row.name)).toEqual(['Baseline', 'Cautious', 'Stress', 'Optimistic'])
    expect(comparison[0].forecast.horizonNetCashFlowLkr).toBe(120_000)
    expect(comparison[2].forecast.monthlyNetCashFlowLkr).toBe(5_000)
  })
})

describe('buildBaselineForecast', () => {
  it('uses complete trailing months and projects a transparent average', () => {
    const result = buildBaselineForecast(
      new Date('2026-09-15T12:00:00.000Z'),
      [
        { dateReceived: '2026-06-10', convertedLkrAmount: 100_000 },
        { dateReceived: '2026-07-10', convertedLkrAmount: 120_000 },
        { dateReceived: '2026-08-10', convertedLkrAmount: 110_000 },
      ],
      [
        { date: '2026-06-12', convertedLkrAmount: 60_000 },
        { date: '2026-07-12', convertedLkrAmount: 70_000, category: 'Food', recurring: true },
        { date: '2026-08-12', convertedLkrAmount: 80_000 },
      ],
      [
        {
          id: 'salary',
          employerName: 'Acme Ltd',
          monthlyIncomeAmount: 115_000,
          currency: 'LKR',
          expectedPaydayDayOfMonth: 15,
          status: 'active',
        },
      ],
    )
    expect(result.monthsWithActivity).toBe(3)
    expect(result.averageIncomeLkr).toBe(110_000)
    expect(result.averageExpensesLkr).toBe(70_000)
    expect(result.averageNetCashFlowLkr).toBe(40_000)
    expect(result.categoryForecast).toEqual([
      { category: 'Other', averageMonthlyLkr: 46_666.666666666664, nextThreeMonthsLkr: 140_000, monthsWithActivity: 2 },
      { category: 'Food', averageMonthlyLkr: 23_333.333333333332, nextThreeMonthsLkr: 70_000, monthsWithActivity: 1 },
    ])
    expect(result.incomeSourceForecast[0]).toMatchObject({
      sourceId: 'salary',
      sourceName: 'Acme Ltd',
      projectedMonthlyLkr: 115_000,
      basis: 'contract-monthly',
      nextPayday: '2026-10-15',
    })
    expect(result.recurringExpenseForecast).toEqual([
      { category: 'Food', monthlyCommitmentLkr: 70_000, lastRecordedMonth: '2026-07', occurrenceCount: 1 },
    ])
    expect(result.recurringCommitmentLkr).toBe(70_000)
    expect(result.forecast.map((row) => row.month)).toEqual(['2026-10', '2026-11', '2026-12'])
  })

  it('excludes transfers and does not fabricate a forecast from current-month-only data', () => {
    const result = buildBaselineForecast(
      new Date('2026-09-15T12:00:00.000Z'),
      [{ dateReceived: '2026-09-10', convertedLkrAmount: 500_000 }],
      [{ date: '2026-08-10', convertedLkrAmount: 20_000, transactionType: 'transfer' }],
    )
    expect(result.monthsWithActivity).toBe(0)
    expect(result.incomeRecordCount).toBe(0)
    expect(result.expenseRecordCount).toBe(0)
    expect(result.averageNetCashFlowLkr).toBe(0)
    expect(result.categoryForecast).toEqual([])
    expect(result.incomeSourceForecast).toEqual([])
    expect(result.recurringExpenseForecast).toEqual([])
    expect(result.recurringCommitmentLkr).toBe(0)
  })

  it('excludes soft-deleted rows from forecast history and accuracy coverage', () => {
    const result = buildBaselineForecast(
      new Date('2026-09-15T12:00:00.000Z'),
      [{ dateReceived: '2026-08-10', convertedLkrAmount: 500_000, deletedAt: '2026-08-11T00:00:00Z' }],
      [{ date: '2026-08-10', convertedLkrAmount: 200_000, deletedAt: '2026-08-11T00:00:00Z' }],
    )
    expect(result.monthsWithActivity).toBe(0)
    expect(result.incomeRecordCount).toBe(0)
    expect(result.expenseRecordCount).toBe(0)
    expect(buildForecastAccuracy(
      new Date('2026-09-15T12:00:00.000Z'),
      [{ dateReceived: '2026-08-10', convertedLkrAmount: 500_000, deletedAt: '2026-08-11T00:00:00Z' }],
      [],
      1,
      1,
    ).evaluatedMonths).toBe(0)
  })
})
