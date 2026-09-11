import { describe, expect, it } from 'vitest'
import { createEmptyFinanceDatabase } from './finance-store'
import { prepareTransactionImport } from './transaction-import'

const header =
  'id,kind,transactionType,date,counterparty,category,subcategory,accountId,transferId,transferAccountId,splitGroupId,splitIndex,currency,amount,convertedLkrAmount,status,tags,source,createdAt,updatedAt'

describe('prepareTransactionImport', () => {
  it('parses escaped fields and prepares an ordinary expense', () => {
    const preview = prepareTransactionImport(
      `${header}\nexpense-1,expense,,2026-09-10,"Cafe, Central",Dining,,, ,,,LKR,500,500,cleared,,manual,,\n`,
      createEmptyFinanceDatabase(),
    )

    expect(preview.errors).toEqual([])
    expect(preview.items).toHaveLength(1)
    expect(preview.items[0]).toMatchObject({
      type: 'expense',
      payload: { vendor: 'Cafe, Central', category: 'Dining', amount: 500 },
    })
  })

  it('detects duplicates without rejecting the preview', () => {
    const db = createEmptyFinanceDatabase()
    db.expense_records.push({
      id: 'existing',
      date: '2026-09-10',
      vendor: 'Cafe',
      category: 'Dining',
      currency: 'LKR',
      amount: 500,
      convertedLkrAmount: 500,
      recurring: false,
      workRelated: false,
      taxDeductiblePossible: false,
      source: 'manual',
      createdAt: '2026-09-10T00:00:00.000Z',
      updatedAt: '2026-09-10T00:00:00.000Z',
    })
    const preview = prepareTransactionImport(
      `${header}\nexpense-1,expense,,2026-09-10,Cafe,Dining,,,,,,LKR,500,500,cleared,,manual,,\n`,
      db,
    )

    expect(preview.errors).toEqual([])
    expect(preview.duplicates).toEqual([
      { rowNumbers: [2], kind: 'expense', date: '2026-09-10', counterparty: 'Cafe', amount: 500 },
    ])
  })

  it('reconstructs an exported transfer pair as one import item', () => {
    const db = createEmptyFinanceDatabase()
    db.finance_accounts.push(
      {
        id: 'source',
        name: 'Checking',
        type: 'bank',
        currency: 'LKR',
        balance: 1000,
        source: 'test',
        createdAt: '2026-09-10T00:00:00.000Z',
        updatedAt: '2026-09-10T00:00:00.000Z',
      },
      {
        id: 'destination',
        name: 'Savings',
        type: 'bank',
        currency: 'LKR',
        balance: 0,
        source: 'test',
        createdAt: '2026-09-10T00:00:00.000Z',
        updatedAt: '2026-09-10T00:00:00.000Z',
      },
    )
    const preview = prepareTransactionImport(
      `${header}\nexp-1,expense,transfer,2026-09-10,Transfer to Savings,Transfer,,source,transfer-1,destination,, ,LKR,2500,2500,cleared,,manual,,\ninc-1,income,transfer,2026-09-10,Transfer from Checking,Transfer,,destination,transfer-1,source,, ,LKR,2500,2500,cleared,,manual,,\n`,
      db,
    )

    expect(preview.errors).toEqual([])
    expect(preview.items).toHaveLength(1)
    expect(preview.items[0]).toMatchObject({
      type: 'transfer',
      payload: {
        sourceAccountId: 'source',
        destinationAccountId: 'destination',
        amount: 2500,
      },
    })
  })

  it('rejects malformed rows before any commit is possible', () => {
    const preview = prepareTransactionImport(
      `${header}\nexpense-1,expense,,not-a-date,Cafe,Dining,,,,,,LKR,-1,0,cleared,,manual,,\n`,
      createEmptyFinanceDatabase(),
    )

    expect(preview.items).toHaveLength(0)
    expect(preview.errors).toEqual([
      'Row 2: date must use YYYY-MM-DD',
    ])
  })

  it('rejects impossible calendar dates', () => {
    const preview = prepareTransactionImport(
      `${header}\nexpense-1,expense,,2026-02-30,Cafe,Dining,,,,,,LKR,10,10,cleared,,manual,,\n`,
      createEmptyFinanceDatabase(),
    )
    expect(preview.items).toHaveLength(0)
    expect(preview.errors).toEqual(['Row 2: date must use YYYY-MM-DD'])
  })

  it('rejects rows whose column count does not match the header', () => {
    const row = Array.from({ length: header.split(',').length + 1 }, () => 'x').join(',')
    const preview = prepareTransactionImport(
      header + '\n' + row + '\n',
      createEmptyFinanceDatabase(),
    )
    expect(preview.items).toHaveLength(0)
    expect(preview.errors).toEqual([
      `Row 2: expected ${header.split(',').length} columns but found 21`,
    ])
  })
})
