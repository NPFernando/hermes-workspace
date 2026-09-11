import { useState } from 'react'
import { StatCard } from '../../finance/components/stat-card'
import { numberField, optionalNumberField, stringField } from '../field-helpers'
import { formatLkr } from '../utils'

export type BaselineForecast = {
  month: string
  incomeLkr: number
  expensesLkr: number
  netCashFlowLkr: number
}

export type CategoryForecast = {
  category: string
  averageMonthlyLkr: number
  nextThreeMonthsLkr: number
  monthsWithActivity: number
}

export type IncomeSourceForecast = {
  sourceId: string
  sourceName: string
  currency: string
  projectedMonthlyLkr: number
  recordedAverageMonthlyLkr: number
  basis: 'contract-monthly' | 'recorded-run-rate' | 'no-supported-data'
  paydayDayOfMonth?: number
  nextPayday?: string
}

export type RecurringExpenseForecast = {
  category: string
  monthlyCommitmentLkr: number
  lastRecordedMonth: string
  occurrenceCount: number
}

export type ForecastConfidence = {
  score: number
  level: 'low' | 'moderate' | 'high'
  reasons: Array<string>
}

export type ForecastAlert = {
  level: 'info' | 'warning' | 'critical'
  title: string
  detail: string
}

export type ForecastAccuracyRow = {
  month: string
  predictedNetCashFlowLkr: number
  actualNetCashFlowLkr: number
  absoluteErrorLkr: number
  errorPct: number
}

export type ForecastAccuracy = {
  evaluatedMonths: number
  meanAbsoluteErrorLkr: number
  meanAbsolutePercentageError: number
  rows: Array<ForecastAccuracyRow>
}

function isForecastRecord(record: Record<string, unknown>): boolean {
  return !record.deletedAt && stringField(record, 'transactionType') !== 'transfer'
}

/** PF-910: deterministic explanation from the forecast's own evidence. */
export function buildForecastExplanation(
  result: Pick<BaselineForecastResult, 'monthsWithActivity' | 'historicalMonths' | 'averageIncomeLkr' | 'averageExpensesLkr' | 'averageNetCashFlowLkr' | 'recurringCommitmentLkr' | 'categoryForecast' | 'confidence'>,
  accuracy: ForecastAccuracy,
): string {
  if (result.monthsWithActivity === 0) {
    return 'There is not enough recorded activity in the trailing complete-month window to explain a reliable forecast. Add complete income or expense months before relying on the projection.'
  }
  const direction = result.averageNetCashFlowLkr >= 0 ? 'positive' : 'negative'
  const coverage = `The baseline uses ${result.monthsWithActivity} of ${result.historicalMonths} trailing complete months and projects ${formatLkr(result.averageNetCashFlowLkr)} of ${direction} net cash flow per month.`
  const categorySentence = result.categoryForecast.length === 0
    ? 'No category has enough recorded expense data to identify a leading driver.'
    : `The largest recorded expense driver is ${result.categoryForecast[0].category}, projected at ${formatLkr(result.categoryForecast[0].nextThreeMonthsLkr)} over the next three months.`
  const commitmentSentence = result.recurringCommitmentLkr > 0
    ? `Recorded recurring commitments account for ${formatLkr(result.recurringCommitmentLkr)} per month.`
    : 'No explicit recurring expense commitments were recorded in the trailing window.'
  const accuracySentence = accuracy.evaluatedMonths > 0
    ? `Back-testing across ${accuracy.evaluatedMonths} prior month${accuracy.evaluatedMonths === 1 ? '' : 's'} shows a mean absolute error of ${formatLkr(accuracy.meanAbsoluteErrorLkr)}.`
    : 'Historical accuracy is not available yet because no prior complete month has enough recorded activity.'
  return `${coverage} Data confidence is ${result.confidence.level} (${result.confidence.score}/100). ${categorySentence} ${commitmentSentence} ${accuracySentence} This is a transparent run-rate, not a guarantee.`
}

function forecastCsvCell(value: string | number): string {
  const text = String(value)
  const safe = /^[=+\-@]/.test(text) ? `'${text}` : text
  return `"${safe.replaceAll('"', '""')}"`
}

