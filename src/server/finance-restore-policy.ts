export const FINANCE_RESTORE_CONFIRMATION = 'RESTORE_FINANCE'

export type FinanceRestoreRequest = {
  mode?: 'preview' | 'apply'
  confirmation?: string
}

export function financeRestorePlan(request: FinanceRestoreRequest): {
  apply: boolean
  requiredConfirmation?: string
} {
  if (request.mode === 'apply' && request.confirmation === FINANCE_RESTORE_CONFIRMATION) {
    return { apply: true }
  }
  return { apply: false, requiredConfirmation: FINANCE_RESTORE_CONFIRMATION }
}
