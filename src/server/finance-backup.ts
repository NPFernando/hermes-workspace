import { createCipheriv, createDecipheriv, createHash, randomBytes, scryptSync } from 'node:crypto'
import type { FinanceDatabase } from './finance-store'

const BACKUP_VERSION = 1
const KEY_LENGTH = 32
const MIN_PASSPHRASE_LENGTH = 12

export type FinanceBackupEnvelope = {
  format: 'hermes-finance-backup'
  version: 1
  createdAt: string
  kdf: 'scrypt'
  salt: string
  iv: string
  authTag: string
  digest: string
  ciphertext: string
}

function encoded(value: Buffer): string {
  return value.toString('base64url')
}

function decoded(value: string): Buffer {
  return Buffer.from(value, 'base64url')
}

function keyFor(passphrase: string, salt: Buffer): Buffer {
  if (passphrase.length < MIN_PASSPHRASE_LENGTH) {
    throw new Error(`Backup passphrase must be at least ${MIN_PASSPHRASE_LENGTH} characters.`)
  }
  return scryptSync(passphrase, salt, KEY_LENGTH, { N: 16_384, r: 8, p: 1 })
}

function assertDatabase(value: unknown): asserts value is FinanceDatabase {
  if (!value || typeof value !== 'object' || !Number.isInteger((value as { schemaVersion?: unknown }).schemaVersion)) {
    throw new Error('Backup does not contain a valid finance database.')
  }
  for (const collection of ['finance_accounts', 'income_records', 'expense_records', 'transfers', 'settings']) {
    const candidate = (value as Record<string, unknown>)[collection]
    if (collection === 'settings' ? !candidate || typeof candidate !== 'object' : !Array.isArray(candidate)) {
      throw new Error(`Backup is missing finance collection: ${collection}.`)
    }
  }
}

export function encryptFinanceBackup(db: FinanceDatabase, passphrase: string, createdAt = new Date().toISOString()): FinanceBackupEnvelope {
  assertDatabase(db)
  const plaintext = Buffer.from(JSON.stringify(db), 'utf8')
  const salt = randomBytes(16)
  const iv = randomBytes(12)
  const cipher = createCipheriv('aes-256-gcm', keyFor(passphrase, salt), iv)
  const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()])
  return {
    format: 'hermes-finance-backup',
    version: BACKUP_VERSION,
    createdAt,
    kdf: 'scrypt',
    salt: encoded(salt),
    iv: encoded(iv),
    authTag: encoded(cipher.getAuthTag()),
    digest: createHash('sha256').update(plaintext).digest('hex'),
    ciphertext: encoded(ciphertext),
  }
}

export function decryptFinanceBackup(input: unknown, passphrase: string): FinanceDatabase {
  const envelope = input as Partial<FinanceBackupEnvelope> | null
  if (!envelope || envelope.format !== 'hermes-finance-backup' || envelope.version !== BACKUP_VERSION || envelope.kdf !== 'scrypt' || typeof envelope.salt !== 'string' || typeof envelope.iv !== 'string' || typeof envelope.authTag !== 'string' || typeof envelope.digest !== 'string' || typeof envelope.ciphertext !== 'string') {
    throw new Error('Unsupported finance backup format.')
  }
  const decipher = createDecipheriv('aes-256-gcm', keyFor(passphrase, decoded(envelope.salt)), decoded(envelope.iv))
  decipher.setAuthTag(decoded(envelope.authTag))
  let plaintext: Buffer
  try {
    plaintext = Buffer.concat([decipher.update(decoded(envelope.ciphertext)), decipher.final()])
  } catch {
    throw new Error('Backup could not be decrypted. Check the passphrase or file integrity.')
  }
  if (createHash('sha256').update(plaintext).digest('hex') !== envelope.digest) {
    throw new Error('Backup integrity verification failed.')
  }
  let parsed: unknown
  try { parsed = JSON.parse(plaintext.toString('utf8')) } catch { throw new Error('Backup payload is not valid JSON.') }
  assertDatabase(parsed)
  return parsed
}

export function verifyFinanceBackup(envelope: unknown, passphrase: string): { ok: true; schemaVersion: number; recordCounts: Record<string, number> } {
  const db = decryptFinanceBackup(envelope, passphrase)
  return {
    ok: true,
    schemaVersion: db.schemaVersion,
    recordCounts: Object.fromEntries(Object.entries(db).flatMap(([key, value]) => Array.isArray(value) ? [[key, value.length]] : [])),
  }
}
