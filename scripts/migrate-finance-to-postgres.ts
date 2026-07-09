import { financeStorageStatus, readFinanceStore, writeFinanceStore } from '../src/server/finance-store'

const before = financeStorageStatus()
const db = readFinanceStore()
writeFinanceStore(db)
const after = financeStorageStatus()

const counts: Record<string, number> = {}
for (const [key, value] of Object.entries(db)) {
  if (Array.isArray(value)) counts[key] = value.length
}

console.log(JSON.stringify({
  ok: after.postgres.available && after.postgres.snapshotAvailable,
  before,
  after,
  schemaVersion: db.schemaVersion,
  updatedAt: db.updatedAt,
  counts,
}, null, 2))
