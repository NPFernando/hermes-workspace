import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import { randomUUID } from 'node:crypto'
import { decryptFinanceBackup, encryptFinanceBackup } from './encrypted-finance-backup'

const BACKUP_NAME = /^finance-\d{8}T\d{6}Z-[a-f0-9]{8}\.enc\.json$/
const AUDIT_ARCHIVE_NAME = /^finance-audit-\d{8}T\d{6}Z-[a-f0-9]{8}\.enc\.json$/
const SAFE_ARCHIVE_METADATA_KEYS = new Set([
  'retentionDays',
  'cutoff',
  'eligibleEntries',
  'prunedEntries',
])
const DEFAULT_STALE_AFTER_MS = 48 * 60 * 60 * 1000

export type EncryptedBackupRotationOptions = {
  backupDir: string
  passphraseFile: string
  retention: number
  finance: unknown
  auditLog: string
  now?: Date
}

export type EncryptedBackupRotationResult = {
  path: string
  retained: number
  removed: number
}

export type EncryptedBackupHealth = {
  status: 'healthy' | 'stale' | 'unconfigured' | 'missing'
  configured: boolean
  backupCount: number
  latestCreatedAt: string | null
  latestAgeMs: number | null
  staleAfterMs: number
  retention: number
}

export type EncryptedFinanceAuditArchiveOptions = {
  archiveDir: string
  passphraseFile: string
  auditLog: string
  metadata: Record<string, unknown>
  now?: Date
}

export type EncryptedFinanceAuditArchiveSummary = {
  name: string
  bytes: number
  modifiedAt: string
}

export type EncryptedFinanceAuditArchiveVerification = {
  valid: boolean
  name: string
  bytes: number | null
  archiveType: 'finance-audit' | null
  archivedAt: string | null
  auditEntries: number | null
  metadata: Record<string, unknown> | null
  reason?: string
}

export function writeEncryptedFinanceAuditArchive(
  options: EncryptedFinanceAuditArchiveOptions,
): string {
  const passphrase = readBackupPassphrase(options.passphraseFile)
  fs.mkdirSync(options.archiveDir, { recursive: true, mode: 0o700 })
  fs.chmodSync(options.archiveDir, 0o700)
  const now = options.now ?? new Date()
  const stamp = now.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z')
  const filename = `finance-audit-${stamp}-${randomUUID().slice(0, 8)}.enc.json`
  const destination = path.join(options.archiveDir, filename)
  const temporary = path.join(options.archiveDir, `.${filename}.${randomUUID()}.tmp`)
  const encrypted = encryptFinanceBackup(
    { archiveType: 'finance-audit', archivedAt: now.toISOString(), ...options.metadata },
    options.auditLog,
    passphrase,
  )
  try {
    fs.writeFileSync(temporary, encrypted, { mode: 0o600, flag: 'wx' })
    fs.chmodSync(temporary, 0o600)
    fs.renameSync(temporary, destination)
  } finally {
    if (fs.existsSync(temporary)) fs.unlinkSync(temporary)
  }
  return destination
}

/** List only safe metadata for operator-visible audit archives. */
export function listEncryptedFinanceAuditArchives(
  archiveDir: string,
): Array<EncryptedFinanceAuditArchiveSummary> {
  let entries: Array<string>
  try {
    entries = fs.readdirSync(archiveDir)
  } catch {
    return []
  }
  return entries
    .filter((entry) => AUDIT_ARCHIVE_NAME.test(entry))
    .map((name) => {
      try {
        const stat = fs.statSync(path.join(archiveDir, name))
        return stat.isFile()
          ? { name, bytes: stat.size, modifiedAt: new Date(stat.mtimeMs).toISOString(), mtimeMs: stat.mtimeMs }
          : null
      } catch {
        return null
      }
    })
    .filter((entry): entry is EncryptedFinanceAuditArchiveSummary & { mtimeMs: number } => entry !== null)
    .sort((a, b) => b.mtimeMs - a.mtimeMs || b.name.localeCompare(a.name))
    .map(({ mtimeMs: _mtimeMs, ...entry }) => entry)
}

/** Verify one archive without exposing its encrypted contents or filesystem path. */
export function verifyEncryptedFinanceAuditArchive(options: {
  archiveDir: string
  passphraseFile: string
  name: string
}): EncryptedFinanceAuditArchiveVerification {
  const name = path.basename(options.name)
  if (name !== options.name || !AUDIT_ARCHIVE_NAME.test(name)) {
    return {
      valid: false,
      name,
      bytes: null,
      archiveType: null,
      archivedAt: null,
      auditEntries: null,
      metadata: null,
      reason: 'Archive name is not valid',
    }
  }
  const archivePath = path.join(options.archiveDir, name)
  try {
    const stat = fs.statSync(archivePath)
    if (!stat.isFile()) throw new Error('Archive is not a regular file')
    const restored = decryptFinanceBackup(
      fs.readFileSync(archivePath, 'utf8'),
      readBackupPassphrase(options.passphraseFile),
    )
    if (
      !restored.finance ||
      typeof restored.finance !== 'object' ||
      Array.isArray(restored.finance) ||
      (restored.finance as Record<string, unknown>).archiveType !== 'finance-audit'
    ) {
      throw new Error('Archive is not a finance audit archive')
    }
    const finance = restored.finance as Record<string, unknown>
    const metadata = Object.fromEntries(
      Object.entries(finance).filter(([key]) => SAFE_ARCHIVE_METADATA_KEYS.has(key)),
    )
    const auditEntries = restored.auditLog
      .split('\n')
      .filter((line) => line.trim().length > 0).length
    return {
      valid: true,
      name,
      bytes: stat.size,
      archiveType: 'finance-audit',
      archivedAt: typeof finance.archivedAt === 'string' ? finance.archivedAt : null,
      auditEntries,
      metadata,
    }
  } catch (error) {
    return {
      valid: false,
      name,
      bytes: null,
      archiveType: null,
      archivedAt: null,
      auditEntries: null,
      metadata: null,
      reason: 'Archive could not be verified; check the configured passphrase and archive file',
    }
  }
}

