/**
 * CLI runner for the demo-trading-engine backtest harness.
 *
 * Reads deep candle history from ~/.hermes/finance/candles-cache/ (populate it
 * with scripts/backfill-candles.ts first), replays it through the strategy
 * council + guardian via src/server/trading-backtest.ts, prints a summary, and
 * saves the full report JSON to ~/.hermes/finance/backtest-reports/.
 *
 * Usage:
 *   pnpm exec tsx scripts/backtest-trading.ts [--symbols BTCUSDT,ETHUSDT]
 *     [--interval 1h] [--days 180] [--fee-bps 10] [--quote-per-trade 25]
 *     [--stop-pct 2] [--tp-pct 3] [--threshold 0.6] [--strategies id,id]
 *     [--regime-sma 200] [--trail-pct 2] [--atr-period 14]
 *     [--atr-stop-mult 2] [--atr-tp-mult 3] [--atr-trail-mult 2]
 *     [--direction long|short|long-short]
 *     [--market-regime-symbol BTCUSDT] [--market-regime-sma 300]
 *     [--score-scope global|per-symbol] [--split-pct 70]
 *     [--folds 4] [--fold-train-pct 70] [--carry-score]
 */
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import {
  DEFAULT_BACKTEST_CONFIG,
  buildWalkForwardWindows,
  runBacktest,
  splitCandlesByIndex,
} from '../src/server/trading-backtest'
import type {
  BacktestConfig,
  BacktestReport,
  BacktestTrade,
} from '../src/server/trading-backtest'
import type { Candle } from '../src/server/trading-strategies'

function arg(name: string, fallback: string): string {
  const idx = process.argv.indexOf(`--${name}`)
  return idx >= 0 && process.argv[idx + 1] ? process.argv[idx + 1] : fallback
}

function hasFlag(name: string): boolean {
  return process.argv.includes(`--${name}`)
}

function loadCache(
  symbol: string,
  interval: string,
  days: number,
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
  const parsed = JSON.parse(fs.readFileSync(file, 'utf8')) as {
    candles: Array<Candle>
  }
  const cutoff = Date.now() - days * 86_400_000
  return parsed.candles.filter((c) => c.openTime >= cutoff)
}

const fmt = (n: number, d = 2) => n.toFixed(d)

function parseScoreScope(raw: string): BacktestConfig['scoreScope'] {
  const normalized = raw.trim().toLowerCase().replace(/-/g, '_')
  return normalized === 'per_symbol' ? 'per_symbol' : 'global'
}

function parseTradeDirection(raw: string): BacktestConfig['tradeDirection'] {
  const normalized = raw.trim().toLowerCase().replace(/-/g, '_')
  if (normalized === 'short') return 'short'
  if (normalized === 'long_short') return 'long_short'
  return 'long'
}

function reportPath(
  reportDir: string,
  symbols: Array<string>,
  interval: string,
  days: number,
  suffix = '',
): string {
  const symbolSlug = symbols.join('-').toLowerCase()
  const stamp = new Date().toISOString().replace(/[:.]/g, '-')
  const unique = `${process.pid}-${process.hrtime.bigint().toString(36)}`
  const suffixPart = suffix ? `-${suffix}` : ''
  return path.join(
    reportDir,
    `backtest-${symbolSlug}-${interval}-${days}d${suffixPart}-${stamp}-${unique}.json`,
  )
}

interface BacktestReportSummary {
  trades: number
  winRate: number
  totalPnlQuote: number
  totalFeesQuote: number
  returnPct: number
  maxDrawdownPct: number
  profitFactor: number | null
}

interface WalkForwardFoldReport {
  fold: number
  trainEndPct: number
  testStartPct: number
  testEndPct: number
  train: BacktestReport
  test: BacktestReport
}

