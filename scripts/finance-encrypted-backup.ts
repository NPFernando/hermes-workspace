import { readFinanceAuditLog, readFinanceStore } from '../src/server/finance-store'
import {
  defaultEncryptedBackupConfig,
  rotateEncryptedFinanceBackup,
} from '../src/server/encrypted-finance-retention'

const config = defaultEncryptedBackupConfig()
const result = rotateEncryptedFinanceBackup({
  ...config,
  finance: readFinanceStore(),
  auditLog: readFinanceAuditLog(),
})
console.log(
  JSON.stringify({
    ok: true,
    backupPath: result.path,
    retained: result.retained,
    removed: result.removed,
  }),
)
