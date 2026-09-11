import {
  createCipheriv,
  createDecipheriv,
  randomBytes,
  scryptSync,
} from 'node:crypto'

const FORMAT_VERSION = 1
const KEY_BYTES = 32
const SALT_BYTES = 16
const IV_BYTES = 12
const MIN_PASSPHRASE_LENGTH = 12

type EncryptedBackupEnvelope = {
  version: 1
  algorithm: 'aes-256-gcm'
  kdf: 'scrypt'
  salt: string
  iv: string
  authTag: string
  ciphertext: string
  createdAt: string
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

export type FinanceBackupPayload = {
  formatVersion: 1
  finance: unknown
  auditLog: string
}

function requirePassphrase(passphrase: string): void {
  if (
    typeof passphrase !== 'string' ||
    passphrase.length < MIN_PASSPHRASE_LENGTH ||
    passphrase.length > 256
  ) {
    throw new Error(
      `Passphrase must be between ${MIN_PASSPHRASE_LENGTH} and 256 characters`,
    )
  }
}

function deriveKey(passphrase: string, salt: Buffer): Buffer {
  return scryptSync(passphrase, salt, KEY_BYTES, {
    N: 16_384,
    r: 8,
    p: 1,
    maxmem: 32 * 1024 * 1024,
  })
}

export function encryptFinanceBackup(
  finance: unknown,
  auditLog: string,
  passphrase: string,
): string {
  requirePassphrase(passphrase)
  const salt = randomBytes(SALT_BYTES)
  const iv = randomBytes(IV_BYTES)
  const cipher = createCipheriv('aes-256-gcm', deriveKey(passphrase, salt), iv)
  const payload: FinanceBackupPayload = {
    formatVersion: FORMAT_VERSION,
    finance,
    auditLog,
  }
  const ciphertext = Buffer.concat([
    cipher.update(JSON.stringify(payload), 'utf8'),
    cipher.final(),
  ])
  const envelope: EncryptedBackupEnvelope = {
    version: FORMAT_VERSION,
    algorithm: 'aes-256-gcm',
    kdf: 'scrypt',
    salt: salt.toString('base64url'),
    iv: iv.toString('base64url'),
    authTag: cipher.getAuthTag().toString('base64url'),
    ciphertext: ciphertext.toString('base64url'),
    createdAt: new Date().toISOString(),
  }
  return `${JSON.stringify(envelope)}\n`
}

export function decryptFinanceBackup(
  serialized: string,
  passphrase: string,
): FinanceBackupPayload {
  requirePassphrase(passphrase)
  if (Buffer.byteLength(serialized, 'utf8') > 20_000_000) {
    throw new Error('Encrypted backup exceeds the 20 MB limit')
  }
  let parsedEnvelope: unknown
  try {
    parsedEnvelope = JSON.parse(serialized) as unknown
  } catch {
    throw new Error('Encrypted backup is not valid JSON')
  }
  if (
    !isRecord(parsedEnvelope) ||
    parsedEnvelope.version !== FORMAT_VERSION ||
    parsedEnvelope.algorithm !== 'aes-256-gcm' ||
    parsedEnvelope.kdf !== 'scrypt' ||
    typeof parsedEnvelope.salt !== 'string' ||
    typeof parsedEnvelope.iv !== 'string' ||
    typeof parsedEnvelope.authTag !== 'string' ||
    typeof parsedEnvelope.ciphertext !== 'string'
  ) {
    throw new Error('Unsupported encrypted backup format')
  }
  const envelope = parsedEnvelope as EncryptedBackupEnvelope
  try {
    const decipher = createDecipheriv(
      'aes-256-gcm',
      deriveKey(passphrase, Buffer.from(envelope.salt, 'base64url')),
      Buffer.from(envelope.iv, 'base64url'),
    )
    decipher.setAuthTag(Buffer.from(envelope.authTag, 'base64url'))
    const plaintext = Buffer.concat([
      decipher.update(Buffer.from(envelope.ciphertext, 'base64url')),
      decipher.final(),
    ]).toString('utf8')
    const parsedPayload = JSON.parse(plaintext) as unknown
    if (
      !isRecord(parsedPayload) ||
      parsedPayload.formatVersion !== FORMAT_VERSION ||
      typeof parsedPayload.auditLog !== 'string' ||
      !('finance' in parsedPayload)
    ) {
      throw new Error('Encrypted backup payload is invalid')
    }
    return parsedPayload as FinanceBackupPayload
  } catch {
    throw new Error('Unable to decrypt backup; check the passphrase and file')
  }
}

export const encryptedBackupPassphraseMinimum = MIN_PASSPHRASE_LENGTH
