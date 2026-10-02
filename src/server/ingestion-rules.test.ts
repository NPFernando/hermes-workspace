import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ExtractedTransaction } from './finance-store'

async function fresh() {
  const store = await import('./finance-store')
  store.__setFinanceBackend(store.__inMemoryFinanceBackend())
  const rules = await import('./ingestion-rules')
  return { store, rules }
}

function bill(overrides: Partial<ExtractedTransaction> = {}): ExtractedTransaction {
  return {
    kind: 'expense',
    amount: 2840.48,
    currency: 'LKR',
    vendorOrSource: 'Dialog Axiata',
    date: '2026-09-10',
    category: 'Utilities',
    confidence: 'high',
    ...overrides,
  }
}

let clock = Date.parse('2026-10-01T00:00:00.000Z')
function tick() {
  clock += 60_000
  vi.setSystemTime(clock)
}

describe('ingestion rules', () => {
  beforeEach(() => {
    vi.resetModules()
    vi.useFakeTimers({ toFake: ['Date'] })
    tick()
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  it('marks a later copy of a queued bill as duplicate and keeps the first', async () => {
    const { store, rules } = await fresh()
    const first = store.addPendingIngestion({ source: 'gmail', sourceRef: 'a', extracted: bill() })
    tick()
    const second = store.addPendingIngestion({
      source: 'gmail',
      sourceRef: 'b',
      extracted: bill({ vendorOrSource: 'DIALOG AXIATA', date: '2026-09-11' }),
    })
    const result = rules.sweepPendingIngestions()
    expect(result).toEqual({ duplicates: 1, autoConfirmed: 0 })
    const byId = new Map(store.listPendingIngestions().map((p) => [p.id, p]))
    expect(byId.get(first.id)?.status).toBe('awaiting_review')
    expect(byId.get(second.id)?.status).toBe('duplicate')
    expect(byId.get(second.id)?.duplicateOfPendingId).toBe(first.id)
  })

  it('keeps bills from one sender with different amounts (separate accounts)', async () => {
    const { store, rules } = await fresh()
    for (const amount of [3444.33, 10348.72, 544.43]) {
      store.addPendingIngestion({
        source: 'gmail',
        sourceRef: String(amount),
        extracted: bill({ vendorOrSource: 'CEB', amount, date: '2026-09-16' }),
      })
      tick()
    }
    expect(rules.sweepPendingIngestions().duplicates).toBe(0)
  })

  it('marks an item matching an existing record as duplicate', async () => {
    const { store, rules } = await fresh()
    store.addFinanceRecord('expense', {
      vendor: 'Dialog Axiata',
      amount: 2840.48,
      currency: 'LKR',
      date: '2026-09-10',
      category: 'Utilities',
    })
    const item = store.addPendingIngestion({ source: 'gmail', sourceRef: 'a', extracted: bill() })
    expect(rules.applyIngestionPolicies(item.id)).toBe('duplicate')
  })

  it('auto-records a later bill from an approved sender, and undo restores review', async () => {
    const { store, rules } = await fresh()
    const approved = store.addPendingIngestion({
      source: 'gmail',
      sourceRef: 'a',
      senderAddress: 'billing@dialog.lk',
      extracted: bill(),
    })
    const rule = rules.upsertRuleFromApproval(approved, {
      kind: 'expense',
      vendorOrSource: 'Dialog',
      amount: 2840.48,
      currency: 'LKR',
      category: 'Utilities',
    })
    expect(rule?.senderAddress).toBe('billing@dialog.lk')
    tick()
    const next = store.addPendingIngestion({
      source: 'gmail',
      sourceRef: 'b',
      senderAddress: 'Billing@Dialog.lk',
      extracted: bill({ amount: 3100, date: '2026-10-10' }),
    })
    expect(rules.applyIngestionPolicies(next.id)).toBe('auto_confirmed')
    const item = store.listPendingIngestions().find((p) => p.id === next.id)
    expect(item?.status).toBe('auto_confirmed')
    const expense = store
      .ensureFinanceStore()
      .expense_records.find((r) => r.id === item?.confirmedRecordId)
    expect(expense?.vendor).toBe('Dialog')
    expect(expense?.amount).toBe(3100)
    expect(rules.listIngestionAutoRules()[0].matchCount).toBe(1)

    const undone = rules.undoAutoIngestion(next.id)
    expect(undone.status).toBe('awaiting_review')
    expect(
      store.ensureFinanceStore().expense_records.some((r) => r.id === item?.confirmedRecordId),
    ).toBe(false)
    expect(rules.listIngestionAutoRules()[0].enabled).toBe(false)
  })

  it('sends unusual extractions from a ruled sender to review', async () => {
    const { rules } = await fresh()
    const rule = {
      id: 'r1',
      senderAddress: 'billing@dialog.lk',
      label: 'Dialog',
      kind: 'expense' as const,
      vendorOrSource: 'Dialog',
      currency: 'LKR',
      enabled: true,
      maxAmount: 3000,
      matchCount: 0,
      createdAt: '',
      updatedAt: '',
    }
    expect(rules.ruleRejection(rule, bill())).toBeNull()
    expect(rules.ruleRejection(rule, bill({ amount: 9001 }))).toBe('amount_unusually_high')
    expect(rules.ruleRejection(rule, bill({ confidence: 'low' }))).toBe('low_confidence')
    expect(rules.ruleRejection(rule, bill({ currency: 'USD' }))).toBe('currency_mismatch')
    expect(rules.ruleRejection(rule, bill({ kind: 'income' }))).toBe('kind_mismatch')
    expect(rules.ruleRejection({ ...rule, enabled: false }, bill())).toBe('rule_disabled')
  })

  it('matches a rule by known sender when items carry no address', async () => {
    const { store, rules } = await fresh()
    const approved = store.addPendingIngestion({
      source: 'gmail',
      sourceRef: 'a',
      matchedSenderId: 'ks-ceb',
      matchedSenderLabel: 'EDL Electricity',
      extracted: bill({ vendorOrSource: 'CEB', amount: 3444.33 }),
    })
    rules.upsertRuleFromApproval(approved, {
      kind: 'expense',
      vendorOrSource: 'CEB',
      amount: 3444.33,
      currency: 'LKR',
    })
    tick()
    const next = store.addPendingIngestion({
      source: 'gmail',
      sourceRef: 'b',
      matchedSenderId: 'ks-ceb',
      extracted: bill({ vendorOrSource: 'CEB', amount: 544.43, date: '2026-09-16' }),
    })
    expect(rules.applyIngestionPolicies(next.id)).toBe('auto_confirmed')
  })

  it('records income with its amount (originalAmount/convertedLkrAmount)', async () => {
    const { store, rules } = await fresh()
    const id = rules.recordFromIngestion({ source: 'gmail', sourceRef: 'x' }, 'income', {
      kind: 'income',
      amount: 150000,
      currency: 'LKR',
      vendorOrSource: 'Employer',
      date: '2026-09-25',
    })
    const income = store.ensureFinanceStore().income_records.find((r) => r.id === id)
    expect(income?.originalAmount).toBe(150000)
    expect(income?.convertedLkrAmount).toBe(150000)
    expect(income?.sourceName).toBe('Employer')
  })
})
