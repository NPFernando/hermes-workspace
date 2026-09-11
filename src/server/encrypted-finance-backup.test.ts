import { describe, expect, it } from 'vitest'
import {
  decryptFinanceBackup,
  encryptFinanceBackup,
  encryptedBackupPassphraseMinimum,
} from './encrypted-finance-backup'

describe('encrypted finance backup', () => {
  const passphrase = 'correct horse battery staple'

  it('round-trips finance data and audit text', () => {
    const serialized = encryptFinanceBackup(
      { schemaVersion: 1, settings: { baseCurrency: 'LKR' } },
      '{"action":"record_added:expense"}\n',
      passphrase,
    )
    expect(serialized).not.toContain('battery')
    expect(decryptFinanceBackup(serialized, passphrase)).toEqual({
      formatVersion: 1,
      finance: { schemaVersion: 1, settings: { baseCurrency: 'LKR' } },
      auditLog: '{"action":"record_added:expense"}\n',
    })
  })

  it('rejects a wrong passphrase and short passphrases', () => {
    const serialized = encryptFinanceBackup({}, 'audit', passphrase)
    expect(() => decryptFinanceBackup(serialized, 'wrong passphrase')).toThrow(
      /Unable to decrypt/,
    )
    expect(() => encryptFinanceBackup({}, '', 'short')).toThrow(
      `between ${encryptedBackupPassphraseMinimum} and 256`,
    )
  })

  it('detects tampering through the authenticated encryption tag', () => {
    const envelope = JSON.parse(
      encryptFinanceBackup({ safe: true }, '', passphrase),
    ) as { ciphertext: string }
    envelope.ciphertext = `${envelope.ciphertext.slice(0, -1)}A`
    expect(() =>
      decryptFinanceBackup(JSON.stringify(envelope), passphrase),
    ).toThrow(/Unable to decrypt/)
  })
})
