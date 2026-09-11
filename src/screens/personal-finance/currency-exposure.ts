import { convertWithExchangeRates, normalizeDisplayCurrency } from './utils'
import { optionalNumberField as numberField, stringField } from './field-helpers'
import type { PersonalFinancePayload } from './types'

export type CurrencyExposureRow = {
  currency: string
  amount: number
  baseAmount?: number
}

/** PF-209: groups tracked exposure and adds a dated, read-only conversion when available. */
export function currencyExposure(
  payload: PersonalFinancePayload,
): Array<CurrencyExposureRow> {
  const totals = new Map<string, number>()
  const add = (currency: string, amount: number) => {
    const normalized = normalizeDisplayCurrency(currency)
    totals.set(normalized, (totals.get(normalized) ?? 0) + amount)
  }

  for (const job of payload.data.income_sources) {
    if (!['active', 'notice_period'].includes(stringField(job, 'status') || 'active')) continue
    const amount = numberField(job, 'monthlyIncomeAmount')
    if (amount !== undefined) add(stringField(job, 'currency') || 'LKR', amount)
  }
  for (const holding of payload.data.stock_holdings) {
    const qty = numberField(holding, 'quantity') ?? 0
    const price = numberField(holding, 'lastKnownPrice') ?? numberField(holding, 'buyPrice') ?? 0
    add(stringField(holding, 'currency') || 'LKR', qty * price)
  }
  for (const fd of payload.data.fixed_deposits) {
    if (stringField(fd, 'status') === 'withdrawn') continue
    const principal = numberField(fd, 'principal')
    if (principal !== undefined) add(stringField(fd, 'currency') || 'LKR', principal)
  }

  const baseCurrency = normalizeDisplayCurrency(payload.baseCurrency)
  const rates = payload.exchangeRates.map((rate) => ({
    base: normalizeDisplayCurrency(rate.base),
    target: normalizeDisplayCurrency(rate.target),
    rate: rate.rate,
    date: rate.date,
  }))
  return Array.from(totals.entries())
    .filter(([, amount]) => amount > 0)
    .map(([currency, amount]) => ({
      currency,
      amount,
      baseAmount: convertWithExchangeRates(amount, currency, baseCurrency, rates),
    }))
    // Compare unlike currencies using the configured base valuation when it
    // exists. Unconvertible rows stay visible, but sort after valued rows.
    .sort((a, b) => {
      if (a.baseAmount !== undefined && b.baseAmount !== undefined) {
        return b.baseAmount - a.baseAmount
      }
      if (a.baseAmount !== undefined) return -1
      if (b.baseAmount !== undefined) return 1
      return b.amount - a.amount
    })
}
