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
      /** Set only when a volatilityRatio was passed in — how many months
       *  sooner/later the goal might land if the stated monthlyContribution
       *  runs volatilityRatio higher/lower some months, same variability
       *  the net-worth forecast's ±1σ band already surfaces elsewhere.
       *  Not shown when the goal is already this month (monthsRemaining=0)
       *  or the pessimistic contribution would be non-positive. */
      optimisticMonthsRemaining: number | null
      optimisticDate: string | null
      pessimisticMonthsRemaining: number | null
      pessimisticDate: string | null
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

/** Straight-line savings estimate; intentionally assumes no interest or
 *  investment return. `volatilityRatio` (e.g. 0.15 = ±15%) is optional —
 *  when given (the caller's own trailing-months savings stddev / mean,
 *  same figure the net-worth forecast's ±1σ band is built from), the
 *  'projected' result also carries an optimistic/pessimistic pair showing
 *  how much the payoff date could realistically shift, instead of implying
 *  the stated monthlyContribution will land exactly every month. */
export function savingsGoalTimeline(
  goal: SavingsGoalTimelineInput,
  today = new Date(),
  volatilityRatio = 0,
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

  // Only floor at 0 (a negative ratio would make "optimistic" the slower
  // one, backwards) — deliberately NOT capped at the top: a real trailing-
  // months stddev can exceed the mean (a genuinely noisy 2-3 month
  // history), and the ratio needs to be able to reach/exceed 1 for the
  // slowerContribution <= 0 guard below to ever actually do anything.
  const clampedRatio = Math.max(0, volatilityRatio)
  let optimisticMonthsRemaining: number | null = null
  let optimisticDate: string | null = null
  let pessimisticMonthsRemaining: number | null = null
  let pessimisticDate: string | null = null
  if (clampedRatio > 0) {
    const fasterContribution = monthlyContribution * (1 + clampedRatio)
    optimisticMonthsRemaining = Math.ceil(remaining / fasterContribution)
    optimisticDate = addCalendarMonths(today, optimisticMonthsRemaining)
      .toISOString()
      .slice(0, 10)
    // A ratio >= 1 would make the "slower" contribution zero or negative —
    // there's no meaningful payoff date for "might save nothing some
    // months", so pessimistic stays null rather than showing Infinity.
    const slowerContribution = monthlyContribution * (1 - clampedRatio)
    if (slowerContribution > 0) {
      pessimisticMonthsRemaining = Math.ceil(remaining / slowerContribution)
      pessimisticDate = addCalendarMonths(today, pessimisticMonthsRemaining)
        .toISOString()
        .slice(0, 10)
    }
  }

  return {
    state: 'projected',
    monthsRemaining,
    projectedDate,
    requiredMonthlyContribution,
    targetDateMonths,
    optimisticMonthsRemaining,
    optimisticDate,
    pessimisticMonthsRemaining,
    pessimisticDate,
  }
}
