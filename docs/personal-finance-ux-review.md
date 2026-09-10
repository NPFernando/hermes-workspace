# Personal Finance dashboard — UX, data-model & performance review

**Date:** 2026-09-10
**Reviewer pass:** codebase inspection of `src/screens/personal-finance/**` (27 components, ~9k LOC),
`src/routes/api/finance.ts` (`personalFinancePayload()`), `src/server/finance-store.ts`, and the
`~/.hermes/scripts/personal-finance-digest.sh` cron.
**Lens:** the goal asked specifically — *"is it usable to a normal user, is it smart, easy to work
with, easy to understand, no duplicate data, refinement / rebuild, performance."*

This is complementary to `personal-finance-os-roadmap.md` (which already tracks the missing unified
ledger as the Phase-1 structural gap) and `finance-cutover-open-questions.md`. It does **not**
re-derive those; it focuses on usability, data duplication, and runtime cost.

Findings are ranked by **who they hurt**: a normal user first, then the maintainer.

---

## Part 1 — Normal-user UX

### U1. The Overview tab is an undifferentiated 13-card vertical scroll — HIGH

`personal-finance-screen.tsx:341-357` renders, in one flat column, with equal visual weight:

```
FinanceAlertsCard · BaseCurrencySelect · FinanceAnalystCard · FinanceTrendsCard ·
SavingsGoalsProgress · SinkingFundsPanel · EmergencyFundCard · SavingsRateTargetCard ·
WealthGoalCard · UpcomingMoney · RecurringBillsInsight · AssistantMemoryCard · DataHealthCard
```

A first-time user lands on a wall of 13 stacked cards with no "here's your money right now"
focal point, no grouping, and no sense of what matters most. There is no responsive grid — it's
one column at every breakpoint. `DataHealthCard` (a storage-health diagnostic) and
`AssistantMemoryCard` (AI category rules) sit in the same feed as "your net worth".

**Refine:** give Overview a real information hierarchy — a compact "today" summary block, then a
2-col grid of the goal cards, then insights, then diagnostics collapsed by default.

### U2. Three near-identical "target vs progress bar" cards — HIGH

`EmergencyFundCard`, `SavingsRateTargetCard`, `WealthGoalCard` are the same widget three times:
a target, a current value, a percentage, a progress bar, an inline "set target" form, and a
"needs X/mo to reach by <date>" line (the last is independently re-implemented in
`SavingsGoalsProgress` and `SinkingFundsPanel` too — see D4).

**Refine:** one "Goals & targets" section with a consistent row per goal. It reads as one idea
instead of three competing cards, and collapses ~200 lines of near-duplicate JSX.

### U3. A settings control is wedged into the middle of the dashboard feed — MEDIUM

`BaseCurrencySelect` (reporting-currency `<select>` + spread hint) renders as card #2 on
Overview, between the alerts card and the AI analyst. Changing your reporting currency is a
settings action, not something you do while scanning your finances. It belongs in a settings
area / a header control, not the content feed.

### U4. "Accounts & Records" tab is a grab-bag with two different editing UXs — MEDIUM

The Records tab (`:376-433`) mixes a purpose-built `TransactionsPanel`, `AccountsPanel`,
`CategoriesPanel`, `MerchantsPanel`, `TagsPanel` **and** three raw generic `<DataTable>`s
(Budget categories, Savings goals, Tax records) with hand-listed column arrays. So some
entities get a designed panel and others get a spreadsheet. Savings goals in particular are
editable in *two* places — the rich `SavingsGoalsProgress` card on Overview and the raw
`DataTable` here — with different fields exposed.

**Refine:** every entity gets one edit surface. Kill the generic `DataTable`s or make them the
only pattern; don't run both.

### U5. Header copy is developer-facing — LOW

`:177-191` — eyebrow "DollarWise-style personal finance", H1 "Money clarity, without trading
controls", body "separate from the automated trading workspace". "DollarWise-style" and
"trading workspace" mean nothing to a normal user; the framing is about what this *isn't*.

### U6. Currency-exposure block is cryptic — LOW

`:295-312` renders active-job / holding / FD exposure as a bare space-separated list of
`formatMoney(amount, currency)` — e.g. `USD 12,340   AUD 5,000   LKR 1,200,000` — with no
labels, no "you hold X across these currencies" sentence, no link to what's driving each.

### U7. Export is JSON-only — LOW

`:184` — the only export is `Export data (JSON)`. A normal user wants a CSV of transactions or
a PDF summary, not a database dump.

### U8. No global freshness / manual refresh — LOW

