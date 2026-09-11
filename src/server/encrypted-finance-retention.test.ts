import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  encryptedFinanceBackupHealth,
  listEncryptedFinanceAuditArchives,
  readBackupPassphrase,
  rotateEncryptedFinanceBackup,
  verifyEncryptedFinanceAuditArchive,
  writeEncryptedFinanceAuditArchive,
} from './encrypted-finance-retention'
import { decryptFinanceBackup } from './encrypted-finance-backup'

const temporaryDirectories: string[] = []
afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    fs.rmSync(directory, { recursive: true, force: true })
  }
})

describe('encrypted finance backup retention', () => {
  it('requires a private passphrase file and rotates old encrypted snapshots', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'finance-backup-'))
    temporaryDirectories.push(root)
    const passphraseFile = path.join(root, 'passphrase')
    const backupDir = path.join(root, 'backups')
    fs.writeFileSync(passphraseFile, 'correct horse battery staple\n', {
      mode: 0o600,
    })
    fs.chmodSync(passphraseFile, 0o600)

    const first = rotateEncryptedFinanceBackup({
      backupDir,
      passphraseFile,
      retention: 2,
      finance: { secret: 'value' },
      auditLog: 'audit',
      now: new Date('2026-09-10T00:00:00.000Z'),
    })
    const second = rotateEncryptedFinanceBackup({
      backupDir,
      passphraseFile,
      retention: 2,
      finance: { secret: 'value-2' },
      auditLog: 'audit',
      now: new Date('2026-09-10T00:01:00.000Z'),
    })
    const third = rotateEncryptedFinanceBackup({
      backupDir,
      passphraseFile,
      retention: 2,
      finance: { secret: 'value-3' },
      auditLog: 'audit',
      now: new Date('2026-09-10T00:02:00.000Z'),
    })

    expect(readBackupPassphrase(passphraseFile)).toBe(
      'correct horse battery staple',
    )
    expect(first.path).not.toBe(second.path)
    expect(third.removed).toBe(1)
    expect(fs.readdirSync(backupDir)).toHaveLength(2)
    expect(fs.readFileSync(third.path, 'utf8')).not.toContain('value-3')
    expect(fs.statSync(third.path).mode & 0o077).toBe(0)
  })

  it('rejects passphrase files readable by group or others', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'finance-backup-'))
    temporaryDirectories.push(root)
    const passphraseFile = path.join(root, 'passphrase')
    fs.writeFileSync(passphraseFile, 'correct horse battery staple', {
      mode: 0o644,
    })
    fs.chmodSync(passphraseFile, 0o644)
    expect(() => readBackupPassphrase(passphraseFile)).toThrow(/0600/)
  })

  it('reports safe health metadata and marks old snapshots stale', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'finance-backup-'))
    temporaryDirectories.push(root)
    const passphraseFile = path.join(root, 'passphrase')
    const backupDir = path.join(root, 'backups')
    fs.writeFileSync(passphraseFile, 'correct horse battery staple', { mode: 0o600 })
    fs.chmodSync(passphraseFile, 0o600)
    const snapshot = rotateEncryptedFinanceBackup({
      backupDir,
      passphraseFile,
      retention: 7,
      finance: { secret: 'value' },
      auditLog: 'audit',
      now: new Date('2026-09-08T00:00:00.000Z'),
    })
    fs.utimesSync(snapshot.path, new Date('2026-09-08T00:00:00.000Z'), new Date('2026-09-08T00:00:00.000Z'))

    const health = encryptedFinanceBackupHealth({
      backupDir,
      passphraseFile,
      retention: 7,
      now: new Date('2026-09-10T00:00:00.000Z'),
      staleAfterMs: 24 * 60 * 60 * 1000,
    })
    expect(health.status).toBe('stale')
    expect(health.configured).toBe(true)
    expect(health.backupCount).toBe(1)
    expect(health.latestCreatedAt).toBeTruthy()
    expect(health).not.toHaveProperty('backupDir')
    expect(health).not.toHaveProperty('passphraseFile')
  })

  it('writes an encrypted audit archive with restricted file permissions', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'finance-audit-archive-'))
    temporaryDirectories.push(root)
    const passphraseFile = path.join(root, 'passphrase')
    const archiveDir = path.join(root, 'audit-archives')
    fs.writeFileSync(passphraseFile, 'correct horse battery staple', { mode: 0o600 })
    fs.chmodSync(passphraseFile, 0o600)
    const archivePath = writeEncryptedFinanceAuditArchive({
      archiveDir,
      passphraseFile,
      auditLog: '{"entryHash":"hash"}',
      metadata: { eligibleEntries: 3 },
      now: new Date('2026-09-10T00:00:00.000Z'),
    })
    const restored = decryptFinanceBackup(
      fs.readFileSync(archivePath, 'utf8'),
      'correct horse battery staple',
    )
    expect(restored.auditLog).toContain('entryHash')
    expect(restored.finance).toMatchObject({ archiveType: 'finance-audit', eligibleEntries: 3 })
    expect(fs.statSync(archivePath).mode & 0o077).toBe(0)
  })

  it('lists safe archive metadata and verifies an archive without exposing its contents', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'finance-audit-archive-'))
    temporaryDirectories.push(root)
    const passphraseFile = path.join(root, 'passphrase')
    const archiveDir = path.join(root, 'audit-archives')
    fs.writeFileSync(passphraseFile, 'correct horse battery staple', { mode: 0o600 })
    fs.chmodSync(passphraseFile, 0o600)
    const archivePath = writeEncryptedFinanceAuditArchive({
      archiveDir,
      passphraseFile,
      auditLog: '{"id":"one"}\n{"id":"two"}\n',
      metadata: { eligibleEntries: 2 },
      now: new Date('2026-09-10T00:00:00.000Z'),
    })

    const archives = listEncryptedFinanceAuditArchives(archiveDir)
    expect(archives).toHaveLength(1)
    expect(archives[0]).toMatchObject({ name: path.basename(archivePath), bytes: expect.any(Number) })
    expect(archives[0]).not.toHaveProperty('path')

    const verification = verifyEncryptedFinanceAuditArchive({
      archiveDir,
      passphraseFile,
      name: path.basename(archivePath),
    })
    expect(verification).toMatchObject({
      valid: true,
      archiveType: 'finance-audit',
      auditEntries: 2,
      metadata: { eligibleEntries: 2 },
    })
    expect(verification).not.toHaveProperty('auditLog')
    expect(verifyEncryptedFinanceAuditArchive({
      archiveDir,
      passphraseFile,
      name: '../escape.enc.json',
    }).valid).toBe(false)
  })
})