function summarizeReports(
  reports: Array<BacktestReport>,
  startingBalanceQuote: number,
): BacktestReportSummary {
  const trades = reports.flatMap((r) => r.trades)
  const totalPnlQuote = reports.reduce((sum, r) => sum + r.totalPnlQuote, 0)
  const totalFeesQuote = reports.reduce((sum, r) => sum + r.totalFeesQuote, 0)
  const grossWin = trades.reduce(
    (sum: number, t: BacktestTrade) => sum + Math.max(0, t.pnlQuote),
    0,
  )
  const grossLoss = trades.reduce(
    (sum: number, t: BacktestTrade) => sum + Math.min(0, t.pnlQuote),
    0,
  )
  const wins = trades.filter((t) => t.pnlQuote > 0).length
  return {
    trades: trades.length,
    winRate: trades.length > 0 ? wins / trades.length : 0,
    totalPnlQuote,
    totalFeesQuote,
    returnPct: (totalPnlQuote / startingBalanceQuote) * 100,
    maxDrawdownPct: reports.reduce(
      (maxDrawdown, r) => Math.max(maxDrawdown, r.maxDrawdownPct),
      0,
    ),
    profitFactor: grossLoss < 0 ? grossWin / -grossLoss : null,
  }
}

function printWalkForwardSummary(
  folds: Array<WalkForwardFoldReport>,
  summary: BacktestReportSummary,
  initialTrainPct: number,
  carryScore: boolean,
) {
  console.log(
    `\nWalk-forward OOS: ${folds.length} folds · initial train ${fmt(initialTrainPct, 1)}% · carry-score ${carryScore ? 'on' : 'off'}`,
  )
  console.log('─'.repeat(78))
  console.log(
    `OOS realized ${summary.totalPnlQuote >= 0 ? '+' : ''}${fmt(summary.totalPnlQuote)} USDT (${summary.returnPct >= 0 ? '+' : ''}${fmt(summary.returnPct)}%) over ${summary.trades} trades · win ${fmt(summary.winRate * 100, 1)}% · PF ${summary.profitFactor == null ? '—' : fmt(summary.profitFactor)} · fees ${fmt(summary.totalFeesQuote)} USDT · max fold DD ${fmt(summary.maxDrawdownPct)}%`,
  )
  console.log('\nfolds:')
  console.log(
    '  fold  test window                 train%  train ret  test ret  trades  win%     PF',
  )
  for (const fold of folds) {
    const test = fold.test
    const testSummary = summarizeReports(
      [test],
      test.config.startingBalanceQuote,
    )
    const pf = testSummary.profitFactor
    console.log(
      `  ${String(fold.fold).padStart(4)}  ${test.from.slice(0, 10)} → ${test.to.slice(0, 10)}  ${fmt(fold.trainEndPct, 1).padStart(6)}  ${fmt(fold.train.returnPct).padStart(9)}  ${fmt(test.returnPct).padStart(8)}  ${String(test.trades.length).padStart(6)}  ${fmt(testSummary.winRate * 100, 1).padStart(5)}  ${(pf == null ? '  —' : fmt(pf)).padStart(5)}`,
    )
  }
}

