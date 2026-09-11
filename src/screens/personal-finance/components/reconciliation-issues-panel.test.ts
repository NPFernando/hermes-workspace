import { describe, expect, it } from 'vitest'
import { getReconciliationIssues } from './reconciliation-issues-panel'

describe('getReconciliationIssues', () => {
  const now = new Date('2026-09-10T12:00:00.000Z')

  it('returns only pending transactions at least seven days old, oldest first', () => {
    const issues = getReconciliationIssues(
      [
        { id: 'recent', status: 'pending', date: '2026-09-07', kind: 'expense' },
        { id: 'old', status: 'pending', date: '2026-09-01', kind: 'expense' },
        { id: 'older', status: 'pending', date: '2026-08-01', kind: 'income' },
        { id: 'cleared', status: 'cleared', date: '2026-08-01', kind: 'expense' },
      ],
      now,
    )

    expect(issues.map((issue) => issue.id)).toEqual(['older', 'old'])
  })

  it('ignores malformed dates instead of treating them as stale', () => {
    expect(
      getReconciliationIssues(
        [{ id: 'invalid', status: 'pending', date: 'not-a-date', kind: 'expense' }],
        now,
      ),
    ).toEqual([])
  })
})
