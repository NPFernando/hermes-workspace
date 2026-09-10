/**
 * Live Binance price ticker — direct public WebSocket stream, buffered and
 * flushed once per second. Fully self-contained; extracted verbatim from
 * trading-screen.tsx (2026-09-10).
 */
import { useEffect, useRef, useState } from 'react'
import { Area, AreaChart, ResponsiveContainer } from 'recharts'
import { formatUsdt } from '../format-helpers'

const LIVE_PRICE_HISTORY_LIMIT = 60
const LIVE_PRICE_RECONNECT_DELAY_MS = 5000

interface LivePriceState {
  price: number
  changePercent: number
  history: Array<{ t: number; price: number }>
}

const LIVE_PRICE_FLUSH_INTERVAL_MS = 1000

export function LivePriceTicker({ symbols }: { symbols: Array<string> }) {
  const [prices, setPrices] = useState<Map<string, LivePriceState>>(new Map())
  const [connected, setConnected] = useState(false)
  // Binance can fire @ticker updates several times a second per symbol —
  // buffer incoming ticks in a ref and flush to React state on a fixed
  // interval so the UI re-renders at most once a second, not on every frame.
  const bufferRef = useRef<Map<string, LivePriceState>>(new Map())
  const dirtyRef = useRef(false)

  useEffect(() => {
    if (symbols.length === 0) return
    let socket: WebSocket | null = null
    let reconnectTimer: ReturnType<typeof setTimeout> | null = null
    let stopped = false

    function connect() {
      const streams = symbols.map((s) => `${s.toLowerCase()}@ticker`).join('/')
      socket = new WebSocket(
        `wss://stream.binance.com:9443/stream?streams=${streams}`,
      )
      socket.onopen = () => setConnected(true)
      socket.onclose = () => {
        setConnected(false)
        if (!stopped)
          reconnectTimer = setTimeout(connect, LIVE_PRICE_RECONNECT_DELAY_MS)
      }
      socket.onerror = () => {
        socket?.close()
      }
      socket.onmessage = (event) => {
        try {
          const parsed = JSON.parse(event.data as string) as {
            data?: { s?: string; c?: string; P?: string }
          }
          const d = parsed.data
          if (!d?.s || !d.c) return
          const symbol = d.s
          const price = Number(d.c)
          const changePercent = Number(d.P ?? 0)
          if (!Number.isFinite(price)) return
          const existing = bufferRef.current.get(symbol)
          const history = [
            ...(existing?.history ?? []),
            { t: Date.now(), price },
          ].slice(-LIVE_PRICE_HISTORY_LIMIT)
          bufferRef.current.set(symbol, { price, changePercent, history })
          dirtyRef.current = true
        } catch {
          // malformed frame — skip, never crash the ticker
        }
      }
    }

    connect()
    const flushTimer = setInterval(() => {
      if (!dirtyRef.current) return
      dirtyRef.current = false
      setPrices(new Map(bufferRef.current))
    }, LIVE_PRICE_FLUSH_INTERVAL_MS)

    return () => {
      stopped = true
      clearInterval(flushTimer)
      if (reconnectTimer) clearTimeout(reconnectTimer)
      socket?.close()
    }
  }, [symbols])

  if (symbols.length === 0) return null

  return (
    <section className="mt-6 rounded-3xl border border-[var(--theme-border)] bg-[var(--theme-panel)]/70 p-5">
      <div className="flex items-center justify-between gap-3">
        <h2 className="text-lg font-semibold">Live prices</h2>
        <span
          className={`rounded-full border px-2.5 py-1 text-xs ${
            connected
              ? 'border-[color-mix(in_srgb,var(--theme-success)_30%,transparent)] bg-[color-mix(in_srgb,var(--theme-success)_10%,transparent)] text-[var(--theme-success)]'
              : 'border-[var(--theme-border)] bg-[color-mix(in_srgb,var(--theme-text)_8%,transparent)] text-[var(--theme-muted)]'
          }`}
        >
          {connected ? 'Live' : 'Connecting...'}
        </span>
      </div>
      <p className="mt-1 text-xs text-[var(--theme-muted)]">
        Direct from Binance's public market stream, for your own monitoring —
        the engine itself still runs on its own 5/15-minute cycle.
      </p>
      <div className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
        {symbols.map((symbol) => {
          const state = prices.get(symbol)
          const changeTone =
            state && state.changePercent > 0
              ? 'text-[var(--theme-success)]'
              : state && state.changePercent < 0
                ? 'text-[var(--theme-danger)]'
                : 'text-[var(--theme-muted)]'
          return (
            <div
              key={symbol}
              className="rounded-2xl border border-[var(--theme-border)]/70 bg-[color-mix(in_srgb,var(--theme-text)_8%,transparent)] p-3"
            >
              <div className="flex items-center justify-between">
                <span className="text-sm font-semibold">{symbol}</span>
                <span className={`text-xs ${changeTone}`}>
                  {state
                    ? `${state.changePercent > 0 ? '+' : ''}${state.changePercent.toFixed(2)}%`
                    : '...'}
                </span>
              </div>
              <div className="mt-1 text-lg font-semibold">
                {state ? formatUsdt(state.price) : '...'}
              </div>
              <div className="mt-2 h-10 w-full">
                {state && state.history.length > 1 ? (
                  <ResponsiveContainer width="100%" height="100%">
                    <AreaChart data={state.history}>
                      <defs>
                        <linearGradient
                          id={`spark-${symbol}`}
                          x1="0"
                          y1="0"
                          x2="0"
                          y2="1"
                        >
                          <stop
                            offset="0%"
                            stopColor="var(--theme-success)"
                            stopOpacity={0.4}
                          />
                          <stop
                            offset="100%"
                            stopColor="var(--theme-success)"
                            stopOpacity={0}
                          />
                        </linearGradient>
                      </defs>
                      <Area
                        type="monotone"
                        dataKey="price"
                        stroke="var(--theme-success)"
                        strokeWidth={1.5}
                        fill={`url(#spark-${symbol})`}
                        isAnimationActive={false}
                        dot={false}
                      />
                    </AreaChart>
                  </ResponsiveContainer>
                ) : null}
              </div>
            </div>
          )
        })}
      </div>
    </section>
  )
}
