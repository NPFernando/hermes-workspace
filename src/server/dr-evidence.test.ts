import { afterEach, describe, expect, it } from 'vitest'
import { sanitizeDrEvidence, readDrEvidence } from './dr-evidence'

describe('disaster recovery evidence sanitization', () => {
  afterEach(() => {
    delete process.env.HERMES_DR_EVIDENCE_DIR
  })

  it('keeps statuses and removes child output that could contain sensitive details', () => {
    const report = sanitizeDrEvidence('exercise-20260918120000.json', {
      generatedAt: '2026-09-18T12:00:00.000Z',
      mode: 'run',
      nonDestructive: true,
      ok: true,
      results: [
        {
          name: 'finance-local-restore',
          status: 'passed',
          detail: 'safe summary',
          output: { password: 'must not be returned' },
        },
      ],
    })
    expect(report).toEqual({
      file: 'exercise-20260918120000.json',
      generatedAt: '2026-09-18T12:00:00.000Z',
      mode: 'run',
      nonDestructive: true,
      ok: true,
      results: [{ name: 'finance-local-restore', status: 'passed', detail: 'safe summary' }],
    })
  })

  it('rejects traversal and non-exercise filenames', () => {
    expect(readDrEvidence('../secrets.json')).toBeNull()
    expect(readDrEvidence('notes.json')).toBeNull()
  })
})
