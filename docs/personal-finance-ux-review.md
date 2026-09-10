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

**Tier 0 — shipped in this pass**

- **Budget-panel currency default + convert-on-write.** The `getBudgetVsActual` LKR-normalisation
  (already on PR #45) unblocked it: the budget form now defaults its currency to the reporting
  currency and the server converts base→LKR on write, same shape as `set_wealth_goal`. Closes
  the last genuinely *remaining* item from the PF-201 thread.

**Tier 1 — small, safe, high user impact (post-merge of #45)**

1. Window `income_records` / `expense_records` in the dashboard payload to 24 months (D2/P1).
2. Cap `TransactionsPanel` initial render at ~100 rows + "show more" (D3/P2).
3. Narrow `finance-trends-card` `useMemo` deps (P3).
4. Overview information hierarchy: 2-col grid, collapse diagnostics (U1).

**Tier 2 — medium, structural**

5. Merge the 3 target cards into one "Goals & targets" section (U2); move `BaseCurrencySelect`
   to settings (U3).
6. De-duplicate the transaction representation — one of `transactions` vs raw arrays (D1).
7. Server-side `trends` / `recurringBills` / `upcomingMoney` / `currencyExposure` in the
   payload; delete the Python port in the digest cron (D4).
8. Consolidate on `useFinanceAction` (M1).

**Tier 3 — larger / roadmap-level**

9. Paged transaction-history endpoint (D2).
10. Lighter mutation responses + explicit cache patching (P5).
11. `*Lkr` → `*Base` rename (M3).
12. The unified ledger (already `personal-finance-os-roadmap.md` Phase 1).
