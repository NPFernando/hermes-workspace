import { createHash } from 'node:crypto'
import { appendFileSync, existsSync, mkdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { getStateDir } from './workspace-state-dir'
import type { CompositeIntelligence } from './finance-intelligence'

export const PAPER_DECISION_JOURNAL_FILE = 'paper-decision-journal.jsonl'

export type PaperDecisionJournalEntry = {
  id: string
  kind: 'research_snapshot'
  symbol: string
  compositeIntelligenceId: string
  compositeScore: number | null
  provenance: {
    formulaVersion: string
    sourceIds: Array<string>
    observedAt: string
  }
  recordedAt: string
  idempotencyKey: string
  side_effects: false
}

export function paperDecisionJournalPath(): string {
  return join(getStateDir(), PAPER_DECISION_JOURNAL_FILE)
}

function hash(value: string): string {
  return createHash('sha256').update(value).digest('hex').slice(0, 24)
}

/** A stable identifier for the research inputs captured by a composite. */
export function compositeIntelligenceId(
  composite: Pick<
    CompositeIntelligence,
    'symbol' | 'formulaVersion' | 'sourceIds' | 'observedAt'
  >,
): string {
  return `composite:${composite.symbol}:${composite.formulaVersion}:${hash(
    JSON.stringify({
      sourceIds: [...composite.sourceIds].sort(),
      observedAt: composite.observedAt,
    }),
  )}`
}

function toEntry(value: unknown): PaperDecisionJournalEntry | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const entry = value as Record<string, unknown>
  if (
    typeof entry.id !== 'string' ||
    entry.kind !== 'research_snapshot' ||
    typeof entry.symbol !== 'string' ||
    typeof entry.compositeIntelligenceId !== 'string' ||
    !(
      typeof entry.compositeScore === 'number' || entry.compositeScore === null
    ) ||
    typeof entry.recordedAt !== 'string' ||
    typeof entry.idempotencyKey !== 'string' ||
    entry.side_effects !== false ||
    !entry.provenance ||
    typeof entry.provenance !== 'object' ||
    Array.isArray(entry.provenance)
  ) {
    return null
  }
  const provenance = entry.provenance as Record<string, unknown>
  if (
    typeof provenance.formulaVersion !== 'string' ||
    typeof provenance.observedAt !== 'string' ||
    !Array.isArray(provenance.sourceIds) ||
    !provenance.sourceIds.every((sourceId) => typeof sourceId === 'string')
  ) {
    return null
  }
  return entry as PaperDecisionJournalEntry
}

export function readPaperDecisionJournal(): Array<PaperDecisionJournalEntry> {
  const path = paperDecisionJournalPath()
  if (!existsSync(path)) return []
  return readFileSync(path, 'utf8')
    .split('\n')
    .filter(Boolean)
    .flatMap((line) => {
      try {
        const entry = toEntry(JSON.parse(line) as unknown)
        return entry ? [entry] : []
      } catch {
        return []
      }
    })
}

/**
 * Appends a research-only snapshot once per idempotency key. This module never
 * reads or writes finance plans, orders, positions, execution settings, or
 * exchange clients.
 */
export function appendPaperDecisionSnapshot(input: {
  symbol: string
  composite: CompositeIntelligence
  idempotencyKey: string
  now?: Date
}): { entry: PaperDecisionJournalEntry; appended: boolean } {
  const symbol = input.symbol.trim().toUpperCase()
  const idempotencyKey = input.idempotencyKey.trim()
  if (!symbol) throw new Error('symbol is required')
  if (!idempotencyKey) throw new Error('idempotencyKey is required')

  const existing = readPaperDecisionJournal().find(
    (entry) => entry.idempotencyKey === idempotencyKey,
  )
  if (existing) return { entry: existing, appended: false }

  const compositeId = compositeIntelligenceId(input.composite)
  const recordedAt = (input.now ?? new Date()).toISOString()
  const entry: PaperDecisionJournalEntry = {
    id: `paper-decision:${hash(`${symbol}|${compositeId}|${idempotencyKey}`)}`,
    kind: 'research_snapshot',
    symbol,
    compositeIntelligenceId: compositeId,
    compositeScore: input.composite.score,
    provenance: {
      formulaVersion: input.composite.formulaVersion,
      sourceIds: [...input.composite.sourceIds].sort(),
      observedAt: input.composite.observedAt,
    },
    recordedAt,
    idempotencyKey,
    side_effects: false,
  }

  const path = paperDecisionJournalPath()
  mkdirSync(getStateDir(), { recursive: true, mode: 0o700 })
  appendFileSync(path, `${JSON.stringify(entry)}\n`, {
    encoding: 'utf8',
    mode: 0o600,
  })
  return { entry, appended: true }
}
