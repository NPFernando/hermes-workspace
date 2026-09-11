import { describe, expect, it } from 'vitest'
import { listFinanceDocuments } from './finance-document-vault'
import { createEmptyFinanceDatabase } from './finance-store'

describe('listFinanceDocuments', () => {
  it('returns safe metadata without document paths or contents', () => {
    const db = createEmptyFinanceDatabase()
    db.finance_accounts.push({
      id: 'account-1', name: 'Main bank', type: 'bank', currency: 'LKR', balance: 100000,
      documentRef: '/tmp/finance/bank-statement.pdf', source: 'manual',
      createdAt: '2026-09-01T00:00:00.000Z', updatedAt: '2026-09-01T00:00:00.000Z',
    })
    db.income_sources.push({
      id: 'job-1', employerName: 'Acme', employmentType: 'full_time', currency: 'LKR',
      status: 'active', documentRef: '/tmp/finance/contract.pdf', source: 'upload',
      createdAt: '2026-09-01T00:00:00.000Z', updatedAt: '2026-09-02T00:00:00.000Z',
    })
    db.pending_ingestions.push({
      id: 'pending-1', status: 'awaiting_review', source: 'upload', documentType: 'contract',
      sourceRef: '/tmp/finance/contract.pdf', createdAt: '2026-09-03T00:00:00.000Z', updatedAt: '2026-09-03T00:00:00.000Z',
    })
    db.fixed_deposits.push({
      id: 'fd-1', bankName: 'Acme Bank', principal: 500000, currency: 'LKR',
      interestRatePct: 8, interestPayout: 'at_maturity', startDate: '2026-01-01',
      maturityDate: '2027-01-01', status: 'active', documentRef: '/tmp/finance/fd.pdf',
      source: 'upload', createdAt: '2026-09-04T00:00:00.000Z', updatedAt: '2026-09-04T00:00:00.000Z',
    })
    db.stock_holdings.push({
      id: 'holding-1', symbol: 'ACME', companyName: 'Acme PLC', platform: 'Broker One',
      quantity: 10, buyPrice: 100, buyDate: '2026-01-01', currency: 'LKR',
      priceSource: 'manual', documentRef: '/tmp/finance/trade.pdf', source: 'upload',
      createdAt: '2026-09-05T00:00:00.000Z', updatedAt: '2026-09-05T00:00:00.000Z',
    })
    const documents = listFinanceDocuments(db)
    expect(documents).toHaveLength(5)
    expect(documents).toContainEqual(expect.objectContaining({ kind: 'finance_account', label: 'Main bank' }))
    expect(documents).toContainEqual(expect.objectContaining({ kind: 'stock_holding', label: 'ACME' }))
    expect(documents).toContainEqual(expect.objectContaining({ kind: 'fixed_deposit', label: 'Acme Bank' }))
    expect(documents.find((document) => document.kind === 'income_source')).toMatchObject({ name: 'contract.pdf', label: 'Acme' })
    expect(documents[0]).not.toHaveProperty('documentRef')
    expect(documents[0]).not.toHaveProperty('path')
    db.tax_records.push({
      id: 'tax-1', taxYear: '2025', incomeType: 'Salary', amount: 1000,
      currency: 'LKR', convertedLkrAmount: 1000, exchangeRateSource: 'manual',
      estimatedTaxableAmount: 1000, taxPaid: 100, taxDue: 0,
      requiresConfirmation: false, documentRef: '/tmp/finance/tax-return.pdf',
      source: 'manual', createdAt: '2026-09-05T00:00:00.000Z', updatedAt: '2026-09-05T00:00:00.000Z',
    })
    expect(listFinanceDocuments(db)).toContainEqual(
      expect.objectContaining({ kind: 'tax_record', label: '2025 Salary' }),
    )
  })
})
