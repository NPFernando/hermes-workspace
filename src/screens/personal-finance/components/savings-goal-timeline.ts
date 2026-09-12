export type SavingsGoalTimelineInput = {
  currentAmount: number
  targetAmount: number
  monthlyContribution: number
  targetDate?: string
  status?: string
}

export type SavingsGoalTimeline =
  | { state: 'achieved' }
  | { state: 'paused' }
  | { state: 'no_target' }
  | { state: 'no_contribution' }
  | {
      state: 'projected'
      monthsRemaining: number
      projectedDate: string
      requiredMonthlyContribution: number | null
      targetDateMonths: number | null
    }

function addCalendarMonths(date: Date, months: number): Date {
  const day = date.getUTCDate()
  const result = new Date(
    Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + months, 1),
  )
  const lastDay = new Date(
    Date.UTC(result.getUTCFullYear(), result.getUTCMonth() + 1, 0),
  ).getUTCDate()
  result.setUTCDate(Math.min(day, lastDay))
  return result
}

function monthsUntil(targetDate: string, today: Date): number | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(targetDate)
  if (!match) return null
  const target = new Date(`${targetDate}T00:00:00.000Z`)
  if (
    Number.isNaN(target.getTime()) ||
    target.toISOString().slice(0, 10) !== targetDate
  ) {
    return null
  }
  return Math.max(
    0,
    (target.getUTCFullYear() - today.getUTCFullYear()) * 12 +
      target.getUTCMonth() -
      today.getUTCMonth(),
  )
}

/** Straight-line savings estimate; intentionally assumes no interest or investment return. */
export function savingsGoalTimeline(
  goal: SavingsGoalTimelineInput,
  today = new Date(),
): SavingsGoalTimeline {
  if (goal.status === 'achieved') return { state: 'achieved' }
  if (goal.status === 'paused' || goal.status === 'abandoned') {
    return { state: 'paused' }
  }

  const currentAmount = Number.isFinite(goal.currentAmount)
    ? Math.max(0, goal.currentAmount)
    : 0
  const targetAmount = Number.isFinite(goal.targetAmount)
    ? Math.max(0, goal.targetAmount)
    : 0
  const monthlyContribution = Number.isFinite(goal.monthlyContribution)
    ? Math.max(0, goal.monthlyContribution)
    : 0
  if (targetAmount <= 0) return { state: 'no_target' }
  if (currentAmount >= targetAmount) return { state: 'achieved' }
  const remaining = Math.max(0, targetAmount - currentAmount)
  if (monthlyContribution <= 0) return { state: 'no_contribution' }

  const monthsRemaining = Math.ceil(remaining / monthlyContribution)
  const projectedDate = addCalendarMonths(today, monthsRemaining)
    .toISOString()
    .slice(0, 10)
  const targetDateMonths = goal.targetDate
    ? monthsUntil(goal.targetDate, today)
    : null
  const requiredMonthlyContribution =
    targetDateMonths !== null && targetDateMonths > 0
      ? remaining / targetDateMonths
      : targetDateMonths === 0
        ? remaining
        : null

  return {
    state: 'projected',
    monthsRemaining,
    projectedDate,
    requiredMonthlyContribution,
    targetDateMonths,
  }
}
