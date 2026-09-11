import { describe, expect, it } from 'vitest'
import { groupAccountsByType } from './net-worth-by-account-card'

function account(over: Partial<Record<string, unknown>> = {}) {
  return {
    id: 'a1',
    name: 'ComBank Savings',
    type: 'bank',
    currency: 'LKR',
    balance: 100_000,
    ...over,
  }
}

describe('groupAccountsByType', () => {
  it('groups accounts by type', () => {
    const groups = groupAccountsByType([
      account({ id: 'a1', type: 'bank' }),
      account({ id: 'a2', type: 'cash', name: 'Wallet', balance: 5000 }),
    ])
    expect(groups.map((g) => g.type).sort()).toEqual(['bank', 'cash'])
  })

  it('uses a friendly label for known types and falls back to the raw type otherwise', () => {
    const groups = groupAccountsByType([
      account({ type: 'crypto_wallet' }),
      account({ id: 'a2', type: 'some_custom_type' }),
    ])
    expect(groups.find((g) => g.type === 'crypto_wallet')?.label).toBe(
      'Crypto wallet',
    )
    expect(groups.find((g) => g.type === 'some_custom_type')?.label).toBe(
      'some_custom_type',
    )
  })

  it('defaults an account with no type to "other"', () => {
    const groups = groupAccountsByType([account({ type: '' })])
    expect(groups[0].type).toBe('other')
  })

  it('sums totalsByCurrency only within the same (type, currency) pair — never mixes currencies', () => {
    const groups = groupAccountsByType([
      account({ id: 'a1', type: 'bank', currency: 'LKR', balance: 100_000 }),
      account({ id: 'a2', type: 'bank', currency: 'LKR', balance: 50_000 }),
      account({ id: 'a3', type: 'bank', currency: 'USD', balance: 200 }),
    ])
    const bank = groups.find((g) => g.type === 'bank')!
    expect(bank.totalsByCurrency).toEqual(
      expect.arrayContaining([
        { currency: 'LKR', total: 150_000 },
        { currency: 'USD', total: 200 },
      ]),
    )
  })

  it('uses the ledger-derived balance when deriveBalanceFromLedger is set and a ledgerBalance is present', () => {
    const groups = groupAccountsByType([
      account({ balance: 100_000, deriveBalanceFromLedger: true, ledgerBalance: 87_500 }),
    ])
    expect(groups[0].accounts[0].balance).toBe(87_500)
  })

  it('falls back to the manual balance when deriveBalanceFromLedger is set but ledgerBalance is null', () => {
    const groups = groupAccountsByType([
      account({ balance: 100_000, deriveBalanceFromLedger: true, ledgerBalance: null }),
    ])
    expect(groups[0].accounts[0].balance).toBe(100_000)
  })

  it('uses the manual balance when deriveBalanceFromLedger is false, even if a ledgerBalance is present', () => {
    const groups = groupAccountsByType([
      account({ balance: 100_000, deriveBalanceFromLedger: false, ledgerBalance: 87_500 }),
    ])
    expect(groups[0].accounts[0].balance).toBe(100_000)
  })

  it('sorts accounts within a type by balance descending', () => {
    const groups = groupAccountsByType([
      account({ id: 'a1', name: 'Small', balance: 100 }),
      account({ id: 'a2', name: 'Big', balance: 10_000 }),
    ])
    expect(groups[0].accounts.map((a) => a.name)).toEqual(['Big', 'Small'])
  })

  it('sorts type groups by their combined balance descending', () => {
    const groups = groupAccountsByType([
      account({ id: 'a1', type: 'cash', balance: 500 }),
      account({ id: 'a2', type: 'bank', balance: 1_000_000 }),
    ])
    expect(groups.map((g) => g.type)).toEqual(['bank', 'cash'])
  })

  it('returns an empty array for no accounts', () => {
    expect(groupAccountsByType([])).toEqual([])
  })
})
