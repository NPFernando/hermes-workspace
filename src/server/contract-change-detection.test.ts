import { describe, expect, it } from 'vitest'
import { detectContractChanges } from './contract-change-detection'

describe('detectContractChanges', () => {
  it('reports structured contract term changes and ignores unchanged terms', () => {
    expect(
      detectContractChanges(
        {
          employerName: 'Acme',
          employmentType: 'full_time',
          monthlyIncomeAmount: 100_000,
          currency: 'LKR',
          expectedPaydayDayOfMonth: 5,
        },
        {
          employerName: 'Acme',
          employmentType: 'contract',
          monthlyIncomeAmount: 125_000,
          currency: 'LKR',
          paydayDayOfMonth: 10,
        },
      ),
    ).toEqual([
      { field: 'Employment type', previous: 'full_time', current: 'contract' },
      { field: 'Monthly income amount', previous: '100000', current: '125000' },
      { field: 'Payday day', previous: '5', current: '10' },
    ])
  })

  it('makes added and removed terms explicit', () => {
    expect(detectContractChanges({ jobTitle: 'Analyst' }, { jobTitle: undefined })).toEqual([
      { field: 'Job title', previous: 'Analyst', current: 'Not specified' },
    ])
  })
})