export function readBackupPassphrase(passphraseFile: string): string {
  const stat = fs.statSync(passphraseFile)
  if (!stat.isFile() || (stat.mode & 0o077) !== 0) {
    throw new Error('Passphrase file must be a regular file with mode 0600 or stricter')
  }
  if (stat.size > 512) throw new Error('Passphrase file is too large')
  const passphrase = fs.readFileSync(passphraseFile, 'utf8').trim()
  if (!passphrase) throw new Error('Passphrase file is empty')
  return passphrase
}

export function rotateEncryptedFinanceBackup(
  options: EncryptedBackupRotationOptions,
): EncryptedBackupRotationResult {
  if (!Number.isInteger(options.retention) || options.retention < 1 || options.retention > 100) {
    throw new Error('Backup retention must be between 1 and 100')
  }
  const passphrase = readBackupPassphrase(options.passphraseFile)
  fs.mkdirSync(options.backupDir, { recursive: true, mode: 0o700 })
  fs.chmodSync(options.backupDir, 0o700)
  const now = options.now ?? new Date()
  const stamp = now.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z')
  const filename = `finance-${stamp}-${randomUUID().slice(0, 8)}.enc.json`
  const destination = path.join(options.backupDir, filename)
  const temporary = path.join(options.backupDir, `.${filename}.${randomUUID()}.tmp`)
  const encrypted = encryptFinanceBackup(options.finance, options.auditLog, passphrase)
  try {
    fs.writeFileSync(temporary, encrypted, { mode: 0o600, flag: 'wx' })
    fs.chmodSync(temporary, 0o600)
    fs.renameSync(temporary, destination)
  } finally {
    if (fs.existsSync(temporary)) fs.unlinkSync(temporary)
  }

  const backups = fs
    .readdirSync(options.backupDir)
    .filter((entry) => BACKUP_NAME.test(entry))
    .map((entry) => {
      const fullPath = path.join(options.backupDir, entry)
      return { entry, fullPath, mtimeMs: fs.statSync(fullPath).mtimeMs }
    })
    .sort((a, b) => b.mtimeMs - a.mtimeMs || b.entry.localeCompare(a.entry))
  let removed = 0
  for (const backup of backups.slice(options.retention)) {
    fs.unlinkSync(backup.fullPath)
    removed += 1
  }
  return {
    path: destination,
    retained: Math.min(backups.length, options.retention),
    removed,
  }
}

/**
 * Return safe operational backup metadata. This deliberately does not expose
 * filesystem paths, passphrase state, or encrypted payload contents.
 */
export function encryptedFinanceBackupHealth(
  options: {
    backupDir: string
    passphraseFile: string
    retention: number
    now?: Date
    staleAfterMs?: number
  },
): EncryptedBackupHealth {
  const staleAfterMs = options.staleAfterMs ?? DEFAULT_STALE_AFTER_MS
  const now = options.now ?? new Date()
  let configured = false
  try {
    const stat = fs.statSync(options.passphraseFile)
    configured = stat.isFile() && (stat.mode & 0o077) === 0 && stat.size <= 512
  } catch {
    configured = false
  }

  let entries: Array<string> = []
  try {
    entries = fs.readdirSync(options.backupDir).filter((entry) => BACKUP_NAME.test(entry))
  } catch {
    entries = []
  }
  const snapshots = entries
    .map((entry) => {
      try {
        const stat = fs.statSync(path.join(options.backupDir, entry))
        return stat.isFile() ? stat.mtimeMs : null
      } catch {
        return null
      }
    })
    .filter((mtimeMs): mtimeMs is number => mtimeMs !== null)
    .sort((a, b) => b - a)
  const latestMs = snapshots.at(0) ?? null
  const latestAgeMs = latestMs === null ? null : Math.max(0, now.getTime() - latestMs)
  const status = !configured
    ? 'unconfigured'
    : latestMs === null
      ? 'missing'
      : now.getTime() - latestMs > staleAfterMs
        ? 'stale'
        : 'healthy'
  return {
    status,
    configured,
    backupCount: snapshots.length,
    latestCreatedAt: latestMs === null ? null : new Date(latestMs).toISOString(),
    latestAgeMs,
    staleAfterMs,
    retention: options.retention,
  }
}

export function defaultEncryptedBackupConfig(): {
  backupDir: string
  auditArchiveDir: string
  passphraseFile: string
  retention: number
} {
  const hermesHome =
    process.env.HERMES_HOME ?? process.env.CLAUDE_HOME ?? path.join(os.homedir(), '.hermes')
  return {
    backupDir: process.env.FINANCE_BACKUP_DIR ?? path.join(hermesHome, 'finance', 'backups'),
    auditArchiveDir:
      process.env.FINANCE_AUDIT_ARCHIVE_DIR ??
      path.join(hermesHome, 'finance', 'audit-archives'),
    passphraseFile:
      process.env.FINANCE_BACKUP_PASSPHRASE_FILE ??
      path.join(hermesHome, 'finance', 'backup-passphrase'),
    retention: Math.max(1, Math.min(100, Number(process.env.FINANCE_BACKUP_RETENTION ?? 7))),
  }
}
