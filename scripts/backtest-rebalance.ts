/**
 * CLI runner for the rebalancing-bot backtest (src/server/rebalance-backtest.ts).
 * Mirrors scripts/backtest-grid.ts's shape.
 *
 * Usage:
 *   pnpm exec tsx scripts/backtest-rebalance.ts [--symbols BTCUSDT,ETHUSDT]
 *     [--interval 1h] [--days 365] [--fee-bps 10] [--drift-pct 5]
 *     [--rebalance-minutes 1440] [--starting-balance 500] [--split-pct 70]
 */
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import {
  DEFAULT_REBALANCE_BACKTEST_CONFIG,
  runRebalanceBacktest,
} from '../src/server/rebalance-backtest'
import type {
  RebalanceBacktestConfig,
  RebalanceBacktestReport,
} from '../src/server/rebalance-backtest'
import { splitCandlesByIndex } from '../src/server/trading-backtest'
import type { Candle } from '../src/server/trading-strategies'

function arg(name: string, fallback: string): string {
  const idx = process.argv.indexOf(`--${name}`)
  return idx >= 0 && process.argv[idx + 1] ? process.argv[idx + 1] : fallback
}

function loadCache(
  symbol: string,
  interval: string,
  days: number,
  minDaysAgo = 0,
): Array<Candle> {
  const file = path.join(
    os.homedir(),
    '.hermes',
    'finance',
    'candles-cache',
    `${symbol}-${interval}.json`,
  )
  if (!fs.existsSync(file)) {
    throw new Error(
      `no cached candles at ${file} — run: pnpm exec tsx scripts/backfill-candles.ts --symbols ${symbol} --intervals ${interval}`,
    )
  }
  const parsed = JSON.parse(fs.readFileSync(file, 'utf8')) as { candles: Array<Candle> }
  const cutoff = Date.now() - days * 86_400_000
  const upperBound = minDaysAgo > 0 ? Date.now() - minDaysAgo * 86_400_000 : Infinity
  return parsed.candles.filter((c) => c.openTime >= cutoff && c.openTime < upperBound)
}

const fmt = (n: number, d = 2) => n.toFixed(d)

function reportPath(reportDir: string, symbols: Array<string>, interval: string, days: number, suffix = ''): string {
  const symbolSlug = symbols.join('-').toLowerCase()
  const stamp = new Date().toISOString().replace(/[:.]/g, '-')
  const unique = `${process.pid}-${process.hrtime.bigint().toString(36)}`
  const suffixPart = suffix ? `-${suffix}` : ''
  return path.join(
    reportDir,
    `rebalance-${symbolSlug}-${interval}-${days}d${suffixPart}-${stamp}-${unique}.json`,
  )
}

function printReport(report: RebalanceBacktestReport, title?: string) {
  const heading = title ? `${title}: ` : ''
  console.log(
    `\n${heading}Rebalance backtest ${report.symbols.join('+')}  ${report.from.slice(0, 10)} → ${report.to.slice(0, 10)}  (${report.candleCount} steps)`,
  )
  console.log(
    `fees ${fmt(report.config.feeRatePerSide * 10_000, 0)} bps/side · drift ${fmt(report.config.driftThresholdPct * 100, 1)}% · interval ${report.config.minRebalanceIntervalMinutes}min · rebalances ${report.rebalanceCount}`,
  )
  console.log('─'.repeat(78))
  console.log(
    `equity      ${fmt(report.config.startingBalanceQuote)} → ${fmt(report.finalEquityQuote)} USDT  (${report.returnPct >= 0 ? '+' : ''}${fmt(report.returnPct)}%)`,
  )
  console.log(
    `trades      ${report.trades.length} over ${report.rebalanceCount} rebalance events · fees ${fmt(report.totalFeesQuote)} USDT`,
  )
  console.log(`max drawdown ${fmt(report.maxDrawdownPct)}% (on equity)`)
  const ra = report.riskAdjusted
  console.log(
    `risk-adj    Sharpe ${ra.sharpeRatio == null ? '—' : fmt(ra.sharpeRatio)} · Calmar ${ra.calmarRatio == null ? '—' : fmt(ra.calmarRatio)} · annualized ${ra.annualizedReturnPct == null ? '—' : `${ra.annualizedReturnPct >= 0 ? '+' : ''}${fmt(ra.annualizedReturnPct)}%`}`,
  )
  const bh = Object.entries(report.buyAndHoldReturnPct)
    .map(([s, r]) => `${s} ${r >= 0 ? '+' : ''}${fmt(r)}%`)
    .join(' · ')
  console.log(`buy & hold  ${bh}`)
}

function main() {
  const symbols = arg('symbols', DEFAULT_REBALANCE_BACKTEST_CONFIG.symbols.join(','))
    .split(',')
    .map((s) => s.trim().toUpperCase())
  const interval = arg('interval', '1h')
  const days = Number(arg('days', '365'))
  const minDaysAgo = Number(arg('min-days-ago', '0'))
  const splitPct = Number(arg('split-pct', '0'))

  const config: RebalanceBacktestConfig = {
    ...DEFAULT_REBALANCE_BACKTEST_CONFIG,
    symbols,
    feeRatePerSide: Number(arg('fee-bps', '10')) / 10_000,
    driftThresholdPct: Number(arg('drift-pct', '5')) / 100,
    minRebalanceIntervalMinutes: Number(arg('rebalance-minutes', '1440')),
    startingBalanceQuote: Number(arg('starting-balance', '500')),
  }

  const candlesBySymbol: Record<string, Array<Candle>> = {}
  for (const s of symbols) candlesBySymbol[s] = loadCache(s, interval, days, minDaysAgo)

  const reportDir = path.join(os.homedir(), '.hermes', 'finance', 'backtest-reports')
  fs.mkdirSync(reportDir, { recursive: true })

  if (splitPct > 0) {
    const { train, test } = splitCandlesByIndex(candlesBySymbol, splitPct)
    const trainReport = runRebalanceBacktest(train, config)
    const testReport = runRebalanceBacktest(test, config)
    printReport(trainReport, 'TRAIN')
    printReport(testReport, 'TEST (out-of-sample)')
    const out = reportPath(reportDir, symbols, interval, days, `split${splitPct}`)
    fs.writeFileSync(out, JSON.stringify({ config, train: trainReport, test: testReport }, null, 2))
    console.log(`\nsaved: ${out}`)
    return
  }

  const report = runRebalanceBacktest(candlesBySymbol, config)
  printReport(report)
  const out = reportPath(reportDir, symbols, interval, days)
  fs.writeFileSync(out, JSON.stringify(report, null, 2))
  console.log(`\nsaved: ${out}`)
}

main()
