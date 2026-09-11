import { migrateFinanceStore } from './finance-store'
import type { FinanceDatabase } from './finance-store'

export type FinanceRestoreSummary = {
  schemaVersion: number
  auditEntries: number
  collectionCounts: Record<string, number>
}

export function prepareFinanceRestore(payload: unknown): FinanceDatabase {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    throw new Error('Backup payload must be an object')
  }
  const candidate = payload as { finance?: unknown }
  if (!candidate.finance || typeof candidate.finance !== 'object') {
    throw new Error('Backup does not contain a finance database')
  }
  return migrateFinanceStore(candidate.finance as FinanceDatabase)
}

/** DATA-105/106: safe, non-sensitive preview metadata for an already-decrypted restore. */
export function summarizeFinanceRestore(
  finance: FinanceDatabase,
  auditLog: string,
): FinanceRestoreSummary {
  const collectionCounts: Record<string, number> = {}
  for (const [key, value] of Object.entries(finance)) {
    if (Array.isArray(value)) collectionCounts[key] = value.length
  }
  return {
    schemaVersion: finance.schemaVersion,
    auditEntries: auditLog.split('\n').filter(Boolean).length,
    collectionCounts,
  }
}
