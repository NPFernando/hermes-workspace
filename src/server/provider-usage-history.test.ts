import { execFileSync } from 'node:child_process'
import { mkdtempSync, rmSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { recordAndReadProviderUsageHistory } from './provider-usage-history'
import type { ProviderUsageResult } from './provider-usage'

const directories: Array<string> = []

afterEach(() => {
  for (const directory of directories.splice(0)) {
    rmSync(directory, { recursive: true, force: true })
  }
})

function tempDatabase(): string {
  const directory = mkdtempSync(join(tmpdir(), 'provider-usage-history-'))
  directories.push(directory)
  return join(directory, 'history.db')
}

function provider(updatedAt: number, used: number): ProviderUsageResult {
  return {
    provider: 'codex',
    displayName: 'Codex',
    status: 'ok',
    source: 'fixture provider feed',
    sourceKind: 'provider_api',
    lines: [
      {
        type: 'progress',
        label: 'Weekly',
        measure: 'quota',
        used,
        limit: 100,
        format: 'percent',
      },
      { type: 'text', label: 'Private detail', value: 'must not be stored' },
    ],
    updatedAt,
  }
}

describe('provider usage history', () => {
  it('stores only aggregate quota samples and returns the latest point per UTC day', () => {
    const dbPath = tempDatabase()
    const first = Date.UTC(2026, 8, 10, 10)
    const laterSameDay = Date.UTC(2026, 8, 10, 18)
    const nextDay = Date.UTC(2026, 8, 11, 9)

    expect(
      recordAndReadProviderUsageHistory([provider(first, 40)], {
        dbPath,
        now: first,
        days: 7,
      }),
    ).toHaveLength(1)
    const history = recordAndReadProviderUsageHistory(
      [provider(laterSameDay, 60), provider(nextDay, 75)],
      { dbPath, now: nextDay, days: 7 },
    )

    expect(history).toEqual([
      expect.objectContaining({
        day: '2026-09-10',
        provider: 'codex',
        label: 'Weekly',
        used: 60,
        limit: 100,
        percent: 60,
      }),
      expect.objectContaining({
        day: '2026-09-11',
        provider: 'codex',
        used: 75,
        percent: 75,
      }),
    ])
    expect(JSON.stringify(history)).not.toContain('must not be stored')
    const stored = execFileSync(
      '/usr/bin/sqlite3',
      [
        '-json',
        dbPath,
        'SELECT provider, label, used FROM provider_usage_samples;',
      ],
      { encoding: 'utf8' },
    )
    expect(stored).not.toContain('Private detail')
    expect(JSON.parse(stored)).toHaveLength(3)
    expect(statSync(dbPath).mode & 0o777).toBe(0o600)
  })

  it('does not record failed provider readings', () => {
    const dbPath = tempDatabase()
    const failed: ProviderUsageResult = {
      ...provider(Date.UTC(2026, 8, 12), 90),
      status: 'error',
      message: 'feed unavailable',
    }

    expect(
      recordAndReadProviderUsageHistory([failed], {
        dbPath,
        now: Date.UTC(2026, 8, 12),
      }),
    ).toEqual([])
  })
})
