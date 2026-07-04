import { createFileRoute } from '@tanstack/react-router';
import { json } from '@tanstack/react-start'
import { isAuthenticated } from '../../server/auth-middleware'
import { safeErrorMessage } from '../../server/rate-limit'
import {
  FINANCE_AUDIT_PATH,
  FINANCE_DATA_PATH,
  addFinanceRecord,
  appendAuditLog,
  ensureFinanceStore,
  financeAlerts,
  financeSummary,
  maskSensitive,
  readFinanceStore,
  tradingPerformanceSummary,
  writeFinanceStore,
} from '../../server/finance-store'
import {
  addBinanceCandles,
  addMarketPrice,
  fetchBinanceKlines,
  fetchBinanceTickerPrice,
} from '../../server/binance-market.service'
import {
  addIBKRCandles,
  addIBKRLMarketPrice,
  fetchIBKRTicker,
  getIBKRCandles,
} from '../../server/ibkr-market.service'
import { demoTradingPerformance } from '../../server/demo-trading-engine'

type JsonRecord = Record<string, unknown>

async function parseJsonBody(request: Request): Promise<JsonRecord> {
  try {
    const body = (await request.json()) as unknown
    return body && typeof body === 'object' && !Array.isArray(body) ? (body as JsonRecord) : {}
  } catch {
    return {}
  }
}

function unauthorized() {
  return json({ ok: false, error: 'Unauthorized' }, { status: 401 })
}

