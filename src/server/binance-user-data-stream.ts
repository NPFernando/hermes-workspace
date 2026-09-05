/**
 * Read-only, informational listener on Binance Demo Trading's WebSocket API
 * user data stream (`userDataStream.subscribe.signature` — HMAC-signed, no
 * Ed25519 session needed: https://developers.binance.com/docs/binance-spot-api-docs/web-socket-api.md#user-data-signature).
 * Audit-logs order/balance events as they happen instead of only learning
 * about account activity on the next 5-15 minute cron tick.
 *
 * Deliberately never mutates trading state (positions/trades/settings) — the
 * single-writer invariant for finance.json stays entirely with the
 * cron-driven engine cycles (demo-trading-engine.ts / grid-paper-engine.ts).
 * This is a parallel, informational side-channel only.
 *
 * Honest scope note (2026-07-20): every order this engine places is MARKET,
 * which fills synchronously in the same placeOrder() response — so this does
 * NOT close any latency gap for orders we initiate; we already have that
 * fill data in-process. Its actual value is (a) detecting account activity
 * we didn't initiate ourselves (e.g. manual actions in the Binance testnet
 * UI), and (b) infrastructure that would matter if async order types
 * (native STOP_LOSS_LIMIT/OCO) are ever added later.
 */
import { randomUUID } from 'node:crypto'
import { appendAuditLog, readFinanceStore } from './finance-store'
import { createDemoClientFromEnv } from './binance-demo-client'

const WS_HOST_BY_REST_HOST: Record<string, string> = {
  'demo-api.binance.com': 'demo-ws-api.binance.com',
  'testnet.binance.vision': 'ws-api.testnet.binance.vision',
}

const RECONNECT_DELAY_MS = 15_000
const ARMED_POLL_INTERVAL_MS = 60_000

let socket: WebSocket | null = null
let pollTimer: ReturnType<typeof setInterval> | null = null
let reconnectTimer: ReturnType<typeof setTimeout> | null = null
let stopped = true

function envFlagOff(name: string): boolean {
  const value = process.env[name]?.trim().toLowerCase()
  return value === '0' || value === 'false' || value === 'off' || value === 'no'
}

/**
 * Maps a parsed user-data-stream event to an audit-log entry, or null for
 * event types we don't act on. Pure (no I/O) so it's unit-testable without a
 * live socket — see user-data-stream.md for the exact event shapes.
 */
export function auditEntryForEvent(
  evt: unknown,
): { action: string; details: Record<string, unknown> } | null {
  if (!evt || typeof evt !== 'object' || Array.isArray(evt)) return null
  const e = evt as Record<string, unknown>
  if (typeof e.e !== 'string') return null

  if (e.e === 'executionReport') {
    return {
      action: 'binance_user_data_execution_report',
      details: {
        symbol: e.s,
        side: e.S,
        orderType: e.o,
        executionType: e.x,
        orderStatus: e.X,
        rejectReason: e.r,
        orderId: e.i,
        lastExecutedQty: e.l,
        cumulativeFilledQty: e.z,
        lastExecutedPrice: e.L,
        commission: e.n,
        commissionAsset: e.N,
        cumulativeQuoteQty: e.Z,
      },
    }
  }
  if (e.e === 'outboundAccountPosition') {
    const balances = Array.isArray(e.B) ? e.B : []
    return {
      action: 'binance_user_data_account_position',
      details: {
        balances: balances.filter((b: Record<string, unknown>) => {
          const free = parseFloat(String(b.f ?? '0'))
          const locked = parseFloat(String(b.l ?? '0'))
          return free > 0 || locked > 0
        }),
      },
    }
  }
  if (e.e === 'balanceUpdate') {
    return {
      action: 'binance_user_data_balance_update',
      details: { asset: e.a, delta: e.d },
    }
  }
  return null
}

