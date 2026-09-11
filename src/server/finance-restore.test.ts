import { describe, expect, it } from 'vitest'
import { createEmptyFinanceDatabase } from './finance-store'
import { prepareFinanceRestore, summarizeFinanceRestore } from './finance-restore'

describe('prepareFinanceRestore', () => {
  it('normalizes a compatible encrypted-backup payload', () => {
    const legacy = createEmptyFinanceDatabase()
    delete (legacy as unknown as Record<string, unknown>).properties
    const restored = prepareFinanceRestore({
      formatVersion: 1,
      finance: legacy,
      auditLog: '',
    })
    expect(restored.schemaVersion).toBe(1)
    expect(restored.properties).toEqual([])
  })

  it('rejects malformed and future-version restore payloads', () => {
    expect(() => prepareFinanceRestore({ finance: null })).toThrow(
      /does not contain/,
    )
    expect(() =>
      prepareFinanceRestore({
        finance: { ...createEmptyFinanceDatabase(), schemaVersion: 99 },
      }),
    ).toThrow(/newer than the supported version/)
  })

  it('summarizes a validated restore without exposing record contents', () => {
    const finance = createEmptyFinanceDatabase()
    finance.finance_accounts.push({} as (typeof finance.finance_accounts)[number])
    const summary = summarizeFinanceRestore(finance, '{"action":"one"}\n{"action":"two"}\n')
    expect(summary).toEqual(expect.objectContaining({
      schemaVersion: 1,
      auditEntries: 2,
    }))
    expect(summary.collectionCounts.finance_accounts).toBe(1)
    // Collection names are public metadata and may legitimately contain a
    // substring such as `scheduled_transactions`; prove that audit payload
    // fields and values are not copied into the preview instead.
    expect(summary).not.toHaveProperty('action')
    expect(JSON.stringify(summary)).not.toContain('one')
    expect(JSON.stringify(summary)).not.toContain('two')
  })
})