/** PF-909: client-side, formula-safe export of the complete forecast report. */
export function buildForecastExportCsv(
  result: Pick<BaselineForecastResult, 'averageIncomeLkr' | 'averageExpensesLkr' | 'averageNetCashFlowLkr' | 'recurringCommitmentLkr' | 'confidence' | 'forecast' | 'categoryForecast' | 'incomeSourceForecast' | 'recurringExpenseForecast'>,
  comparison: Array<ScenarioComparison>,
  accuracy: ForecastAccuracy,
): string {
  const rows: Array<Array<string | number>> = [
    ['section', 'name', 'month', 'value', 'secondary', 'notes'],
    ['summary', 'average income', '', result.averageIncomeLkr, '', 'LKR per month'],
    ['summary', 'average expenses', '', result.averageExpensesLkr, '', 'LKR per month'],
    ['summary', 'average net cash flow', '', result.averageNetCashFlowLkr, '', 'LKR per month'],
    ['summary', 'recurring commitments', '', result.recurringCommitmentLkr, '', 'latest recorded monthly commitment'],
    ['confidence', 'score', '', result.confidence.score, result.confidence.level, 'data quality, not a guarantee'],
  ]
  for (const row of result.forecast) rows.push(['baseline', 'net cash flow', row.month, row.netCashFlowLkr, `${row.incomeLkr}/${row.expensesLkr}`, 'projected income/expenses'])
  for (const row of result.categoryForecast) rows.push(['category', row.category, '', row.nextThreeMonthsLkr, row.averageMonthlyLkr, 'next three months / monthly average'])
  for (const row of result.incomeSourceForecast) rows.push(['income source', row.sourceName, '', row.projectedMonthlyLkr, row.currency, row.basis])
  for (const row of result.recurringExpenseForecast) rows.push(['recurring expense', row.category, row.lastRecordedMonth, row.monthlyCommitmentLkr, row.occurrenceCount, 'latest recorded monthly commitment'])
  for (const row of comparison) rows.push(['scenario', row.name, '', row.forecast.horizonNetCashFlowLkr, `${row.forecast.incomeAdjustmentPct}/${row.forecast.expenseAdjustmentPct}`, row.description])
  for (const row of accuracy.rows) rows.push(['accuracy', 'net cash flow error', row.month, row.absoluteErrorLkr, row.errorPct, `${row.predictedNetCashFlowLkr}/${row.actualNetCashFlowLkr}`])
  rows.push(['accuracy', 'mean absolute error', '', accuracy.meanAbsoluteErrorLkr, '', `${accuracy.evaluatedMonths} evaluated months`])
  rows.push(['accuracy', 'mean absolute percentage error', '', accuracy.meanAbsolutePercentageError, '%', `${accuracy.evaluatedMonths} evaluated months`])
  return rows.map((row) => row.map(forecastCsvCell).join(',')).join('\n') + '\n'
}

export type ScenarioForecast = {
  incomeAdjustmentPct: number
  expenseAdjustmentPct: number
  monthlyIncomeLkr: number
  monthlyExpensesLkr: number
  monthlyNetCashFlowLkr: number
  horizonNetCashFlowLkr: number
  changeVsBaselineLkr: number
}

export type ScenarioComparison = {
  name: string
  description: string
  forecast: ScenarioForecast
}

export type BaselineForecastResult = {
  historicalMonths: number
  monthsWithActivity: number
  incomeRecordCount: number
  expenseRecordCount: number
  averageIncomeLkr: number
  averageExpensesLkr: number
  averageNetCashFlowLkr: number
  forecast: Array<BaselineForecast>
  categoryForecast: Array<CategoryForecast>
  incomeSourceForecast: Array<IncomeSourceForecast>
  recurringExpenseForecast: Array<RecurringExpenseForecast>
  recurringCommitmentLkr: number
  confidence: ForecastConfidence
}

function monthOffset(month: string, offset: number): string {
  const date = new Date(`${month}-01T12:00:00.000Z`)
  date.setUTCMonth(date.getUTCMonth() + offset)
  return date.toISOString().slice(0, 7)
}

/** PF-905: explicit, session-only scenario adjustment over the baseline. */
export function buildScenarioForecast(
  baseline: Pick<BaselineForecastResult, 'averageIncomeLkr' | 'averageExpensesLkr' | 'averageNetCashFlowLkr'>,
  incomeAdjustmentPct: number,
  expenseAdjustmentPct: number,
  horizonMonths = 3,
): ScenarioForecast {
  const incomeAdjustment = Math.max(-100, Math.min(100, incomeAdjustmentPct))
  const expenseAdjustment = Math.max(-100, Math.min(100, expenseAdjustmentPct))
  const monthlyIncomeLkr = Math.max(0, baseline.averageIncomeLkr * (1 + incomeAdjustment / 100))
  const monthlyExpensesLkr = Math.max(0, baseline.averageExpensesLkr * (1 + expenseAdjustment / 100))
  const roundedIncomeLkr = Math.round(monthlyIncomeLkr * 100) / 100
  const roundedExpensesLkr = Math.round(monthlyExpensesLkr * 100) / 100
  const monthlyNetCashFlowLkr = Math.round((roundedIncomeLkr - roundedExpensesLkr) * 100) / 100
  const horizonNetCashFlowLkr = Math.round(monthlyNetCashFlowLkr * Math.max(1, horizonMonths) * 100) / 100
  return {
    incomeAdjustmentPct: incomeAdjustment,
    expenseAdjustmentPct: expenseAdjustment,
    monthlyIncomeLkr: roundedIncomeLkr,
    monthlyExpensesLkr: roundedExpensesLkr,
    monthlyNetCashFlowLkr,
    horizonNetCashFlowLkr,
    changeVsBaselineLkr: Math.round((monthlyNetCashFlowLkr - baseline.averageNetCashFlowLkr) * 100) / 100,
  }
}

