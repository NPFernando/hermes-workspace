import { chmodSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  clampDays,
  loadHarpRouteStats,
  parseHarpRouteStats,
  resolveHarpBin,
} from './harp-route-stats'

function row(overrides: Record<string, unknown> = {}) {
  return {
    task_family: 'code_review',
    provider: 'openai-codex',
    model: 'gpt-5.5',
    n: 6,
    success: 5,
    failure: 1,
    escalated: 0,
    success_rate: 0.75,
    demoted: false,
    ...overrides,
  }
}

function statsFixture(routes = [row()]) {
  return {
    contract: 'harp-route-stats-v1',
    window_days: 30,
    outcomes: 6,
    min_samples: 5,
    demote_below: 0.5,
    routes,
    classifier: { agreed: 3, corrected: 1, accuracy: 0.75 },
  }
}

function fakeHarp(script: string): string {
  const dir = mkdtempSync(join(tmpdir(), 'harp-stats-'))
  const bin = join(dir, 'harp')
  writeFileSync(bin, `#!/bin/sh\n${script}\n`)
  chmodSync(bin, 0o700)
  return bin
}

describe('HARP route stats', () => {
  it('accepts harp-route-stats-v1 and sorts weakest routes first', () => {
    const weak = row({ model: 'weak', success_rate: 0.2, demoted: true })
    const parsed = parseHarpRouteStats(statsFixture([row(), weak]))
    expect(parsed?.routes.map((r) => r.model)).toEqual(['weak', 'gpt-5.5'])
    expect(parsed?.classifier.accuracy).toBe(0.75)
  })

  it('rejects other contracts and malformed rows', () => {
    expect(parseHarpRouteStats({ ...statsFixture(), contract: 'x' })).toBeNull()
    expect(parseHarpRouteStats(statsFixture([row({ n: -1 })]))).toBeNull()
    expect(
      parseHarpRouteStats(statsFixture([row({ success_rate: 2 })])),
    ).toBeNull()
    expect(
      parseHarpRouteStats({
        ...statsFixture(),
        classifier: { agreed: 0, corrected: 0, accuracy: 'n/a' },
      }),
    ).toBeNull()
  })

  it('parses optional coverage and tolerates older HARP without it', () => {
    const coverage = {
      plans: 4,
      reported: 1,
      rate: 0.25,
      by_host: [{ host: 'paperclip', plans: 4, reported: 1 }],
    }
    expect(
      parseHarpRouteStats({ ...statsFixture(), coverage })?.coverage,
    ).toEqual({ ...coverage, by_agent: [] })
    expect(parseHarpRouteStats(statsFixture())?.coverage).toBeNull()
    expect(
      parseHarpRouteStats({ ...statsFixture(), coverage: { plans: -1 } })
        ?.coverage,
    ).toBeNull()
  })

  it('folds pre-rename agent names into personas', () => {
    const stats = parseHarpRouteStats({
      ...statsFixture([
        row({ agents: ['DevOps / SRE Engineer', 'VESTA', 'ADA'], observed: 2 }),
      ]),
      coverage: {
        plans: 6,
        reported: 2,
        rate: 0.333,
        by_host: [{ host: 'paperclip', plans: 6, reported: 2 }],
        by_agent: [
          {
            host: 'paperclip',
            agent: 'Engineering Manager',
            plans: 3,
            reported: 1,
          },
          { host: 'paperclip', agent: 'MINERVA', plans: 2, reported: 1 },
          { host: 'paperclip', agent: 'ASTRA', plans: 1, reported: 0 },
        ],
      },
    })
    expect(stats?.routes[0]).toMatchObject({
      observed: 2,
      agents: ['CASSIA', 'VESTA'],
    })
    expect(stats?.coverage?.by_agent).toEqual([
      { agent: 'MINERVA', plans: 5, reported: 2 },
      { agent: 'ASTRA', plans: 1, reported: 0 },
    ])
    expect(parseHarpRouteStats(statsFixture([row({ agents: [1] })]))).toBeNull()
    expect(parseHarpRouteStats(statsFixture())?.routes[0]).toMatchObject({
      observed: 0,
      agents: [],
    })
  })

  it('clamps the window to 1..365 days', () => {
    expect(clampDays('7')).toBe(7)
    expect(clampDays(null)).toBe(30)
    expect(clampDays('-3')).toBe(30)
    expect(clampDays('9999')).toBe(365)
  })

  it('prefers HARP_BIN when set', () => {
    expect(resolveHarpBin({ HARP_BIN: '/opt/harp' })).toBe('/opt/harp')
  })

  it('runs the read-only stats command with a bounded window', async () => {
    const out = join(mkdtempSync(join(tmpdir(), 'harp-args-')), 'args')
    const bin = fakeHarp(
      `echo "$@" > ${out}\ncat <<'JSON'\n${JSON.stringify(statsFixture())}\nJSON`,
    )
    const stats = await loadHarpRouteStats(9999, bin)
    expect(stats.routes).toHaveLength(1)
    const { readFileSync } = await import('node:fs')
    expect(readFileSync(out, 'utf8').trim()).toBe(
      'route stats --json --days 365',
    )
  })

  it('rejects failing, non-JSON and off-contract output', async () => {
    await expect(loadHarpRouteStats(30, fakeHarp('exit 2'))).rejects.toThrow(
      'failed',
    )
    await expect(loadHarpRouteStats(30, fakeHarp('echo nope'))).rejects.toThrow(
      'invalid JSON',
    )
    await expect(
      loadHarpRouteStats(30, fakeHarp(`echo '{"contract":"other"}'`)),
    ).rejects.toThrow('harp-route-stats-v1')
  })
})
