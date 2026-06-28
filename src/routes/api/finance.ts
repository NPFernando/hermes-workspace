import { createFileRoute } from '@tanstack/react-router'
import { json } from '@tanstack/react-start'
import { isAuthenticated } from '../../server/auth-middleware'
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
  writeFinanceStore,
} from '../../server/finance-store'

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
          if (action === 'set_trading_mode') {
            const requestedMode = typeof body.mode === 'string' ? body.mode : 'observe_only'
            const db = readFinanceStore()
            const liveModes = ['live_manual_approval', 'live_auto_trade']
            if (liveModes.includes(requestedMode) && body.approval !== 'I_APPROVE_LIVE_TRADING') {
              appendAuditLog('trading_mode_change_blocked', { requestedMode, reason: 'missing explicit approval phrase' })
              return json({ ok: false, error: 'Explicit approval phrase required before enabling live trading.' }, { status: 400 })
            }
            db.settings.tradingMode = requestedMode as typeof db.settings.tradingMode
            db.settings.liveTradingEnabled = requestedMode === 'live_manual_approval' || requestedMode === 'live_auto_trade'
            db.settings.emergencyKillSwitch = requestedMode !== 'live_auto_trade'
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
          return json({ ok: false, error: `Unsupported finance action: ${action}` }, { status: 400 })
        } catch (error) {
          appendAuditLog('finance_api_error', { action, error: error instanceof Error ? error.message : String(error) })
          return json({ ok: false, error: error instanceof Error ? error.message : 'Finance API failed' }, { status: 400 })
        }
      },
    },
  },
})