/** PF-906: named comparisons share the same explicit scenario calculation. */
export function buildScenarioComparison(
  baseline: Pick<BaselineForecastResult, 'averageIncomeLkr' | 'averageExpensesLkr' | 'averageNetCashFlowLkr'>,
): Array<ScenarioComparison> {
  return [
    { name: 'Baseline', description: 'Recorded run-rate', income: 0, expenses: 0 },
    { name: 'Cautious', description: 'Income -10%, expenses +10%', income: -10, expenses: 10 },
    { name: 'Stress', description: 'Income -20%, expenses +25%', income: -20, expenses: 25 },
    { name: 'Optimistic', description: 'Income +10%, expenses -10%', income: 10, expenses: -10 },
  ].map((scenario) => ({
    name: scenario.name,
    description: scenario.description,
    forecast: buildScenarioForecast(baseline, scenario.income, scenario.expenses),
  }))
}

/** PF-904: data-quality signal, not a statistical guarantee of accuracy. */
export function buildForecastConfidence(
  historicalMonths: number,
  monthsWithActivity: number,
  incomeRecordCount: number,
  expenseRecordCount: number,
): ForecastConfidence {
  const coveragePoints = Math.round(
    (Math.min(monthsWithActivity, historicalMonths) / Math.max(1, historicalMonths)) * 50,
  )
  const samplePoints = Math.min(
    30,
    Math.round(((incomeRecordCount + expenseRecordCount) / 12) * 30),
  )
  const repetitionPoints = monthsWithActivity >= 2 ? 20 : monthsWithActivity === 1 ? 10 : 0
  const score = Math.min(100, coveragePoints + samplePoints + repetitionPoints)
  const level = score >= 75 ? 'high' : score >= 45 ? 'moderate' : 'low'
  return {
    score,
    level,
    reasons: [
      `${monthsWithActivity} of ${historicalMonths} trailing months contain activity`,
      `${incomeRecordCount + expenseRecordCount} income and expense records support the estimate`,
      monthsWithActivity >= 2
        ? 'Activity repeats across multiple months'
        : 'More repeated monthly history is needed',
    ],
  }
}

/** PF-907: bounded, read-only alerts from forecast evidence only. */
export function buildForecastAlerts(
  forecast: Pick<BaselineForecastResult, 'averageIncomeLkr' | 'averageNetCashFlowLkr' | 'recurringCommitmentLkr' | 'confidence' | 'forecast'>,
): Array<ForecastAlert> {
  const alerts: Array<ForecastAlert> = []
  if (forecast.averageNetCashFlowLkr < 0) {
    alerts.push({
      level: 'critical',
      title: 'Baseline cash flow is negative',
      detail: `The recorded run-rate projects ${Math.abs(forecast.averageNetCashFlowLkr).toLocaleString()} LKR less cash flow per month.`,
    })
  } else if (forecast.forecast.some((row) => row.netCashFlowLkr < 0)) {
    alerts.push({
      level: 'warning',
      title: 'A projected month is negative',
      detail: 'At least one forward month has projected expenses above projected income.',
    })
  }
  if (forecast.confidence.level === 'low') {
    alerts.push({
      level: 'warning',
      title: 'Forecast evidence is sparse',
      detail: 'Treat the projection as directional until more complete months are recorded.',
    })
  }
  if (forecast.averageIncomeLkr > 0 && forecast.recurringCommitmentLkr > forecast.averageIncomeLkr * 0.6) {
    alerts.push({
      level: 'warning',
      title: 'Recurring commitments are concentrated',
      detail: `Recorded recurring commitments consume ${Math.round((forecast.recurringCommitmentLkr / forecast.averageIncomeLkr) * 100)}% of average monthly income.`,
    })
  }
  if (alerts.length === 0) {
    alerts.push({
      level: 'info',
      title: 'No forecast alert detected',
      detail: 'The baseline is currently positive and no configured alert threshold was crossed.',
    })
  }
  return alerts
}

