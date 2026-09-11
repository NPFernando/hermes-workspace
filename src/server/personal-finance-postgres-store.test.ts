import { describe, expect, it } from 'vitest'
import { snakeRowToCamel } from './personal-finance-postgres-store'

describe('snakeRowToCamel', () => {
  it('converts snake_case column names to camelCase', () => {
    expect(snakeRowToCamel({ converted_lkr_amount: 5000 })).toEqual({
      convertedLkrAmount: 5000,
    })
    expect(snakeRowToCamel({ tax_deductible_possible: true })).toEqual({
      taxDeductiblePossible: true,
    })
    expect(snakeRowToCamel({ expected_payday_day_of_month: 5 })).toEqual({
      expectedPaydayDayOfMonth: 5,
    })
  })

  it('leaves single-word and already-camelCase keys unchanged', () => {
    expect(snakeRowToCamel({ id: 'x', name: 'y' })).toEqual({
      id: 'x',
      name: 'y',
    })
  })

  it('passes through null, number, string, and boolean values untouched', () => {
    expect(
      snakeRowToCamel({
        notes: null,
        amount: 100.5,
        currency: 'LKR',
        recurring: false,
      }),
    ).toEqual({
      notes: null,
      amount: 100.5,
      currency: 'LKR',
      recurring: false,
    })
  })

  it('does not recurse into nested object/array values (e.g. investment_accounts.data)', () => {
    const nested = { some_key: 'some_value', another_key: 1 }
    const result = snakeRowToCamel({ data: nested })
    expect(result.data).toBe(nested)
  })
})
