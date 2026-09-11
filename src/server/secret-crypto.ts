/**
 * AES-256-GCM helpers for the one legitimate secret this app stores at
 * rest: passwords the user explicitly registers for known Gmail billers
 * (gmail-known-senders.ts), so gmail-ingest.ts can auto-unlock a matching
 * encrypted PDF instead of guessing. The ciphertext lives in the finance
 * Postgres store (settings.gmailIngest.knownSenders[].encryptedPassword);
 * only the decryption key lives outside it, in ~/.hermes/.env, following
 * the same file-fallback convention finance-postgres-store.ts already uses
 * for HERMES_PG_PASSWORD. Nothing that imports this module ever returns a
 * decrypted value to the client — see list_known_senders in api/finance.ts,
 * which only reports a `hasPassword` boolean.
 */
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import {
  createCipheriv,
  createDecipheriv,
  randomBytes,
} from 'node:crypto'

const HERMES_HOME =
  process.env.HERMES_HOME ??
  process.env.CLAUDE_HOME ??
  path.join(os.homedir(), '.hermes')

const KEY_ENV_VAR = 'FINANCE_SECRET_KEY'

function envFileKey(): string | undefined {
  // Same guard finance-postgres-store.ts's financePostgresEnabled() uses:
  // without it, a test that forgets to set FINANCE_SECRET_KEY would
  // silently fall back to this machine's real ~/.hermes/.env key instead of
  // failing loudly.
  if (process.env.VITEST || process.env.NODE_ENV === 'test') return undefined
  try {
    const env = fs.readFileSync(path.join(HERMES_HOME, '.env'), 'utf8')
    const match = env.match(new RegExp(`^${KEY_ENV_VAR}=(.*)$`, 'm'))
    return match?.[1]?.trim().replace(/^"|"$/g, '')
  } catch {
    return undefined
  }
}

/** 32-byte AES-256 key, base64-encoded. Missing key is a hard error — never falls back to a fixed key. */
function loadKey(): Buffer {
  const raw = process.env[KEY_ENV_VAR] || envFileKey()
  if (!raw) {
    throw new Error(
      `${KEY_ENV_VAR} is not set (checked process.env and ${path.join(HERMES_HOME, '.env')}) — cannot encrypt/decrypt sender passwords.`,
    )
  }
  const key = Buffer.from(raw, 'base64')
  if (key.length !== 32) {
    throw new Error(
      `${KEY_ENV_VAR} must decode to 32 bytes (got ${key.length}) — expected a base64-encoded AES-256 key.`,
    )
  }
  return key
}

/** Returns true without throwing — lets callers show a clear setup error instead of a stack trace. */
export function secretKeyConfigured(): boolean {
  try {
    loadKey()
    return true
  } catch {
    return false
  }
}

/** iv:authTag:ciphertext, each base64, colon-joined so it's a single plain string column/JSON value. */
export function encryptSecret(plaintext: string): string {
  const key = loadKey()
  const iv = randomBytes(12)
  const cipher = createCipheriv('aes-256-gcm', key, iv)
  const ciphertext = Buffer.concat([
    cipher.update(plaintext, 'utf8'),
    cipher.final(),
  ])
  const authTag = cipher.getAuthTag()
  return [
    iv.toString('base64'),
    authTag.toString('base64'),
    ciphertext.toString('base64'),
  ].join(':')
}

export function decryptSecret(encrypted: string): string {
  const key = loadKey()
  const [ivB64, tagB64, ciphertextB64] = encrypted.split(':')
  if (!ivB64 || !tagB64 || !ciphertextB64) {
    throw new Error('Malformed encrypted secret (expected iv:authTag:ciphertext).')
  }
  const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(ivB64, 'base64'))
  decipher.setAuthTag(Buffer.from(tagB64, 'base64'))
  const plaintext = Buffer.concat([
    decipher.update(Buffer.from(ciphertextB64, 'base64')),
    decipher.final(),
  ])
  return plaintext.toString('utf8')
}