/** PF-908: rolling out-of-sample back-test of the exact baseline method. */
export function buildForecastAccuracy(
  asOf: Date,
  incomeRecords: Array<Record<string, unknown>>,
  expenseRecords: Array<Record<string, unknown>>,
  evaluationMonths = 3,
  historicalMonths = 3,
): ForecastAccuracy {
  const currentMonth = asOf.toISOString().slice(0, 7)
  const rows: Array<ForecastAccuracyRow> = []
  for (let index = evaluationMonths; index >= 1; index -= 1) {
    const targetMonth = monthOffset(currentMonth, -index)
    const baseline = buildBaselineForecast(
      new Date(`${targetMonth}-15T12:00:00.000Z`),
      incomeRecords,
      expenseRecords,
      [],
      historicalMonths,
      1,
    )
    const predicted = Math.round(baseline.averageNetCashFlowLkr * 100) / 100
    const actualIncome = incomeRecords
      .filter((record) => isForecastRecord(record) && stringField(record, 'dateReceived').slice(0, 7) === targetMonth)
      .reduce((sum, record) => sum + numberField(record, 'convertedLkrAmount'), 0)
    const actualExpenses = expenseRecords
      .filter((record) => isForecastRecord(record) && stringField(record, 'date').slice(0, 7) === targetMonth)
      .reduce((sum, record) => sum + numberField(record, 'convertedLkrAmount'), 0)
    const actualRecordCount = incomeRecords.filter((record) => isForecastRecord(record) && stringField(record, 'dateReceived').slice(0, 7) === targetMonth).length + expenseRecords.filter((record) => isForecastRecord(record) && stringField(record, 'date').slice(0, 7) === targetMonth).length
    if (actualRecordCount === 0) continue
    const actual = actualIncome - actualExpenses
    const absoluteError = Math.round(Math.abs(predicted - actual) * 100) / 100
    rows.push({
      month: targetMonth,
      predictedNetCashFlowLkr: predicted,
      actualNetCashFlowLkr: actual,
      absoluteErrorLkr: absoluteError,
      errorPct: Math.round((absoluteError / Math.max(1, Math.abs(actual))) * 10000) / 100,
    })
  }
  return {
    evaluatedMonths: rows.length,
    meanAbsoluteErrorLkr: rows.length > 0 ? rows.reduce((sum, row) => sum + row.absoluteErrorLkr, 0) / rows.length : 0,
    meanAbsolutePercentageError: rows.length > 0 ? rows.reduce((sum, row) => sum + row.errorPct, 0) / rows.length : 0,
    rows,
  }
}

