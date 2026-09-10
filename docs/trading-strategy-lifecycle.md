# Strategy lifecycle: making auto upgrade/degrade symmetric

**Status:** IMPLEMENTED inert, 2026-09-10 — ships behind
`learningPolicy.autoRestore` (**default false**), so it changes nothing until
explicitly enabled. Turning it on, plus the final threshold values
(`STRATEGY_RESTORE_WINRATE` 0.53, `STRATEGY_RESTORE_HEALTHY_RUNS` 2, the
`0.5 → 0.75 → clear` ladder), still need sign-off.
**Author:** finance-section audit, 2026-09-10.

## What shipped

`demo-trading-engine.ts`: `LearningPolicy.autoRestore`, pure helpers
`strategyRecoveryEligible()` / `restoreStepForOverride()`, a per-strategy
`strategyRestoreProgress` streak map on `settings.demoTrading`, and a recovery
loop appended to `applyStrategyOverrideRecommendations()` (the same daily
applier — no new cron). Result gains a `restored: StrategyOverrideRestoreStep[]`
field; the audit row gains `restoredCount`. 5 tests cover flag-off no-op, the
2-run gate, the full `disabled → 0.5 → 0.75 → clear` ladder, the flap reset,
and manual-override immunity. The design below is unchanged; the recovery-band
line landed at **0.53** (not 0.52) for a clean 8-pt gap over the 0.45 demote
line. The dashboard chip + `demo-trading-auto-throttle.sh` Telegram line are
still TODO.

## The gap

The engine automatically **degrades** a strategy when its success rate falls,
but has **no automatic path back up** when it recovers. Requested behaviour was
"upgrade *and* degrade … when success rate low to high" — currently only the
"high → low" direction is automated.

### How degrade works today (automatic)

| Where | What |
|---|---|
| `strategyRecommendation()` (`demo-trading-engine.ts`) | per-strategy verdict from its `StrategyScore`: `disable_until_review` (`trades≥3 && winRate<0.34 && totalPnl<0`), `reduce_size` (`trades≥3 && (winRate<0.45 \|\| avgPnl<0 \|\| score<−0.5)`), `cooldown` (loss-streak), else `keep` |
| `demo-trading-auto-throttle.sh` → `POST /api/finance {apply_strategy_override_recommendations}` — **daily 20:35 cron** | calls `applyStrategyOverrideRecommendations()` |
| `applyStrategyOverrideRecommendations()` | for each strategy, `targetOverrideForRecommendation(rec)` → if non-null, `setStrategyOverride({overrideAction:'disabled'\|'reduce_size'})` with a 3-day review / **7-day `expiresAt`** |

### How upgrade works today (manual only)

| Where | What |
|---|---|
| `decisionQualityReport()` | docstring: *"does not change configuration… guidance for the UI"*. Produces `recommendedAdjustments.recommendedMode` (`paper_trade`→`testnet_execute` at `winRate≥0.45`+`PF≥1`+`recentPnl≥0`; →`live_manual_approval` at `winRate≥0.55`+`PF≥1.5`+15 trades) |
| Trading dashboard | renders the recommendation; a human clicks to apply |
| Override removal | `setStrategyOverride({overrideAction:'clear'})` — **only** from a manual UI action, **or** silent 7-day `expiresAt` |

### Consequences

1. **A recovered strategy stays throttled for up to 7 days.** `applyStrategyOverrideRecommendations()` treats `recommendation==='keep'` as "skip" — it never emits `overrideAction:'clear'`. Nothing cronned calls `clear`. So the only way a `reduce_size ×0.5` / `disabled` override lifts on its own is the expiry clock, regardless of how good the strategy now looks.
2. **No hysteresis at 0.45.** Demote fires at `winRate < 0.45`; the promote-eligible band starts at `winRate ≥ 0.45`. Sample gates differ (`trades≥3` demote vs `closedCount≥5` promote guidance). A strategy oscillating around 0.44–0.46 flaps between "throttle" and "promote-eligible", damped only by the review window.
3. **`expiresAt` on `automatic` overrides is partly ignored.** `strategyOverrideState()` keeps an override in `active` when `!expired || source==='automatic'` — so an expired automatic override can linger until something rewrites the state. Recovery-driven clearing would also fix this by giving automatic overrides a real removal path.

## Proposal

Add a **recovery ladder** to `applyStrategyOverrideRecommendations()` — the same
daily cron, no new job — that steps `automatic`-source overrides *down* one
level per run when the strategy has clearly recovered, with a hysteresis band
and a min-sample gate so it can't flap.

