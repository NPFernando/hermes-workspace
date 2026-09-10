import { describe, expect, it } from 'vitest'
import {
  FINANCE_POSTGRES_COLLECTIONS,
  appendFinanceAuditPostgres,
  financePostgresStatus,
  readFinancePostgresStore,
  writeFinancePostgresStore,
} from './finance-postgres-store'
import { createEmptyFinanceDatabase } from './finance-store'

// Regression test for the 2026-07-27 incident: settings.demoTradingGrid held
// test-fixture values in the real production Postgres finance database for
// 2+ days because writeFinanceStore() unconditionally mirrors to Postgres,
// and only the JSON store was isolated by tests (via a $HOME override) —
// this module reads HERMES_PG_*/DATABASE_URL directly, which a $HOME
// override does nothing for. financePostgresEnabled() must short-circuit
// under vitest so no test can ever reach a real `psql` call.
describe('finance-postgres-store test isolation', () => {
  it('never touches Postgres under vitest, regardless of HERMES_FINANCE_STORE', () => {
    const db = createEmptyFinanceDatabase()
    expect(writeFinancePostgresStore(db)).toBe(false)
    expect(readFinancePostgresStore()).toBeNull()
    expect(
      appendFinanceAuditPostgres({
        id: 'test-id',
        action: 'test-action',
        details: {},
        source: 'test',
        createdAt: new Date(0).toISOString(),
      }),
    ).toBe(false)
    expect(financePostgresStatus().enabled).toBe(false)
  })
})

// PF review item 12: the `transfers` collection is persisted through the generic
// `finance_engine_collections` table — there is no per-collection DDL, so the
// ONLY thing that wires it up is its membership in FINANCE_COLLECTIONS (which
// drives both readFinancePostgresNormalized and writeFinancePostgresNormalized).
// Dropping it from that list would silently stop persisting transfers with no
// type error and no failing test — this guards that.
describe('transfers collection is wired for Postgres persistence', () => {
  it('is a member of FINANCE_POSTGRES_COLLECTIONS, alongside the other PF record kinds', () => {
    expect(FINANCE_POSTGRES_COLLECTIONS).toContain('transfers')
    // sits with the personal-finance collections, not the trading ones
    const idx = FINANCE_POSTGRES_COLLECTIONS.indexOf('transfers')
    expect(idx).toBeGreaterThan(
      FINANCE_POSTGRES_COLLECTIONS.indexOf('expense_records'),
    )
    expect(idx).toBeLessThan(
      FINANCE_POSTGRES_COLLECTIONS.indexOf('budget_categories'),
    )
  })

  it('net_worth_snapshots is wired for Postgres persistence too', () => {
    expect(FINANCE_POSTGRES_COLLECTIONS).toContain('net_worth_snapshots')
  })

  it('every PG-persisted PF collection exists as an array on a fresh db, so the normalizer round-trips it', () => {
    const db = createEmptyFinanceDatabase() as unknown as Record<string, unknown>
    for (const collection of [
      'finance_accounts',
      'income_records',
      'expense_records',
      'transfers',
      'net_worth_snapshots',
      'exchange_rates',
    ]) {
      expect(Array.isArray(db[collection]), collection).toBe(true)
    }
    expect(db.transfers).toEqual([])
  })

  it('a transfer record survives a JSONB write→read cycle (structure is JSON-serialisable)', () => {
    const transfer = {
      id: 't-rt-1',
      date: '2026-06-05',
      fromAccountId: 'checking',
      toAccountId: 'savings',
      amount: 60_000,
      currency: 'LKR',
      convertedLkrAmount: 60_000,
      notes: 'monthly sweep',
      source: 'manual',
      createdAt: '2026-06-05T00:00:00.000Z',
      updatedAt: '2026-06-05T00:00:00.000Z',
    }
    // mirrors sqlJsonb(row) on write + JSON.parse(data) on read in
    // finance-postgres-store's normalized (de)serialisation
    expect(JSON.parse(JSON.stringify(transfer))).toEqual(transfer)
  })
})
