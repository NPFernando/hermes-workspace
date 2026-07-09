/**
 * Sanity check for the LLM signal engine — deliberately NOT the same rigor
 * as the deterministic strategies' full-candle backtests. An LLM call can't
 * be cheaply/deterministically replayed over a year of candles the way a
 * formula can; this makes a small number of REAL model calls against real
 * historical context (no lookahead — each sample only sees candles up to
 * that point) and checks the engine produces valid, sane structured output.
 * It answers "does this work at all", not "is this profitable" — that
 * confidence has to come from the live decision log (research.llm_decisions)
 * over time instead.
 *
 * Usage:
 *   pnpm exec tsx scripts/sanity-backtest-llm.ts [--symbols BTCUSDT,ETHUSDT,...]
 *     [--days 90] [--samples 20]
 */
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import {
  buildContextSummary,
  buildPrompt,
  callWithFallback,
  DEFAULT_LLM_SIGNAL_CONFIG,
  parseLlmResponse,
  selectHarpRoutes,
} from '../src/server/llm-signal-engine'
import { recordResearchRun } from '../src/server/research-store'
import type { Candle } from '../src/server/trading-strategies'

process.loadEnvFile(path.join(process.cwd(), '.env'))

function arg(name: string, fallback: string): string {
  const idx = process.argv.indexOf(`--${name}`)
  return idx >= 0 && process.argv[idx + 1] ? process.argv[idx + 1] : fallback
}

function loadCache(symbol: string, interval: string, days: number): Array<Candle> {
  const file = path.join(os.homedir(), '.hermes', 'finance', 'candles-cache', `${symbol}-${interval}.json`)
  if (!fs.existsSync(file)) {
    throw new Error(`no cached candles at ${file} — run scripts/backfill-candles.ts first`)
  }
  const parsed = JSON.parse(fs.readFileSync(file, 'utf8')) as { candles: Array<Candle> }
  const cutoff = Date.now() - days * 86_400_000
  return parsed.candles.filter((c) => c.openTime >= cutoff)
}

async function main() {
  const symbols = arg('symbols', DEFAULT_LLM_SIGNAL_CONFIG.symbols.join(',')).split(',').map((s) => s.trim().toUpperCase())
  const days = Number(arg('days', '90'))
  const sampleCount = Number(arg('samples', '20'))

  const candlesBySymbol: Record<string, Array<Candle>> = {}
  for (const s of symbols) candlesBySymbol[s] = loadCache(s, '1h', days)
  const minLength = Math.min(...symbols.map((s) => candlesBySymbol[s].length))

  const warmup = 50 // enough history for sma50/rsi14/atr14 to be meaningful
  if (minLength <= warmup + sampleCount) {
    throw new Error(`not enough candle history for ${sampleCount} samples with ${warmup}-candle warmup`)
  }

  const routes = selectHarpRoutes(DEFAULT_LLM_SIGNAL_CONFIG.harpTask, DEFAULT_LLM_SIGNAL_CONFIG.harpRisk)
  if (routes.length === 0) {
    console.log('🔴 No HARP OpenRouter route available — cannot run the sanity check.')
    process.exit(1)
  }
  console.log(`HARP fallback chain (${routes.length} candidates): ${routes.map((r) => r.model).join(' → ')}`)

  const sampleIndices = Array.from({ length: sampleCount }, (_, i) =>
    Math.round(warmup + ((minLength - warmup - 1) * i) / (sampleCount - 1)),
  )

  let validCount = 0
  let invalidCount = 0
  const signalCounts: Record<string, number> = { BUY: 0, SELL: 0, HOLD: 0, invalid: 0 }
  const samples: Array<{ index: number; at: string; signal: string; confidence: number | null; symbol: string | null }> = []

  for (const idx of sampleIndices) {
    // No lookahead: only candles up to and including idx are visible.
    const contexts = symbols.map((s) => buildContextSummary(s, candlesBySymbol[s].slice(0, idx + 1)))
    const prompt = buildPrompt(contexts, [])
    const callResult = await callWithFallback(routes, prompt)
    const raw = callResult?.content ?? null
    const at = new Date(candlesBySymbol[symbols[0]][idx].openTime).toISOString()

    if (!raw) {
      invalidCount++
      signalCounts.invalid++
      samples.push({ index: idx, at, signal: 'NO_RESPONSE', confidence: null, symbol: null })
      console.log(`  [${at}] NO RESPONSE from model`)
      continue
    }
    const decision = parseLlmResponse(raw)
    let decidedSymbol: string | null = null
    try {
      const parsedRaw = JSON.parse(raw.trim().replace(/^```(?:json)?/i, '').replace(/```$/, '')) as { symbol?: string | null }
      decidedSymbol = parsedRaw.symbol ?? null
    } catch {
      /* leave null */
    }
    if (!decision) {
      invalidCount++
      signalCounts.invalid++
      samples.push({ index: idx, at, signal: 'UNPARSEABLE', confidence: null, symbol: null })
      console.log(`  [${at}] UNPARSEABLE response: ${raw.slice(0, 120)}`)
      continue
    }
    validCount++
    signalCounts[decision.signal] = (signalCounts[decision.signal] ?? 0) + 1
    samples.push({ index: idx, at, signal: decision.signal, confidence: decision.confidence, symbol: decidedSymbol })
    console.log(
      `  [${at}] ${decision.signal.padEnd(4)} ${decidedSymbol ?? '—'} conf=${decision.confidence.toFixed(2)} — ${decision.reasoning.slice(0, 80)}`,
    )
  }

  console.log('\n' + '─'.repeat(78))
  console.log(
    `Sanity check: ${validCount}/${sampleCount} valid structured responses, ${invalidCount} invalid/no-response.`,
  )
  console.log(`Signal distribution: ${JSON.stringify(signalCounts)}`)
  console.log(
    '\n⚠️  This is a basic quality gate (does the engine produce valid, sane output on real\n' +
      '    historical context), NOT a profitability backtest — LLM calls cannot be cheaply/\n' +
      '    deterministically replayed at the scale the deterministic strategies were tested at.\n' +
      '    Confidence in this engine has to build from the live research.llm_decisions log over time.',
  )

  await recordResearchRun({
    engine: 'llm_signal',
    runType: 'sanity',
    config: { symbols, days, sampleCount, routes: routes.map((r) => r.model) },
    result: { validCount, invalidCount, signalCounts, samples },
    notes: 'pre-deploy sanity check — not a profitability backtest',
  })
}

main().catch((err) => {
  console.error('sanity-backtest-llm failed:', err)
  process.exit(1)
})
