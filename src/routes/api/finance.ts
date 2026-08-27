import { createFileRoute } from '@tanstack/react-router'
import { json } from '@tanstack/react-start'
import { isAuthenticated } from '../../server/auth-middleware'
import { safeErrorMessage } from '../../server/rate-limit'
import {
  FINANCE_AUDIT_PATH,
  FINANCE_DATA_PATH,
  TRADING_MODES,
  addFinanceRecord,
  appendAuditLog,
  budgetVsActualSummary,
  deleteFinanceRecord,
  ensureFinanceStore,
  financeAlerts,
  financeStorageAlerts,
  financeStorageStatus,
  financeSummary,
  findPossibleDuplicate,
  getCategoryCorrections,
  listPendingIngestions,
  maskSensitive,
  readFinanceStore,
  recordCategoryCorrection,
  storeIntelligenceRecords,
  tradingPerformanceSummary,
  updateFinanceRecord,
  updatePendingIngestion,
  writeFinanceStore,
} from '../../server/finance-store'
import { isPdfEncrypted, pdfToImages } from '../../server/document-normalizer'
import { extractTransactionFromImage } from '../../server/finance-extraction'
import { syncGmailNow } from '../../server/gmail-ingest'
import { fetchCsePrice } from '../../server/cse-market.service'
import {
  addBinanceCandles,
  addMarketPrice,
  fetchBinanceKlines,
  fetchBinanceTickerPrice,
} from '../../server/binance-market.service'
import { STRATEGIES } from '../../server/trading-strategies'
import {
  applyLearningCandidate,
  applyRecommendedSafeguards,
  applyStrategyOverrideRecommendations,
  decisionQualityReport,
  demoTradingPerformance,
  learningReport,
  marketLearningReport,
  runLearningCycle,
  safeguardHistory,
  setStrategyOverride,
  strategyCatalog,
  strategyOverrideState,
} from '../../server/demo-trading-engine'
import { startFinanceStorageMonitor } from '../../server/finance-storage-monitor'
import { fetchAndStoreGoogleNews } from '../../server/finance-news.service'
import { INTELLIGENCE_FORMULA_VERSION, assessResearchRisk, buildCompositeSentiment } from '../../server/finance-intelligence'
import {
  appendPaperDecisionSnapshot,
  readPaperDecisionJournal,
} from '../../server/paper-decision-journal'
import { evaluatePaperDecisionQuality } from '../../server/paper-decision-quality'
import { resetConnectivityBreaker } from '../../server/connectivity-breaker'

const VALID_LONG_SHORT_PERIODS = new Set([
  '5m',
  '15m',
  '30m',
  '1h',
  '2h',
  '4h',
  '6h',
  '12h',
  '1d',
])

type JsonRecord = Record<string, unknown>

startFinanceStorageMonitor()

async function parseJsonBody(request: Request): Promise<JsonRecord> {
  try {
    const body = (await request.json()) as unknown
    return body && typeof body === 'object' && !Array.isArray(body)
      ? (body as JsonRecord)
      : {}
  } catch {
    return {}
  }
}

function unauthorized() {
  return json({ ok: false, error: 'Unauthorized' }, { status: 401 })
}

function binanceSymbolFromBody(body: JsonRecord): string {
  const symbol =
    typeof body.symbol === 'string' ? body.symbol.trim().toUpperCase() : ''
  if (!symbol) throw new Error('symbol is required')
  if (!/^[A-Z0-9]{5,20}$/.test(symbol))
    throw new Error('symbol must be a Binance spot symbol such as BTCUSDT')
  if (body.platform === 'ibkr') {
    appendAuditLog('ibkr_future_feature_redirected', {
      requestedPlatform: 'ibkr',
      activeProvider: 'binance',
      symbol,
    })
  }
  return symbol
}

/** Research snapshots are provider-neutral and must not emit provider audit events. */
function researchSymbolFromBody(body: JsonRecord): string {
  const symbol =
    typeof body.symbol === 'string' ? body.symbol.trim().toUpperCase() : ''
  if (!symbol) throw new Error('symbol is required')
  if (!/^[A-Z0-9]{5,20}$/.test(symbol))
    throw new Error('symbol must be an uppercase alphanumeric market symbol')
  return symbol
}

function isLiveMode(mode: string): boolean {
  return (
    mode === 'live_manual_approval' ||
    mode === 'live_auto_trade' ||
    mode === 'live_monitored'
  )
}

function financePayload() {
  const db = ensureFinanceStore()
  const storage = financeStorageStatus({ selfHeal: true })
  const alerts = [...financeStorageAlerts(storage.health), ...financeAlerts(db)]
  return {
    ok: true,
    checkedAt: Date.now(),
    storage,
    paths: {
      database: FINANCE_DATA_PATH,
      postgresDatabase: storage.postgres.database,
      auditLog: FINANCE_AUDIT_PATH,
      secretStorage:
        'external secret manager / environment references only; API keys are not stored here',
    },
    security: {
      secretsStoredInPlainText: false,
      accountNumbersMaskedInNormalPayload: true,
      liveTradingRequiresManualApproval: true,
      withdrawalsDisabled: true,
      leverageDisabledByDefault: true,
      futuresDisabledByDefault: true,
    },
    connectors: {
      binance: {
        publicMarketData: true,
        paperTradingSupported: true,
        spotTestnetSupported: true,
        gatedLiveSpotSupported: true,
        liveTradingEnabled: db.settings.liveTradingEnabled,
        paperShadowEnabled: db.settings.paperShadowEnabled,
        withdrawalsAllowed: false,
        futuresEnabled: false,
      },
      ibkr: {
        status: 'future_feature',
        active: false,
        blocksImplementation: false,
        liveTradingEnabled: false,
        requiresContractVerification: true,
      },
    },
    summary: financeSummary(db),
    budgetVsActual: budgetVsActualSummary(db),
    tradingPerformance: tradingPerformanceSummary(db),
    demoPerformance: demoTradingPerformance(),
    decisionQuality: decisionQualityReport(),
    paperDecisionQuality: evaluatePaperDecisionQuality({
      decisions: readPaperDecisionJournal(),
      historicalCandles: db.historical_candles,
      evaluatedAt: new Date().toISOString(),
    }),
    learning: learningReport(),
    marketLearning: marketLearningReport(),
    safeguardHistory: safeguardHistory(),
    strategyCatalog: strategyCatalog(),
    strategyOverrides: strategyOverrideState(),
    alerts,
    settings: db.settings,
    connectivityBreaker: db.connectivityBreaker,
    // market_prices/risk_scores are fetched but never rendered anywhere in
    // the UI (confirmed via grep) — dropped here to shrink this response,
    // which finance-screen.tsx's polling/refetch cycle re-fetches in full.
    data: maskSensitive({ ...db, market_prices: [], risk_scores: [] }),
  }
}

