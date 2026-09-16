import * as fs from 'node:fs'

export interface AuditRetentionEntry {
  createdAt: string
  [key: string]: unknown
}

export interface AuditRetentionReport {
  path: string
  bytes: number
  totalLines: number
  validEntries: number
  malformedLines: number
  retainedEntries: number
  removableEntries: number
  cutoff: string
  oldestCreatedAt: string | null
  newestCreatedAt: string | null
}

function parseEntries(contents: string): {
  entries: Array<AuditRetentionEntry>
  malformedLines: number
} {
  const entries: Array<AuditRetentionEntry> = []
  let malformedLines = 0
  for (const line of contents.split('\n')) {
    if (!line.trim()) continue
    try {
      const value: unknown = JSON.parse(line)
      if (
        !value ||
        typeof value !== 'object' ||
        typeof (value as { createdAt?: unknown }).createdAt !== 'string' ||
        !Number.isFinite(Date.parse((value as { createdAt: string }).createdAt))
      ) {
        malformedLines += 1
        continue
      }
      entries.push(value as AuditRetentionEntry)
    } catch {
      malformedLines += 1
    }
  }
  return { entries, malformedLines }
}

export function auditRetentionReport(
  filePath: string,
  retentionDays: number,
  now = new Date(),
): AuditRetentionReport {
  if (!Number.isInteger(retentionDays) || retentionDays < 7)
    throw new Error('retentionDays must be an integer of at least 7')
  const contents = fs.existsSync(filePath)
    ? fs.readFileSync(filePath, 'utf8')
    : ''
  const { entries, malformedLines } = parseEntries(contents)
  const cutoffDate = new Date(now.getTime() - retentionDays * 86_400_000)
  const cutoff = cutoffDate.toISOString()
  const retained = entries.filter((entry) => entry.createdAt >= cutoff)
  const removable = entries.length - retained.length
  const dates = entries.map((entry) => entry.createdAt).sort()
  return {
    path: filePath,
    bytes: Buffer.byteLength(contents),
    totalLines: contents.split('\n').filter((line) => line.trim()).length,
    validEntries: entries.length,
    malformedLines,
    retainedEntries: retained.length,
    removableEntries: removable,
    cutoff,
    oldestCreatedAt: dates[0] ?? null,
    newestCreatedAt: dates.at(-1) ?? null,
  }
}

/**
 * Prune only the local recovery buffer. Postgres audit_logs is canonical and
 * is intentionally not touched by this helper. An atomic replacement keeps
 * appendAuditLog safe if a process writes while the report is being applied.
 */
export function pruneAuditRecoveryBuffer(
  filePath: string,
  retentionDays: number,
  now = new Date(),
): AuditRetentionReport {
  const report = auditRetentionReport(filePath, retentionDays, now)
  if (report.malformedLines > 0)
    throw new Error(
      `refusing to prune ${filePath}: ${report.malformedLines} malformed line(s) require manual review`,
    )
  if (report.removableEntries === 0) return report
  const contents = fs.readFileSync(filePath, 'utf8')
  const cutoff = new Date(now.getTime() - retentionDays * 86_400_000)
  const kept = contents
    .split('\n')
    .filter((line) => {
      if (!line.trim()) return false
      const entry = JSON.parse(line) as AuditRetentionEntry
      return entry.createdAt >= cutoff.toISOString()
    })
    .join('\n')
    .concat('\n')
  const temporary = `${filePath}.retention-${process.pid}-${Date.now()}`
  fs.writeFileSync(temporary, kept, { mode: 0o600 })
  fs.renameSync(temporary, filePath)
  return auditRetentionReport(filePath, retentionDays, now)
}
