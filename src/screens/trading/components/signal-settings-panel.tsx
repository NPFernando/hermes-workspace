/** SignalSettingsPanel — extracted verbatim from trading-screen.tsx. */
import { useState } from 'react'
import { formatUsdt } from '../format-helpers'
import { toggleTone } from '../panel-helpers'
import { useFinanceAction } from '../../finance/hooks/use-finance-action'
import type { FinancePayload } from '../trading-types'

export function SignalSettingsPanel({
  demoTrading,
  onPayload,
}: {
  demoTrading: Record<string, unknown>
  onPayload: (p: FinancePayload) => void
}) {
  const {
    run: post,
    busy,
    error: err,
  } = useFinanceAction<FinancePayload>(onPayload)
  const atrSizeBaselinePct =
    typeof demoTrading.atrSizeBaselinePct === 'number'
      ? demoTrading.atrSizeBaselinePct
      : 0
  const kellySizingEnabled = demoTrading.kellySizingEnabled === true
  const patternVetoEnabled = demoTrading.patternVetoEnabled === true
  const adxThreshold =
    typeof demoTrading.adxThreshold === 'number' ? demoTrading.adxThreshold : 0
  const fibTakeProfitEnabled = demoTrading.fibTakeProfitEnabled === true
  const longShortSentimentEnabled =
    demoTrading.longShortSentimentEnabled === true
  // Defaults to true (see EngineConfig.noLossExitMode's doc comment in
  // demo-trading-engine.ts) — only false once explicitly toggled off, since
  // an unset key from settings.demoTrading means "use the engine default".
  const noLossExitMode = demoTrading.noLossExitMode !== false
  const strategyGuardEnabled = demoTrading.strategyGuardEnabled === true
  const strategyGuardMinClosedTrades =
    typeof demoTrading.strategyGuardMinClosedTrades === 'number'
      ? demoTrading.strategyGuardMinClosedTrades
      : 5
  const strategyGuardLossRateThreshold =
    typeof demoTrading.strategyGuardLossRateThreshold === 'number'
      ? demoTrading.strategyGuardLossRateThreshold
      : 0.4
  const strategyGuardMaxPnlQuote =
    typeof demoTrading.strategyGuardMaxPnlQuote === 'number'
      ? demoTrading.strategyGuardMaxPnlQuote
      : 0
  const strategyGuardAction =
    demoTrading.strategyGuardAction === 'disabled' ? 'disabled' : 'reduce_size'

  const [atrInput, setAtrInput] = useState(String(atrSizeBaselinePct * 100))
  const [adxInput, setAdxInput] = useState(String(adxThreshold))
  const [guardMinTradesInput, setGuardMinTradesInput] = useState(
    String(strategyGuardMinClosedTrades),
  )
  const [guardLossRateInput, setGuardLossRateInput] = useState(
    String(strategyGuardLossRateThreshold * 100),
  )

  function setConfig(config: Record<string, unknown>, busyKey: string) {
    void post({ action: 'set_demo_config', config }, busyKey)
  }

  const buttonClass =
    'rounded-xl border px-3 py-1.5 text-xs font-medium transition disabled:opacity-40'
  const toneClass = (tone: 'good' | 'neutral') =>
    tone === 'good'
      ? 'border-[color-mix(in_srgb,var(--theme-success)_40%,transparent)] bg-[color-mix(in_srgb,var(--theme-success)_15%,transparent)] text-[var(--theme-success)] hover:bg-[color-mix(in_srgb,var(--theme-success)_25%,transparent)]'
      : 'border-[var(--theme-border)] bg-[color-mix(in_srgb,var(--theme-text)_8%,transparent)] text-[var(--theme-text)] hover:bg-[color-mix(in_srgb,var(--theme-text)_16%,transparent)]'
  const inputClass =
    'w-20 rounded-xl border border-[var(--theme-border)] bg-[color-mix(in_srgb,var(--theme-text)_8%,transparent)] px-3 py-1.5 text-xs text-[var(--theme-text)] outline-none'

  return (
    <section className="mt-6 rounded-3xl border border-[var(--theme-border)] bg-[var(--theme-panel)]/70 p-5">
      <div>
        <h2 className="text-lg font-semibold">Signal settings</h2>
        <p className="text-xs text-[var(--theme-muted)]">
          Optional council-engine levers built and backtested this session. Each
          is independent and off by default — read the caption before turning
          one on.
        </p>
      </div>

      {err && <p className="mt-3 text-xs text-[var(--theme-danger)]">{err}</p>}

      <div className="mt-4 grid gap-3 sm:grid-cols-2">
        <div className="rounded-2xl border border-[var(--theme-border)]/70 bg-[color-mix(in_srgb,var(--theme-text)_8%,transparent)] p-3">
          <h3 className="text-sm font-semibold">ATR-based position sizing</h3>
          <p className="mt-1 text-xs text-[var(--theme-muted)]">
            Only the 1% baseline improved backtest P&amp;L (-40→-29 quote) and
            drawdown (53%→46%); 2%/4% made both worse.
          </p>
          <div className="mt-2 flex items-center gap-2">
            <input
              type="number"
              value={atrInput}
              onChange={(e) => setAtrInput(e.target.value)}
              className={inputClass}
            />
            <span className="text-xs text-[var(--theme-muted)]">
              % baseline
            </span>
            <button
              type="button"
              disabled={busy === 'atr'}
              onClick={() =>
                setConfig(
                  { atrSizeBaselinePct: (Number(atrInput) || 0) / 100 },
                  'atr',
                )
              }
              className={`${buttonClass} ${toneClass(toggleTone(atrSizeBaselinePct > 0))}`}
            >
              {busy === 'atr' ? '...' : 'Save'}
            </button>
          </div>

          <div className="rounded-2xl border border-[color-mix(in_srgb,var(--theme-warning)_30%,transparent)] bg-[color-mix(in_srgb,var(--theme-warning)_8%,transparent)] p-3 sm:col-span-2">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <h3 className="text-sm font-semibold">
                  Automatic sandbox strategy guard
                </h3>
                <p className="mt-1 max-w-3xl text-xs text-[var(--theme-muted)]">
                  After enough closed trades, automatically reduces size or
                  disables an enabled strategy when its win rate and P&amp;L are
                  weak. It only affects future paper/testnet entries, expires
                  after 7 days, and can be cleared from Strategy overrides.
                </p>
              </div>
              <button
                type="button"
                disabled={busy === 'strategy-guard'}
                onClick={() =>
                  setConfig(
                    { strategyGuardEnabled: !strategyGuardEnabled },
                    'strategy-guard',
                  )
                }
                className={`${buttonClass} ${toneClass(toggleTone(strategyGuardEnabled))}`}
              >
                {busy === 'strategy-guard'
                  ? '...'
                  : strategyGuardEnabled
                    ? 'Enabled'
                    : 'Disabled'}
              </button>
            </div>
            <div className="mt-3 flex flex-wrap items-center gap-2 text-xs">
              <label className="flex items-center gap-2 text-[var(--theme-muted)]">
                Minimum trades
                <input
                  type="number"
                  min={3}
                  max={200}
                  value={guardMinTradesInput}
                  onChange={(event) => setGuardMinTradesInput(event.target.value)}
                  className={inputClass}
                />
              </label>
              <label className="flex items-center gap-2 text-[var(--theme-muted)]">
                Max win rate
                <input
                  type="number"
                  min={0}
                  max={100}
                  value={guardLossRateInput}
                  onChange={(event) => setGuardLossRateInput(event.target.value)}
                  className={inputClass}
                />
                %
              </label>
              <select
                value={strategyGuardAction}
                onChange={(event) =>
                  setConfig(
                    { strategyGuardAction: event.target.value },
                    'strategy-guard-action',
                  )
                }
                className="rounded-xl border border-[var(--theme-border)] bg-[var(--theme-panel)] px-3 py-1.5 text-xs text-[var(--theme-text)]"
              >
                <option value="reduce_size">Reduce to 50%</option>
                <option value="disabled">Disable until review</option>
              </select>
              <button
                type="button"
                disabled={busy === 'strategy-guard-thresholds'}
                onClick={() =>
                  setConfig(
                    {
                      strategyGuardMinClosedTrades:
                        guardMinTradesInput.trim() === ''
                          ? 5
                          : Number(guardMinTradesInput),
                      strategyGuardLossRateThreshold:
                        (guardLossRateInput.trim() === ''
                          ? 40
                          : Number(guardLossRateInput)) / 100,
                    },
                    'strategy-guard-thresholds',
                  )
                }
                className={`${buttonClass} ${toneClass('neutral')}`}
              >
                {busy === 'strategy-guard-thresholds' ? '...' : 'Save thresholds'}
              </button>
              <span className="text-[var(--theme-muted)]">
                Also requires total P&amp;L ≤{' '}
                {formatUsdt(strategyGuardMaxPnlQuote)}.
              </span>
            </div>
          </div>
        </div>

        <div className="rounded-2xl border border-[var(--theme-border)]/70 bg-[color-mix(in_srgb,var(--theme-text)_8%,transparent)] p-3">
          <h3 className="text-sm font-semibold">Kelly-criterion sizing</h3>
          <p className="mt-1 text-xs text-[var(--theme-muted)]">
            Safe to enable — self-gates behind 30 closed trades per strategy
            before it changes anything; only ever shrinks size.
          </p>
          <div className="mt-2">
            <button
              type="button"
              disabled={busy === 'kelly'}
              onClick={() =>
                setConfig({ kellySizingEnabled: !kellySizingEnabled }, 'kelly')
              }
              className={`${buttonClass} ${toneClass(toggleTone(kellySizingEnabled))}`}
            >
              {busy === 'kelly'
                ? '...'
                : kellySizingEnabled
                  ? 'Enabled'
                  : 'Disabled'}
            </button>
          </div>
        </div>

        <div className="rounded-2xl border border-[var(--theme-border)]/70 bg-[color-mix(in_srgb,var(--theme-text)_8%,transparent)] p-3">
          <h3 className="text-sm font-semibold">Pattern-bucket veto</h3>
          <p className="mt-1 text-xs text-[var(--theme-muted)]">
            Safe to enable — self-gates behind 20 samples in a strategy/RSI/
            volatility bucket with a 65%+ loss rate before it blocks anything.
          </p>
          <div className="mt-2">
            <button
              type="button"
              disabled={busy === 'veto'}
              onClick={() =>
                setConfig({ patternVetoEnabled: !patternVetoEnabled }, 'veto')
              }
              className={`${buttonClass} ${toneClass(toggleTone(patternVetoEnabled))}`}
            >
              {busy === 'veto'
                ? '...'
                : patternVetoEnabled
                  ? 'Enabled'
                  : 'Disabled'}
            </button>
          </div>
        </div>

        <div className="rounded-2xl border border-[var(--theme-border)]/70 bg-[color-mix(in_srgb,var(--theme-text)_8%,transparent)] p-3">
          <h3 className="text-sm font-semibold">ADX trend-strength gate</h3>
          <p className="mt-1 text-xs text-[var(--theme-muted)]">
            Caution: one backtest showed threshold 25 flip -40→+15 quote, but
            it's non-monotonic (30 dropped to -18) — no walk-forward done.
          </p>
          <div className="mt-2 flex items-center gap-2">
            <input
              type="number"
              value={adxInput}
              onChange={(e) => setAdxInput(e.target.value)}
              className={inputClass}
            />
            <span className="text-xs text-[var(--theme-muted)]">
              threshold (0=off)
            </span>
            <button
              type="button"
              disabled={busy === 'adx'}
              onClick={() =>
                setConfig({ adxThreshold: Number(adxInput) || 0 }, 'adx')
              }
              className={`${buttonClass} ${toneClass(toggleTone(adxThreshold > 0))}`}
            >
              {busy === 'adx' ? '...' : 'Save'}
            </button>
          </div>
        </div>

        <div className="rounded-2xl border border-[var(--theme-border)]/70 bg-[color-mix(in_srgb,var(--theme-text)_8%,transparent)] p-3">
          <h3 className="text-sm font-semibold">
            Fibonacci-extension take-profit
          </h3>
          <p className="mt-1 text-xs text-[var(--theme-muted)]">
            Roughly halves losses vs. the fixed-% take-profit in backtest, but
            stays net-negative overall — an improvement, not a standalone edge.
          </p>
          <div className="mt-2">
            <button
              type="button"
              disabled={busy === 'fib'}
              onClick={() =>
                setConfig(
                  { fibTakeProfitEnabled: !fibTakeProfitEnabled },
                  'fib',
                )
              }
              className={`${buttonClass} ${toneClass(toggleTone(fibTakeProfitEnabled))}`}
            >
              {busy === 'fib'
                ? '...'
                : fibTakeProfitEnabled
                  ? 'Enabled'
                  : 'Disabled'}
            </button>
          </div>
        </div>

        <div className="rounded-2xl border border-[var(--theme-border)]/70 bg-[color-mix(in_srgb,var(--theme-text)_8%,transparent)] p-3">
          <h3 className="text-sm font-semibold">Long/short sentiment</h3>
          <p className="mt-1 text-xs text-[var(--theme-muted)]">
            No backtest possible yet (Binance only retains ~30 days) — a live,
            unvalidated bet, not a proven signal.
          </p>
          <div className="mt-2">
            <button
              type="button"
              disabled={busy === 'sentiment'}
              onClick={() =>
                setConfig(
                  { longShortSentimentEnabled: !longShortSentimentEnabled },
                  'sentiment',
                )
              }
              className={`${buttonClass} ${toneClass(toggleTone(longShortSentimentEnabled))}`}
            >
              {busy === 'sentiment'
                ? '...'
                : longShortSentimentEnabled
                  ? 'Enabled'
                  : 'Disabled'}
            </button>
          </div>
        </div>

        <div className="rounded-2xl border border-[var(--theme-border)]/70 bg-[color-mix(in_srgb,var(--theme-text)_8%,transparent)] p-3">
          <h3 className="text-sm font-semibold">
            Patient hold (don't realize losses)
          </h3>
          <p className="mt-1 text-xs text-[var(--theme-muted)]">
            Sandbox/testnet only — while a position is underwater, this skips
            stop-loss, trailing-stop, max-hold, and strategy-exit sells so the
            engine keeps holding (and researching) until it can close at
            breakeven or a profit instead of locking in a loss. Guardian
            safety limits (dust/unsellable close, daily loss halt, max open
            positions) stay active regardless. Never enable this for real
            money — a losing position can never be forced to recover.
          </p>
          <div className="mt-2">
            <button
              type="button"
              disabled={busy === 'no-loss'}
              onClick={() =>
                setConfig({ noLossExitMode: !noLossExitMode }, 'no-loss')
              }
              className={`${buttonClass} ${toneClass(toggleTone(noLossExitMode))}`}
            >
              {busy === 'no-loss'
                ? '...'
                : noLossExitMode
                  ? 'Enabled'
                  : 'Disabled'}
            </button>
          </div>
        </div>
      </div>
    </section>
  )
}
