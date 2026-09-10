/** TradingControls — extracted verbatim from trading-screen.tsx. */
import { useFinanceAction } from '../../finance/hooks/use-finance-action'
import type { FinancePayload } from '../trading-types'

export const SELECTABLE_MODES: Array<{ id: string; label: string; hint: string }> = [
  {
    id: 'observe_only',
    label: 'Observe only',
    hint: 'No trading — market data only',
  },
  {
    id: 'paper_trade',
    label: 'Paper trade',
    hint: 'Simulated; no orders placed',
  },
  {
    id: 'testnet_execute',
    label: 'Testnet execute',
    hint: 'Fake-money orders on Binance testnet',
  },
  {
    id: 'live_manual_approval',
    label: 'Live manual',
    hint: 'Real Binance spot; 10 USDT cap + paper shadow',
  },
]

export function TradingControls({
  summary,
  onPayload,
}: {
  summary: FinancePayload['summary']
  onPayload: (p: FinancePayload) => void
}) {
  const {
    run: post,
    busy,
    error: err,
  } = useFinanceAction<FinancePayload>(onPayload)

  const cutoffOn = summary.emergencyKillSwitch

  function disarmCutoff() {
    const confirmed = window.confirm(
      'Disarm the emergency safety cutoff?\n\nThis lets the engine place orders in the selected Binance mode, including real-money live mode if it is armed. ' +
        'Only do this deliberately — you can re-arm it at any time.',
    )
    if (!confirmed) return
    void post(
      {
        action: 'set_kill_switch',
        engaged: false,
        approval: 'I_UNDERSTAND_DISABLE_SAFETY_CUTOFF',
      },
      'cutoff',
    )
  }

  function selectMode(modeId: string) {
    if (modeId === 'live_manual_approval') {
      const confirmed = window.confirm(
        'Arm Binance live manual mode?\n\nThis can place real spot orders after the cutoff is disarmed. Orders are capped and mirrored to paper shadow tracking.',
      )
      if (!confirmed) return
      void post(
        {
          action: 'arm_live_binance',
          approval: 'I_APPROVE_BINANCE_LIVE_TRADING',
          livePerOrderCapUsdt: 10,
        },
        'mode-live_manual_approval',
      )
      return
    }
    if (modeId === 'observe_only') {
      void post(
        { action: 'set_trading_mode', mode: 'observe_only' },
        `mode-${modeId}`,
      )
      return
    }
    const account = modeId === 'testnet_execute' ? 'binance_testnet' : 'paper'
    void post({ action: 'set_execution_account', account }, `mode-${modeId}`)
  }

  return (
    <section className="mt-6 rounded-3xl border border-[var(--theme-border)] bg-[var(--theme-panel)]/70 p-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-lg font-semibold">Trading controls</h2>
        <span
          className={`rounded-full border px-3 py-1 text-xs font-medium ${
            cutoffOn
              ? 'border-[color-mix(in_srgb,var(--theme-success)_30%,transparent)] bg-[color-mix(in_srgb,var(--theme-success)_10%,transparent)] text-[var(--theme-success)]'
              : 'border-[color-mix(in_srgb,var(--theme-danger)_30%,transparent)] bg-[color-mix(in_srgb,var(--theme-danger)_10%,transparent)] text-[var(--theme-danger)]'
          }`}
        >
          Cutoff:{' '}
          {cutoffOn
            ? 'ARMED (trading halted)'
            : 'DISARMED (trading can execute)'}
        </span>
      </div>

      {err && (
        <p className="mt-3 rounded-xl border border-[color-mix(in_srgb,var(--theme-danger)_30%,transparent)] bg-[color-mix(in_srgb,var(--theme-danger)_10%,transparent)] p-2 text-sm text-[var(--theme-danger)]">
          {err}
        </p>
      )}

      <div className="mt-4">
        <div className="text-xs uppercase tracking-[0.2em] text-[var(--theme-muted)]">
          Trading mode
        </div>
        <div className="mt-2 flex flex-wrap gap-2">
          {SELECTABLE_MODES.map((mode) => {
            const active = summary.tradingMode === mode.id
            return (
              <button
                key={mode.id}
                type="button"
                disabled={busy !== null}
                onClick={() => selectMode(mode.id)}
                className={`rounded-2xl border px-3.5 py-2 text-left text-sm transition disabled:opacity-50 ${
                  active
                    ? 'border-[color-mix(in_srgb,var(--theme-success)_40%,transparent)] bg-[color-mix(in_srgb,var(--theme-success)_15%,transparent)] text-[var(--theme-success)]'
                    : 'border-[var(--theme-border)] bg-[color-mix(in_srgb,var(--theme-text)_8%,transparent)] text-[var(--theme-text)] hover:border-[color-mix(in_srgb,var(--theme-success)_30%,transparent)]'
                }`}
              >
                <div className="font-medium">
                  {mode.label}
                  {active ? ' ✓' : ''}
                </div>
                <div className="text-xs text-[var(--theme-muted)]">
                  {mode.hint}
                </div>
              </button>
            )
          })}
        </div>
        <p className="mt-2 text-xs text-[var(--theme-muted)]">
          Active provider: Binance. IBKR is tracked as a future feature. Live
          mode still needs the cutoff disarmed before any order can execute.
        </p>
      </div>

      <div className="mt-5 border-t border-[var(--theme-border)]/60 pt-4">
        <div className="text-xs uppercase tracking-[0.2em] text-[var(--theme-muted)]">
          Emergency safety cutoff
        </div>
        <p className="mt-1 text-xs text-[var(--theme-muted)]">
          Master switch — while ARMED the engine cannot place any order,
          regardless of mode.
        </p>
        <div className="mt-3 flex flex-wrap gap-2">
          <button
            type="button"
            disabled={busy !== null || cutoffOn}
            onClick={() =>
              void post({ action: 'set_kill_switch', engaged: true }, 'cutoff')
            }
            className="rounded-2xl border border-[color-mix(in_srgb,var(--theme-success)_40%,transparent)] bg-[color-mix(in_srgb,var(--theme-success)_15%,transparent)] px-4 py-2 text-sm font-medium text-[var(--theme-success)] transition hover:bg-[color-mix(in_srgb,var(--theme-success)_25%,transparent)] disabled:opacity-40"
          >
            {busy === 'cutoff' ? '…' : 'Arm cutoff (safe)'}
          </button>
          <button
            type="button"
            disabled={busy !== null || !cutoffOn}
            onClick={disarmCutoff}
            className="rounded-2xl border border-[color-mix(in_srgb,var(--theme-danger)_40%,transparent)] bg-[color-mix(in_srgb,var(--theme-danger)_15%,transparent)] px-4 py-2 text-sm font-medium text-[var(--theme-danger)] transition hover:bg-[color-mix(in_srgb,var(--theme-danger)_25%,transparent)] disabled:opacity-40"
          >
            {busy === 'cutoff' ? '…' : 'Disarm cutoff (enable trading)'}
          </button>
          <button
            type="button"
            disabled={busy !== null}
            onClick={() => void post({ action: 'emergency_stop' }, 'estop')}
            className="rounded-2xl border border-[color-mix(in_srgb,var(--theme-danger)_50%,transparent)] bg-[color-mix(in_srgb,var(--theme-danger)_20%,transparent)] px-4 py-2 text-sm font-semibold text-[var(--theme-danger)] transition hover:bg-[color-mix(in_srgb,var(--theme-danger)_30%,transparent)] disabled:opacity-40"
          >
            {busy === 'estop' ? '…' : 'EMERGENCY STOP'}
          </button>
        </div>
      </div>
    </section>
  )
}
