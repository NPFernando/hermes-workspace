# `noUncheckedIndexedAccess` rollout plan

## Why this exists

`tsconfig.json` is missing `noUncheckedIndexedAccess`. Without it, TypeScript treats
`arr[i]` and `Record<K, V>[key]` as always-defined, even when they may not be. Across
three rounds of `@typescript-eslint/no-unnecessary-condition` cleanup (PRs #14, #17,
#20), this repo repeatedly found that most remaining lint findings are false positives
caused by exactly this gap — real risk the linter can't see because the compiler's own
types are lying to it. Fixing them one at a time is the wrong axis; the tsconfig flag
is the actual fix. This doc plans that rollout.

## Current state (2026-07-29)

Enabling the flag produces **859 errors across ~180 files** (measured after a 12-error
pilot batch, `docs/tsconfig-strictness-rollout.md`'s own fixes, already landed — see
below). Error types, unchanged from an earlier scoping pass, are ~98% two shapes:

| Code                                                             | Meaning                                         | Share |
| ---------------------------------------------------------------- | ----------------------------------------------- | ----- |
| TS18048                                                          | `'x' is possibly 'undefined'`                   | ~49%  |
| TS2532                                                           | `Object is possibly 'undefined'`                | ~34%  |
| TS2322 / TS2345                                                  | assignability against a now-`\| undefined` type | ~15%  |
| everything else (TS2538, TS2769, TS2722, TS2339, TS2488, TS7006) | ~2%                                             |

By directory:

| Directory        | Errors |
| ---------------- | ------ |
| `src/server`     | ~420   |
| `src/screens`    | ~255   |
| `src/components` | ~72    |
| `src/routes`     | ~38    |
| `src/hooks`      | ~23    |
| `scripts`        | ~19    |
| `src/lib`        | ~14    |
| `src/stores`     | ~12    |

Heaviest individual files (all in `src/server`, all trading-engine): `grid-backtest.ts`
(54), `trading-strategies.ts` (43), `grid-paper-engine.ts` (41), `trading-backtest.ts`
(39), `trading-backtest.test.ts` (28), `rebalance-backtest.ts` (25), plus their test
files. These 7 files alone account for roughly a third of the remaining total.

## Rollout strategy: fix in batches first, flip the flag last

Three options were considered:

- **(a) Flip now, fix everything in one PR.** Rejected — 859 errors in one diff is
  unreviewable, and this repo's whole pattern this session (PRs #10–#28, every one
  scoped to a single concern) argues strongly against it.
- **(b) Flip now, bridge with `@ts-expect-error`/`eslint-disable` suppressions, clean
  up over many follow-ups.** Rejected as the default — it unblocks the flag
  immediately but creates ~850 pieces of tracked debt with no forcing function to
  actually pay them down, and (worse) suppressing `TS18048`/`TS2532` at the _use_
  site risks masking a genuinely unsafe access that a future editor won't recatch.
- **(c) Fix in directory-sized batches first (this doc's approach), flip the flag once
  batches are done, or once few enough remain that the rest can ride in a single
  bridging PR.** Chosen. Each batch is real, mergeable, independently low-risk —
  same shape as every trading-engine PR this session already shipped.

**Recommendation: flip the flag once `src/server` is clean.** That's the directory
with the actual money-moving code (trading engines, finance store, guardian/alerts) —
the highest-value target for real bounds-safety, and at ~420 errors is roughly half
the total. Once it's clean, the remaining ~440 errors (mostly UI code in
`src/screens`/`src/components`, lower risk if occasionally wrong) can ride behind the
flag with `// eslint-disable-next-line @typescript-eslint/no-unnecessary-condition` +
a defensive guard as a bridging step per-file, cleaned up incrementally — UI code
getting a `undefined` where it expected a value is far less costly than a trading
engine doing the same.

## Batch plan for `src/server` (recommended order)

1. **Pilot (done, this PR)**: `trading-pattern-veto.ts` (+test), `rebalance-engine.ts`
   (+test), `fear-greed-sentiment.ts`, `tasks-store.ts`. 12 errors fixed. Proves the
   pattern: real guards (`!== undefined` checks, `?? null`, `?.`), not blind `!`
   assertions — same discipline as the `no-unnecessary-condition` cleanup rounds.
2. **Trading-engine core** (~200 errors): `grid-backtest.ts`, `trading-strategies.ts`,
   `grid-paper-engine.ts`, `trading-backtest.ts`, `rebalance-backtest.ts` + their test
   files. Highest value (real money logic), but also the largest single batch —
   consider splitting further by file if a single PR still feels too large once
   started. This session's context on these files is unusually deep (12+ PRs already
   touched them); doing this batch soon, while that context is fresh, is cheaper than
   doing it later.
3. **Finance/store layer** (~60 errors): `finance-store.ts`, `finance-postgres-store.ts`,
   `alerts.ts`, `strategy-decay.ts`, `exposure-aggregator.ts`, `trading-guardian.ts`.
4. **Everything else in `src/server`** (~160 errors, long tail of 1–5-error files):
   batch alphabetically or by subsystem (swarm/, mcp-hub/, sisters), few enough errors
   per file that this can likely go fast once the pattern is proven.
5. **Flip `noUncheckedIndexedAccess: true`** once 1–4 are clean. `src/screens` /
   `src/components` / `src/routes` / `src/hooks` / `scripts` / `src/lib` / `src/stores`
   (~440 errors) now show up as real tsc errors under the flag; bridge them with
   documented `eslint-disable-next-line` + guard, batch down incrementally same as
   above, no fixed deadline — UI-layer risk is lower.

## What "done" looks like for a batch

- Real bounds-safe fixes (`?.`, `??`, explicit `!== undefined` guards, or restructuring
  to avoid the access) — never a blind `!` non-null assertion unless the invariant is
  genuinely unprovable to TS but trivially true by inspection (and even then, prefer
  an explicit guard; it doubles as documentation).
- Each fix verified against actual type provenance, not pattern-matched from the error
  message alone — same rule this session's lint-cleanup rounds established.
- Because current CI runs eslint under the _lax_ tsconfig, guards added ahead of the
  flag being enabled will trip `@typescript-eslint/no-unnecessary-condition` (the lax
  types don't reflect the risk the guard defends against) — bridge with a documented
  `eslint-disable-next-line` pointing back to this doc, as done in the pilot batch.
- `npx tsc --noEmit` clean under the _current_ (non-strict) tsconfig after each batch
  — batches hardening code should never themselves depend on the flag being on.
- Full `npx vitest run` green, scoped `npx eslint` clean, before merging each batch PR.