The payload is React-Query-cached with `staleTime: 30s` + refetch-on-focus (good), but there's
no "as of HH:MM" line and no manual refresh button anywhere on the screen. After a cron digest
or an ingestion confirm elsewhere, the user has no signal the numbers moved or a way to force it.

---

## Part 2 — Data duplication (the "no duplicate data" ask)

### D1. Every income/expense row is on the wire twice — HIGH  *(write-up only; not fixed this pass)*

`personalFinancePayload()` returns **both**:

- `transactions` = `getUnifiedTransactions(db)` — every `income_records` row and every
  `expense_records` row, re-shaped (`finance-store.ts`: `getUnifiedTransactions` restates
  `id, date, counterparty, category, accountId, currency, amount, convertedLkrAmount, notes,
  documentRef, tags, status, source, createdAt, updatedAt` for each).
- `data.income_records` **and** `data.expense_records` — the same rows, raw.

So the two largest, fastest-growing collections ship in full **twice** in every payload — on
first load, every 30s stale refetch, and in every mutation response.

**Consumers today (why it can't just be deleted in one line):**

| Reads `payload.transactions` | Reads `data.income_records` / `data.expense_records` directly |
|---|---|
| `transactions-panel.tsx` (only consumer) | `accounts-panel`, `categories-panel`, `merchants-panel`, `tags-panel`, `income-sources-panel`, `finance-trends-card`, `upcoming-money`, `recurring-bills-insight` |

**Fix (separate PR, against a merged baseline):** ship **one** representation. Either (a) drop
`transactions` and have `transactions-panel` unify the two raw arrays client-side (it already
does field-normalisation via `stringField`/`numberField`), or (b) drop the raw arrays and give
the 8 consumers a selector over `transactions`. (a) is smaller. Both are too large to be a 7th
commit on the unmerged PR #45 — this finding + the consumer list above **is** the deliverable.

### D2. The whole finance DB ships on every payload, unbounded — HIGH

`personalFinancePayload().data` returns 16 full collections (`finance_accounts`,
`income_records`, `expense_records`, `budget_categories`, `categories`, `subcategories`,
`merchants`, `tags`, `savings_goals`, `tax_records`, `income_sources`, `stock_holdings`,
`fixed_deposits`, `loans`, `properties`, `beneficiaries`) with no date window, no pagination,
no field projection. `maskSensitive()` runs over all of it but doesn't shrink it. For a user
with a few years of history this is a multi-MB JSON parse on every dashboard open and every
edit.

**Fix:** window `income_records`/`expense_records` to (say) 24 months for the dashboard payload,
add a separate paged endpoint for the full transaction history the Records tab needs.

### D3. `TransactionsPanel` renders every matching row — no windowing — HIGH

`transactions-panel.tsx:529` — `filtered.map(...)` renders one full row (with an inline
account-reassign `<select>` listing every account, plus a tag list) for **every** transaction
that passes the filters. Default filters = none, so the default render is *all* transactions.
Grep confirms no `.slice`, no page size, no virtualisation. Thousands of rows → thousands of
DOM subtrees on tab open.

**Fix:** cap the initial render (e.g. 100 rows + "show more"), or virtualise.

### D4. Same calculations re-implemented client-side, and again in the cron — MEDIUM

The server has `financeSummary`, `getMonthlySummary`, `getBudgetVsActual`,
`getAverageMonthlyExpensesLkr`, `getAverageMonthlySavingsRatePct`. The client re-derives
overlapping numbers from raw records anyway:

- `finance-trends-card.tsx` — `buildTrendData` / `buildCategoryData` recompute monthly
  income/expense/net and per-category sums from `data.income_records` / `data.expense_records`.
- `recurring-bills-insight.tsx` — `detectRecurringVendors` over `data.expense_records`.
- `upcoming-money.tsx` — payday / FD-maturity / contract-expiry windows over raw records.
- `personal-finance-screen.tsx` — `currencyExposure()` over 3 raw collections.
- `wealth-goal-card` / `savings-goals-progress` / `sinking-funds-panel` — each computes
  "needs X/mo to reach by <date>" independently, three slightly different implementations.

And the strongest evidence that server-side derivation is missing — `personal-finance-digest.sh`
re-implements the payday / FD / contract badge logic **in Python**, with the comment:

> `# income-sources-panel.tsx), reimplemented here in Python since this`
> `# script has no access to the TS bundle.`

**Fix:** compute these once server-side and add them to the payload (`trends`, `recurringBills`,
`upcomingMoney`, `currencyExposure`, `goalPacing`). The dashboard renders; the cron reads the
same JSON instead of maintaining a parallel Python port.

---

## Part 3 — Performance

| # | Issue | Cost |
|---|---|---|
| P1 | Unbounded whole-DB payload (D2), income/expense duplicated (D1) | JSON size + parse on every load & mutation |
| P2 | `TransactionsPanel` renders all rows (D3) | DOM node count, layout time on tab open |
| P3 | `finance-trends-card` `useMemo` deps include `payload` — identity changes on every mutation, so both charts fully recompute after any unrelated edit | recompute per mutation |
| P4 | Recharts bundled into ≥3 components (`personal-finance-screen`, `finance-trends-card`, `finance-analyst-card`); the `personal-finance` route chunk is ~318 KB (build output) | initial load |
| P5 | Every mutation response is the **entire** `personalFinancePayload()` (by design, for cache-write) — so editing one tag re-ships all 16 collections + duplicated transactions | per-edit bandwidth |

**Fixes:** window the payload (P1); cap/virtualise the list (P2); narrow the trends `useMemo`
deps to the specific arrays (P3); lazy-load the analyst chart / share one Recharts import (P4);
consider a lighter mutation response (`{ ok, changed: {...} }`) with an explicit cache patch
instead of full-payload round-trips (P5).

---

## Part 4 — Maintainer cost (not user-facing, but "smart / easy to work with")

### M1. Two mutation patterns coexist

12 entity panels use the `useFinanceAction` hook (busy/error/optimistic handling in one place);
7 Overview cards (`savings-goals-progress`, `sinking-funds-panel`, `savings-rate-target-card`,
`base-currency-select`, `wealth-goal-card`, `emergency-fund-card`, `finance-analyst-card`)
hand-roll `fetch('/api/finance')` + `useState` for `saving`/`err`. Same operation, two idioms,
two places for a bug. Consolidate on `useFinanceAction`.

### M2. `formatMoney` always groups with `en-LK`

`utils.ts:2` — `Math.round(amount).toLocaleString('en-LK')` regardless of the currency being
formatted. Minor, but a USD amount gets Sri-Lankan digit grouping.

### M3. `*Lkr` field names now lie

Post-PF-201 the `*Lkr` suffix means "in the configured reporting currency", documented in
comments but not in the names. A rename (`*Base` / drop the suffix) is a mechanical but wide
change worth doing before more code piles onto the current names.

### M4. Cosmetic layer is already consolidated — credit where due

`shared-styles.ts` shows a prior pass removed byte-for-byte tone/button class duplication
across ~15 panels. That work is done and good; the duplication that remains is *data* and
*logic*, not CSS.

---

## Part 5 — Recommended order of work

### Status (2026-09-10)

| Item | State | Where |
|---|---|---|
| Budget currency default | ✅ done | PR #45 |
| 2 · cap TransactionsPanel render | ✅ done | PR #46 |
| 3 · trends memo deps | ✅ done | PR #46 |
| 4 · Overview hierarchy | ✅ done | PR #46 |
| 8 · one mutation pattern | ✅ done | PR #46 |
| 10 · analyst units | ✅ done | PR #46 |
| 6 · de-dup transaction representation | ✅ done — `transactions` off the payload; panel unifies raw arrays client-side, parity-tested | PR #46 |
| 7 · server-side derivations | ✅ done — `getFinanceTrends`/`getRecurringBills`/`getUpcomingMoney`/`getCurrencyExposure` on the payload; 4 components + `personal-finance-digest.sh` rewired; ~90 lines of digest Python deleted | PR #46 |
| 9 · paged transaction-history endpoint | ✅ done — `list_transactions` action (id cursor, 1..500) | PR #46 |
| 5 · merge target cards / settings screen | ✅ done — `GoalsTargetsCard` (one section, `GoalRow` layout, each row keeps its `set_*` action); the 3 old card files deleted; `BaseCurrencySelect` moved into the collapsed settings drawer (U3) | PR #46 |
| 1 · window payload | ✅ done — `data.{income_records,expense_records}` capped to the trailing **36 months** (`TRANSACTIONS_WINDOW_MONTHS`); `financeSummary`'s all-time figures untouched (reads `db`); `TransactionsPanel` shows a "last 36 months" note; full history via `list_transactions` + JSON export | PR #46 |
| 11 · `*Lkr` → `*Base` rename | ✅ done — `financeSummary`'s aggregate outputs + the `emergencyFund` / `wealthGoal` payload fields renamed `*Lkr` → `*Base`; storage fields (`convertedLkrAmount`), the `set_wealth_goal` request param `targetLkr`, and the `wealthGoalTargetLkr` settings key **kept** (contract/storage). Touches `src/screens/dashboard/finance-overview-card.tsx` too. `personal-finance-digest.sh` reads both names for the deploy window. | PR #46 |
| 12 · unified ledger | ✅ **first slice done** — `transfer` record kind: `Transfer` type + `db.transfers` collection (auto-migrated via `migrateFinanceStore`'s spread; `'transfers'` added to `FINANCE_COLLECTIONS` → persists through the generic `finance_engine_collections` table, no DDL); `add`/`update`/`delete` branches; `getUnifiedTransactions` + client `unifyTransactions` emit it (parity-tested); windowed on the payload. **`financeSummary` untouched** — transfers never enter income/expense/savings totals (asserted). Remaining ledger work (own PRs, roadmap-sequenced): ledger-derived account balances (ADR-001), splits, a transfer entry form, transfer-aware filters. | PR #46 |

**Tier 0 — shipped in this pass**

- **Budget-panel currency default + convert-on-write.** The `getBudgetVsActual` LKR-normalisation
  (already on PR #45) unblocked it: the budget form now defaults its currency to the reporting
  currency and the server converts base→LKR on write, same shape as `set_wealth_goal`. Closes
  the last genuinely *remaining* item from the PF-201 thread.

**Tier 1 — small, safe, high user impact**

1. ✅ **DONE** (`feat/pf-dashboard-perf`) — `data.{income_records,expense_records}` capped to
   the trailing **36 months** (`TRANSACTIONS_WINDOW_MONTHS`, `withinWindow()`). `financeSummary`
   reads `db` server-side so its all-time figures are unaffected; `TransactionsPanel` shows a
   "last 36 months" note; the entity panels' "records tagged to X" lists are likewise bounded.
   Full history: `list_transactions` (item 9) + the JSON export (D2/P1).
2. ✅ **DONE** (`feat/pf-dashboard-perf`) — `TransactionsPanel` renders the first 100 filtered
   rows + "Show more"; totals/counts still span the full list; visible count resets on filter
   change (D3/P2).
3. ✅ **DONE** (`feat/pf-dashboard-perf`) — `finance-trends-card` memos depend on the record
   arrays, not the whole `payload`, so an unrelated mutation no longer recomputes both charts
   (P3).
4. ✅ **DONE** (`feat/pf-dashboard-perf`) — Overview hierarchy (U1): money first
   (alerts → AI Q&A → trends), then a labelled **"Goals & targets"** section and a **"Coming
   up"** section each in a `lg:grid-cols-2` grid (the cards' baked-in `mt-*` is zeroed by a
   `[&>*]:mt-0` container variant, no per-card edits), then the currency picker, then a
   collapsed `<details>` for `AssistantMemoryCard` + `DataHealthCard`.

**Tier 2 — medium, structural**

5. ✅ **DONE** (`feat/pf-dashboard-perf`) — `EmergencyFundCard` + `SavingsRateTargetCard` +
   `WealthGoalCard` folded into one **`GoalsTargetsCard`** (one section, a `GoalRow` layout,
   each row keeps its own set-form and `set_*` action). The 3 old files deleted.
   `BaseCurrencySelect` moved into the collapsed "Settings, assistant memory & data health"
   drawer (U3) — the missing-rate warning still surfaces up top via `FinanceAlertsCard`.
6. ✅ **DONE** (`feat/pf-dashboard-perf`) — `transactions` dropped from the payload;
   `TransactionsPanel` unifies `data.income_records` + `data.expense_records` client-side via
   `unifyTransactions`, parity-tested against the server's `getUnifiedTransactions` (D1).
7. ✅ **DONE** (`feat/pf-dashboard-perf`) — `getFinanceTrends` / `getRecurringBills` /
   `getUpcomingMoney` / `getCurrencyExposure` compute once in `finance-store.ts` and ride the
   payload; `finance-trends-card` / `recurring-bills-insight` / `upcoming-money` / the screen's
   exposure block read them; `personal-finance-digest.sh` switched to `?scope=personal_finance`
   and its ~90-line Python payday/FD/contract port is deleted (D4). +4 tests.
8. ✅ **DONE** (`feat/pf-dashboard-perf`) — 6 Overview cards (`savings-rate-target-card`,
   `emergency-fund-card`, `base-currency-select`, `wealth-goal-card`, and the
   `LinkedAccountControl` in `savings-goals-progress` / `sinking-funds-panel`) now use
   `useFinanceAction`; cards that silently swallowed failures now surface the server error.
   `finance-analyst-card` keeps its own fetch (streaming Q&A + chart, not a single mutation).

**Tier 3 — larger / roadmap-level**

9. ✅ **DONE** (`feat/pf-dashboard-perf`) — `list_transactions` action: paged unified history,
   id cursor, `limit` 1..500. Prerequisite for item 1; not yet wired into `TransactionsPanel`
   (that's part of item 1).
10. ✅ **DONE** (`feat/pf-dashboard-perf`) — Finance Analyst units pass:
    `buildFinanceQueryContext` pins its `summary` to LKR (computed against a `baseCurrency:'LKR'`
    clone of the db) and stamps `currency: 'LKR'`, so the LLM prompt no longer mixes a
    base-currency `summary` with the raw-LKR `monthlySummary` / `categoryBreakdown` /
    `topVendors`. The prompt now states the currency explicitly.
    *(was item 10 "Finance Analyst units pass" in the original table — the "lighter mutation
    responses" idea moves down.)*
11. ✅ **DONE** (`feat/pf-dashboard-perf`) — `financeSummary` aggregate outputs + `emergencyFund`
    / `wealthGoal` payload fields `*Lkr` → `*Base`. Storage fields, the `set_wealth_goal`
    `targetLkr` request param, and the `wealthGoalTargetLkr` settings key kept. Also touched
    `src/screens/dashboard/`; the digest cron reads both names for the deploy window.
12. ✅ **first slice done** (`feat/pf-dashboard-perf`) — `transfer` record kind (type, `db.transfers`
    collection, `FINANCE_COLLECTIONS` entry, add/update/delete, unified-list emission, windowed
    payload, parity test, `financeSummary` untouched). The full unified ledger (balances derived
    from the ledger, splits, transfer UI) stays roadmap-sequenced across further PRs.

---

## Appendix — the transaction-payload cluster (items 1 + 6 + 9 are one change)

Items 1, 6 and 9 look independent in the table but must land together. Item 1 as written
("window `income_records`/`expense_records` to 24 months in the dashboard payload") is **lossy on
its own**: `payload.transactions` is the *sole* feed for `TransactionsPanel` (the Records-tab
transaction browser), so a 24-month window makes a 2023 transaction unviewable anywhere in the UI.

### Do it in this order, one PR

**Step A — item 6 (pick one representation).** Drop `payload.transactions`; keep only
`data.income_records` / `data.expense_records`. `transactions-panel.tsx` is the only consumer of
`transactions` and already does field-normalisation via `stringField`/`numberField` — give it a
local `useMemo` that maps + merges the two raw arrays (the exact logic of `getUnifiedTransactions`,
moved client-side). Net payload change: the larger of the two representations is gone.

Consumers to leave untouched (they already read the raw arrays): `accounts-panel`,
`categories-panel`, `merchants-panel`, `tags-panel`, `income-sources-panel`, `finance-trends-card`,
`upcoming-money`, `recurring-bills-insight`.

**Step B — item 9 (paged history endpoint).** New `?scope=transactions&before=<cursor>&limit=200`
(or a `list_transactions` action) returning a page of unified rows, newest first. `TransactionsPanel`
switches from "map the whole payload array" to "first page + cursor, load more". This is the
history surface, so it must exist before Step C removes old rows from the main payload.

**Step C — item 1 (window the dashboard payload).** Now safe: `personalFinancePayload().data`
returns only the trailing 24 months of `income_records` / `expense_records`. The 8 aggregation/insight
consumers all operate on recent windows already (`finance-trends-card` = 6 months,
`recurring-bills-insight` = recent cadence, `upcoming-money` = forward-looking). `financeSummary`'s
all-time totals are **unaffected** — it reads `db.*` server-side, not the windowed payload.
`TransactionsPanel` is unaffected — it's on the Step-B endpoint by now.

### Risks to cover in that PR

- `recurring-bills-insight`'s `detectRecurringVendors` needs enough months to see a cadence — verify
  24 is comfortably more than its longest look-back before shipping Step C.
- Any entity panel that shows "all records tagged to this account/merchant/…" now shows "records in
  the last 24 months tagged to …". Decide whether that's acceptable or whether those panels move to
  the paged endpoint too.
- `getUnifiedTransactions` stays in `finance-store.ts` for the Step-B endpoint; only its use inside
  `personalFinancePayload` goes away.

### Not started here

This appendix is the plan; no code for items 1/6/9 is in the `feat/pf-dashboard-perf` branch —
that branch carries only items 2 and 3 (see the PR).
