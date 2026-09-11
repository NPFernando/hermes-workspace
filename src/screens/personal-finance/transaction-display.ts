import { optionalNumberField, stringField } from './field-helpers'
import { formatMoney, normalizeDisplayCurrency } from './utils'

/** Show the entered amount plus stored LKR conversion when it is meaningful. */
export function transactionAmountLabel(
  transaction: Record<string, unknown>,
): string {
  const currency = normalizeDisplayCurrency(stringField(transaction, 'currency'))
  const amount = typeof transaction.amount === 'number' ? transaction.amount : 0
  const original = formatMoney(amount, currency)
  const convertedLkr = optionalNumberField(transaction, 'convertedLkrAmount')
  if (currency === 'LKR' || convertedLkr === undefined) return original
  return `${original} (≈ ${formatMoney(convertedLkr, 'LKR')})`
}
