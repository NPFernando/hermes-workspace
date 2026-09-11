import { formatMoney } from '../utils'
import { stringField } from '../field-helpers'

/** Keep goal progress in the goal's recorded currency, including legacy rows. */
export function goalCurrency(goal: Record<string, unknown>): string {
  const currency = stringField(goal, 'currency').trim().toUpperCase()
  return currency || 'LKR'
}

export function formatGoalAmount(
  goal: Record<string, unknown>,
  amount: number,
): string {
  return formatMoney(amount, goalCurrency(goal))
}
