/**
 * Encrypted Finance backup with an off-site round-trip verification.
 *
 * Required environment (normally supplied by ~/.hermes/.env):
 *   HERMES_FINANCE_BACKUP_PASSPHRASE       12+ character secret
 *   HERMES_FINANCE_BACKUP_RCLONE_REMOTE    rclone remote, e.g. b2:hermes
 *
 * The job fails closed when either value or rclone is unavailable. It uploads
 * an AES-256-GCM Finance envelope, downloads that exact object again, and
 * verifies authentication, digest, schema, and record counts before success.
 */
import { execFileSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { homedir, tmpdir } from 'node:os'
import { join } from 'node:path'

function loadHermesEnv(): void {
  const home = process.env.HERMES_HOME ?? join(homedir(), '.hermes')
  try {
    for (const line of readFileSync(join(home, '.env'), 'utf8').split('\n')) {
      const match = line.match(
        /^(HERMES_FINANCE_BACKUP_(?:PASSPHRASE|RCLONE_REMOTE))=(.*)$/,
      )
      if (match && !process.env[match[1]])
        process.env[match[1]] = match[2].trim().replace(/^"|"$/g, '')
    }
  } catch {
    // Missing configuration is reported below without exposing secret paths.
  }
}

loadHermesEnv()

const passphrase = process.env.HERMES_FINANCE_BACKUP_PASSPHRASE?.trim() || ''
const remote = process.env.HERMES_FINANCE_BACKUP_RCLONE_REMOTE?.trim() || ''
if (!passphrase)
  throw new Error(
    'HERMES_FINANCE_BACKUP_PASSPHRASE is required; refusing an unencrypted backup.',
  )
if (!/^[A-Za-z0-9][A-Za-z0-9_-]*:.+$/.test(remote) || /[\s\n\r]/.test(remote)) {
  throw new Error(
    'HERMES_FINANCE_BACKUP_RCLONE_REMOTE must be an explicit rclone remote such as b2:hermes-finance.',
  )
}

const rclone = process.env.HERMES_RCLONE_BIN || 'rclone'
const stamp = new Date()
  .toISOString()
  .replace(/[-:]/g, '')
  .replace(/\.\d{3}Z$/, 'Z')
const filename = `finance-${stamp}.json.enc`
const destination = `${remote.replace(/\/$/, '')}/${filename}`
const tempDir = mkdtempSync(join(tmpdir(), 'hermes-finance-offsite-'))
const staged = join(tempDir, filename)
const downloaded = join(tempDir, `verify-${filename}`)

function rcloneCopy(source: string, target: string): void {
  execFileSync(rclone, ['copyto', source, target], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    timeout: 120_000,
  })
}

try {
  const { readFinanceStore } = await import('../src/server/finance-store')
  const { decryptFinanceBackup, encryptFinanceBackup, verifyFinanceBackup } =
    await import('../src/server/finance-backup')
  const db = readFinanceStore()
  const envelope = encryptFinanceBackup(db, passphrase)
  writeFileSync(staged, `${JSON.stringify(envelope)}\n`, { mode: 0o600 })

  rcloneCopy(staged, destination)
  rcloneCopy(destination, downloaded)
  const restored = JSON.parse(readFileSync(downloaded, 'utf8')) as unknown
  const verification = verifyFinanceBackup(restored, passphrase)
  decryptFinanceBackup(restored, passphrase)

  console.log(
    JSON.stringify(
      {
        ok: true,
        filename,
        encrypted: true,
        roundTripVerified: true,
        schemaVersion: verification.schemaVersion,
        recordCounts: verification.recordCounts,
      },
      null,
      2,
    ),
  )
} finally {
  rmSync(tempDir, { recursive: true, force: true })
}