function isArmed(): boolean {
  try {
    const db = readFinanceStore()
    const settings = db.settings as Record<string, unknown>
    return (
      settings.tradingMode === 'testnet_execute' &&
      settings.emergencyKillSwitch !== true
    )
  } catch {
    return false
  }
}

function scheduleReconnect(): void {
  if (stopped || reconnectTimer) return
  reconnectTimer = setTimeout(() => {
    reconnectTimer = null
    connectIfArmed()
  }, RECONNECT_DELAY_MS)
  reconnectTimer.unref()
}

function closeSocket(): void {
  if (!socket) return
  const current = socket
  socket = null
  try {
    current.close()
  } catch {
    /* non-fatal */
  }
}

function connectIfArmed(): void {
  if (stopped || socket) return
  if (!isArmed()) return
  const built = createDemoClientFromEnv()
  if (!built.client) return
  const client = built.client
  const wsHost = WS_HOST_BY_REST_HOST[client.host]
  if (!wsHost) return

  const subscribeId = randomUUID()
  let ws: WebSocket
  try {
    ws = new WebSocket(`wss://${wsHost}/ws-api/v3`)
  } catch (err) {
    appendAuditLog('binance_user_data_stream_connect_failed', {
      reason: err instanceof Error ? err.message : String(err),
    })
    scheduleReconnect()
    return
  }
  socket = ws

  ws.addEventListener('open', () => {
    try {
      const params = client.buildUserDataStreamSubscribeParams()
      ws.send(
        JSON.stringify({
          id: subscribeId,
          method: 'userDataStream.subscribe.signature',
          params,
        }),
      )
    } catch (err) {
      appendAuditLog('binance_user_data_stream_subscribe_failed', {
        reason: err instanceof Error ? err.message : String(err),
      })
      closeSocket()
    }
  })

  ws.addEventListener('message', (messageEvent) => {
    let msg: Record<string, unknown>
    try {
      const raw =
        typeof messageEvent.data === 'string'
          ? messageEvent.data
          : String(messageEvent.data)
      msg = JSON.parse(raw)
    } catch {
      return
    }

    if (msg.id === subscribeId) {
      if (msg.status !== 200) {
        appendAuditLog('binance_user_data_stream_subscribe_failed', {
          status: msg.status,
          error: msg.error,
        })
        closeSocket()
      } else {
        appendAuditLog('binance_user_data_stream_subscribed', {})
      }
      return
    }

    const logged = auditEntryForEvent(msg.event)
    if (logged) appendAuditLog(logged.action, logged.details)
  })

  ws.addEventListener('close', () => {
    socket = null
    scheduleReconnect()
  })

  ws.addEventListener('error', () => {
    // 'close' always follows 'error' for WebSocket connections — the
    // reconnect is scheduled from the 'close' handler above.
  })
}

/**
 * Starts the background listener (idempotent — safe to call on every
 * request-module load, same pattern as startFinanceStorageMonitor()).
 * Polls every ARMED_POLL_INTERVAL_MS to connect once testnet_execute is
 * armed, and to disconnect if it's disarmed mid-session.
 */
export function startBinanceUserDataStream(): boolean {
  if (pollTimer) return false
  if (envFlagOff('HERMES_BINANCE_USER_DATA_STREAM')) return false
  if (process.env.VITEST || process.env.NODE_ENV === 'test') return false
  if (typeof window !== 'undefined') return false

  stopped = false
  connectIfArmed()
  pollTimer = setInterval(() => {
    if (isArmed()) connectIfArmed()
    else closeSocket()
  }, ARMED_POLL_INTERVAL_MS)
  pollTimer.unref()
  return true
}

/** For tests: fully tears down timers/connection and resets the singleton guard. */
export function stopBinanceUserDataStream(): void {
  stopped = true
  if (pollTimer) {
    clearInterval(pollTimer)
    pollTimer = null
  }
  if (reconnectTimer) {
    clearTimeout(reconnectTimer)
    reconnectTimer = null
  }
  closeSocket()
}
