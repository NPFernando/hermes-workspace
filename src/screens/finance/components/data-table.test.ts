import { describe, expect, it } from 'vitest'
import { humanizeColumnLabel } from './data-table'

describe('humanizeColumnLabel', () => {
  it('turns storage field names into readable headings', () => {
    expect(humanizeColumnLabel('budgetAmount')).toBe('Budget amount')
    expect(humanizeColumnLabel('taxPaid')).toBe('Tax paid')
    expect(humanizeColumnLabel('target_date')).toBe('Target date')
  })

  it('keeps intentional domain-specific labels clear', () => {
    expect(humanizeColumnLabel('convertedLkrAmount')).toBe('Converted LKR amount')
    expect(humanizeColumnLabel('documentRef')).toBe('Document')
  })
})