function financePayload() {
  const db = ensureFinanceStore()
  return {
    ok: true,
    checkedAt: Date.now(),
    paths: {
      database: FINANCE_DATA_PATH,
      auditLog: FINANCE_AUDIT_PATH,
      secretStorage: 'external secret manager / environment references only; API keys are not stored here',
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
        spotTestnetSupported: true,
        liveTradingEnabled: false,
        withdrawalsAllowed: false,
        futuresEnabled: false,
      },
      ibkr: {
        paperTradingSupported: true,
        liveTradingEnabled: false,
        requiresContractVerification: true,
      },
    },
    summary: financeSummary(db),
    tradingPerformance: tradingPerformanceSummary(db),
    demoPerformance: demoTradingPerformance(),
    alerts: financeAlerts(db),
    settings: db.settings,
    data: maskSensitive(db),
  }
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
        const action = typeof body.action === 'string' ? body.action : 'add_record'
        try {
          if (action === 'add_record') {
            const kind = typeof body.kind === 'string' ? body.kind : ''
            const payload = body.payload && typeof body.payload === 'object' ? (body.payload as JsonRecord) : {}
            addFinanceRecord(kind, payload)
            return json(financePayload())
          }
          if (action === 'fetch_market_price') {
            // Read-only market data: public Binance ticker or simulated IBKR paper price.
            // Does not place orders and is independent of the live-trading gate.
            const symbol = typeof body.symbol === 'string' ? body.symbol.trim() : ''
            if (!symbol) {
              return json({ ok: false, error: 'symbol is required' }, { status: 400 })
            }
            const platform = body.platform === 'ibkr' ? 'ibkr' : 'binance'
            if (platform === 'ibkr') {
              const ticker = await fetchIBKRTicker(symbol)
              addIBKRLMarketPrice(symbol, ticker.price, ticker.bid, ticker.ask, undefined)
            } else {
              const ticker = await fetchBinanceTickerPrice(symbol)
              addMarketPrice(symbol, ticker.price, ticker.bid, ticker.ask, undefined)
            }
            return json(financePayload())
          }
          if (action === 'fetch_candles') {
            // Read-only historical OHLCV: public Binance klines or simulated IBKR bars.
            const symbol = typeof body.symbol === 'string' ? body.symbol.trim() : ''
            if (!symbol) {
              return json({ ok: false, error: 'symbol is required' }, { status: 400 })
            }
            const platform = body.platform === 'ibkr' ? 'ibkr' : 'binance'
            const requestedLimit = typeof body.limit === 'number' && Number.isFinite(body.limit) ? body.limit : 100
            const limit = Math.max(1, Math.min(Math.floor(requestedLimit), 500))
            if (platform === 'ibkr') {
              const interval = typeof body.interval === 'string' && body.interval.trim() ? body.interval.trim() : '1 day'
              const bars = await getIBKRCandles(symbol, interval, limit)
              addIBKRCandles(symbol, interval, bars)
              return json(financePayload())
            }
            const interval = typeof body.interval === 'string' && body.interval.trim() ? body.interval.trim() : '1h'
            const klines = await fetchBinanceKlines(symbol, interval, limit)
            addBinanceCandles(symbol, interval, klines)
            return json(financePayload())
          }
          if (action === 'set_trading_mode') {
            const requestedMode = typeof body.mode === 'string' ? body.mode : 'observe_only'
            const db = readFinanceStore()
            const liveModes = ['live_manual_approval', 'live_auto_trade', 'live_monitored']
            if (liveModes.includes(requestedMode) && body.approval !== 'I_APPROVE_LIVE_TRADING') {
              appendAuditLog('trading_mode_change_blocked', { requestedMode, reason: 'missing explicit approval phrase' })
              return json({ ok: false, error: 'Explicit approval phrase required before enabling live trading.' }, { status: 400 })
            }
            db.settings.tradingMode = requestedMode as typeof db.settings.tradingMode
            db.settings.liveTradingEnabled = requestedMode === 'live_manual_approval' || requestedMode === 'live_auto_trade' || requestedMode === 'live_monitored'
            // NOTE: the emergency kill switch is an INDEPENDENT master cutoff — a mode
            // change must never arm or disarm it. Use `set_kill_switch` for that. This
            // keeps "select a mode" and "disarm the safety cutoff" as two deliberate,
            // separately-audited human actions instead of one being a side effect of the other.
            writeFinanceStore(db)
            appendAuditLog('trading_mode_changed', { requestedMode, liveTradingEnabled: db.settings.liveTradingEnabled })
            return json(financePayload())
          }
          if (action === 'emergency_stop') {
            const db = readFinanceStore()
            db.settings.tradingMode = 'observe_only'
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
            if (!engaged && body.approval !== 'I_UNDERSTAND_DISABLE_SAFETY_CUTOFF') {
              appendAuditLog('kill_switch_disarm_blocked', { reason: 'missing explicit confirmation phrase' })
              return json(
                { ok: false, error: 'Disarming the safety cutoff requires the explicit confirmation phrase.' },
                { status: 400 },
              )
            }
            db.settings.emergencyKillSwitch = engaged
            writeFinanceStore(db)
            appendAuditLog('kill_switch_set', { engaged, source: 'finance_api' })
            return json(financePayload())
          }
          if (action === 'set_demo_config') {
            // Update the demo engine's tunable knobs (settings.demoTrading), merged
            // over defaults by resolveEngineConfig. Values are range-validated; anything
            // out of range is ignored rather than applied.
            const cfg = body.config && typeof body.config === 'object' ? (body.config as JsonRecord) : {}
            const inRange = (value: unknown, min: number, max: number): number | undefined =>
              typeof value === 'number' && Number.isFinite(value) && value >= min && value <= max ? value : undefined
            const db = readFinanceStore()
            const settings = db.settings as Record<string, unknown>
            const dt = (settings.demoTrading && typeof settings.demoTrading === 'object'
              ? { ...(settings.demoTrading as Record<string, unknown>) }
              : {}) as Record<string, unknown>

            const tp = inRange(cfg.takeProfitPct, 0.0005, 0.5)
            const sl = inRange(cfg.stopLossPct, 0.0005, 0.5)
            const qpt = inRange(cfg.quotePerTrade, 1, 100000)
            const maxOpen = inRange(cfg.maxOpenPositions, 1, 50)
            if (tp !== undefined) dt.takeProfitPct = tp
            if (sl !== undefined) dt.stopLossPct = sl
            if (qpt !== undefined) dt.quotePerTrade = qpt
            if (Array.isArray(cfg.symbols)) {
              const syms = cfg.symbols
                .filter((s): s is string => typeof s === 'string')
                .map((s) => s.trim().toUpperCase())
                .filter((s) => /^[A-Z0-9]{5,20}$/.test(s))
              if (syms.length > 0) dt.symbols = Array.from(new Set(syms))
            }
            if (maxOpen !== undefined) {
              const guardian = (dt.guardian && typeof dt.guardian === 'object' ? { ...(dt.guardian as Record<string, unknown>) } : {}) as Record<string, unknown>
              guardian.maxOpenPositions = Math.floor(maxOpen)
              dt.guardian = guardian
            }
            settings.demoTrading = dt
            writeFinanceStore(db)
            appendAuditLog('demo_config_updated', {
              takeProfitPct: dt.takeProfitPct,
              stopLossPct: dt.stopLossPct,
              quotePerTrade: dt.quotePerTrade,
              symbols: dt.symbols,
              maxOpenPositions: (dt.guardian as Record<string, unknown> | undefined)?.maxOpenPositions,
            })
            return json(financePayload())
          }
          return json({ ok: false, error: `Unsupported finance action: ${action}` }, { status: 400 })
        } catch (error) {
          appendAuditLog('finance_api_error', { action, error: safeErrorMessage(error) })
          return json({ ok: false, error: safeErrorMessage(error) }, { status: 400 })
        }
      },
    },
  },
})