function printReport(report: BacktestReport, title?: string) {
  const config = report.config
  const heading = title ? `${title}: ` : ''
  console.log(
    `\n${heading}Backtest ${report.symbols.join('+')} ${report.interval}  ${report.from.slice(0, 10)} → ${report.to.slice(0, 10)}  (${report.candleCount} steps)`,
  )
  const regime =
    config.regimeSmaPeriod > 0 ? ` · regime SMA(${config.regimeSmaPeriod})` : ''
  const marketRegime =
    config.marketRegimeSymbol && config.marketRegimeSmaPeriod > 0
      ? ` · market ${config.marketRegimeSymbol} SMA(${config.marketRegimeSmaPeriod})`
      : ''
  const atrExit = [
    config.atrStopMultiple > 0 ? `ATR stop ${config.atrStopMultiple}x` : '',
    config.atrTakeProfitMultiple > 0
      ? `ATR TP ${config.atrTakeProfitMultiple}x`
      : '',
    config.atrTrailingMultiple > 0
      ? `ATR trail ${config.atrTrailingMultiple}x`
      : '',
  ]
    .filter(Boolean)
    .join(' · ')
  const atrPart = atrExit ? ` · ATR(${config.atrPeriod}) ${atrExit}` : ''
  console.log(
    `fees ${fmt(config.feeRatePerSide * 10_000, 0)} bps/side · quote/trade ${config.quotePerTrade} · SL ${fmt(config.stopLossPct * 100, 1)}% · TP ${fmt(config.takeProfitPct * 100, 1)}% · threshold ${config.councilThreshold}${regime}${marketRegime}${atrPart} · direction ${config.tradeDirection.replace('_', '-')} · score ${config.scoreScope}`,
  )
  console.log('─'.repeat(78))
  console.log(
    `equity      ${fmt(config.startingBalanceQuote)} → ${fmt(report.finalEquityQuote)} USDT  (${report.returnPct >= 0 ? '+' : ''}${fmt(report.returnPct)}%)`,
  )
  console.log(
    `realized    ${report.totalPnlQuote >= 0 ? '+' : ''}${fmt(report.totalPnlQuote)} USDT over ${report.trades.length} trades · fees ${fmt(report.totalFeesQuote)} USDT`,
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

  console.log('\nper-strategy:')
  console.log(
    '  strategy                 trades  win%    pnl(USDT)  avg     PF     score',
  )
  for (const s of report.strategyReports) {
    const label = s.symbol ? `${s.symbol}:${s.strategyId}` : s.strategyId
    console.log(
      `  ${label.padEnd(24)} ${String(s.trades).padStart(5)}  ${fmt(s.winRate * 100, 1).padStart(5)}  ${fmt(s.totalPnlQuote).padStart(9)}  ${fmt(s.avgPnlQuote).padStart(6)}  ${(s.profitFactor == null ? '  —' : fmt(s.profitFactor)).padStart(5)}  ${fmt(s.score).padStart(6)}`,
    )
  }

  const blocks = Object.entries(report.guardianBlocks)
  if (blocks.length > 0) {
    console.log('\nguardian blocks:')
    for (const [rule, n] of blocks) console.log(`  ${rule.padEnd(24)} ${n}`)
  }

  const exitReasons: Record<string, number> = {}
  for (const t of report.trades) {
    const kind = t.reason.split(/[ :(]/)[0]
    exitReasons[kind] = (exitReasons[kind] ?? 0) + 1
  }
  console.log('\nexit reasons:')
  for (const [kind, n] of Object.entries(exitReasons))
    console.log(`  ${kind.padEnd(24)} ${n}`)
}

function main() {
  const symbols = arg('symbols', 'BTCUSDT,ETHUSDT')
    .split(',')
    .map((s) => s.trim().toUpperCase())
  const interval = arg('interval', '1h')
  const days = Number(arg('days', '180'))
  const splitPct = Number(arg('split-pct', '0'))
  const foldCount = Number(arg('folds', '0'))
  const foldTrainPct = Number(
    arg('fold-train-pct', splitPct > 0 ? String(splitPct) : '70'),
  )
  const carryScore = hasFlag('carry-score')

  const config: BacktestConfig = {
    ...DEFAULT_BACKTEST_CONFIG,
    quotePerTrade: Number(
      arg('quote-per-trade', String(DEFAULT_BACKTEST_CONFIG.quotePerTrade)),
    ),
    stopLossPct: Number(arg('stop-pct', '2')) / 100,
    takeProfitPct: Number(arg('tp-pct', '3')) / 100,
    councilThreshold: Number(
      arg('threshold', String(DEFAULT_BACKTEST_CONFIG.councilThreshold)),
    ),
    feeRatePerSide: Number(arg('fee-bps', '10')) / 10_000,
    regimeSmaPeriod: Number(
      arg('regime-sma', String(DEFAULT_BACKTEST_CONFIG.regimeSmaPeriod)),
    ),
    trailingStopPct: Number(arg('trail-pct', '0')) / 100,
    atrPeriod: Number(
      arg('atr-period', String(DEFAULT_BACKTEST_CONFIG.atrPeriod)),
    ),
    atrStopMultiple: Number(arg('atr-stop-mult', '0')),
    atrTakeProfitMultiple: Number(arg('atr-tp-mult', '0')),
    atrTrailingMultiple: Number(arg('atr-trail-mult', '0')),
    tradeDirection: parseTradeDirection(
      arg('direction', DEFAULT_BACKTEST_CONFIG.tradeDirection),
    ),
    marketRegimeSymbol: arg(
      'market-regime-symbol',
      DEFAULT_BACKTEST_CONFIG.marketRegimeSymbol,
    )
      .trim()
      .toUpperCase(),
    marketRegimeSmaPeriod: Number(
      arg(
        'market-regime-sma',
        String(DEFAULT_BACKTEST_CONFIG.marketRegimeSmaPeriod),
      ),
    ),
    scoreScope: parseScoreScope(
      arg('score-scope', DEFAULT_BACKTEST_CONFIG.scoreScope),
    ),
    enabledStrategies: arg(
      'strategies',
      DEFAULT_BACKTEST_CONFIG.enabledStrategies.join(','),
    )
      .split(',')
      .map((s) => s.trim()),
  }

  const candlesBySymbol: Record<string, Array<Candle>> = {}
  for (const s of symbols) candlesBySymbol[s] = loadCache(s, interval, days)

  const reportDir = path.join(
    os.homedir(),
    '.hermes',
    'finance',
    'backtest-reports',
  )
  fs.mkdirSync(reportDir, { recursive: true })

  if (foldCount > 0) {
    const windows = buildWalkForwardWindows(
      candlesBySymbol,
      foldTrainPct,
      foldCount,
    )
    const folds: Array<WalkForwardFoldReport> = []
    for (const window of windows) {
      const train = runBacktest(window.train, interval, config)
      const test = runBacktest(
        window.test,
        interval,
        config,
        carryScore ? { initialScores: train.scoreState } : {},
      )
      folds.push({
        fold: window.fold,
        trainEndPct: window.trainEndPct,
        testStartPct: window.testStartPct,
        testEndPct: window.testEndPct,
        train,
        test,
      })
    }
    const outOfSampleSummary = summarizeReports(
      folds.map((f) => f.test),
      config.startingBalanceQuote,
    )
    const suffix = [
      `walk-forward-${Math.trunc(foldCount)}`,
      `train-${String(foldTrainPct).replace('.', 'p')}`,
      carryScore ? 'carry-score' : '',
    ]
      .filter(Boolean)
      .join('-')
    const outPath = reportPath(reportDir, symbols, interval, days, suffix)
    fs.writeFileSync(
      outPath,
      JSON.stringify(
        {
          config,
          carryScore,
          initialTrainPct: foldTrainPct,
          outOfSampleSummary,
          folds,
        },
        null,
        2,
      ),
    )
    printWalkForwardSummary(folds, outOfSampleSummary, foldTrainPct, carryScore)
    console.log(`\nfull walk-forward report: ${outPath}\n`)
    return
  }

  if (splitPct > 0 && splitPct < 100) {
    const split = splitCandlesByIndex(candlesBySymbol, splitPct)
    const train = runBacktest(split.train, interval, config)
    const test = runBacktest(
      split.test,
      interval,
      config,
      carryScore ? { initialScores: train.scoreState } : {},
    )
    const suffix = carryScore
      ? `split-${splitPct}-carry-score`
      : `split-${splitPct}`
    const outPath = reportPath(reportDir, symbols, interval, days, suffix)
    fs.writeFileSync(
      outPath,
      JSON.stringify({ config, carryScore, train, test }, null, 2),
    )
    printReport(train, `In-sample ${splitPct}%`)
    printReport(
      test,
      `Out-of-sample ${100 - splitPct}%${carryScore ? ' carried-score' : ''}`,
    )
    console.log(`\nfull split report: ${outPath}\n`)
    return
  }

  const report = runBacktest(candlesBySymbol, interval, config)
  const outPath = reportPath(reportDir, symbols, interval, days)
  fs.writeFileSync(outPath, JSON.stringify(report, null, 2))
  printReport(report)

  console.log(`\nfull report: ${outPath}\n`)
}

main()
