import { describe, expect, it } from 'vitest'
import { financeRestorePlan, FINANCE_RESTORE_CONFIRMATION } from './finance-restore-policy'

describe('finance restore safety policy', () => {
  it('previews by default and requires the exact confirmation token', () => {
    expect(financeRestorePlan({})).toEqual({ apply: false, requiredConfirmation: FINANCE_RESTORE_CONFIRMATION })
    expect(financeRestorePlan({ mode: 'apply', confirmation: 'RESTORE' })).toEqual({ apply: false, requiredConfirmation: FINANCE_RESTORE_CONFIRMATION })
  })

  it('allows an explicitly confirmed apply', () => {
    expect(financeRestorePlan({ mode: 'apply', confirmation: FINANCE_RESTORE_CONFIRMATION })).toEqual({ apply: true })
  })
})
