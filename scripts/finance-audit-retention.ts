/**
 * Report or explicitly prune the local Finance audit recovery buffer.
 *
 * The Postgres audit_logs table is canonical and is never deleted here.
 * Default mode is a read-only report; pass --apply only after reviewing it.
 *
 * RUN:
 *   pnpm finance:audit-retention
 *   pnpm finance:audit-retention -- --days 180 --apply
 */
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import {
  auditRetentionReport,
  pruneAuditRecoveryBuffer,
} from '../src/server/finance-audit-retention'

const daysArg = process.argv.find((arg) => arg === '--days')
const daysIndex = daysArg ? process.argv.indexOf(daysArg) : -1
const retentionDays = daysIndex >= 0 ? Number(process.argv[daysIndex + 1]) : 180
const apply = process.argv.includes('--apply')
const home = process.env.HERMES_HOME ?? process.env.CLAUDE_HOME ?? os.homedir()
const auditPath = path.join(home, '.hermes', 'finance', 'audit.jsonl')

if (!Number.isInteger(retentionDays) || retentionDays < 7 || retentionDays > 3650) {
  console.error('--days must be an integer between 7 and 3650')
  process.exit(2)
}

if (!fs.existsSync(auditPath)) {
  console.log(JSON.stringify({ path: auditPath, exists: false, retentionDays }, null, 2))
  process.exit(0)
}

try {
  const result = apply
    ? pruneAuditRecoveryBuffer(auditPath, retentionDays)
    : auditRetentionReport(auditPath, retentionDays)
  console.log(
    JSON.stringify(
      {
        ...result,
        retentionDays,
        mode: apply ? 'applied-local-buffer-only' : 'dry-run',
        postgresAuditHistory: 'unchanged',
      },
      null,
      2,
    ),
  )
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error))
  process.exit(1)
}
