# Finance engine — open questions for the in-flight Postgres cutover

Context: produced during a review of the finance engine + `/personal-finance`
dashboard (`hermes-workspace-live @ 5ed90523`). Two items below need a decision
from whoever owns the Postgres cutover; the third is a ready-to-apply fix that
should ride along with it rather than be hot-patched separately.

---

## 1. The `personal_finance` Postgres DB looks orphaned — keep or delete?

### What was found

Personal-finance data has **two** Postgres representations, and production
only uses one:

| | Production path (live) | Phase D path |
|---|---|---|
| Store | `finance` DB → `finance_engine_collections` + `settings` | `personal_finance` DB |
| Owner module | `finance-postgres-store.ts` (`readFinancePostgresNormalized` / `writeFinancePostgresNormalized`) | `personal-finance-postgres-store.ts` (`readPersonalFinancePostgresStore` / `writePersonalFinancePostgresStore`) |
| Reached from | `readFinanceStore()` / `writeFinanceStore()` **non-test** branches | `overlaySplitStores()` / `mirrorIntoSplitStores()` |
| Those callers run… | always | only from `readFinanceJsonStore()` / `writeFinanceJsonStore()` |
| …which run… | — | **only under `VITEST` / `NODE_ENV=test`** |

So in a normal process:

- `readFinanceStore()` → `readFinanceStoreUncached()` →
  `readFinancePostgresNormalized()` against the **`finance` DB**. It never calls
  `overlaySplitStores()`.
- `writeFinanceStore()` non-test → `writeFinancePostgresNormalized()` against
  the **`finance` DB**. It never calls `writeFinanceJsonStore()` →
  `mirrorIntoSplitStores()` → `writePersonalFinancePostgresStore()`.

`FINANCE_COLLECTIONS` in `finance-postgres-store.ts` is a **superset** — it
already lists all 19 personal collections plus the trading ones — so there is
**no data loss**: personal-finance data is persisted, just to the `finance` DB,
not `personal_finance`.

### Why it matters

- `personal-finance-postgres-store.ts`, the `personal_finance` DB,
  `overlaySplitStores()` and `mirrorIntoSplitStores()` appear to be **dead code
  in this tree**.
- `finance-store.test.ts`'s `describe('overlaySplitStores (Postgres Migration
  Phase D)')` block **only passes because `VITEST` forces the JSON-compat
  branch** that production never takes. The suite currently validates a
  non-production path — a maintenance trap.
- The live `personal_finance` DB has near-zero rows (`income_sources` 1,
  `stock_holdings` 4, `fixed_deposits` 2, everything else 0), consistent with
  nothing writing it.

### Decision needed

Pick the canonical representation and delete the other **plus its tests**:

- **(A) Keep the unified `finance` DB** (current production). Remove
  `personal-finance-postgres-store.ts`, `overlaySplitStores()`,
  `mirrorIntoSplitStores()`, the `HERMES_PERSONAL_FINANCE_READ_SOURCE` kill
  switch, the frozen `personal-finance.json` rollback snapshot handling, and
  the Phase D test block. Drop the `personal_finance` database.
- **(B) The split `personal_finance` DB was the intended target** and a later
  change bypassed it by mistake. Re-point `readFinanceStoreUncached()` /
  `writeFinanceStore()` back through the overlay/mirror, and reconcile
  `readFinancePostgresNormalized()`'s personal collections.

(A) looks right — it is what runs today and needs the least code — but that is
the cutover owner's call.

### Baseline for either path

`scripts/personal-finance-pg-integration.ts` (this branch, run via
`pnpm test:pg-integration`) locks down `personal-finance-postgres-store.ts`'s
write→read contract against a throwaway DB — 49 assertions covering every
collection, the snake↔camel mapping, nested JSON, replace-not-append semantics
and missing-table resilience. Use it to verify a re-wire, or delete it with the
module under (A).

---

## 2. Reconciliation `status` is ignored by all summary math

PF-113 added `status: 'pending' | 'cleared' | 'reconciled'` to
`ExpenseRecord` / `IncomeRecord` and plumbed it through
`getUnifiedTransactions()` and the Transactions panel — but the aggregate
functions still sum **every** record regardless of status:

- `financeSummary()` (`src/server/finance-store.ts`) —
  `totalIncomeLkr` / `totalExpensesLkr` `reduce` straight over
  `db.income_records` / `db.expense_records`, no status filter. Flows into
  `netSavingsLkr`, `savingsRate`, `netWorthLkr`.
- `getBudgetVsActual()` — the `actual` accumulator loops
  `db.expense_records` filtered only by date + category.
- `getMonthlySummary()` — confirmed same: both the income and expense loops
  accumulate `convertedLkrAmount` filtered only by date.

Impact is latent today because `status` defaults to `'cleared'`, but it
becomes a silent correctness bug the moment the status feature is used as
intended: a `pending` transaction still moves Net worth / Savings rate /
Budget-vs-actual.

### Suggested shape

Add an opt-in parameter rather than changing the default silently:

```ts
function includeForTotals(
  row: { status?: 'pending' | 'cleared' | 'reconciled' },
  statuses: ReadonlyArray<'pending' | 'cleared' | 'reconciled'> =
    ['cleared', 'reconciled'],
): boolean {
  return statuses.includes(row.status ?? 'cleared')
}
```

- `financeSummary()`, `getBudgetVsActual()`, `getMonthlySummary()` filter with
  the default (`cleared` + `reconciled`).
- The raw record tables / `getUnifiedTransactions()` keep showing everything.
- Optionally surface a "pending" line in the UI so excluded amounts are visible.

This touches the store layer, so fold it into the cutover rather than patching
separately.

---

## 3. Already shipped (context, no action)

Two live-ops issues found in the same review were fixed outside this branch:

- **`~/.hermes-data/scripts/finance-pg-sync.sh`** referenced a migrator path
  that no longer exists and failed every 30 min (masked as `last_status = ok`
  by its `exit 0`). The `finance` DB was **not** actually stale — the app
  mirrors it inline on every `writeFinanceStore()`. The script is now a
  read-only drift monitor (no writes, no migration). Old version:
  `finance-pg-sync.sh.bak-20260907`.
- **`~/.hermes-data/finance/audit.jsonl`** (30 MB, unbounded) now rotates via
  `/etc/logrotate.d/hermes-finance-audit` (20 MB × 6, `copytruncate`). Durable
  audit history lives in the Postgres `audit_logs` table.