### New verdict: `strategyRecommendation()` gains a `restore` tier

```
cooldown / loss-streak            -> (unchanged) 'cooldown'
trades≥3 && winRate<0.34 && pnl<0 -> (unchanged) 'disable_until_review'
trades≥3 && (winRate<0.45 || …)   -> (unchanged) 'reduce_size'
trades≥5 && winRate≥0.52 &&        }
  avgPnlQuote>0 && score>-0.2      } -> NEW 'restore'   (recovery band)
otherwise                         -> 'keep'
```

- **0.52 recovery line vs 0.45 demote line = 7-point hysteresis band.** A
  strategy in `[0.45, 0.52)` is neither demoted nor restored — it holds its
  current override.
- `trades≥5` (vs `≥3` for demote): asymmetric sample gate — slower to trust a
  recovery than to react to a slump.
- `avgPnlQuote>0 && score>-0.2`: recovery must be *profitable*, not just a
  win-rate artefact of tiny wins / big losses.

### New mapping: `restoreStepForOverride(existing)`

One step down the ladder per daily run, so size ramps back gradually (mirrors
the fact that a slump can also only escalate one strictness level per run):

```
existing.mode === 'disabled'    -> setStrategyOverride({ overrideAction: 'reduce_size', multiplier: 0.5, source: 'automatic',
                                     reason: 'Auto-restore: win rate recovered above the 52% band.' })
existing.mode === 'reduce_size'
  && multiplier < 1.0           -> step multiplier up (0.5 -> 0.75 -> clear); final step:
                                   setStrategyOverride({ overrideAction: 'clear', source: 'automatic',
                                     reason: 'Auto-restore: sustained recovery, override lifted.' })
no existing automatic override  -> no-op (nothing to restore)
```

### Anti-flap guard

Track `restoreProgress` per strategy on the override record:
`{ consecutiveHealthyRuns: number, lastEvaluatedAt: string }`.
Require **2 consecutive** daily runs with a `restore` verdict before the first
step down. Any non-`restore` verdict resets the counter to 0. A demote verdict
still escalates immediately (no counter) — reactions to danger stay fast,
recovery stays cautious.

### Scope guards (unchanged safety posture)

- Only `source==='automatic'` overrides are touched by auto-restore. Manual
  (`source==='manual'`) and `experiment` overrides are never auto-cleared.
- Never runs in live mode (the applier already gates on execution mode via the
  same path as the auto-guard).
- `apply_recommended_safeguards` (the quote-size / tradingMode applier) stays
  **not cronned** — auto-restore only touches per-strategy overrides, never
  `tradingMode` or the global `quotePerTrade` base.

## Files

| File | Change |
|---|---|
| `demo-trading-engine.ts` `strategyRecommendation()` | add the `restore` branch |
| `demo-trading-engine.ts` `targetOverrideForRecommendation()` | return `null` for `restore` (handled separately) |
| `demo-trading-engine.ts` `applyStrategyOverrideRecommendations()` | after the escalation loop, a restore loop: for each `restore` strategy with an `automatic` override + 2 healthy runs, apply `restoreStepForOverride`; maintain `restoreProgress` |
| `demo-trading-engine.ts` override record type + `strategyOverrideFromRecord` / `setStrategyOverride` | carry `restoreProgress` |
| `trading-screen.tsx` | show a "recovering — N/2 healthy runs" chip on throttled strategies; show the restore in the override history |
| `demo-trading-engine.test.ts` | transitions: demote→hold(in band)→restore step→restore step→clear; flap reset; manual override untouched; live mode untouched |
| `demo-trading-auto-throttle.sh` (cron, **separate sign-off**) | widen the "changed" diff + Telegram line to report restores, not just throttles |

## Rollout

1. Land behind `settings.demoTrading.learningPolicy.autoRestore` (default
   **false**) — ships inert.
2. Observe one week of `strategy_override_recommendations_applied` audit rows
   with `restoreWouldApply` shadow entries (computed, not applied).
3. Flip `autoRestore: true` once the shadow log shows it would have lifted the
   right overrides at the right time.

## Open questions for sign-off

- Recovery line at **0.52**, or wider (0.55, matching the `live_manual_approval`
  bar)? Wider = more conservative, slower to un-throttle.
- **2** consecutive healthy runs, or 3?
- Restore ladder step for `reduce_size`: `0.5 → 0.75 → clear` (two runs), or
  `0.5 → clear` (one run)?
