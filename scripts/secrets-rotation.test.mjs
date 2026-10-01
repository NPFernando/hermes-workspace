import { describe, expect, it } from 'vitest'
import {
  DEFAULT_KEYS,
  recordRotation,
  rotationStatus,
} from './secrets-rotation.mjs'

describe('secret rotation metadata', () => {
  it('tracks the production read-only E2E credential separately from the client variable', () => {
    expect(DEFAULT_KEYS).toContain('HERMES_E2E_PASSWORD')
    expect(DEFAULT_KEYS).toContain('AUTH_E2E_PASSWORD')
    expect(DEFAULT_KEYS).toContain('GOOGLE_CLIENT_ID')
    expect(DEFAULT_KEYS).toContain('GOOGLE_CLIENT_SECRET')
    expect(DEFAULT_KEYS).toContain('HERMES_FINANCE_BACKUP_PASSPHRASE')
    expect(DEFAULT_KEYS).toContain('HERMES_FINANCE_BACKUP_RCLONE_REMOTE')
    expect(DEFAULT_KEYS).toContain('OPENROUTER_API_KEY')
  })
  it('reports valid, expiring, and expired metadata without exposing values', () => {
    const metadata = {
      version: 1,
      secrets: {
        VALID_KEY: {
          owner: 'ops',
          source: 'env',
          rotatedAt: '2026-09-01T00:00:00.000Z',
          expiresAt: '2026-10-01T00:00:00.000Z',
        },
        SOON_KEY: {
          owner: 'ci',
          source: 'github',
          rotatedAt: '2026-09-01T00:00:00.000Z',
          expiresAt: '2026-09-20T00:00:00.000Z',
        },
        OLD_KEY: {
          owner: 'db',
          source: 'env',
          rotatedAt: '2026-08-01T00:00:00.000Z',
          expiresAt: '2026-09-10T00:00:00.000Z',
        },
      },
    }
    const status = rotationStatus(metadata, {
      configuredKeys: ['VALID_KEY'],
      now: Date.parse('2026-09-17T00:00:00.000Z'),
      warningDays: 13,
    })
    expect(
      status.map((entry) => [entry.key, entry.state, entry.configured]),
    ).toEqual([
      ['VALID_KEY', 'valid', true],
      ['SOON_KEY', 'expiring', false],
      ['OLD_KEY', 'expired', false],
    ])
  })

  it('records only rotation metadata', () => {
    const next = recordRotation(
      { version: 1, secrets: {} },
      {
        key: 'AUTH_E2E_PASSWORD',
        owner: 'ci',
        source: 'github-actions',
        rotatedAt: '2026-09-17T00:00:00Z',
        expiresAt: '2026-12-17T00:00:00Z',
      },
    )
    expect(next.secrets.AUTH_E2E_PASSWORD).toEqual({
      owner: 'ci',
      source: 'github-actions',
      rotatedAt: '2026-09-17T00:00:00.000Z',
      expiresAt: '2026-12-17T00:00:00.000Z',
    })
    expect(JSON.stringify(next)).not.toContain('password-value')
  })

  it('reports configured keys that have no rotation metadata yet', () => {
    const status = rotationStatus(
      { version: 1, secrets: {} },
      { configuredKeys: ['GOOGLE_CLIENT_ID', 'OPENAI_API_KEY'] },
    )
    expect(status).toEqual([
      expect.objectContaining({
        key: 'GOOGLE_CLIENT_ID',
        state: 'untracked',
        configured: true,
      }),
      expect.objectContaining({
        key: 'OPENAI_API_KEY',
        state: 'untracked',
        configured: true,
      }),
    ])
  })
})
