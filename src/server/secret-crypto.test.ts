import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { randomBytes } from 'node:crypto'
import { decryptSecret, encryptSecret, secretKeyConfigured } from './secret-crypto'

describe('secret-crypto', () => {
  let realKey: string | undefined

  beforeEach(() => {
    realKey = process.env.FINANCE_SECRET_KEY
    process.env.FINANCE_SECRET_KEY = randomBytes(32).toString('base64')
  })
  afterEach(() => {
    if (realKey === undefined) delete process.env.FINANCE_SECRET_KEY
    else process.env.FINANCE_SECRET_KEY = realKey
  })

  it('round-trips a plaintext secret', () => {
    const encrypted = encryptSecret('my-real-password-123')
    expect(encrypted).not.toContain('my-real-password-123')
    expect(decryptSecret(encrypted)).toBe('my-real-password-123')
  })

  it('produces a different ciphertext each time (random IV) even for the same plaintext', () => {
    const a = encryptSecret('same-value')
    const b = encryptSecret('same-value')
    expect(a).not.toBe(b)
    expect(decryptSecret(a)).toBe('same-value')
    expect(decryptSecret(b)).toBe('same-value')
  })

  it('reports secretKeyConfigured() true when a valid key is present', () => {
    expect(secretKeyConfigured()).toBe(true)
  })

  it('reports secretKeyConfigured() false and throws a clear error when the key is missing', () => {
    // The VITEST env-file-fallback guard in secret-crypto.ts means this
    // never falls back to this machine's real ~/.hermes/.env key.
    delete process.env.FINANCE_SECRET_KEY
    expect(secretKeyConfigured()).toBe(false)
    expect(() => encryptSecret('x')).toThrow(/FINANCE_SECRET_KEY/)
  })

  it('throws when the key does not decode to 32 bytes', () => {
    process.env.FINANCE_SECRET_KEY = Buffer.from('too-short').toString('base64')
    expect(() => encryptSecret('x')).toThrow(/32 bytes/)
  })

  it('fails to decrypt with a malformed ciphertext string', () => {
    expect(() => decryptSecret('not-a-valid-payload')).toThrow()
  })

  it('fails to decrypt when the auth tag does not match (tampered ciphertext)', () => {
    const encrypted = encryptSecret('secret-value')
    const [iv, tag, ciphertext] = encrypted.split(':')
    const tampered = [iv, tag, `${ciphertext.slice(0, -2)}zz`].join(':')
    expect(() => decryptSecret(tampered)).toThrow()
  })
})