/** PF-900: transparent trailing-complete-month run-rate forecast. */
export function buildBaselineForecast(
  asOf: Date,
  incomeRecords: Array<Record<string, unknown>>,
  expenseRecords: Array<Record<string, unknown>>,
  incomeSources: Array<Record<string, unknown>> = [],
  historicalMonths = 3,
  horizonMonths = 3,
): BaselineForecastResult {
  const currentMonth = asOf.toISOString().slice(0, 7)
  const historical = Array.from({ length: Math.max(1, historicalMonths) }, (_, index) =>
    monthOffset(currentMonth, -(index + 1)),
  ).reverse()
  const incomeByMonth = new Map<string, number>(historical.map((month) => [month, 0]))
  const expensesByMonth = new Map<string, number>(historical.map((month) => [month, 0]))
  const categoryByMonth = new Map<string, Map<string, number>>()
  const recurringByMonth = new Map<string, Map<string, number>>()
  let incomeRecordCount = 0
  let expenseRecordCount = 0

  for (const record of incomeRecords) {
    const month = stringField(record, 'dateReceived').slice(0, 7)
    if (!incomeByMonth.has(month) || !isForecastRecord(record)) continue
    incomeByMonth.set(month, (incomeByMonth.get(month) ?? 0) + numberField(record, 'convertedLkrAmount'))
    incomeRecordCount += 1
  }
  for (const record of expenseRecords) {
    const month = stringField(record, 'date').slice(0, 7)
    if (!expensesByMonth.has(month) || !isForecastRecord(record)) continue
    const amount = numberField(record, 'convertedLkrAmount')
    expensesByMonth.set(month, (expensesByMonth.get(month) ?? 0) + amount)
    const category = stringField(record, 'category') || 'Other'
    const monthlyCategories = categoryByMonth.get(month) ?? new Map<string, number>()
    monthlyCategories.set(category, (monthlyCategories.get(category) ?? 0) + amount)
    categoryByMonth.set(month, monthlyCategories)
    if (record.recurring === true) {
      const recurringCategories = recurringByMonth.get(month) ?? new Map<string, number>()
      recurringCategories.set(category, (recurringCategories.get(category) ?? 0) + amount)
      recurringByMonth.set(month, recurringCategories)
    }
    expenseRecordCount += 1
  }

  const totalIncome = Array.from(incomeByMonth.values()).reduce((sum, amount) => sum + amount, 0)
  const totalExpenses = Array.from(expensesByMonth.values()).reduce((sum, amount) => sum + amount, 0)
  const averageIncomeLkr = totalIncome / historical.length
  const averageExpensesLkr = totalExpenses / historical.length
  const averageNetCashFlowLkr = averageIncomeLkr - averageExpensesLkr
  const forecast = Array.from({ length: Math.max(1, horizonMonths) }, (_, index) => {
    const month = monthOffset(currentMonth, index + 1)
    return {
      month,
      incomeLkr: averageIncomeLkr,
      expensesLkr: averageExpensesLkr,
      netCashFlowLkr: averageNetCashFlowLkr,
    }
  })
  const categoryTotals = new Map<string, { total: number; monthsWithActivity: number }>()
  for (const month of historical) {
    for (const [category, amount] of categoryByMonth.get(month) ?? []) {
      const current = categoryTotals.get(category) ?? { total: 0, monthsWithActivity: 0 }
      current.total += amount
      current.monthsWithActivity += amount > 0 ? 1 : 0
      categoryTotals.set(category, current)
    }
  }
  const categoryForecast = Array.from(categoryTotals.entries())
    .map(([category, values]) => ({
      category,
      averageMonthlyLkr: values.total / historical.length,
      nextThreeMonthsLkr: (values.total / historical.length) * Math.max(1, horizonMonths),
      monthsWithActivity: values.monthsWithActivity,
    }))
    .sort((a, b) => b.nextThreeMonthsLkr - a.nextThreeMonthsLkr)
  const sourceTotals = new Map<string, number>()
  for (const record of incomeRecords) {
    const month = stringField(record, 'dateReceived').slice(0, 7)
    if (!incomeByMonth.has(month) || !isForecastRecord(record)) continue
    const sourceId = stringField(record, 'incomeSourceId') || stringField(record, 'sourceName') || 'other-recorded-income'
    sourceTotals.set(sourceId, (sourceTotals.get(sourceId) ?? 0) + numberField(record, 'convertedLkrAmount'))
  }
  const incomeSourceForecast = incomeSources
    .filter((source) => ['active', 'notice_period'].includes(stringField(source, 'status') || 'active'))
    .map((source) => {
      const sourceId = stringField(source, 'id')
      const sourceName = stringField(source, 'employerName') || 'Income source'
      const monthlyIncomeAmount = optionalNumberField(source, 'monthlyIncomeAmount')
      const currency = stringField(source, 'currency') || 'LKR'
      const recordedTotal = sourceTotals.get(sourceId) ?? sourceTotals.get(sourceName) ?? 0
      const recordedAverageMonthlyLkr = recordedTotal / historical.length
      const hasContractAmount = currency === 'LKR' && monthlyIncomeAmount !== undefined && monthlyIncomeAmount > 0
      const paydayDayOfMonth = optionalNumberField(source, 'expectedPaydayDayOfMonth')
      return {
        sourceId,
        sourceName,
        currency,
        projectedMonthlyLkr: hasContractAmount ? monthlyIncomeAmount : recordedAverageMonthlyLkr,
        recordedAverageMonthlyLkr,
        basis: hasContractAmount
          ? 'contract-monthly' as const
          : recordedAverageMonthlyLkr > 0
            ? 'recorded-run-rate' as const
            : 'no-supported-data' as const,
        paydayDayOfMonth: paydayDayOfMonth !== undefined ? Math.round(paydayDayOfMonth) : undefined,
        nextPayday: paydayDayOfMonth !== undefined ? nextPayday(asOf, Math.max(1, Math.min(31, Math.round(paydayDayOfMonth)))) : undefined,
      }
    })
    .sort((a, b) => b.projectedMonthlyLkr - a.projectedMonthlyLkr)
  const recurringCategories = new Set(
    Array.from(recurringByMonth.values()).flatMap((month) => Array.from(month.keys())),
  )
  const recurringExpenseForecast = Array.from(recurringCategories)
    .map((category) => {
      const latestMonth = [...historical].reverse().find(
        (month) => (recurringByMonth.get(month)?.get(category) ?? 0) > 0,
      )
      const monthlyCommitmentLkr = latestMonth
        ? recurringByMonth.get(latestMonth)?.get(category) ?? 0
        : 0
      const occurrenceCount = historical.reduce(
        (count, month) => count + (recurringByMonth.get(month)?.has(category) ? 1 : 0),
        0,
      )
      return {
        category,
        monthlyCommitmentLkr,
        lastRecordedMonth: latestMonth ?? historical[historical.length - 1],
        occurrenceCount,
      }
    })
    .filter((row) => row.monthlyCommitmentLkr > 0)
    .sort((a, b) => b.monthlyCommitmentLkr - a.monthlyCommitmentLkr)
  const confidence = buildForecastConfidence(
    historical.length,
    historical.filter(
      (month) => (incomeByMonth.get(month) ?? 0) > 0 || (expensesByMonth.get(month) ?? 0) > 0,
    ).length,
    incomeRecordCount,
    expenseRecordCount,
  )

  return {
    historicalMonths: historical.length,
    monthsWithActivity: historical.filter(
      (month) => (incomeByMonth.get(month) ?? 0) > 0 || (expensesByMonth.get(month) ?? 0) > 0,
    ).length,
    incomeRecordCount,
    expenseRecordCount,
    averageIncomeLkr,
    averageExpensesLkr,
    averageNetCashFlowLkr,
    forecast,
    categoryForecast,
    incomeSourceForecast,
    recurringExpenseForecast,
    recurringCommitmentLkr: recurringExpenseForecast.reduce(
      (sum, row) => sum + row.monthlyCommitmentLkr,
      0,
    ),
    confidence,
  }
}

