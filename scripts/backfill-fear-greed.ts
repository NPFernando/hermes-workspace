/**
 * One-shot cache of the full Crypto Fear & Greed Index history (alternative.me,
 * free/public/no-auth, confirmed 2026-07-24) for the offline backtester.
 * Unlike candle data, the whole history (3000+ daily points back to
 * 2018-02-01) comes back in a single request via limit=0 — no pagination,
 * no live finance-store write (this is public, non-tradeable market
 * sentiment data, not account/trade data).
 *
 * Usage:
 *   pnpm exec tsx scripts/backfill-fear-greed.ts
 *
 * Writes ~/.hermes/finance/fear-greed-cache.json:
 *   { "fetchedAt": "...", "points": [{ "value": 31, "classification": "Fear", "timestamp": 1784764800 }, ...] }
 */
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import { fetchFearGreedHistory } from '../src/server/fear-greed-sentiment'

async function main() {
  const points = await fetchFearGreedHistory(0)
  const cacheDir = path.join(os.homedir(), '.hermes', 'finance')
  fs.mkdirSync(cacheDir, { recursive: true })
  const file = path.join(cacheDir, 'fear-greed-cache.json')
  fs.writeFileSync(
    file,
    JSON.stringify({ fetchedAt: new Date().toISOString(), points }, null, 2),
  )
  const oldest = points[points.length - 1]
  const newest = points[0]
  console.log(
    `Cached ${points.length} Fear & Greed points (${new Date(oldest.timestamp * 1000).toISOString().slice(0, 10)} → ${new Date(newest.timestamp * 1000).toISOString().slice(0, 10)}) to ${file}`,
  )
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
