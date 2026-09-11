import * as fs from 'node:fs'
import * as path from 'node:path'
import { decryptFinanceBackup } from '../src/server/encrypted-finance-backup'
import {
  defaultEncryptedBackupConfig,
  readBackupPassphrase,
  rotateEncryptedFinanceBackup,
} from '../src/server/encrypted-finance-retention'
import {
  appendAuditLog,
  readFinanceAuditLog,
  readFinanceStore,
  writeFinanceStore,
} from '../src/server/finance-store'
import {
  prepareFinanceRestore,
  summarizeFinanceRestore,
} from '../src/server/finance-restore'

const args = new Set(process.argv.slice(2))
const fileIndex = process.argv.indexOf('--file')
const backupPath = fileIndex >= 0 ? process.argv[fileIndex + 1] : ''
const config = defaultEncryptedBackupConfig()

if (!backupPath || args.has('--help')) {
  console.error(
    'Usage: pnpm finance:restore:encrypted --file /path/backup.enc.json [--dry-run|--confirm]',
  )
  process.exitCode = 2
} else if (!args.has('--confirm') && !args.has('--dry-run')) {
  console.error(
    'Refusing to restore without --confirm or --dry-run. No data was changed. Use --help for the command shape.',
  )
  process.exitCode = 2
} else {
  const stat = fs.lstatSync(path.resolve(backupPath))
  if (!stat.isFile()) throw new Error('Backup path must be a regular file')
  const serialized = fs.readFileSync(path.resolve(backupPath), 'utf8')
  const passphrase = readBackupPassphrase(config.passphraseFile)
  const payload = decryptFinanceBackup(serialized, passphrase)
  const restored = prepareFinanceRestore(payload)

  if (args.has('--dry-run')) {
    console.log(JSON.stringify({
      ok: true,
      dryRun: true,
      sourceBackup: path.basename(path.resolve(backupPath)),
      restore: summarizeFinanceRestore(restored, payload.auditLog),
    }))
  } else {
    const current = readFinanceStore()
    const safetyBackup = rotateEncryptedFinanceBackup({
      ...config,
      finance: current,
      auditLog: readFinanceAuditLog(),
    })
    writeFinanceStore(restored)
    appendAuditLog('finance_restore_completed', {
      sourceBackup: path.basename(path.resolve(backupPath)),
      preRestoreSafetyBackup: path.basename(safetyBackup.path),
      schemaVersion: restored.schemaVersion,
    })
    console.log(
      JSON.stringify({
        ok: true,
        restoredSchemaVersion: restored.schemaVersion,
        preRestoreSafetyBackup: safetyBackup.path,
      }),
    )
  }
}
