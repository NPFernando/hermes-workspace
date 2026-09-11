import { mkdtempSync, readFileSync, rmSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  appendCseMarketSnapshot,
  fetchCseMarketSnapshot,
  parseCseMarketSnapshot,
  readCseMarketSnapshots,
} from './cse-market-index.service'

describe('CSE market index provider', () => {
  it('normalizes the nested daily market response', async () => {
    const result = await fetchCseMarketSnapshot({
      id: 'fixture',
      fetchSnapshot: async () => [
        [
          {
            tradeDate: 1754505000000,
            asi: 19826.57,
            aspiChange: 21.77,
            spp: 5825.39,
            sppChange: -2.46,
            marketTurnover: 3263761920,
            volumeOfTurnOverNumber: 115084304,
            tradesNo: 30274,
            marketCap: 6940225783432,
          },
        ],
      ],
    })

    expect(result).toMatchObject({
      aspi: 19826.57,
      aspiChange: 21.77,
      sp20: 5825.39,
      sp20Change: -2.46,
      marketTurnover: 3263761920,
      shareVolume: 115084304,
      trades: 30274,
      marketCap: 6940225783432,
      source: 'cse_unofficial',
    })
    expect(result?.tradeDate).toBe('2025-08-06T18:30:00.000Z')
  })

  it('accepts a single-index response and leaves unavailable metrics null', () => {
    expect(
      parseCseMarketSnapshot({ value: '19,826.57', change: '21.77' }),
    ).toMatchObject({ aspi: 19826.57, aspiChange: 21.77, sp20: null })
  })

  it('rejects an unrelated or unusable response', () => {
    expect(parseCseMarketSnapshot({ status: 'Market Closed' })).toBeNull()
    expect(parseCseMarketSnapshot({ asi: null, spp: null })).toBeNull()
  })

  it('turns provider failures into a normal null result', async () => {
    await expect(
      fetchCseMarketSnapshot({
        id: 'failing',
        fetchSnapshot: async () => {
          throw new Error('network down')
        },
      }),
    ).resolves.toBeNull()
  })

  it('deduplicates by trade day, caps history, and writes private storage', () => {
    const dir = mkdtempSync(join(tmpdir(), 'cse-market-index-'))
    const path = join(dir, 'snapshots.json')
    try {
      const makeSnapshot = (day: number) => ({
        capturedAt: new Date(Date.UTC(2026, 0, day, 10)).toISOString(),
        tradeDate: new Date(Date.UTC(2026, 0, day)).toISOString(),
        aspi: day,
        aspiChange: 1,
        sp20: day,
        sp20Change: 1,
        marketTurnover: day,
        shareVolume: day,
        trades: day,
        marketCap: day,
        source: 'cse_unofficial' as const,
      })

      for (let day = 1; day <= 365; day += 1) {
        appendCseMarketSnapshot(makeSnapshot(day), path)
      }
      const replacement = makeSnapshot(365)
      replacement.aspi = 999
      const snapshots = appendCseMarketSnapshot(replacement, path)

      expect(snapshots).toHaveLength(365)
      expect(snapshots.at(-1)?.aspi).toBe(999)
      expect(readCseMarketSnapshots(path)).toHaveLength(365)
      expect(statSync(path).mode & 0o777).toBe(0o600)
      expect(readFileSync(path, 'utf8')).not.toContain('/home/')
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})