function refreshIntelligence(symbol: string) {
  const db = readFinanceStore()
  const now = new Date()
  const composite = buildCompositeSentiment({ symbol, items: db.news_items, sentimentScores: db.sentiment_scores, now })
  const risk = assessResearchRisk(composite)
  const createdAt = now.toISOString()
  const scoreId = `sentiment:${symbol}:${INTELLIGENCE_FORMULA_VERSION}:${createdAt}`
  const riskId = `risk:${symbol}:${INTELLIGENCE_FORMULA_VERSION}:${createdAt}`
  const stored = storeIntelligenceRecords({
    sentiment: {
      id: scoreId, symbol, kind: 'news_composite', score: composite.score ?? 0,
      label: composite.label, confidenceScore: composite.confidence, freshness: composite.freshness,
      inputRefs: composite.sourceIds, formulaVersion: composite.formulaVersion,
      observedAt: composite.observedAt, expiresAt: composite.expiresAt, source: 'finance-intelligence',
      createdAt, updatedAt: createdAt,
    },
    risk: {
      id: riskId, platform: 'research_only', symbol, ...risk,
      formulaVersion: composite.formulaVersion, inputRefs: composite.sourceIds,
      observedAt: composite.observedAt, expiresAt: composite.expiresAt, source: 'finance-intelligence',
      createdAt, updatedAt: createdAt,
    },
  })
  return { composite, stored, researchOnly: true }
}

