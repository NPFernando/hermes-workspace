export type FinancialRules = {
  monthlyInvestmentTargetLkr?: number
  largeTransactionThresholdLkr?: number
  discretionarySpendingThresholdLkr?: number
  investmentAllocationTargetPct?: number
}

export type FinancialRulesValidation = {
  ok: boolean
  rules: FinancialRules
  errors: Array<string>
}

const RULE_LIMITS = {
  monthlyInvestmentTargetLkr: 100_000_000,
  largeTransactionThresholdLkr: 100_000_000,
  discretionarySpendingThresholdLkr: 100_000_000,
  investmentAllocationTargetPct: 100,
} as const

function optionalNumber(
  input: Record<string, unknown>,
  key: keyof typeof RULE_LIMITS,
  errors: Array<string>,
): number | undefined {
  const value = input[key]
  if (value === undefined || value === null || value === '') return undefined
  const number = typeof value === 'number' ? value : Number(value)
  if (!Number.isFinite(number) || number < 0 || number > RULE_LIMITS[key]) {
    errors.push(`${key} must be between 0 and ${RULE_LIMITS[key]}.`)
    return undefined
  }
  return Math.round(number * 100) / 100 || undefined
}

export function validateFinancialRules(input: unknown): FinancialRulesValidation {
  const source = input && typeof input === 'object' ? (input as Record<string, unknown>) : {}
  const errors: Array<string> = []
  const rules: FinancialRules = {}
  for (const key of Object.keys(RULE_LIMITS) as Array<keyof typeof RULE_LIMITS>) {
    const value = optionalNumber(source, key, errors)
    if (value !== undefined) rules[key] = value
  }
  return { ok: errors.length === 0, rules, errors }
}
