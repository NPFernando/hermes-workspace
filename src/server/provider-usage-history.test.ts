import { readFile, rm, stat, mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

describe('provider health history', () => {
  beforeEach(() => {
    vi.resetModules()
    delete process.env.HERMES_HOME
  })

  afterEach(() => {
    delete process.env.HERMES_HOME
  })

  it('persists status-only snapshots, deduplicates stable polls, and caps history', async () => {
    const home = await mkdtemp(join(tmpdir(), 'hermes-provider-health-'))
    process.env.HERMES_HOME = home
    try {
      const { recordProviderHealthSnapshot } = await import('./provider-usage')
      const healthy = [{ provider: 'codex', status: 'ok' as const }]
      const first = recordProviderHealthSnapshot(healthy, 1_000)
      expect(first).toHaveLength(1)
      expect(
        recordProviderHealthSnapshot(healthy, 2_000),
      ).toHaveLength(1)

      const changed = [
        { provider: 'codex', status: 'auth_expired' as const },
      ]
      expect(recordProviderHealthSnapshot(changed, 301_001)).toHaveLength(2)

      let history = recordProviderHealthSnapshot(healthy, 601_001)
      for (let i = 1; i < 60; i += 1) {
        history = recordProviderHealthSnapshot(
          [{ provider: `provider-${i}`, status: 'error' as const }],
          601_001 + i * 300_001,
        )
      }
      expect(history).toHaveLength(48)
      expect(history[0].providers[0].provider).toBe('provider-12')

      const historyPath = join(home, 'provider-health-history.json')
      const persisted = JSON.parse(await readFile(historyPath, 'utf8')) as Array<{
        capturedAt: number
        providers: Array<Record<string, unknown>>
      }>
      expect(persisted.length).toBeLessThanOrEqual(48)
      expect(
        persisted.every((entry) =>
          entry.providers.every(
            (provider) =>
              Object.keys(provider).sort().join(',') === 'provider,status',
          ),
        ),
      ).toBe(true)
      expect((await stat(historyPath)).mode & 0o777).toBe(0o600)
    } finally {
      await rm(home, { recursive: true, force: true })
    }
  })
})
