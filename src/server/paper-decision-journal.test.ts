import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  appendPaperDecisionSnapshot,
  paperDecisionJournalPath,
  readPaperDecisionJournal,
} from './paper-decision-journal'
import type { CompositeIntelligence } from './finance-intelligence'

const stateDirs: Array<string> = []
const originalStateDir = process.env.HERMES_WORKSPACE_STATE_DIR

function composite(): CompositeIntelligence {
  return {
    symbol: 'BTCUSDT',
    score: 20.5,
    label: 'positive',
    confidence: 0.6,
    freshness: 0.8,
    sourceIds: ['news-2', 'news-1'],
    disagreement: false,
    blockers: [],
    observedAt: '2026-08-20T12:00:00.000Z',
    expiresAt: '2026-08-22T12:00:00.000Z',
    formulaVersion: 'research-v1',
  }
}

function useTemporaryStateDir(): void {
  const directory = mkdtempSync(join(tmpdir(), 'paper-decision-journal-'))
  stateDirs.push(directory)
  process.env.HERMES_WORKSPACE_STATE_DIR = directory
}

afterEach(() => {
  if (originalStateDir === undefined)
    delete process.env.HERMES_WORKSPACE_STATE_DIR
  else process.env.HERMES_WORKSPACE_STATE_DIR = originalStateDir
  for (const directory of stateDirs.splice(0))
    rmSync(directory, { force: true, recursive: true })
})

describe('paper decision journal', () => {
  it('appends immutable research snapshots with explicit no-side-effects metadata', () => {
    useTemporaryStateDir()

    const result = appendPaperDecisionSnapshot({
      symbol: 'btcusdt',
      composite: composite(),
      idempotencyKey: 'research-click-1',
      now: new Date('2026-08-20T12:01:00.000Z'),
    })

    expect(result).toMatchObject({
      appended: true,
      entry: {
        kind: 'research_snapshot',
        symbol: 'BTCUSDT',
        compositeScore: 20.5,
        provenance: {
          formulaVersion: 'research-v1',
          sourceIds: ['news-1', 'news-2'],
          observedAt: '2026-08-20T12:00:00.000Z',
        },
        recordedAt: '2026-08-20T12:01:00.000Z',
        side_effects: false,
      },
    })
    expect(result.entry.compositeIntelligenceId).toMatch(
      /^composite:BTCUSDT:research-v1:/,
    )
    expect(readPaperDecisionJournal()).toEqual([result.entry])
  })

  it('is idempotent without rewriting or duplicating an existing journal entry', () => {
    useTemporaryStateDir()
    const input = {
      symbol: 'BTCUSDT',
      composite: composite(),
      idempotencyKey: 'retry-safe-key',
    }
    const first = appendPaperDecisionSnapshot({
      ...input,
      now: new Date('2026-08-20T12:01:00.000Z'),
    })
    const beforeRetry = readFileSync(paperDecisionJournalPath(), 'utf8')
    const retry = appendPaperDecisionSnapshot({
      ...input,
      now: new Date('2026-08-20T12:02:00.000Z'),
    })

    expect(first.appended).toBe(true)
    expect(retry).toEqual({ entry: first.entry, appended: false })
    expect(readFileSync(paperDecisionJournalPath(), 'utf8')).toBe(beforeRetry)
    expect(readPaperDecisionJournal()).toEqual([first.entry])
  })
})
