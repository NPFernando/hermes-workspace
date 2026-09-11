# Personal-finance calculation validation

This is the maintained regression map for calculations shown in the personal-finance dashboard and exposed to finance agents. The calculators are deterministic and read-only; validation covers both individual results and relationships between related results.

## Regression command

```bash
./node_modules/.bin/vitest run src/server/personal-finance-regression.test.ts src/server/finance-store.test.ts
```

The small suite is separate from the feature-heavy store tests so it remains easy to run during calculation changes.

## Coverage map

| Calculation or contract | Primary implementation | Regression evidence |
| --- | --- | --- |
| Income, expense, net savings, savings rate | `financeSummary` | `personal-finance-regression.test.ts`; summary tests in `finance-store.test.ts` |
| Monthly income/expense/savings rollup | `getMonthlySummary` | `personal-finance-regression.test.ts`; monthly summary tests in `finance-store.test.ts` |
| Monthly budget actual, currency-aware variance/percentage, over-budget state, and tombstone exclusion | `budgetVsActualSummary` / `getBudgetVsActual` | `personal-finance-regression.test.ts`; budget edge cases in `finance-store.test.ts` |
| Annual budget aggregation and duplicate-month handling | `annualBudgetVsActualSummary` | `personal-finance-regression.test.ts`; duplicate-month test in `finance-store.test.ts` |
| Safe-to-spend floor and commitment subtraction | `safeToSpendSummary` | `personal-finance-regression.test.ts`; safe-to-spend test in `finance-store.test.ts` |
| Explainable financial-health score | `financialHealthSummary` | `personal-finance-regression.test.ts`; component test in `finance-store.test.ts` |
| Bounded finance-agent context and task summary | `buildFinanceAgentContext` / `buildFinanceQueryContext` | `personal-finance-regression.test.ts`; agent-context tests in `finance-store.test.ts` |
| Currency-code normalization across forms, imports, FX pairs, and legacy snapshots | `normalizeCurrencyCode` / `currencyField` / `migrateFinanceStore` | `personal-finance-regression.test.ts`; migration, transaction, and FX tests in `finance-store.test.ts` |

## Change checklist

1. Run the regression command above.
2. Add or update an invariant when the relationship between outputs changes.
3. Update this map if the public result or privacy boundary changes.
4. Run the full Vitest suite and typecheck before release validation.

This suite does not replace currency-conversion, storage-mirror, migration, or UI tests; those remain separate because they exercise external state or presentation behavior.