function monthLabel(month: string): string {
  const date = new Date(`${month}-01T12:00:00.000Z`)
  return date.toLocaleDateString('en-LK', { month: 'short', year: 'numeric', timeZone: 'UTC' })
}

function nextPayday(asOf: Date, day: number): string {
  const monthStart = new Date(Date.UTC(asOf.getUTCFullYear(), asOf.getUTCMonth(), 1, 12))
  const lastDay = (year: number, month: number) => new Date(Date.UTC(year, month + 1, 0)).getUTCDate()
  const candidate = new Date(monthStart)
  candidate.setUTCDate(Math.min(day, lastDay(candidate.getUTCFullYear(), candidate.getUTCMonth())))
  if (candidate <= asOf) {
    candidate.setUTCMonth(candidate.getUTCMonth() + 1, 1)
    candidate.setUTCDate(Math.min(day, lastDay(candidate.getUTCFullYear(), candidate.getUTCMonth())))
  }
  return candidate.toISOString().slice(0, 10)
}

export function ForecastingPanel({
  incomeRecords,
  expenseRecords,
  incomeSources,
}: {
  incomeRecords: Array<Record<string, unknown>>
  expenseRecords: Array<Record<string, unknown>>
  incomeSources: Array<Record<string, unknown>>
}) {
  const [scenarioIncomePct, setScenarioIncomePct] = useState(0)
  const [scenarioExpensePct, setScenarioExpensePct] = useState(0)
  const asOf = new Date()
  const result = buildBaselineForecast(asOf, incomeRecords, expenseRecords, incomeSources)
  const scenario = buildScenarioForecast(result, scenarioIncomePct, scenarioExpensePct)
  const comparison = buildScenarioComparison(result)
  const forecastAlerts = buildForecastAlerts(result)
  const accuracy = buildForecastAccuracy(asOf, incomeRecords, expenseRecords)
  const explanation = buildForecastExplanation(result, accuracy)

  function downloadForecast() {
    const csv = buildForecastExportCsv(result, comparison, accuracy)
    const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }))
    const anchor = document.createElement('a')
    anchor.href = url
    anchor.download = `forecast-report-${asOf.toISOString().slice(0, 10)}.csv`
    document.body.appendChild(anchor)
    anchor.click()
    anchor.remove()
    URL.revokeObjectURL(url)
  }
  const coverage = result.monthsWithActivity === 0
    ? 'No recorded activity in the trailing window'
    : `${result.monthsWithActivity} of ${result.historicalMonths} trailing complete months contain recorded activity`

  return (
    <section className="mt-6 rounded-3xl border border-[var(--theme-border)] bg-[var(--theme-panel)]/70 p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold">Baseline cash-flow forecast</h2>
          <p className="mt-1 text-xs text-[var(--theme-muted)]">
            A transparent run-rate from the last three complete months. It does not invent bills, salary changes, or investment returns.
          </p>
          <p className="mt-1 text-xs text-[var(--theme-muted)]">
            Forecast amounts are shown in LKR; base-currency conversion is not applied to these projections.
          </p>
        </div>
        <button type="button" onClick={downloadForecast} className="rounded-xl border border-[var(--theme-border)] px-3 py-2 text-xs font-medium hover:bg-[color-mix(in_srgb,var(--theme-text)_8%,transparent)]">
          Export forecast CSV
        </button>
        <span className="rounded-full border border-[var(--theme-border)] px-2.5 py-1 text-xs text-[var(--theme-muted)]">
          {coverage}
        </span>
      </div>
      <div className="mt-3 rounded-2xl border border-[var(--theme-border)]/60 p-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <h3 className="text-sm font-semibold">Data confidence: {result.confidence.level}</h3>
            <p className="mt-1 text-xs text-[var(--theme-muted)]">Score {result.confidence.score}/100; this measures evidence coverage, not forecast certainty.</p>
          </div>
          <div className="h-2 w-32 overflow-hidden rounded-full bg-[color-mix(in_srgb,var(--theme-text)_12%,transparent)]">
            <div className="h-full rounded-full bg-[var(--theme-accent)]" style={{ width: `${result.confidence.score}%` }} />
          </div>
        </div>
        <ul className="mt-2 grid gap-1 text-xs text-[var(--theme-muted)] sm:grid-cols-3">
          {result.confidence.reasons.map((reason) => <li key={reason}>• {reason}</li>)}
        </ul>
      </div>
      <div className="mt-4 rounded-2xl border border-[var(--theme-border)]/60 p-3">
        <h3 className="text-sm font-semibold">Scenario inputs</h3>
        <p className="mt-1 text-xs text-[var(--theme-muted)]">
          Adjust the verified baseline for a what-if view. These controls are session-only and do not change recorded income, expenses, or budgets.
        </p>
        <div className="mt-3 grid gap-3 sm:grid-cols-2">
          <label className="text-xs text-[var(--theme-muted)]">
            Income change: <span className="font-semibold text-[var(--theme-text)]">{scenarioIncomePct}%</span>
            <input
              type="range"
              min="-50"
              max="50"
              step="5"
              value={scenarioIncomePct}
              onChange={(event) => setScenarioIncomePct(Number(event.target.value))}
              className="mt-2 w-full accent-[var(--theme-accent)]"
            />
          </label>
          <label className="text-xs text-[var(--theme-muted)]">
            Expense change: <span className="font-semibold text-[var(--theme-text)]">{scenarioExpensePct}%</span>
            <input
              type="range"
              min="-50"
              max="50"
              step="5"
              value={scenarioExpensePct}
              onChange={(event) => setScenarioExpensePct(Number(event.target.value))}
              className="mt-2 w-full accent-[var(--theme-accent)]"
            />
          </label>
        </div>
        <div className="mt-3 grid gap-2 sm:grid-cols-3">
          <StatCard label="Scenario monthly net" value={formatLkr(scenario.monthlyNetCashFlowLkr)} tone={scenario.monthlyNetCashFlowLkr >= 0 ? 'good' : 'danger'} />
          <StatCard label="Scenario 3-month net" value={formatLkr(scenario.horizonNetCashFlowLkr)} tone={scenario.horizonNetCashFlowLkr >= 0 ? 'good' : 'danger'} />
          <StatCard label="Change vs baseline" value={formatLkr(scenario.changeVsBaselineLkr)} tone={scenario.changeVsBaselineLkr >= 0 ? 'good' : 'warn'} />
        </div>
        <div className="mt-4 grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
          {comparison.map((row) => (
            <div key={row.name} className="rounded-xl border border-[var(--theme-border)]/60 p-2.5 text-xs">
              <div className="font-semibold">{row.name}</div>
              <div className="mt-1 text-[var(--theme-muted)]">{row.description}</div>
              <div className="mt-1 font-medium">3-month net {formatLkr(row.forecast.horizonNetCashFlowLkr)}</div>
            </div>
          ))}
        </div>
      </div>
      <div className="mt-4 grid gap-3 sm:grid-cols-3">
        <StatCard label="Avg monthly income" value={formatLkr(result.averageIncomeLkr)} tone="good" />
        <StatCard label="Avg monthly expenses" value={formatLkr(result.averageExpensesLkr)} tone={result.averageExpensesLkr > result.averageIncomeLkr ? 'danger' : 'warn'} />
        <StatCard label="Avg net cash flow" value={formatLkr(result.averageNetCashFlowLkr)} tone={result.averageNetCashFlowLkr >= 0 ? 'good' : 'danger'} />
      </div>
      <div className="mt-4 grid gap-2 sm:grid-cols-2">
        {forecastAlerts.map((alert) => (
          <div
            key={`${alert.level}-${alert.title}`}
            className={`rounded-xl border p-3 text-xs ${
              alert.level === 'critical'
                ? 'border-[var(--theme-danger)]/60 bg-[color-mix(in_srgb,var(--theme-danger)_8%,transparent)]'
                : alert.level === 'warning'
                  ? 'border-[var(--theme-warning)]/60 bg-[color-mix(in_srgb,var(--theme-warning)_8%,transparent)]'
                  : 'border-[var(--theme-border)]/60'
            }`}
          >
            <div className="font-semibold">{alert.title}</div>
            <div className="mt-1 text-[var(--theme-muted)]">{alert.detail}</div>
          </div>
        ))}
      </div>
      <div className="mt-4 rounded-2xl border border-[var(--theme-border)]/60 p-3">
        <h3 className="text-sm font-semibold">Forecast explanation</h3>
        <p className="mt-2 text-sm leading-6 text-[var(--theme-text)]">{explanation}</p>
      </div>
      {accuracy.evaluatedMonths > 0 && (
        <div className="mt-4 rounded-2xl border border-[var(--theme-border)]/60 p-3">
          <h3 className="text-sm font-semibold">Forecast accuracy history</h3>
          <p className="mt-1 text-xs text-[var(--theme-muted)]">
            Rolling back-test of the same baseline method against {accuracy.evaluatedMonths} prior complete month{accuracy.evaluatedMonths === 1 ? '' : 's'} with recorded activity.
          </p>
          <div className="mt-2 grid gap-2 sm:grid-cols-2">
            <span className="rounded-xl bg-[color-mix(in_srgb,var(--theme-text)_6%,transparent)] p-2 text-xs">Mean absolute error: {formatLkr(accuracy.meanAbsoluteErrorLkr)}</span>
            <span className="rounded-xl bg-[color-mix(in_srgb,var(--theme-text)_6%,transparent)] p-2 text-xs">Mean absolute percentage error: {accuracy.meanAbsolutePercentageError.toFixed(1)}%</span>
          </div>
          <div className="mt-2 grid gap-1 text-xs text-[var(--theme-muted)]">
            {accuracy.rows.map((row) => <div key={row.month}>{row.month}: predicted {formatLkr(row.predictedNetCashFlowLkr)}, actual {formatLkr(row.actualNetCashFlowLkr)}, error {formatLkr(row.absoluteErrorLkr)}</div>)}
          </div>
        </div>
      )}
      <div className="mt-4 grid gap-2 sm:grid-cols-3">
        {result.forecast.map((row) => (
          <div key={row.month} className="rounded-xl border border-[var(--theme-border)]/60 p-3 text-xs">
            <div className="font-semibold">{monthLabel(row.month)}</div>
            <div className="mt-1 text-[var(--theme-muted)]">Income {formatLkr(row.incomeLkr)}</div>
            <div className="text-[var(--theme-muted)]">Expenses {formatLkr(row.expensesLkr)}</div>
            <div className={`mt-1 font-medium ${row.netCashFlowLkr >= 0 ? 'text-[var(--theme-success)]' : 'text-[var(--theme-danger)]'}`}>
              Net {formatLkr(row.netCashFlowLkr)}
            </div>
          </div>
        ))}
      </div>
      {result.categoryForecast.length > 0 && (
        <div className="mt-4 rounded-2xl border border-[var(--theme-border)]/60 p-3">
          <h3 className="text-sm font-semibold">Category outlook</h3>
          <p className="mt-1 text-xs text-[var(--theme-muted)]">
            Projected three-month expense by category, using each category’s recorded trailing run-rate.
          </p>
          <div className="mt-2 grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
            {result.categoryForecast.slice(0, 9).map((row) => (
              <div key={row.category} className="rounded-xl bg-[color-mix(in_srgb,var(--theme-text)_6%,transparent)] p-2.5 text-xs">
                <div className="font-semibold">{row.category}</div>
                <div className="mt-1 text-[var(--theme-muted)]">Avg {formatLkr(row.averageMonthlyLkr)} / month</div>
                <div className="font-medium">Next 3 months {formatLkr(row.nextThreeMonthsLkr)}</div>
                <div className="text-[var(--theme-muted)]">Recorded in {row.monthsWithActivity} month{row.monthsWithActivity === 1 ? '' : 's'}</div>
              </div>
            ))}
          </div>
        </div>
      )}
      {result.incomeSourceForecast.length > 0 && (
        <div className="mt-4 rounded-2xl border border-[var(--theme-border)]/60 p-3">
          <h3 className="text-sm font-semibold">Income source outlook</h3>
          <p className="mt-1 text-xs text-[var(--theme-muted)]">
            Uses a documented monthly LKR amount when present; otherwise it falls back to recorded income history. Payday dates are reminders, not guaranteed deposits.
          </p>
          <div className="mt-2 grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
            {result.incomeSourceForecast.map((row) => (
              <div key={row.sourceId} className="rounded-xl bg-[color-mix(in_srgb,var(--theme-text)_6%,transparent)] p-2.5 text-xs">
                <div className="font-semibold">{row.sourceName}</div>
                <div className="mt-1 font-medium">Projected {formatLkr(row.projectedMonthlyLkr)} / month</div>
                <div className="text-[var(--theme-muted)]">Basis: {row.basis.replaceAll('-', ' ')}</div>
                {row.nextPayday && <div className="text-[var(--theme-muted)]">Next expected payday: {row.nextPayday}</div>}
              </div>
            ))}
          </div>
        </div>
      )}
      {result.recurringExpenseForecast.length > 0 && (
        <div className="mt-4 rounded-2xl border border-[var(--theme-border)]/60 p-3">
          <h3 className="text-sm font-semibold">Recorded recurring commitments</h3>
          <p className="mt-1 text-xs text-[var(--theme-muted)]">
            {formatLkr(result.recurringCommitmentLkr)} per month from the latest recorded recurring expense in each category. Unrecorded bills are excluded.
          </p>
          <div className="mt-2 grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
            {result.recurringExpenseForecast.map((row) => (
              <div key={row.category} className="rounded-xl bg-[color-mix(in_srgb,var(--theme-text)_6%,transparent)] p-2.5 text-xs">
                <div className="font-semibold">{row.category}</div>
                <div className="mt-1 font-medium">{formatLkr(row.monthlyCommitmentLkr)} / month</div>
                <div className="text-[var(--theme-muted)]">Latest: {row.lastRecordedMonth} · seen in {row.occurrenceCount} month{row.occurrenceCount === 1 ? '' : 's'}</div>
              </div>
            ))}
          </div>
        </div>
      )}
      <p className="mt-3 text-[11px] text-[var(--theme-muted)]">
        Based on {result.incomeRecordCount} income and {result.expenseRecordCount} expense records. This is a baseline, not a promise; add more complete-month data for a stronger signal.
      </p>
    </section>
  )
}