export const Route = createFileRoute('/api/finance')({
  server: {
    handlers: {
      GET: ({ request }) => {
        if (!isAuthenticated(request)) return unauthorized()
        return json(financePayload())
      },
      POST: async ({ request }) => {
        if (!isAuthenticated(request)) return unauthorized()
        const body = await parseJsonBody(request)
        const action =
          typeof body.action === 'string' ? body.action : 'add_record'
        try {
          if (action === 'add_record') {
            const kind = typeof body.kind === 'string' ? body.kind : ''
            const payload =
              body.payload && typeof body.payload === 'object'
                ? (body.payload as JsonRecord)
                : {}
            addFinanceRecord(kind, payload)
            return json(financePayload())
          }
          if (action === 'update_record') {
            const kind = typeof body.kind === 'string' ? body.kind : ''
            const id = typeof body.id === 'string' ? body.id : ''
            const payload =
              body.payload && typeof body.payload === 'object'
                ? (body.payload as JsonRecord)
                : {}
            if (!id) return json({ ok: false, error: 'id is required.' }, { status: 400 })
            updateFinanceRecord(kind, id, payload)
            return json(financePayload())
          }
          if (action === 'delete_record') {
            const kind = typeof body.kind === 'string' ? body.kind : ''
            const id = typeof body.id === 'string' ? body.id : ''
            if (!id) return json({ ok: false, error: 'id is required.' }, { status: 400 })
            deleteFinanceRecord(kind, id)
            return json(financePayload())
          }
          if (action === 'fetch_market_price') {
            // Read-only market data: Binance is the active provider. IBKR is a future feature.
            const symbol = binanceSymbolFromBody(body)
            const ticker = await fetchBinanceTickerPrice(symbol)
            addMarketPrice(
              symbol,
              ticker.price,
              ticker.bid,
              ticker.ask,
              undefined,
              'binance',
              'binance-public-api',
            )
            return json(financePayload())
          }
          if (action === 'fetch_news') {
            // Public Google News RSS only: research ingestion has no keys and
            // does not touch trading plans, orders, positions, or execution.
            const symbol = binanceSymbolFromBody(body)
            const newsIngestion = await fetchAndStoreGoogleNews(symbol)
            return json({ ...financePayload(), newsIngestion })
          }
          if (action === 'refresh_intelligence') {
            // Derives and stores research-only records from already stored
            // inputs. It never creates plans, orders, positions, or execution.
            const symbol = binanceSymbolFromBody(body)
            const intelligence = refreshIntelligence(symbol)
            return json({ ...financePayload(), intelligence })
          }
          if (action === 'record_paper_decision') {
            // Authenticated research journal only. It derives a composite from
            // stored inputs and appends one immutable snapshot; it never creates
            // plans, orders, positions, executions, or exchange requests.
            const symbol = researchSymbolFromBody(body)
            const idempotencyKey =
              typeof body.idempotencyKey === 'string'
                ? body.idempotencyKey.trim()
                : ''
            if (!idempotencyKey || idempotencyKey.length > 128) {
              return json(
                { ok: false, error: 'A 1-128 character idempotencyKey is required.' },
                { status: 400 },
              )
            }
            const db = readFinanceStore()
            const composite = buildCompositeSentiment({
              symbol,
              items: db.news_items,
              sentimentScores: db.sentiment_scores,
              now: new Date(),
            })
            const journal = appendPaperDecisionSnapshot({
              symbol,
              composite,
              idempotencyKey,
            })
            return json({
              ...financePayload(),
              paperDecisionJournal: { ...journal, researchOnly: true },
            })
          }
          if (action === 'fetch_candles') {
            // Read-only historical OHLCV from Binance public klines.
            const symbol = binanceSymbolFromBody(body)
            const requestedLimit =
              typeof body.limit === 'number' && Number.isFinite(body.limit)
                ? body.limit
                : 100
            const limit = Math.max(1, Math.min(Math.floor(requestedLimit), 500))
            const interval =
              typeof body.interval === 'string' && body.interval.trim()
                ? body.interval.trim()
                : '1h'
            const klines = await fetchBinanceKlines(symbol, interval, limit)
            addBinanceCandles(
              symbol,
              interval,
              klines,
              'binance',
              'binance-public-api',
            )
            return json(financePayload())
          }
          if (action === 'set_trading_mode') {
            const requestedMode =
              typeof body.mode === 'string' ? body.mode : 'observe_only'
            if (
              !(TRADING_MODES as ReadonlyArray<string>).includes(requestedMode)
            ) {
              return json(
                {
                  ok: false,
                  error: `Unsupported trading mode: ${requestedMode}`,
                },
                { status: 400 },
              )
            }
            const db = readFinanceStore()
            if (
              isLiveMode(requestedMode) &&
              body.approval !== 'I_APPROVE_LIVE_TRADING' &&
              !db.settings.liveBinanceApprovedAt
            ) {
              appendAuditLog('trading_mode_change_blocked', {
                requestedMode,
                reason: 'missing explicit approval phrase',
              })
              return json(
                {
                  ok: false,
                  error:
                    'Explicit approval phrase required before enabling live trading.',
                },
                { status: 400 },
              )
            }
            db.settings.tradingMode =
              requestedMode as typeof db.settings.tradingMode
            db.settings.executionAccount =
              requestedMode === 'paper_trade'
                ? 'paper'
                : requestedMode === 'testnet_execute'
                  ? 'binance_testnet'
                  : isLiveMode(requestedMode)
                    ? 'binance_live'
                    : requestedMode === 'observe_only'
                      ? 'paper'
                      : db.settings.executionAccount
            db.settings.liveTradingEnabled = isLiveMode(requestedMode)
            // NOTE: the emergency kill switch is an INDEPENDENT master cutoff — a mode
            // change must never arm or disarm it. Use `set_kill_switch` for that. This
            // keeps "select a mode" and "disarm the safety cutoff" as two deliberate,
            // separately-audited human actions instead of one being a side effect of the other.
            writeFinanceStore(db)
            appendAuditLog('trading_mode_changed', {
              requestedMode,
              liveTradingEnabled: db.settings.liveTradingEnabled,
              executionAccount: db.settings.executionAccount,
            })
            return json(financePayload())
          }
          if (action === 'set_execution_account') {
            const account =
              typeof body.account === 'string' ? body.account : 'paper'
            const db = readFinanceStore()
            if (account === 'paper') {
              db.settings.executionAccount = 'paper'
              db.settings.tradingMode = 'paper_trade'
              db.settings.liveTradingEnabled = false
            } else if (account === 'binance_testnet') {
              db.settings.executionAccount = 'binance_testnet'
              db.settings.tradingMode = 'testnet_execute'
              db.settings.liveTradingEnabled = false
            } else if (account === 'binance_live') {
              if (
                body.approval !== 'I_APPROVE_LIVE_TRADING' &&
                !db.settings.liveBinanceApprovedAt
              ) {
                appendAuditLog('execution_account_change_blocked', {
                  account,
                  reason: 'missing live approval',
                })
                return json(
                  {
                    ok: false,
                    error:
                      'Live Binance account selection requires explicit approval.',
                  },
                  { status: 400 },
                )
              }
              db.settings.executionAccount = 'binance_live'
              db.settings.tradingMode = 'live_manual_approval'
              db.settings.liveTradingEnabled = true
            } else {
              return json(
                {
                  ok: false,
                  error: `Unsupported execution account: ${account}`,
                },
                { status: 400 },
              )
            }
            writeFinanceStore(db)
            appendAuditLog('execution_account_changed', {
              account: db.settings.executionAccount,
              tradingMode: db.settings.tradingMode,
            })
            return json(financePayload())
          }
          if (action === 'arm_live_binance') {
            if (body.approval !== 'I_APPROVE_BINANCE_LIVE_TRADING') {
              appendAuditLog('live_binance_arm_blocked', {
                reason: 'missing explicit approval phrase',
              })
              return json(
                {
                  ok: false,
                  error:
                    'Arming Binance live trading requires the explicit approval phrase.',
                },
                { status: 400 },
              )
            }
            const db = readFinanceStore()
            const approvedAt = new Date().toISOString()
            db.settings.primaryTradingProvider = 'binance'
            db.settings.executionAccount = 'binance_live'
            db.settings.tradingMode = 'live_manual_approval'
            db.settings.liveTradingEnabled = true
            db.settings.paperShadowEnabled = true
            db.settings.livePerOrderCapUsdt =
              typeof body.livePerOrderCapUsdt === 'number' &&
              Number.isFinite(body.livePerOrderCapUsdt)
                ? Math.max(1, Math.min(body.livePerOrderCapUsdt, 50))
                : db.settings.livePerOrderCapUsdt || 10
            db.settings.liveBinanceApprovedAt = approvedAt
            db.settings.liveBinanceApprovalId = `live_binance_${Date.now()}`
            writeFinanceStore(db)
            appendAuditLog('live_binance_armed', {
              approvedAt,
              livePerOrderCapUsdt: db.settings.livePerOrderCapUsdt,
              paperShadowEnabled: true,
            })
            return json(financePayload())
          }
          if (action === 'emergency_stop') {
            const db = readFinanceStore()
            db.settings.tradingMode = 'observe_only'
            db.settings.executionAccount = 'paper'
            db.settings.liveTradingEnabled = false
            db.settings.emergencyKillSwitch = true
            writeFinanceStore(db)
            appendAuditLog('emergency_stop', { source: 'finance_api' })
            return json(financePayload())
          }
          if (action === 'set_kill_switch') {
            // Independent master cutoff. `engaged: true` = cutoff ON (all trading halted, safe).
            // DISARMING (engaged=false) is the dangerous direction — it requires an explicit
            // confirmation phrase and is intended to be a deliberate human action from the UI.
            const engaged = body.engaged !== false // default to engaged (fail-safe)
            const db = readFinanceStore()
            if (
              !engaged &&
              body.approval !== 'I_UNDERSTAND_DISABLE_SAFETY_CUTOFF'
            ) {
              appendAuditLog('kill_switch_disarm_blocked', {
                reason: 'missing explicit confirmation phrase',
              })
              return json(
                {
                  ok: false,
                  error:
                    'Disarming the safety cutoff requires the explicit confirmation phrase.',
                },
                { status: 400 },
              )
            }
            db.settings.emergencyKillSwitch = engaged
            writeFinanceStore(db)
            appendAuditLog('kill_switch_set', {
              engaged,
              source: 'finance_api',
            })
            return json(financePayload())
          }
          if (action === 'reset_connectivity_breaker') {
            // Manual-only, same as the kill switch's general philosophy —
            // no auto-recovery, a human should verify the underlying
            // credential problem is actually fixed before trading resumes.
            resetConnectivityBreaker()
            appendAuditLog('connectivity_breaker_reset', { source: 'finance_api' })
            return json(financePayload())
          }
          if (action === 'set_alerts_config') {
            // Gates non-critical (info/warning) Telegram delivery in
            // alerts.ts. Off by default, ships disarmed like every other
            // new toggle this session — critical alerts (e.g. the
            // connectivity breaker tripping) always send regardless.
            const enabled = body.enabled === true
            const db = readFinanceStore()
            db.settings.alertsEnabled = enabled
            writeFinanceStore(db)
            appendAuditLog('alerts_config_updated', { enabled, source: 'finance_api' })
            return json(financePayload())
          }
          if (action === 'set_demo_config' || action === 'set_engine_config') {
            // Update the demo engine's tunable knobs (settings.demoTrading), merged
            // over defaults by resolveEngineConfig. Values are range-validated; anything
            // out of range is ignored rather than applied.
            const cfg =
              body.config && typeof body.config === 'object'
                ? (body.config as JsonRecord)
                : {}
            const inRange = (
              value: unknown,
              min: number,
              max: number,
            ): number | undefined =>
              typeof value === 'number' &&
              Number.isFinite(value) &&
              value >= min &&
              value <= max
                ? value
                : undefined
            const db = readFinanceStore()
            const settings = db.settings as Record<string, unknown>
            const dt = (
              settings.demoTrading && typeof settings.demoTrading === 'object'
                ? { ...(settings.demoTrading as Record<string, unknown>) }
                : {}
            ) as Record<string, unknown>

            const tp = inRange(cfg.takeProfitPct, 0.0005, 0.5)
            const sl = inRange(cfg.stopLossPct, 0.0005, 0.5)
            const qpt = inRange(cfg.quotePerTrade, 1, 100000)
            const maxOpen = inRange(cfg.maxOpenPositions, 1, 50)
            // 0 = off for all three; upper bounds mirror what the offline
            // backtest harness actually validated (regime up to SMA300,
            // max hold up to 7 days).
            const regimeSma = inRange(cfg.regimeSmaPeriod, 0, 300)
            const trailingStop = inRange(cfg.trailingStopPct, 0, 0.5)
            const maxHold = inRange(cfg.maxHoldMinutes, 0, 10080)
            // Regime-conditional strategy switching (off by default) — see
            // EngineConfig.regimeSwitchingEnabled's doc comment in
            // demo-trading-engine.ts.
            const regimeSwitchingVolPeriod = inRange(
              cfg.regimeSwitchingVolPeriod,
              2,
              300,
            )
            const regimeSwitchingBaselineLookback = inRange(
              cfg.regimeSwitchingBaselineLookback,
              0,
              1000,
            )
            if (typeof cfg.regimeSwitchingEnabled === 'boolean')
              dt.regimeSwitchingEnabled = cfg.regimeSwitchingEnabled
            if (regimeSwitchingVolPeriod !== undefined)
              dt.regimeSwitchingVolPeriod = Math.floor(regimeSwitchingVolPeriod)
            if (regimeSwitchingBaselineLookback !== undefined)
              dt.regimeSwitchingBaselineLookback = Math.floor(
                regimeSwitchingBaselineLookback,
              )
            if (tp !== undefined) dt.takeProfitPct = tp
            if (sl !== undefined) dt.stopLossPct = sl
            if (qpt !== undefined) dt.quotePerTrade = qpt
            if (regimeSma !== undefined)
              dt.regimeSmaPeriod = Math.floor(regimeSma)
            if (trailingStop !== undefined) dt.trailingStopPct = trailingStop
            if (maxHold !== undefined) dt.maxHoldMinutes = Math.floor(maxHold)
            if (Array.isArray(cfg.symbols)) {
              const syms = cfg.symbols
                .filter((s): s is string => typeof s === 'string')
                .map((s) => s.trim().toUpperCase())
                .filter((s) => /^[A-Z0-9]{5,20}$/.test(s))
              if (syms.length > 0) dt.symbols = Array.from(new Set(syms))
            }
            // enabledStrategies: explicit allow-list against STRATEGIES ids only.
            // Left unset, resolveEngineConfig() defaults to *every* id in
            // STRATEGIES — meaning a newly added strategy silently joins live
            // council voting on the next deploy. Setting this here locks the
            // roster until someone deliberately opts a new strategy in.
            if (Array.isArray(cfg.enabledStrategies)) {
              const validIds = new Set(STRATEGIES.map((s) => s.id))
              const ids = cfg.enabledStrategies.filter(
                (s): s is string => typeof s === 'string' && validIds.has(s),
              )
              if (ids.length > 0) dt.enabledStrategies = Array.from(new Set(ids))
            }
            // Signal features built 2026-07-10/11: each is its own independent,
            // off-by-default lever (see docs/trading-engine.md for the backtest
            // evidence behind each one before arming).
            const atrBaseline = inRange(cfg.atrSizeBaselinePct, 0, 0.1)
            const atrMin = inRange(cfg.atrSizeMinMultiplier, 0.1, 1)
            const atrMax = inRange(cfg.atrSizeMaxMultiplier, 1, 3)
            const kellyMinTrades = inRange(cfg.kellySizingMinClosedTrades, 5, 200)
            const kellyMaxFraction = inRange(cfg.kellySizingMaxFraction, 0, 1)
            const vetoMinSamples = inRange(cfg.patternVetoMinSamples, 5, 200)
            const vetoLossThreshold = inRange(
              cfg.patternVetoLossRateThreshold,
              0,
              1,
            )
            const adxPeriod = inRange(cfg.adxPeriod, 2, 100)
            const adxThreshold = inRange(cfg.adxThreshold, 0, 100)
            const fibLookback = inRange(cfg.fibSwingLookback, 5, 200)
            const fibRatio = inRange(cfg.fibExtensionRatio, 1, 3)
            if (atrBaseline !== undefined) dt.atrSizeBaselinePct = atrBaseline
            if (atrMin !== undefined) dt.atrSizeMinMultiplier = atrMin
            if (atrMax !== undefined) dt.atrSizeMaxMultiplier = atrMax
            if (typeof cfg.kellySizingEnabled === 'boolean')
              dt.kellySizingEnabled = cfg.kellySizingEnabled
            if (kellyMinTrades !== undefined)
              dt.kellySizingMinClosedTrades = Math.floor(kellyMinTrades)
            if (kellyMaxFraction !== undefined)
              dt.kellySizingMaxFraction = kellyMaxFraction
            if (typeof cfg.patternVetoEnabled === 'boolean')
              dt.patternVetoEnabled = cfg.patternVetoEnabled
            if (vetoMinSamples !== undefined)
              dt.patternVetoMinSamples = Math.floor(vetoMinSamples)
            if (vetoLossThreshold !== undefined)
              dt.patternVetoLossRateThreshold = vetoLossThreshold
            if (adxPeriod !== undefined) dt.adxPeriod = Math.floor(adxPeriod)
            if (adxThreshold !== undefined) dt.adxThreshold = adxThreshold
            if (typeof cfg.fibTakeProfitEnabled === 'boolean')
              dt.fibTakeProfitEnabled = cfg.fibTakeProfitEnabled
            if (fibLookback !== undefined)
              dt.fibSwingLookback = Math.floor(fibLookback)
            if (fibRatio !== undefined) dt.fibExtensionRatio = fibRatio
            if (typeof cfg.longShortSentimentEnabled === 'boolean')
              dt.longShortSentimentEnabled = cfg.longShortSentimentEnabled
            if (
              typeof cfg.longShortSentimentPeriod === 'string' &&
              VALID_LONG_SHORT_PERIODS.has(cfg.longShortSentimentPeriod)
            )
              dt.longShortSentimentPeriod = cfg.longShortSentimentPeriod
            const maxBucketExposure = inRange(cfg.guardianMaxBucketExposureQuote, 0, 100000)
            const guardianCorrelationBuckets =
              cfg.guardianCorrelationBuckets &&
              typeof cfg.guardianCorrelationBuckets === 'object' &&
              !Array.isArray(cfg.guardianCorrelationBuckets)
                ? Object.entries(cfg.guardianCorrelationBuckets as JsonRecord).reduce<
                    Record<string, Array<string>>
                  >((acc, [bucket, symbols]) => {
                    if (!Array.isArray(symbols)) return acc
                    const syms = symbols
                      .filter((s): s is string => typeof s === 'string')
                      .map((s) => s.trim().toUpperCase())
                      .filter((s) => /^[A-Z0-9]{5,20}$/.test(s))
                    if (syms.length > 0) acc[bucket] = syms
                    return acc
                  }, {})
                : undefined
            if (
              maxOpen !== undefined ||
              typeof cfg.guardianCorrelationBucketsEnabled === 'boolean' ||
              guardianCorrelationBuckets !== undefined ||
              maxBucketExposure !== undefined
            ) {
              const guardian = (
                dt.guardian && typeof dt.guardian === 'object'
                  ? { ...(dt.guardian as Record<string, unknown>) }
                  : {}
              ) as Record<string, unknown>
              if (maxOpen !== undefined) guardian.maxOpenPositions = Math.floor(maxOpen)
              if (typeof cfg.guardianCorrelationBucketsEnabled === 'boolean')
                guardian.correlationBucketsEnabled = cfg.guardianCorrelationBucketsEnabled
              if (guardianCorrelationBuckets !== undefined)
                guardian.correlationBuckets = guardianCorrelationBuckets
              if (maxBucketExposure !== undefined)
                guardian.maxBucketExposureQuote = maxBucketExposure
              dt.guardian = guardian
            }
            // learningPolicy.autoApplyModes: only 'paper_trade' and
            // 'testnet_execute' are ever accepted here — the learning-loop's
            // candidate generation is structurally risk-reducing-only
            // (quotePerTrade patches are Math.min-clamped, strategyOverrides
            // can only be 'disabled'/'reduce_size'), so widening which modes
            // may auto-apply doesn't widen what it's allowed to do.
            if (
              cfg.learningPolicy &&
              typeof cfg.learningPolicy === 'object' &&
              !Array.isArray(cfg.learningPolicy)
            ) {
              const lp = cfg.learningPolicy as JsonRecord
              if (Array.isArray(lp.autoApplyModes)) {
                const modes = lp.autoApplyModes.filter(
                  (m): m is 'paper_trade' | 'testnet_execute' =>
                    m === 'paper_trade' || m === 'testnet_execute',
                )
                if (modes.length > 0) {
                  const existingPolicy = (
                    dt.learningPolicy &&
                    typeof dt.learningPolicy === 'object'
                      ? { ...(dt.learningPolicy as Record<string, unknown>) }
                      : {}
                  ) as Record<string, unknown>
                  existingPolicy.autoApplyModes = Array.from(new Set(modes))
                  dt.learningPolicy = existingPolicy
                }
              }
            }
            settings.demoTrading = dt
            // autoRefinement.enabled: a top-level settings key (not nested
            // under demoTrading, since it spans the grid/rebalance/llm
            // engines too, not just the council) — gates whether
            // src/server/auto-refinement.ts's candidates get applied live or
            // only recorded as proposals. Off by default; every candidate it
            // can generate is risk/cost-reducing-only by construction.
            if (typeof cfg.autoRefinementEnabled === 'boolean') {
              const existingRefinement = (
                settings.autoRefinement &&
                typeof settings.autoRefinement === 'object'
                  ? { ...(settings.autoRefinement as Record<string, unknown>) }
                  : {}
              ) as Record<string, unknown>
              existingRefinement.enabled = cfg.autoRefinementEnabled
              settings.autoRefinement = existingRefinement
            }
            writeFinanceStore(db)
            appendAuditLog('engine_config_updated', {
              takeProfitPct: dt.takeProfitPct,
              stopLossPct: dt.stopLossPct,
              quotePerTrade: dt.quotePerTrade,
              symbols: dt.symbols,
              enabledStrategies: dt.enabledStrategies,
              atrSizeBaselinePct: dt.atrSizeBaselinePct,
              kellySizingEnabled: dt.kellySizingEnabled,
              patternVetoEnabled: dt.patternVetoEnabled,
              adxThreshold: dt.adxThreshold,
              fibTakeProfitEnabled: dt.fibTakeProfitEnabled,
              longShortSentimentEnabled: dt.longShortSentimentEnabled,
              maxOpenPositions: (
                dt.guardian as Record<string, unknown> | undefined
              )?.maxOpenPositions,
              correlationBucketsEnabled: (
                dt.guardian as Record<string, unknown> | undefined
              )?.correlationBucketsEnabled,
              maxBucketExposureQuote: (
                dt.guardian as Record<string, unknown> | undefined
              )?.maxBucketExposureQuote,
              regimeSmaPeriod: dt.regimeSmaPeriod,
              regimeSwitchingEnabled: dt.regimeSwitchingEnabled,
              regimeSwitchingVolPeriod: dt.regimeSwitchingVolPeriod,
              regimeSwitchingBaselineLookback: dt.regimeSwitchingBaselineLookback,
              trailingStopPct: dt.trailingStopPct,
              maxHoldMinutes: dt.maxHoldMinutes,
              learningPolicyAutoApplyModes: (
                dt.learningPolicy as Record<string, unknown> | undefined
              )?.autoApplyModes,
              autoRefinementEnabled: (
                settings.autoRefinement as Record<string, unknown> | undefined
              )?.enabled,
            })
            return json(financePayload())
          }
          if (action === 'set_grid_config') {
            // Tunable knobs for the independent paper-only grid engine
            // (settings.demoTradingGrid, resolved by resolveGridEngineConfig
            // in grid-paper-engine.ts). Wholly separate from the council's
            // settings.demoTrading — never read or written by this branch.
            const cfg =
              body.config && typeof body.config === 'object'
                ? (body.config as JsonRecord)
                : {}
            const inRange = (
              value: unknown,
              min: number,
              max: number,
            ): number | undefined =>
              typeof value === 'number' &&
              Number.isFinite(value) &&
              value >= min &&
              value <= max
                ? value
                : undefined
            const db = readFinanceStore()
            const settings = db.settings as Record<string, unknown>
            const gc = (
              settings.demoTradingGrid && typeof settings.demoTradingGrid === 'object'
                ? { ...(settings.demoTradingGrid as Record<string, unknown>) }
                : {}
            ) as Record<string, unknown>

            const gridCount = inRange(cfg.gridCount, 2, 100)
            const quotePerGrid = inRange(cfg.quotePerGrid, 1, 100000)
            const rangeLookbackCandles = inRange(cfg.rangeLookbackCandles, 10, 1000)
            const upperStopPct = inRange(cfg.upperStopPct, 0, 5)
            const lowerStopPct = inRange(cfg.lowerStopPct, 0, 1)
            const efficiencyLookbackCandles = inRange(cfg.efficiencyLookbackCandles, 2, 1000)
            const maxEfficiencyRatio = inRange(cfg.maxEfficiencyRatio, 0, 1)
            if (gridCount !== undefined) gc.gridCount = Math.floor(gridCount)
            if (quotePerGrid !== undefined) gc.quotePerGrid = quotePerGrid
            if (rangeLookbackCandles !== undefined)
              gc.rangeLookbackCandles = Math.floor(rangeLookbackCandles)
            if (upperStopPct !== undefined) gc.upperStopPct = upperStopPct
            if (lowerStopPct !== undefined) gc.lowerStopPct = lowerStopPct
            if (efficiencyLookbackCandles !== undefined)
              gc.efficiencyLookbackCandles = Math.floor(efficiencyLookbackCandles)
            if (maxEfficiencyRatio !== undefined) gc.maxEfficiencyRatio = maxEfficiencyRatio
            const rearmOutside = inRange(cfg.rearmOutsideRangeCandles, 0, 1000)
            if (rearmOutside !== undefined)
              gc.rearmOutsideRangeCandles = Math.floor(rearmOutside)
            // Grid execution mode: 'paper' (default) or 'testnet_execute'
            // (mirror paper fills as real testnet orders). Only these two
            // literals are ever accepted — there is deliberately no live
            // mode for the grid engine.
            if (cfg.executionMode === 'paper' || cfg.executionMode === 'testnet_execute')
              gc.executionMode = cfg.executionMode
            const gridDailyLoss = inRange(cfg.maxDailyLossQuote, 0, 100000)
            if (gridDailyLoss !== undefined) gc.maxDailyLossQuote = gridDailyLoss
            const gridOrderBudget = inRange(cfg.maxRealOrdersPerCycle, 1, 200)
            if (gridOrderBudget !== undefined)
              gc.maxRealOrdersPerCycle = Math.floor(gridOrderBudget)
            if (cfg.spacing === 'arithmetic' || cfg.spacing === 'geometric')
              gc.spacing = cfg.spacing
            if (typeof cfg.autoRecenter === 'boolean') gc.autoRecenter = cfg.autoRecenter
            if (typeof cfg.efficiencyGate === 'boolean') gc.efficiencyGate = cfg.efficiencyGate
            if (typeof cfg.absoluteStopFloorEnabled === 'boolean')
              gc.absoluteStopFloorEnabled = cfg.absoluteStopFloorEnabled
            if (Array.isArray(cfg.symbols)) {
              const syms = cfg.symbols
                .filter((s): s is string => typeof s === 'string')
                .map((s) => s.trim().toUpperCase())
                .filter((s) => /^[A-Z0-9]{5,20}$/.test(s))
              if (syms.length > 0) gc.symbols = Array.from(new Set(syms))
            }
            settings.demoTradingGrid = gc
            writeFinanceStore(db)
            appendAuditLog('grid_config_updated', gc)
            return json(financePayload())
          }
          if (action === 'set_rebalance_config') {
            // Only `enabled` is exposed here — the rebalancing bot shares
            // the council's global settings.tradingMode (already
            // testnet_execute in production), so without its own flag,
            // deploying the code plus a cron tick would arm it with no
            // distinct sign-off step. See RebalanceConfig.enabled's docstring
            // in rebalance-engine.ts. Off by default.
            const cfg =
              body.config && typeof body.config === 'object'
                ? (body.config as JsonRecord)
                : {}
            const db = readFinanceStore()
            const settings = db.settings as Record<string, unknown>
            const rc = (
              settings.demoTradingRebalance &&
              typeof settings.demoTradingRebalance === 'object'
                ? { ...(settings.demoTradingRebalance as Record<string, unknown>) }
                : {}
            ) as Record<string, unknown>
            if (typeof cfg.enabled === 'boolean') rc.enabled = cfg.enabled
            settings.demoTradingRebalance = rc
            writeFinanceStore(db)
            appendAuditLog('rebalance_config_updated', { enabled: rc.enabled })
            return json(financePayload())
          }
          if (action === 'set_strategy_decay_config') {
            // Off by default — mirrors autoRefinementEnabled and the other
            // engine flags above. Detection only ever audit-logs
            // ('strategy_decay_detected'); it never disables a strategy or
            // changes sizing itself. See strategy-decay.ts.
            const cfg =
              body.config && typeof body.config === 'object'
                ? (body.config as JsonRecord)
                : {}
            const inRange = (
              value: unknown,
              min: number,
              max: number,
            ): number | undefined =>
              typeof value === 'number' &&
              Number.isFinite(value) &&
              value >= min &&
              value <= max
                ? value
                : undefined
            const db = readFinanceStore()
            const settings = db.settings as Record<string, unknown>
            const dc = (
              settings.strategyDecayDetection &&
              typeof settings.strategyDecayDetection === 'object'
                ? { ...(settings.strategyDecayDetection as Record<string, unknown>) }
                : {}
            ) as Record<string, unknown>
            if (typeof cfg.enabled === 'boolean') dc.enabled = cfg.enabled
            const winRateDropThreshold = inRange(cfg.winRateDropThreshold, 0.01, 1)
            if (winRateDropThreshold !== undefined)
              dc.winRateDropThreshold = winRateDropThreshold
            const minTrailingTrades = inRange(cfg.minTrailingTrades, 1, 1000)
            if (minTrailingTrades !== undefined)
              dc.minTrailingTrades = Math.floor(minTrailingTrades)
            settings.strategyDecayDetection = dc
            writeFinanceStore(db)
            appendAuditLog('strategy_decay_config_updated', dc)
            return json(financePayload())
          }
          if (action === 'save_strategy_baseline') {
            // Persists a strategy's validated backtest summary so live
            // performance can later be compared against it (see
            // strategy-decay.ts / decisionQualityReport's byStrategy[].decay).
            // Intentionally written to finance-store settings, NOT the
            // research-store Postgres schema — research-store is documented
            // as write-only/analysis-only and is never read back by live
            // engines; this value IS read back every cycle, so it belongs in
            // the same operational store as every other engine config.
            const body2 = body as {
              strategyId?: unknown
              winRate?: unknown
              avgPnlQuote?: unknown
              trades?: unknown
            }
            if (
              typeof body2.strategyId !== 'string' ||
              body2.strategyId.length === 0 ||
              typeof body2.winRate !== 'number' ||
              !Number.isFinite(body2.winRate) ||
              typeof body2.avgPnlQuote !== 'number' ||
              !Number.isFinite(body2.avgPnlQuote) ||
              typeof body2.trades !== 'number' ||
              !Number.isFinite(body2.trades)
            ) {
              return json(
                { ok: false, error: 'strategyId, winRate, avgPnlQuote, trades are required' },
                { status: 400 },
              )
            }
            const db = readFinanceStore()
            const settings = db.settings as Record<string, unknown>
            const baselines = (
              settings.strategyBaselines &&
              typeof settings.strategyBaselines === 'object'
                ? { ...(settings.strategyBaselines as Record<string, unknown>) }
                : {}
            ) as Record<string, unknown>
            const baseline = {
              strategyId: body2.strategyId,
              winRate: body2.winRate,
              avgPnlQuote: body2.avgPnlQuote,
              trades: Math.floor(body2.trades),
              computedAt: new Date().toISOString(),
            }
            baselines[body2.strategyId] = baseline
            settings.strategyBaselines = baselines
            writeFinanceStore(db)
            appendAuditLog('strategy_baseline_saved', baseline)
            return json(financePayload())
          }
          if (action === 'set_llm_config') {
            // Only `enabled` is exposed here — same rationale as
            // set_rebalance_config above (this engine also shares the
            // council's global settings.tradingMode). Off by default.
            const cfg =
              body.config && typeof body.config === 'object'
                ? (body.config as JsonRecord)
                : {}
            const db = readFinanceStore()
            const settings = db.settings as Record<string, unknown>
            const lc = (
              settings.demoTradingLlm && typeof settings.demoTradingLlm === 'object'
                ? { ...(settings.demoTradingLlm as Record<string, unknown>) }
                : {}
            ) as Record<string, unknown>
            if (typeof cfg.enabled === 'boolean') lc.enabled = cfg.enabled
            settings.demoTradingLlm = lc
            writeFinanceStore(db)
            appendAuditLog('llm_config_updated', { enabled: lc.enabled })
            return json(financePayload())
          }
          if (action === 'list_pending_ingestions') {
            // Unmasked on purpose — financePayload()'s `data` blob runs
            // through maskSensitive(), which would redact passwordHint
            // (matches /password/i) even though it's a plain hint the user
            // needs to read, not a secret.
            return json({ ok: true, pendingIngestions: listPendingIngestions() })
          }
          if (action === 'submit_ingestion_password') {
            const id = typeof body.id === 'string' ? body.id : ''
            const password = typeof body.password === 'string' ? body.password : ''
            if (!id || !password) {
              return json({ ok: false, error: 'id and password are required.' }, { status: 400 })
            }
            const pending = listPendingIngestions().find((p) => p.id === id)
            if (!pending) return json({ ok: false, error: 'Pending ingestion not found.' }, { status: 404 })

            const normalized = pdfToImages(pending.sourceRef, password)
            if (!normalized.ok) {
              const updated = updatePendingIngestion(id, {
                error: normalized.reason === 'bad_password' ? 'Incorrect password, try again.' : normalized.reason,
              })
              return json({ ok: true, pendingIngestion: updated })
            }

            const previewImagePath = normalized.imagePaths[0]
            const extraction = await extractTransactionFromImage(previewImagePath, getCategoryCorrections())
            const updated = updatePendingIngestion(id, {
              status: 'awaiting_review',
              rawPreviewImagePath: previewImagePath,
              extracted: extraction.ok ? extraction.data : undefined,
              error: extraction.ok ? undefined : extraction.reason,
            })
            return json({ ok: true, pendingIngestion: updated })
          }
          if (action === 'confirm_pending_ingestion') {
            const id = typeof body.id === 'string' ? body.id : ''
            const payload =
              body.payload && typeof body.payload === 'object' ? (body.payload as JsonRecord) : {}
            const force = body.force === true
            const pending = listPendingIngestions().find((p) => p.id === id)
            if (!pending) return json({ ok: false, error: 'Pending ingestion not found.' }, { status: 404 })

            const kind = typeof payload.kind === 'string' ? payload.kind : pending.extracted?.kind
            if (kind !== 'income' && kind !== 'expense') {
              return json({ ok: false, error: 'kind (income|expense) is required.' }, { status: 400 })
            }
            const vendorOrSource = typeof payload.vendorOrSource === 'string' ? payload.vendorOrSource : ''
            const date = typeof payload.date === 'string' ? payload.date : ''
            const amount = typeof payload.amount === 'number' ? payload.amount : Number(payload.amount)

            // Same-day/vendor/amount already on record — likely the same
            // bill arriving via both Gmail and a manual upload. Warn instead
            // of silently double-counting; the UI can resend with force:true.
            if (!force) {
              const duplicate = findPossibleDuplicate(kind, vendorOrSource, date, amount)
              if (duplicate) {
                return json({ ok: true, duplicateWarning: duplicate, pendingIngestion: pending })
              }
            }

            // Learn from a category correction: if the user changed the
            // AI-suggested category before confirming, remember it for next
            // time this vendor shows up.
            const suggestedCategory = pending.extracted?.category
            const finalCategory = typeof payload.category === 'string' ? payload.category : undefined
            if (vendorOrSource && finalCategory && finalCategory !== suggestedCategory) {
              recordCategoryCorrection(vendorOrSource, finalCategory)
            }

            addFinanceRecord(kind, {
              ...payload,
              source: pending.source,
              documentRef: pending.sourceRef,
              ...(kind === 'income'
                ? { sourceName: payload.vendorOrSource, dateReceived: payload.date }
                : { vendor: payload.vendorOrSource, date: payload.date }),
            })
            const updated = updatePendingIngestion(id, { status: 'confirmed' })
            return json({ pendingIngestion: updated, ...financePayload() })
          }
          if (action === 'reject_pending_ingestion') {
            const id = typeof body.id === 'string' ? body.id : ''
            if (!id) return json({ ok: false, error: 'id is required.' }, { status: 400 })
            const updated = updatePendingIngestion(id, { status: 'rejected' })
            return json({ ok: true, pendingIngestion: updated })
          }
          if (action === 'refresh_stock_price') {
            const id = typeof body.id === 'string' ? body.id : ''
            if (!id) return json({ ok: false, error: 'id is required.' }, { status: 400 })
            const db = readFinanceStore()
            const holding = db.stock_holdings.find((h) => h.id === id)
            if (!holding) return json({ ok: false, error: 'Stock holding not found.' }, { status: 404 })

            const priceResult = await fetchCsePrice(holding.symbol)
            if (!priceResult) {
              // Not an error — the unofficial CSE endpoint failing is an
              // expected, documented outcome; manual entry is the fallback.
              return json({ priceFetchFailed: true, ...financePayload() })
            }
            updateFinanceRecord('stock_holding', id, {
              lastKnownPrice: priceResult.price,
              lastPriceUpdatedAt: priceResult.asOf,
              priceSource: 'cse_api',
            })
            return json({ priceFetchFailed: false, ...financePayload() })
          }
          if (action === 'sync_gmail_now') {
            try {
              const result = await syncGmailNow()
              appendAuditLog('gmail_sync_run', { ...result })
              return json({ ok: true, result })
            } catch (error) {
              return json({ ok: false, error: safeErrorMessage(error) }, { status: 502 })
            }
          }
          if (action === 'apply_recommended_safeguards') {
            const applied = applyRecommendedSafeguards()
            return json({
              ...financePayload(),
              appliedSafeguards: applied.applied,
            })
          }
          if (action === 'run_learning_cycle') {
            const learning = runLearningCycle()
            return json({ ...financePayload(), learningCycle: learning })
          }
          if (action === 'apply_learning_candidate') {
            const candidateId =
              typeof body.candidateId === 'string' ? body.candidateId : ''
            const result = applyLearningCandidate(candidateId)
            return json({
              ...financePayload(),
              learningCandidateResult: result,
            })
          }
          if (action === 'set_strategy_override') {
            const result = setStrategyOverride({
              strategyId:
                typeof body.strategyId === 'string' ? body.strategyId : '',
              overrideAction: body.overrideAction,
              multiplier: body.multiplier,
              reason: body.reason,
              reviewAt: body.reviewAt,
              expiresAt: body.expiresAt,
              reviewAfterDays: body.reviewAfterDays,
              expiresAfterDays: body.expiresAfterDays,
            })
            return json({ ...financePayload(), strategyOverrideResult: result })
          }
          if (action === 'apply_strategy_override_recommendations') {
            const applied = applyStrategyOverrideRecommendations()
            return json({
              ...financePayload(),
              strategyOverrideRecommendationResult: applied.result,
            })
          }
          return json(
            { ok: false, error: `Unsupported finance action: ${action}` },
            { status: 400 },
          )
        } catch (error) {
          appendAuditLog('finance_api_error', {
            action,
            error: safeErrorMessage(error),
          })
          return json(
            { ok: false, error: safeErrorMessage(error) },
            { status: 400 },
          )
        }
      },
    },
  },
})
