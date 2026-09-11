export type ContractChange = {
  field: string
  previous: string
  current: string
}

type ContractTerms = {
  employerName?: unknown
  employmentType?: unknown
  monthlyIncomeAmount?: unknown
  currency?: unknown
  contractStartDate?: unknown
  contractEndDate?: unknown
  jobTitle?: unknown
  paydayDayOfMonth?: unknown
  expectedPaydayDayOfMonth?: unknown
  paySchedule?: unknown
}

function displayValue(value: unknown): string {
  if (value === undefined || value === null || value === '') return 'Not specified'
  if (typeof value === 'number' && Number.isFinite(value)) return String(value)
  return String(value).trim() || 'Not specified'
}

function comparable(value: unknown): string {
  return displayValue(value).toLowerCase()
}

/** PF-512: compare only structured contract terms; never compares document text. */
export function detectContractChanges(
  previous: ContractTerms,
  current: ContractTerms,
): Array<ContractChange> {
  const fields: Array<[string, keyof ContractTerms, keyof ContractTerms]> = [
    ['Employer', 'employerName', 'employerName'],
    ['Employment type', 'employmentType', 'employmentType'],
    ['Monthly income amount', 'monthlyIncomeAmount', 'monthlyIncomeAmount'],
    ['Currency', 'currency', 'currency'],
    ['Contract start date', 'contractStartDate', 'contractStartDate'],
    ['Contract end date', 'contractEndDate', 'contractEndDate'],
    ['Job title', 'jobTitle', 'jobTitle'],
    ['Payday day', 'paydayDayOfMonth', 'expectedPaydayDayOfMonth'],
    ['Pay schedule', 'paySchedule', 'paySchedule'],
  ]
  return fields.flatMap(([field, currentKey, previousKey]) => {
    const previousValue = displayValue(previous[previousKey])
    const currentValue = displayValue(current[currentKey])
    return comparable(previousValue) === comparable(currentValue)
      ? []
      : [{ field, previous: previousValue, current: currentValue }]
  })
}
