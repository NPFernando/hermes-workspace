import { describe, expect, it } from 'vitest'
import { createEmptyFinanceDatabase } from './finance-store'
import { decryptFinanceBackup, encryptFinanceBackup, verifyFinanceBackup } from './finance-backup'

describe('finance backup encryption', () => {
  it('round-trips the database and reports verified record counts', () => {
    const db = createEmptyFinanceDatabase()
    db.finance_accounts.push({ id: 'a', name: 'Cash', type: 'bank', currency: 'LKR', balance: 10, source: 'test', createdAt: '2026-01-01', updatedAt: '2026-01-01' })
    const backup = encryptFinanceBackup(db, 'correct horse battery staple', '2026-09-11T00:00:00.000Z')
    expect(backup.ciphertext).not.toContain('Cash')
    expect(decryptFinanceBackup(backup, 'correct horse battery staple').finance_accounts).toHaveLength(1)
    expect(verifyFinanceBackup(backup, 'correct horse battery staple')).toMatchObject({ ok: true, recordCounts: { finance_accounts: 1 } })
  })

  it('rejects short or incorrect passphrases and tampered ciphertext', () => {
    const backup = encryptFinanceBackup(createEmptyFinanceDatabase(), 'correct horse battery staple')
    expect(() => encryptFinanceBackup(createEmptyFinanceDatabase(), 'too-short')).toThrow(/at least 12/)
    expect(() => decryptFinanceBackup(backup, 'wrong passphrase')).toThrow(/could not be decrypted/)
    expect(() => decryptFinanceBackup({ ...backup, ciphertext: `${backup.ciphertext}x` }, 'correct horse battery staple')).toThrow(/could not be decrypted|integrity/)
  })
})
