# Personal Finance OS — Master Feature Registry

This is the living roadmap for evolving the Personal Finance module into the full "Personal Finance OS" architecture. It was bootstrapped by inspecting the actual codebase (not assumptions) against a master architecture spec covering 45 phases and ~410 feature IDs across Personal Finance, CSE investment intelligence, Hermes AI agents, social intelligence, automation, and platform concerns.

**Do not build ahead of this document.** Work happens one feature at a time, explicitly requested. This file is updated after each feature ships — never rewritten to hide scope or mark something done that isn't.

## How to use this document

1. Pick a feature ID from a phase whose dependencies are satisfied (see the Depends-on column in each phase table).
2. Say which one to build (e.g. "build PF-006"). Nothing here is auto-actionable — this document does **not** create anything on the Hermes task board, and no feature is pre-approved for autonomous work.
3. Implementation follows the same cadence used to build everything currently marked `existing`/`partial` in this doc: branch → implement → test → PR → CI → merge → deploy, one feature per PR.
4. After a feature ships, its row here is updated: status, what was actually built, known limitations, and any new future features it revealed (added as new rows, never silently dropped).
5. Status values: **existing** (fully done), **partial** (some of it is real, gap noted), **planned** (foundation exists, not started), **blocked** (a dependency doesn't exist yet), **future** (explicitly deferred, e.g. Telegram/WhatsApp — do not build without being asked).

## Architecture Decision Records (current reality, not aspiration)

| ADR | Statement | Status today |
|---|---|---|
| ADR-001 | Accounts + Transactions are the financial source of truth | Not yet — `FinanceDatabase` (JSON + Postgres mirror) is the source of truth today, but there's no unified accounts/transactions ledger yet (Phase 1 gap) |
| ADR-002 | Hermes cannot directly write the finance database | **True today.** Every mutation goes through `addFinanceRecord`/`updateFinanceRecord`/`deleteFinanceRecord` behind the Finance API. Every AI-extracted document lands as a `PendingIngestion` requiring explicit user confirm before becoming a real record. |
| ADR-003 | CSE manual execution only in Personal Finance | **True today.** No trade execution exists at all — only manual price refresh and manual holding entry/edit. |
| ADR-004 | Research store separate from finance database | Not applicable yet — no research store exists (Phase 14+ gap) |
| ADR-005 | Predictions immutable after creation | Not applicable yet — no predictions exist (Phase 21 gap) |

## Current State Summary

**What's genuinely working today** (built across PRs #53-#72 this session): jobs/employment tracking with AI contract extraction + risk review + re-analysis + payday tracking + contract-expiry alerts; CSE stock holdings with live price refresh, manual fallback, edit, and P/L; fixed deposits with maturity tracking; budget vs. actual with an overspend badge; savings goals with progress tracking; a full AI document-ingestion pipeline (receipts, bills, contracts) with confidence scoring and mandatory human review before anything is committed; manual Gmail sync into that same review queue; a weekly Telegram digest covering net worth, income/expenses, budget overspend, payday, FD maturity, and contract expiry; JSON data export; and a strict architectural separation between Personal Finance and the Trading engine (separate Postgres databases, separate screens, a dedicated lightweight API path).

**The single biggest structural gap**: there is no unified transaction ledger. `income_records` and `expense_records` are separate flat collections with no transfers, splits, merchant registry, tags, or reconciliation status. Nearly every phase from 6 onward (credit cards, bills/subscriptions, forecasting, goals v2, all of CSE ledger/research/signals, analytics, scenarios, loans) depends on this existing first. This is why **Phase 1 (Core Financial Ledger)** is the recommended next major undertaking, not a quick win.

**Two confirmed UI bugs** (from the audit): fixed deposits display `12% · monthly` with no "p.a." qualifier — reads like a monthly rate when it's an annual rate paid out monthly; stock holdings display `-LKR 337` gain/loss with no percentage alongside it.

---

## Phase 0 — Current Build Audit and Corrections

**Goal:** Understand and stabilize what already exists. **Depends on:** none. **Status:** partial (this document is the audit; two corrections confirmed, not yet fixed).

| ID | Feature | Status | Note |
|---|---|---|---|
| PF-000 | Current Personal Finance Architecture Audit | existing | This document |
| PF-001 | Current Database Schema Audit | existing | See Current State Summary + `FinanceDatabase` type in `src/server/finance-store.ts` |
| PF-002 | Current API Audit | existing | Single `/api/finance` action-dispatch family, `?scope=personal_finance` lightweight variant added this session |
| PF-003 | Current UI/Page Inventory | existing | 5-tab `personal-finance-screen.tsx` (Overview/Income & Jobs/Investments/Accounts & Records/Ingestion) |
| PF-004 | Current Calculation Validation | partial | 1288 unit tests cover most computed values; no standalone "calculation validation" doc |
| PF-005 | Fix Currency Display Inconsistencies | planned | `formatLkr()` only handles LKR; other currencies use raw string interpolation in a few places |
| PF-006 | Fix Fixed Deposit Rate Labelling | **existing** | Add-form placeholder and row display now show "% p.a.", helper text says "annual interest rate" explicitly — display-text only, `interestRatePct` was already stored unambiguously |
| PF-007 | Improve Investment P/L Display | **existing** | `financeSummary()` returns `unrealizedStockPnlPct` alongside the existing LKR figure; shown on the Overview StatCard and per-holding row, e.g. "+LKR 200 (+20.0%)" |
| PF-008 | Remove Developer/API Language From User UI | planned | Not yet audited line-by-line |
| PF-009 | Standardize Money Formatting | **existing** | Shared `formatMoney(amount, currency)` in `utils.ts`; 4 duplicated reimplementations deduplicated, and 2 real mislabeling bugs (stock holdings, fixed deposits showing "LKR" for non-LKR currencies) fixed |
| PF-010 | Standardize Date Handling | planned | Not yet audited line-by-line |
| PF-011 | Add Current Feature Regression Tests | partial | 1288 tests exist covering this session's work; not organized as a named regression suite |

## Phase 1 — Core Financial Ledger

**Goal:** Unified accounts + transactions as the foundation everything else depends on. **Depends on:** Phase 0. **Status:** partial — Account Model shipped, Unified Transaction Model is next.

| ID | Feature | Status | Note |
|---|---|---|---|
| PF-100 | Account Model | **existing** | `openingBalance`/`openingBalanceDate` added to `FinanceAccount`; `balance` stays manually-maintained until PF-104 exists to compute it from a real ledger |
| PF-101 | Account Types | **existing** | 8-type enum (`bank`/`cash`/`card`/`crypto_wallet`/`broker`/`foreign_currency`/`loan`/`other`) already existed, confirmed sufficient |
| PF-102 | Account UI | **existing** | Dedicated `AccountsPanel` (add/edit/delete, per-currency total, opening-balance display) replaces the generic DataTable |
| PF-103 | Opening Balances | **existing** | Optional `openingBalance` + `openingBalanceDate`, shown as a secondary line per account |
| PF-104 | Unified Transaction Model | **existing** | Additive read view — `getUnifiedTransactions()` (`finance-store.ts`) maps `income_records`/`expense_records` into one shared shape/sort order; storage itself stays split (deliberate, see Shipped note below) |
| PF-105 | Transaction CRUD | **partial (stronger)** | One `TransactionsPanel` now does add/edit/delete for both kinds from a single UI, but there's still no formal transaction-type enum and each kind keeps its own field set under the hood |
| PF-106 | Transaction Types | planned | Deferred by the PF-104 slice — no enum, `kind: 'income' \| 'expense'` only |
| PF-107 | Transfers | planned | Deferred by the PF-104 slice — no transfer/double-entry concept exists |
| PF-108 | Transaction Splits | planned | Deferred by the PF-104 slice |
| PF-109 | Categories | **existing** | `Category` entity + `CategoriesPanel` (add/edit/delete, usage counts, "in use, not yet a category" formalize flow) + shared datalist wired into Transactions/Budget category inputs; free-text `category`/`incomeType` remain the join key for budget-vs-actual, unchanged — no `categoryId` FK yet |
| PF-110 | Subcategories | **existing** | `Subcategory` entity (name + parentCategory, additive, no FK) managed inline in `CategoriesPanel` — chips per category, usage counts, "in use, not yet a subcategory" formalize flow; also fixed a real bug where `ExpenseRecord.subcategory` was silently blanked on every edit |
| PF-111 | Merchant Registry | **existing** | `Merchant` entity (name + optional defaultCategory, additive, no FK) via `MerchantsPanel`; vendor input in `TransactionsPanel` now autocompletes against known merchants and auto-fills category on blur when the category field is empty |
| PF-112 | Tags | **existing** | `Tag` entity (name + optional notes, additive, no FK) via `TagsPanel`; comma-separated `tags` field on both `ExpenseRecord`/`IncomeRecord`, symmetric input in `TransactionsPanel`, chip display, usage counts/formalize tokenize the delimited field across both record types |
| PF-113 | Pending/Cleared/Reconciled Status | **existing** | `status: 'pending' \| 'cleared' \| 'reconciled'` added to `ExpenseRecord`/`IncomeRecord` (default `'cleared'`), plumbed through `getUnifiedTransactions()` and a status select/badge/filter in `TransactionsPanel` |
| PF-114 | Transaction Search and Filters | **existing** | `TransactionsPanel` now also has date-range (From/To) and amount-range (Min/Max) filters, composing with the existing search/kind/status filters — all client-side against the already-present `date`/`amount` fields on `UnifiedTransaction` |
| PF-115 | Transaction Audit History | partial | `appendAuditLog` covers all mutations generically |
| PF-116 | Soft Delete | planned | Deferred by the PF-104 slice — deletes are hard deletes today |
| PF-117 | Finance Calculation Service Foundation | existing | `finance-store.ts`'s `financeSummary()` etc. already fill this role |

## Phase 2 — Multi-Currency and FX

**Goal:** Correctly support LKR + AUD (and future currencies). **Depends on:** Phase 1. **Status:** partial.

| ID | Feature | Status | Note |
|---|---|---|---|
| PF-200 | Currency Model | partial | `CurrencyCode` string type exists |
| PF-201 | Base Currency Configuration | planned | LKR assumed hardcoded, not configurable |
| PF-202 | Original Currency Preservation | **existing** | Deliberate design decision this session — never overwrite AUD with LKR |
| PF-203 | FX Provider Interface | planned | |
| PF-204 | Historical FX Storage | planned | |
| PF-205 | Transaction FX | partial | `exchangeRateUsed` field exists on `IncomeRecord`, manual entry only |
| PF-206 | Current Valuation FX | planned | No live conversion for non-LKR holdings/FDs |
| PF-207 | Manual FX Override | partial | `exchangeRateUsed` is manual-entry today, loosely satisfies this |
| PF-208 | FX Source/Freshness Metadata | **existing** | `currency`/`exchangeRateSource` now shown/editable in the Tax records table (same fields still not surfaced on `IncomeRecord`, but `IncomeRecord` has no dedicated table today — see Shipped note) |
| PF-209 | Multi-Currency UI | partial | Currency exposure card + per-currency grouped totals exist (PR #69) |
| PF-210 | Multi-Currency Testing | partial | Some unit tests touch currency fields, not comprehensive |

## Phase 3 — Personal Financial Rules

**Goal:** Personalized recommendations without AI guessing preferences. **Depends on:** Phase 1. **Status:** planned.

| ID | Feature | Status |
|---|---|---|
| PF-300 | Financial Rules Model | planned |
| PF-301 | Financial Rules Settings Page | planned |
| PF-302 | Minimum Cash Reserve | planned |
| PF-303 | Emergency Fund Target | **existing** (settings-driven target, in months of average expenses; see PF-1005/PF-1006 and Shipped note) |
| PF-304 | Savings Rate Target | planned (rate is computed/displayed, no target/threshold) |
| PF-305 | Credit Utilization Threshold | blocked (no credit cards yet) |
| PF-306 | Monthly Investment Target | planned |
| PF-307 | Large Transaction Threshold | planned |
| PF-308 | Discretionary Spending Threshold | planned |
| PF-309 | Investment Allocation Rules | planned |
| PF-310 | Rule Validation Engine | planned |

## Phase 4 — Overview V2

**Goal:** Transform Overview into the command center. **Depends on:** Phase 1, 3. **Status:** partial.

| ID | Feature | Status | Note |
|---|---|---|---|
| PF-400 | Net Worth Engine | existing | `financeSummary().netWorthLkr` |
| PF-401 | Liquid Net Worth | planned | Not distinguished from total net worth |
| PF-402 | Available Cash | existing | `cashBalanceLkr` |
| PF-403 | Locked/Illiquid Wealth | planned | FDs contribute to net worth but aren't separately labeled illiquid |
| PF-404 | Safe-To-Spend | planned | Depends on Phase 3 rules |
| PF-405 | Monthly Income | existing | `totalIncomeLkr` + per-currency active-monthly-income total |
| PF-406 | Monthly Expenses | existing | `totalExpensesLkr` |
| PF-407 | Monthly Savings | existing | `netSavingsLkr` |
| PF-408 | Savings Rate | existing | `savingsRate` |
| PF-409 | Assets vs Liabilities | **existing** | Overview's "Net worth breakdown" chart (renamed "Assets vs. liabilities") now includes a red `Debt` bar alongside the existing asset bars, using the already-computed `debtLkr` |
| PF-410 | Monthly Cash Flow | **existing** | `FinanceTrendsCard` now plots a derived net (income − expense) line alongside income/expense, plus a legend and "this month's net" subtitle |
| PF-411 | Upcoming Money | **existing** | New `UpcomingMoney` card on the Overview tab merges the existing payday/FD-maturity/contract-expiry badge computations into one sorted, urgency-filtered list |
| PF-412 | Financial Health | planned | No composite score |
| PF-413 | Data Health | **existing** | `financeStorageStatus()` health object now surfaced as a `DataHealthCard` on the Overview tab, tone-coded good/warn/danger; immediately surfaced a real, pre-existing mirror-lag issue on the trading-side Postgres mirror |
| PF-414 | Investment Summary | existing | Stock value, unrealized P/L, FD value all on Overview |
| PF-415 | AI Insight Summary | planned | |
| PF-416 | Responsive Dashboard Layout | existing | Tailwind responsive grid throughout |

## Phase 5 — Income and Employment V2

**Goal:** Full employment/income tracking. **Depends on:** none additional. **Status:** partial (strong).

| ID | Feature | Status | Note |
|---|---|---|---|
| PF-500 | Income Source Model | existing | `IncomeSource` type |
| PF-501 | Employment Income | existing | |
| PF-502 | Contract Income | existing | `employmentType:'contract'` + dates |
| PF-503 | Freelance Income | existing | Optional `monthlyIncomeAmount` |
| PF-504 | Dividend/Interest Income Types | planned | Free-text `incomeType` field only, not structured to holdings/FDs |
| PF-505 | Salary History | planned | Only current amount stored, no history over time |
| PF-506 | Expected Payday | existing | `expectedPaydayDayOfMonth` + payday badge (PR #67) |
| PF-507 | Income Reliability | planned | |
| PF-508 | Employment Contract Structured Data | existing | Job title, dates, payday, pay schedule all AI-extracted |
| PF-509 | Contract Lifecycle | partial | Only active/ended states |
| PF-510 | Contract Expiry Alerts | existing | Contract-expiry badge (PR #68) |
| PF-511 | Contract AI Extraction | existing | `extractEmploymentContract()` (PR #64) |
| PF-512 | Contract Change Detection | planned | Re-analyze exists (PR #70) but doesn't diff old vs. new terms |

## Phase 6 — Credit Card Management

**Depends on:** Phase 1. **Status:** blocked — nothing exists (PF-600 through PF-614).

## Phase 7 — Commitments, Bills and Subscriptions

**Depends on:** Phase 1. **Status:** blocked — nothing exists (PF-700 through PF-709).

## Phase 8 — Budget V2

**Depends on:** Phase 1. **Status:** partial.

| ID | Feature | Status |
|---|---|---|
| PF-800 | Budget Engine | partial (`budgetVsActualSummary()`) |
| PF-801 | Category Budgets | existing |
| PF-802 | Monthly Budgets | existing |
| PF-803 | Annual Budgets | planned |
| PF-804 | Budget vs Actual | existing |
| PF-805 | Committed Spend | planned |
| PF-806 | Remaining Budget | **existing** (`row.variance` displayed as "Remaining"/"Over by" suffix on each budget `StatCard`) |
| PF-807 | Projected Spend | planned |
| PF-808 | Budget Thresholds | partial (boolean overBudget only, no configurable %) |
| PF-809 | Budget Rollover | planned |
| PF-810 | Budget Templates | planned |
| PF-811 | AI Budget Explanation | planned |

## Phase 9 — Forecasting

**Depends on:** Phase 1, 3, 7. **Status:** blocked — nothing exists (PF-900 through PF-910).

## Phase 10 — Goals, Emergency Funds and Sinking Funds

**Depends on:** Phase 1. **Status:** partial.

| ID | Feature | Status |
|---|---|---|
| PF-1000 | Savings Goals | existing |
| PF-1001 | Goal Progress | existing (`SavingsGoalsProgress`) |
| PF-1002 | Goal Target Date | existing |
| PF-1003 | Required Monthly Contribution | **existing** (`SavingsGoalsProgress` now derives "Needs LKR X/mo to reach by <date>" from stored `targetAmount`/`currentAmount`/`targetDate`, display-only) |
| PF-1004 | Account-Linked Goals | partial (`linkedAccountId` field exists) |
| PF-1005 | Emergency Fund | **existing** (dedicated concept: `FinanceSettings.emergencyFundTargetMonths` tracked against real `cashBalanceLkr`, not a fake `SavingsGoal` row; see Shipped note) |
| PF-1006 | Emergency Coverage Months | **existing** (`coverageMonths` — current cash ÷ trailing 3-month average expenses) |
| PF-1007 | Sinking Funds | planned |
| PF-1008 | Sinking Fund Contribution Schedule | planned |
| PF-1009 | Goal Completion Events | planned |

## Phase 11 — CSE Ledger Foundation

**Depends on:** Phase 1. **Status:** blocked — holdings are single buy-price records, not a lot ledger (CSE-001 through CSE-019).

## Phase 12 — CSE Market Data

**Depends on:** Phase 11. **Status:** partial.

| ID | Feature | Status |
|---|---|---|
| CSE-100 | Price Provider Interface | planned (single hardcoded implementation, no abstraction) |
| CSE-101 | Current Price | existing |
| CSE-102 | Price Source Metadata | existing (`priceSource: cse_api\|manual`) |
| CSE-103 | Price Freshness | existing (staleness display, PR #65) |
| CSE-104 | Manual Price Fallback | existing |
| CSE-105 | Historical Price Store | planned |
| CSE-106 | OHLC Data | planned |
| CSE-107 | Volume | planned |
| CSE-108 | Turnover | planned |
| CSE-109 | Market Index Data | planned |
| CSE-110 | Daily Market Snapshot | planned |
| CSE-111 | Portfolio Snapshots | planned |
| CSE-112 | Provider Failure Handling | existing (`priceFetchFailed` → manual entry) |

## Phase 13 — CSE Portfolio V2

**Depends on:** Phase 11, 12. **Status:** partial.

| ID | Feature | Status |
|---|---|---|
| CSE-200 | My Holdings Dashboard | existing (`StockHoldingsPanel`) |
| CSE-201 | Portfolio Summary | existing |
| CSE-202 | Allocation | planned |
| CSE-203 | Holding Detail | partial (row-level only) |
| CSE-204 | Price vs Cost | existing |
| CSE-205 | P/L % | existing (shipped as part of PF-007) |
| CSE-206 | Dividend Income | planned |
| CSE-207 | Portfolio History | planned |
| CSE-208 | Investment Journal | planned |
| CSE-209 | Investment Thesis | planned |
| CSE-210 | Thesis Health | planned |
| CSE-211 | Why I Bought | planned |
| CSE-212 | Sell/Invalidation Conditions | planned |

## Phase 14 — CSE Research Foundation

**Depends on:** Phase 11-13. **Status:** blocked (CSE-300 through CSE-309).

## Phase 15 — Sri Lanka Intelligence

**Depends on:** Phase 14. **Status:** blocked (CSE-400 through CSE-411).

## Phase 16 — Global Market Intelligence

**Depends on:** Phase 14. **Status:** blocked (CSE-500 through CSE-509).

## Phase 17 — News Intelligence

**Depends on:** Phase 14-16. **Status:** blocked (CSE-600 through CSE-609).

## Phase 18 — CSE Signal Engine

**Depends on:** Phase 11-17. **Status:** blocked (CSE-700 through CSE-709).

## Phase 19 — CSE Recommendation Engine

**Depends on:** Phase 18. **Status:** blocked (CSE-800 through CSE-811).

## Phase 20 — CSE Opportunity Scanner

**Depends on:** Phase 18, 19. **Status:** blocked (CSE-900 through CSE-908).

## Phase 21 — Paper Predictions and Learning

**Depends on:** Phase 18-20. **Status:** blocked (CSE-1000 through CSE-1013). Note: this session's *trading-engine* paper-decision-journal is a separate system from CSE — not reusable here without care.

## Phase 22 — Incremental Investment Assistant

**Depends on:** Phase 3, 11, 19. **Status:** blocked (CSE-1100 through CSE-1106).

## Phase 23 — Hermes Finance Foundation

**Depends on:** Phase 1. **Status:** partial.

| ID | Feature | Status | Note |
|---|---|---|---|
| AI-100 | Finance Manager Agent | planned | No named agent; the Finance API is the controlled layer |
| AI-101 | Finance API Tool Layer | existing | `/api/finance` action-dispatch |
| AI-102 | Agent Read Permissions | partial | Implicit, no formal scoped-permission model |
| AI-103 | Agent Action Contract | partial | `PendingIngestion` confirm/reject is an informal version |
| AI-104 | Finance Guard | planned | |
| AI-105 | Agent Audit Log | existing | `appendAuditLog` |
| AI-106 | AI Task Records | planned | |
| AI-107 | Risk Classification | planned | |
| AI-108 | Approval Integration | existing | Review-before-commit is the approval gate today |
| AI-109 | Context Builder | planned | |
| AI-110 | HARP Routing Integration | existing | `finance-extraction.ts` uses HARP-routed calls + fallback chain |
| AI-111 | Sensitive Data Classification | partial | `maskSensitive()` exists, not a full classification scheme |

## Phase 24 — Hermes Finance Analyst

**Depends on:** Phase 23. **Status:** planned — no NL query agent exists (AI-200 through AI-208).

## Phase 25 — Financial Inbox

**Depends on:** Phase 23. **Status:** partial.

| ID | Feature | Status |
|---|---|---|
| AI-300 | Financial Inbox | partial (Ingestion tab is a proto-inbox) |
| AI-301 | Inbox Item Types | partial (`documentType: transaction\|contract` only) |
| AI-302 | Receipt Review | existing |
| AI-303 | Statement Review | planned |
| AI-304 | Duplicate Review | existing (`findPossibleDuplicate` + duplicate-job guard) |
| AI-305 | Missing Category Review | planned |
| AI-306 | Reconciliation Issues | planned |
| AI-307 | Low Confidence Review | partial (badge shown, no dedicated queue) |
| AI-308 | Batch Approval | planned |
| AI-309 | Inbox Priority | planned |

## Phase 26 — Document Intelligence

**Depends on:** Phase 23. **Status:** partial (strong).

| ID | Feature | Status |
|---|---|---|
| AI-400 | Document Agent | partial (`finance-extraction.ts` functions collectively) |
| AI-401 | Receipt Extraction | existing |
| AI-402 | Bill Extraction | existing |
| AI-403 | Bank Statement Extraction | planned |
| AI-404 | Credit Card Statement Extraction | blocked (no credit cards) |
| AI-405 | Salary Slip Extraction | planned |
| AI-406 | Contract Note Extraction | planned |
| AI-407 | FD Certificate Extraction | planned |
| AI-408 | Employment Contract Extraction | existing |
| AI-409 | Confidence Scoring | existing |
| AI-410 | Document Linking | existing (`documentRef`) |
| AI-411 | Document Provenance | partial (`source`/`sourceRef` fields, not a full model) |

## Phase 27 — Gmail Finance Intelligence

**Depends on:** Phase 26. **Status:** partial.

| ID | Feature | Status |
|---|---|---|
| AI-500 | Gmail Finance Intake | existing (`syncGmailNow()`) |
| AI-501 | Candidate Email Detection | existing (keyword pre-filter) |
| AI-502 | Attachment Detection | existing |
| AI-503 | Finance Document Classification | partial |
| AI-504 | Duplicate Prevention | existing (`alreadyQueued()`) |
| AI-505 | Review Queue Integration | existing |
| AI-506 | Sync History | partial (tracked internally, no UI history view) |

## Phase 28 — Reconciliation Agent

**Depends on:** Phase 1, 23. **Status:** blocked — needs a real ledger to reconcile against (AI-600 through AI-607).

## Phase 29 — Hermes CSE Agent System

**Depends on:** Phase 14-22. **Status:** blocked (AI-700 through AI-708).

## Phase 30 — Telegram CSE Intelligence

**Status: future** (user-designated — do not build without being asked). SOC-100 through SOC-108.

## Phase 31 — WhatsApp CSE Intelligence

**Status: future** (user-designated). SOC-200 through SOC-206.

## Phase 32 — Social Reliability and Rumor Protection

**Status: future** (user-designated). SOC-300 through SOC-308.

## Phase 33 — Smart Alerts

**Depends on:** Phase 1, 5, 10, 11. **Status:** partial.

| ID | Feature | Status |
|---|---|---|
| AUTO-100 | Notification Engine | planned (badges + digest are informal equivalents) |
| AUTO-101 | Important Finance Alerts | **existing** (`FinanceAlertsCard` on the Overview tab now renders `payload.alerts`) |
| AUTO-102 | Credit Card Alerts | blocked |
| AUTO-103 | Budget Alerts | existing (overspend tab badge, PR #68) |
| AUTO-104 | FD Alerts | existing (maturity badge, PR #68) |
| AUTO-105 | Contract Alerts | existing (expiry badge, PR #68) |
| AUTO-106 | CSE Material Event Alerts | blocked |
| AUTO-107 | Thesis Change Alerts | blocked |
| AUTO-108 | Prediction Horizon Alerts | blocked |
| AUTO-109 | Data Health Alerts | planned |
| AUTO-110 | Quiet Mode | planned |

## Phase 34 — Scheduled Hermes Reviews

**Depends on:** Phase 33. **Status:** partial (strong).

| ID | Feature | Status |
|---|---|---|
| AUTO-200 | Daily Finance Check | planned |
| AUTO-201 | Weekly Finance Review | existing (`personal-finance-digest.sh`, cron `a1d0b1b42455`) |
| AUTO-202 | Monthly Financial Report | planned |
| AUTO-203 | Monthly Net Worth Snapshot | planned (needs Phase 38) |
| AUTO-204 | CSE Daily Brief | blocked |
| AUTO-205 | CSE Market Close Review | blocked |
| AUTO-206 | Subscription Review | blocked (no subscriptions model) |
| AUTO-207 | Contract Monitoring | existing (digest covers this) |
| AUTO-208 | FD Monitoring | existing (digest covers this) |

## Phase 35 — Existing Autonomous Trading Integration

**Status:** partial (strong) — the boundary itself is already solid.

| ID | Feature | Status |
|---|---|---|
| TRD-100 | Shared Market Intelligence Contract | planned |
| TRD-101 | Shared News Intelligence | planned |
| TRD-102 | Shared Event Model | planned |
| TRD-103 | Shared Model Registry | planned |
| TRD-104 | Cross-Market Portfolio View | planned |
| TRD-105 | Risk Exposure Aggregation | planned |
| TRD-106 | Strict Execution Boundary | existing (separate Postgres DBs, screens, summary functions) |

## Phase 36 — Fixed Deposits V2

**Depends on:** Phase 1. **Status:** partial.

| ID | Feature | Status |
|---|---|---|
| PF-1100 | Annual Interest Rate | existing |
| PF-1101 | Payout Frequency | existing |
| PF-1102 | Interest Schedule | planned |
| PF-1103 | Accrued Interest | planned |
| PF-1104 | Interest Received | planned |
| PF-1105 | Tax Deducted | planned |
| PF-1106 | Linked Payout Account | planned |
| PF-1107 | Maturity Value | planned (principal + rate stored, value not computed) |
| PF-1108 | Maturity Alerts | existing (badge, PR #68) |
| PF-1109 | Auto Renewal | planned |
| PF-1110 | FD Ladder View | planned |

## Phase 37 — Documents Vault

**Depends on:** Phase 26. **Status:** partial.

| ID | Feature | Status |
|---|---|---|
| DOC-100 | Document Vault | planned |
| DOC-101 | Employment Documents | existing (`finance-document.ts` route, view/re-analyze) |
| DOC-102 | Bank Documents | planned |
| DOC-103 | Credit Card Documents | blocked |
| DOC-104 | Investment Documents | planned |
| DOC-105 | Fixed Deposit Documents | planned |
| DOC-106 | Receipts | **existing** (viewable via "View document" link on transactions once `documentRef` is set) |
| DOC-107 | Bills | **existing** (same viewer, shared with receipts) |
| DOC-108 | Tax | planned |
| DOC-109 | Insurance | planned |
| DOC-110 | Loans | blocked |
| DOC-111 | Property | blocked |
| DOC-112 | Search | planned |
| DOC-113 | Record Linking | **existing** (`documentRef` viewer extended from income_source to income_record/expense_record) |
| DOC-114 | Checksum / Duplicate Detection | planned |

## Phase 38 — Analytics and Historical State

**Depends on:** Phase 1. **Status:** blocked — everything is live-computed present-moment only, no snapshots exist (AN-100 through AN-110).

## Phase 39 — Scenario Engine

**Depends on:** Phase 1, 3, 9. **Status:** blocked (SIM-100 through SIM-109).

## Phase 40 — Loans, Property and Long-Term Wealth

**Depends on:** Phase 1. **Status:** blocked (WEALTH-100 through WEALTH-108).

## Phase 41 — Tax Records

**Depends on:** Phase 1, 26. **Status:** partial.

| ID | Feature | Status |
|---|---|---|
| TAX-100 | Tax Year | existing |
| TAX-101 | Income Records | existing |
| TAX-102 | Tax Withheld | existing (`taxPaid`) |
| TAX-103 | Potential Deduction Records | **existing** (`deductionCategory` now shown/editable in the Tax records table) |
| TAX-104 | Supporting Documents | **existing** (`supportingDocument` now shown/editable in the Tax records table) |
| TAX-105 | Tax Export | partial (covered generically by JSON export) |
| TAX-106 | Tax Review Queue | planned (`requiresConfirmation` field exists, no queue UI) |

## Phase 42 — Backup, Import and Restore

**Depends on:** Phase 1. **Status:** partial.

| ID | Feature | Status |
|---|---|---|
| DATA-100 | Versioned JSON Export | **existing** (export now includes `schemaVersion: db.schemaVersion`) |
| DATA-101 | CSV Transaction Export | planned |
| DATA-102 | Investment Export | **existing** (`stock_holdings`/`fixed_deposits` were already both included in the general JSON export — roadmap-accuracy fix, no code change) |
| DATA-103 | Import | planned |
| DATA-104 | Backup | existing (nightly Postgres dumps, infra-level) |
| DATA-105 | Encrypted Backup | planned |
| DATA-106 | Restore | existing (restore-verified nightly, infra-level) |
| DATA-107 | Restore Validation | existing |
| DATA-108 | Schema Version | planned |
| DATA-109 | Migration Compatibility | planned |

## Phase 43 — Security

**Status:** partial.

| ID | Feature | Status |
|---|---|---|
| SEC-100 | Authentication Review | existing (password-gated) |
| SEC-101 | MFA/Passkey Future Support | planned |
| SEC-102 | Session Management | partial |
| SEC-103 | Sensitive Value Masking | existing (`maskSensitive()`) |
| SEC-104 | Secret Management | existing (`.env`, never in finance DB) |
| SEC-105 | Scoped Agent API Tokens | planned |
| SEC-106 | Financial API Authorization | partial (`isAuthenticated` gate, not finance-scoped) |
| SEC-107 | Document Access Security | existing (`finance-document.ts` auth + path validation) |
| SEC-108 | Audit Logging | existing (`appendAuditLog`) |
| SEC-109 | Sensitive AI Data Classification | planned |
| SEC-110 | Cloud/Local AI Routing Policy | partial (HARP routing tiers exist platform-wide, not finance-specific) |

## Phase 44 — Reliability and Observability

**Status:** partial.

| ID | Feature | Status |
|---|---|---|
| OPS-100 | System Health | **existing** (fully shipped via PF-413's `DataHealthCard` — row was stale) |
| OPS-101 | Database Health | existing (self-heal logic) |
| OPS-102 | Hermes Health | planned (not finance-specific) |
| OPS-103 | CSE Provider Health | partial (`priceFetchFailed` handling) |
| OPS-104 | FX Provider Health | planned |
| OPS-105 | Gmail Health | **existing** (connect-check now also returns/shows `lastSyncedAtSeconds`) |
| OPS-106 | AI Provider Health | planned |
| OPS-107 | Backup Health | planned (backups exist, no in-app health surface) |
| OPS-108 | Background Job Monitoring | planned |
| OPS-109 | Error Reporting | partial (`safeErrorMessage` pattern) |
| OPS-110 | Integration Retry | partial (HARP fallback chains for AI; CSE fetch has no retry, just fail→manual) |

---

## Ready Now

Dependencies met, scope clear — this is informational status only, nothing here is queued for autonomous work:

All three zero-dependency quick wins (PF-006, PF-007, PF-009) are now shipped — nothing left on this list.

## Recommended Next Feature

There is no separate "master registry" file distinct from this document — this roadmap doc itself is the living source of truth (confirmed via the commit that introduced it). With Phase 1's easy wins exhausted after PF-114, a scoping pass over Phase 4 (Overview V2) and Phase 8 (Budget V2) checked every `partial` item's actual code (PF-409, PF-410, PF-411, PF-413, PF-800, PF-806, PF-808) and found **PF-806** (Remaining Budget) the smallest and safest: `variance` was already computed server-side and already typed on the client payload, just never rendered — a one-line display change. It's now shipped.

**PF-413 (Data Health)** is also now shipped — surfacing `financeStorageStatus()` immediately proved its own value by revealing a real, pre-existing issue (see Shipped note below), which is exactly the kind of thing this card exists to catch going forward.

**PF-410 (Monthly Cash Flow)** is also now shipped — the net line was a pure client-side derived value from data the chart already used, no design ambiguity.

**PF-409 (Assets vs Liabilities)** is also now shipped — the "what counts as an asset" design question was resolved minimally by extending the existing net-worth breakdown chart with one more (differently-colored) bar rather than building a new widget or a per-account-type liability breakdown.

**PF-411 (Upcoming Money)** is also now shipped, closing out this entire Phase 4/8 scoping pass — every `partial` item checked (PF-409, PF-410, PF-411, PF-413, PF-806) is now `existing`, and the remaining Phase 8 items (PF-800, PF-808) were confirmed not independently actionable without further design work.

A follow-up scoping pass over Phase 3 (Personal Financial Rules), Phase 10 (Goals/Emergency Funds), and Phase 42 (Backup/Import) found **PF-1003 (Required Monthly Contribution)** the clear next pick — fully additive, reusing `SavingsGoal`'s already-stored `targetAmount`/`currentAmount`/`targetDate`. It's now shipped. The same pass also caught that **DATA-102 (Investment Export)** was already fully satisfied by the existing export and just needed its status corrected — done in the same PR, no code required.

**DATA-100** is also now shipped — the one-line `schemaVersion` stamp closes out the Phase 42 quick wins found in that pass. The phase's remaining actionable items (DATA-101 CSV export, DATA-103 Import, DATA-108 Schema Version enforcement/migrations, DATA-109 Migration Compatibility) are all genuinely `planned` — real design/build efforts, not further quick wins — so the next step is another fresh registry pass rather than continuing Phase 42.

Not ready without design work first: **PF-115** (needs new audit-log query/diff plumbing), **PF-808** (needs a new configurable-threshold schema field and a per-category-vs-global design decision), **PF-800** (not independently scoped — it's the umbrella row for Phase 8's other large `planned` items), **PF-300** (Financial Rules Model — needs a wholly new entity with no existing analog), **PF-304** (Savings Rate Target — technically small, but would pre-empt where Phase 3's other threshold rules end up living; an ordering problem, not a size problem), **PF-1004** (Account-Linked Goals — blocked on whether linking should derive `currentAmount` from the account, plus `DataTable` having no select/dropdown input type).

A follow-up scoping pass over three more unaudited phases (Phase 5 Income/Employment, Phase 41 Tax Records, Phase 44 Reliability/Observability) found **TAX-103 (Potential Deduction Records) and TAX-104 (Supporting Documents)** the clear next pick, combined into one slice — the smallest change of the entire session: two already-existing, already-populated `TaxRecord` fields just needed adding to the generic `DataTable`'s `columns` array. Both are now shipped. The same pass also caught that **OPS-100 (System Health)** was already fully satisfied by PF-413's `DataHealthCard` and just needed its stale status corrected — done in the same PR, no code required.

**OPS-105** is also now shipped — the last-synced timestamp is surfaced end-to-end (`auth.gmail-connect.ts`'s response + `pending-ingestion-panel.tsx`'s display, with a refetch after manual sync so it doesn't go stale). This closes out the current run of "surface an already-computed value" wins found across every phase audited so far this session (Phase 0/1/4/8/10/42/41/44).

**PF-303, PF-1005 & PF-1006 (Emergency Fund Target/Fund/Coverage Months)** are also now shipped — the first genuine design/build effort of this session rather than a surfacing fix, after a comprehensive scoping pass confirmed the "surface an already-computed value" pattern exhausted across every phase audited (Phase 0/1/2/4/5/8/10/33/34/36/37/41/42/43/44). See the Shipped note below for the design decision (settings-driven target tracked against real cash, not a fake `SavingsGoal`). With this shipped, the next candidates for a similar real design/build effort include **PF-1007 (Sinking Funds)** and **CSE-206 (Dividend Income)** — both genuinely new concepts, not yet scoped in detail.

A follow-up pass over Phase 36 (Fixed Deposits V2), Phase 37 (Documents Vault), and Phase 43 (Security) found that pattern genuinely exhausted in Phase 36 (no `partial` rows at all) and Phase 43 (all three `partial` items need new data capture or a real authz/policy design decision). Phase 37's **DOC-106, DOC-107, and DOC-113** were the one structural candidate — extending the already-shipped `finance-document.ts` employment-contract viewer to also serve receipts/bills via the already-existing `documentRef` field on income/expense records. Explicitly flagged before building: this environment has zero live receipt/bill data with `documentRef` populated, so the feature ships correct and ready but not immediately visible — Naveen confirmed shipping it anyway as correct, low-risk infrastructure. Now shipped.

A follow-up pass over Phase 2 (Multi-Currency), Phase 5's remainder, and Phase 33/34 (Smart Alerts/Scheduled Reviews) found **AUTO-101 (Important Finance Alerts)** a clean instance of this pattern — `financeAlerts()`/`financeStorageAlerts()` were already computed and merged into both payload builders' `alerts` field, with a proven render precedent already shipped in `trading-screen.tsx`. Now shipped. The pass also confirmed Phase 34 has no `partial` rows left at all, and Phase 5's remaining rows are all `existing`/`planned` besides the already-ruled-out PF-509.

**PF-208** is also now shipped — `currency`/`exchangeRateSource` added to the Tax records `DataTable` columns, the same shape as TAX-103/104.

With this shipped, the "surface an already-computed value" pattern this session has been mining is genuinely exhausted across every phase audited (Phase 0/1/2/4/5/8/10/33/34/36/37/41/42/43/44). The next scoping pass should either audit further phases not yet touched this session (e.g. Phase 3 beyond PF-300/304, Phase 12/13 CSE, Phase 23-27 Hermes AI, Phase 35 Trading Integration), or accept that further personal-finance work needs real design/build effort — a new entity, new computation logic, or an explicit product decision — rather than another pure-surfacing pass.

Not ready in the phases audited this session: **PF-509** (Contract Lifecycle — the stored `status` union is genuinely just `'active' | 'ended'`, nothing hiding; would need new lifecycle states and a design decision), **OPS-103** (needs a new aggregate health computation across holdings, not a surfacing fix), **OPS-109** (a platform-wide utility used well beyond finance, not finance-scoped), **OPS-110** (needs new retry/backoff logic, a real feature build), **PF-1107** (Maturity Value — needs a new maturity-value computation, not a surfacing fix), **SEC-102/106/110** (all need new data capture or a real authz/policy design decision), **PF-200** (Currency Model — needs real currency metadata design), **PF-205/PF-207** (Transaction FX / Manual FX Override — conversion logic was never actually built, not a hidden field), **PF-209** (Multi-Currency UI — subjective scope, not a specific gap), **PF-210** (test-writing, not this pattern).

### Shipped: PF-100/101/102/103 — Account Model

- **What was built**: `openingBalance?`/`openingBalanceDate?` added to `FinanceAccount` (`src/server/finance-store.ts`) and the `personal_finance` Postgres mirror; a dedicated `AccountsPanel` (`src/screens/personal-finance/components/accounts-panel.tsx`) replacing the generic DataTable in the Accounts & Records tab — add/edit/delete, human-readable account-type labels, a per-currency total-balance line, and an opening-balance secondary line per account.
- **Known limitation**: `balance` is still a manually-maintained current figure, not derived from transactions — that's explicitly PF-104's job, not attempted here.
- **Not built** (deliberately deferred, not dropped): a separate `institutions` entity — the existing free-text `platform` field is reused for "which bank/broker" for now; worth revisiting once multiple accounts actually share an institution and dedup value emerges.

### Shipped: PF-104 — Unified Transaction Model (+ partial PF-105, PF-114)

- **What was built**: an additive read layer, not a storage migration — `getUnifiedTransactions()` (`src/server/finance-store.ts`) maps `income_records`/`expense_records` into one shared `UnifiedTransaction` shape (renaming `dateReceived`→`date`, `sourceName`→`vendor`-equivalent `counterparty`, `incomeType`→`category`, etc.) and sorts them together by date. `TransactionsPanel` (`src/screens/personal-finance/components/transactions-panel.tsx`) replaces the two separate, no-create `DataTable`s (income records in the Income & Jobs tab, expense records in Accounts & Records) with one panel: an income/expense toggle add-form, inline edit, delete, a counterparty/category search box, and a kind filter — all routed through the existing `add_record`/`update_record`/`delete_record` dispatch under the hood. `transactions` is now included in both `personalFinancePayload()` (GET) and `financePayload()` (the shape every mutation's POST response returns via `useFinanceAction`), matching how `budgetVsActual` is already present in both.
- **Known limitation / deliberate scope**: `income_records` and `expense_records` remain two separate collections in storage (JSON + both Postgres mirrors) — `financeSummary`, `budgetVsActual`, `getMonthlySummary`, and duplicate-detection are all untouched and still read the original collections directly. A real storage migration to one `transactions` table (PF-106 types, PF-107 transfers, PF-108 splits, PF-113 reconciliation status, PF-116 soft delete) was deliberately deferred as a separate, larger, higher-risk future feature rather than bundled into this slice.
- **Not built** (deliberately deferred, not dropped): transfers between the user's own accounts (no transfer concept exists anywhere in the codebase today — confirmed via full-file grep), a formal transaction-type enum, merchant/tag entities, and date-range/amount filters (only counterparty/category text search + kind filter shipped).

### Shipped: PF-109 — Categories

- **What was built**: a new `Category` entity (`id, name, kind: 'income'|'expense'|'both', color?, notes?`) as a net-new `categories` collection (JSON + `personal_finance` Postgres mirror), managed via `CategoriesPanel` (`src/screens/personal-finance/components/categories-panel.tsx`) — add/edit/delete, a usage count per category computed by matching its name against existing `expense_records`/`income_records`/`budget_categories`, and an "in use, not yet a category" section listing free-text category strings that don't yet have a matching `Category` row, each with a one-click button to formalize it (never automatic). A shared `<datalist id="pf-known-categories">` is wired into the existing free-text category inputs in `TransactionsPanel` and `BudgetPanel` for native browser autocomplete.
- **Known limitation / deliberate scope**: `ExpenseRecord.category`, `IncomeRecord.incomeType`, and `BudgetCategory.category` remain plain free-text strings — `getBudgetVsActual`'s exact-string join is completely untouched. Renaming or deleting a `Category` row does not retroactively update any existing record's free-text field (the panel's own copy says this explicitly).
- **Not built** (deliberately deferred, not dropped): a `categoryId` foreign key on expense/income/budget records, and rewriting the budget-vs-actual join to key on ID instead of name — both remain real future work once this entity has proven itself in use.

### Shipped: PF-110 — Subcategories

- **What was built**: a new `Subcategory` entity (`id, name, parentCategory, source, createdAt, updatedAt`) as a net-new `subcategories` collection (JSON + `personal_finance` Postgres mirror), managed inline within `CategoriesPanel` — each category row shows its subcategories as removable chips with a usage count, plus an inline add-input scoped to that category, and an "in use, not yet a subcategory" section mirroring the category one. A shared `<datalist id="pf-known-subcategories">` is wired into `TransactionsPanel`'s subcategory inputs.
- **Bug fixed as part of this work**: `getUnifiedTransactions()` never included `ExpenseRecord.subcategory` in the unified view `TransactionsPanel` reads from — subcategory was invisible in the transaction list, and `startEdit()` always seeded the edit form's subcategory field as blank, so opening the editor for any expense with an existing subcategory and saving would silently erase it. Fixed by adding `subcategory` to `UnifiedTransaction` and its mapping; verified via a regression test and live Playwright confirmation that editing no longer blanks the field.
- **Known limitation / deliberate scope**: `ExpenseRecord.subcategory` remains a plain free-text string, scoped to a parent category by name only (not an FK) — identical tradeoff to PF-109. No income-side subcategory concept exists or was added (`IncomeRecord` has none).
- **Not built** (deliberately deferred, not dropped): a `subcategoryId`/`categoryId` foreign key, per-category-filtered datalist (ships one flat list of every subcategory name, same simplicity as the category datalist), and subcategory-level budgets.

### Shipped: PF-111 — Merchant Registry

- **What was built**: a new `Merchant` entity (`id, name, defaultCategory?, notes?, source, createdAt, updatedAt`) as a net-new `merchants` collection (JSON + `personal_finance` Postgres mirror), managed via a new sibling `MerchantsPanel` (`src/screens/personal-finance/components/merchants-panel.tsx` — a separate file from `CategoriesPanel`, which already carried two catalogue blocks) — add/edit/delete, a usage count per merchant, and an "in use, not yet a merchant" formalize section. `TransactionsPanel`'s vendor input gained a `pf-known-merchants` datalist (the first vendor-side autocomplete in the codebase) and an on-blur handler that fills the category field from a recognized merchant's `defaultCategory` — only when the category field is empty, so a manually-typed category is never overwritten.
- **Known limitation / deliberate scope**: `ExpenseRecord.vendor` remains a plain free-text string (no FK); the existing AI-extraction vendor→category hint map (`db.settings.categoryCorrections`) was deliberately left untouched — it stays exclusively the ingestion-hinting mechanism it already was, not merged with or read from this new catalogue.
- **Not built** (deliberately deferred, not dropped): a `merchantId` foreign key, fuzzy/case-insensitive matching for the auto-fill (exact match only), and any income-side "payer" catalogue (no such concept exists or was needed — `IncomeRecord.sourceName` stays plain text).

### Shipped: PF-006 — Fix Fixed Deposit Rate Labelling

- **What was built**: the interest-rate field's add-form placeholder and read-only row display now both show "% p.a." instead of a bare "%", and the panel's helper text explicitly says "the annual interest rate" — disambiguating it from the adjacent Payout Frequency control (e.g. "12.5% · monthly" could previously be misread as a monthly rate).
- **Known limitation / deliberate scope**: display-text only — `FixedDeposit.interestRatePct` was already stored unambiguously as an annual percentage number (confirmed no interest-accrual calculation exists anywhere that could have been affected); no type, storage, or calculation change was needed or made.

### Shipped: PF-007 — Improve Investment P/L Display (+ CSE-205)

- **What was built**: `financeSummary()` now returns `unrealizedStockPnlPct` (`unrealizedStockPnlLkr` ÷ total cost basis × 100, guarded to `0` when there are no holdings) alongside the pre-existing `unrealizedStockPnlLkr`. Shown on the Overview "Unrealized P/L" `StatCard` (e.g. "-LKR 2,913 (-9.2%)") and per-holding in `StockHoldingsPanel` (e.g. "+LKR 200 (+20.0%)"), reusing the existing `formatPct()` helper and green/red color-coding — no new formatter or color logic needed since the sign of the dollar and percentage figures always agree.
- **Known limitation / deliberate scope**: purely additive — the existing `unrealizedStockPnlLkr` formula (locked in by two pre-existing unit tests) was not touched; no `StockHolding` type, storage, or Postgres change was needed since P/L is computed entirely at read time from existing fields.

### Shipped: PF-009 — Standardize Money Formatting

- **What was built**: a shared `formatMoney(amount, currency)` added to `src/screens/personal-finance/utils.ts`; `formatLkr` is now a thin wrapper over it (`formatMoney(value, 'LKR')`) with identical output for every existing caller. Deduplicated 4 independent reimplementations of the same formatting logic onto the shared function (`accounts-panel.tsx`'s local `formatAmount`, a separate identical copy in `transactions-panel.tsx`, and inline template literals in `personal-finance-screen.tsx`'s currency-exposure section and `income-sources-panel.tsx`). Fixed a real mislabeling bug: `stock-holdings-panel.tsx` and `fixed-deposits-panel.tsx` called the LKR-hardcoded `formatLkr()` on values carrying their own real `currency` field — a USD stock holding's price was silently shown as "LKR 150"; both now thread the record's actual currency through `formatMoney`.
- **Known limitation / deliberate scope**: deliberately did not touch `finance-trends-card.tsx`, `recurring-bills-insight.tsx`, `budget-panel.tsx`, `savings-goals-progress.tsx`, or the Overview `StatCard`s — these display genuinely-LKR aggregate figures from `financeSummary()`/`getMonthlySummary()` (which sum `convertedLkrAmount`), so `formatLkr` was already correct there and touching them would have been scope creep with no confirmed bug behind it.

### Shipped: PF-112 — Tags

- **What was built**: a new `Tag` entity (`id, name, notes?, source, createdAt, updatedAt`) as a net-new `tags` collection (JSON + `personal_finance` Postgres mirror, including new `tags TEXT` columns on `expense_records`/`income_records`), managed via a new `TagsPanel` — add/edit/delete, usage counts, and an "in use, not yet a tag" formalize section. Unlike `Category`/`Subcategory`/`Merchant` (one-per-record scalar fields), tags are many-to-many: both `ExpenseRecord` and `IncomeRecord` carry a comma-separated `tags` free-text field, and `TransactionsPanel`'s add/edit forms expose a symmetric "Tags (comma-separated)" input on both income and expense (unlike subcategory, which stays expense-only), with a chip-list display on each transaction row and `pf-known-tags` datalist autocomplete. Usage counting and unmanaged-tag detection tokenize the delimited field (split on comma, trim, dedupe) across both record types into one shared count.
- **Proactive fix, not a new bug**: `tags` was added to `UnifiedTransaction` and `getUnifiedTransactions()`'s mapping from the start, since `TransactionsPanel` reads exclusively from that unified view — this is exactly the step PF-110 skipped for `subcategory`, which silently blanked the field on every edit until fixed afterward. Verified via a live edit-then-reopen check that tags are never blanked.
- **Known limitation / deliberate scope**: no `tagId` foreign key — tags are matched by name only, same tradeoff as every prior catalogue. No income-side "why symmetric" surprises: `IncomeRecord` has no subcategory-equivalent, but tags apply to both record types by design per this feature's own scope.

### Shipped: PF-113 — Pending/Cleared/Reconciled Status

- **What was built**: a `status: 'pending' | 'cleared' | 'reconciled'` field added to both `ExpenseRecord` and `IncomeRecord` (`src/server/finance-store.ts`), validated on create via a `reconciliationStatus()` allowlist-with-fallback (defaulting to `'cleared'` to match today's implicit behavior) and round-tripped on update through the existing shallow-merge, same as `tags`/`subcategory`. Mirrored to the `personal_finance` Postgres database as a new nullable `status TEXT` column on both `income_records`/`expense_records`. `TransactionsPanel` gained a status select on both the add-form and edit-form, a compact badge shown only when status isn't `'cleared'` (amber for pending, indigo for reconciled — keeping the common case visually quiet), and a status filter alongside the existing kind filter.
- **Proactive fix, not a new bug**: `status` was added to `UnifiedTransaction` and both mapping blocks in `getUnifiedTransactions()` from the start, since `TransactionsPanel` reads exclusively from that unified view — the same discipline established for `tags` in PF-112, following the PF-110 lesson. Verified via a live edit-then-reopen check that changing status alone never disturbs other fields.
- **Known limitation / deliberate scope**: no status-based filtering was added to `financeSummary()`, `getBudgetVsActual()`, `budgetVsActualSummary()`, or `getMonthlySummary()` — all four remain status-agnostic and sum every record regardless of status, unchanged from before this feature. Deciding whether "pending" transactions should be excluded from totals is a separate, larger decision explicitly out of scope here; today the field is purely informational/filterable in the UI.

### Shipped: PF-114 — Transaction Search and Filters

- **What was built**: date-range (From/To) and amount-range (Min/Max) filter inputs added to `TransactionsPanel`'s filter bar, composing with the existing search/kind/status filters in the same `filtered` `useMemo`. Purely additive client-side filtering — no server, schema, or Postgres changes, since `date`/`amount` already exist on every `UnifiedTransaction` row.
- **Known limitation / deliberate scope**: date-range comparison uses plain ISO `YYYY-MM-DD` string comparison (safe and correct given native `<input type="date">` values are already ISO-formatted) — no timezone or partial-date handling was needed or added. Amount filtering compares each transaction's own `amount` field directly; it does not normalize across currencies (e.g. filtering "min 100" matches a 100 USD row and a 100 LKR row equally) — cross-currency amount filtering would need to key off `convertedLkrAmount` instead, and was left out as a separate, deliberate scope decision since the doc's own PF-114 gap description only called for basic date/amount ranges.
- **Not built** (deliberately deferred, not dropped): no "clear filters" button — each of the seven filter controls is cleared individually today, matching the existing pattern for `filterKind`/`filterStatus`.

### Shipped: PF-806 — Remaining Budget

- **What was built**: `BudgetPanel`'s budget-vs-actual `StatCard`s (`src/screens/personal-finance/components/budget-panel.tsx`) now append a "Remaining LKR X" (under budget) or "Over by LKR X" (over budget) suffix to the existing actual/budget value string, using the already-signed `variance` field (`budgetAmount - actual`) that `budgetVsActualSummary()` (`finance-store.ts`) already computes and that was already typed on `PersonalFinancePayload.budgetVsActual[].variance` — it simply wasn't read by any component before this.
- **Known limitation / deliberate scope**: purely a display change — no new component, no `StatCard` prop change, no server/schema/Postgres changes. `variance`'s own computation and sign convention were untouched.
- **Not built** (deliberately deferred, not dropped): no separate progress bar or dedicated "remaining" visual treatment — the existing tone-coded (`good`/`warn`/`danger`) `StatCard` background already communicates over/under-budget status at a glance; the text suffix was judged sufficient for this slice.

### Shipped: PF-413 — Data Health

- **What was built**: a `storage` field added to `PersonalFinancePayload` (`src/screens/personal-finance/types.ts`) mirroring the `FinanceStorageHealth` shape `financeStorageStatus()` (`finance-store.ts`) already computed and that both `financePayload()`/`personalFinancePayload()` (`src/routes/api/finance.ts`) already shipped identically — no server change needed. A new `DataHealthCard` (`src/screens/personal-finance/components/data-health-card.tsx`) reads `payload.storage.health` and renders a single tone-coded `StatCard` on the Overview tab (`good` for healthy, `warn` for a lagging/mismatched mirror, `danger` for an unavailable mirror, `neutral` for JSON-only mode), with any warning text truncated to 140 characters since raw mirror-write-error text can be arbitrarily long.
- **Real issue surfaced immediately**: on first live verification, the card revealed that the *shared* (trading-side) finance Postgres mirror — a separate system from the `personal_finance` database all other personal-finance features use — was ~18.8 hours behind with a write failure (`duplicate key value violates unique constraint "strategy_results_pkey"`). This is outside personal-finance scope (the affected table belongs to the trading engine, in the off-limits `finance-postgres-store.ts`) and was flagged to Naveen rather than touched — exactly the kind of visibility this feature exists to provide.
- **Known limitation / deliberate scope**: read-only display of the synchronous per-request health check — does not surface the separate, longer-running `runFinanceStorageHeartbeat` operational monitor's persisted alert state, and does not attempt any fix or self-heal trigger from the UI (self-heal already runs server-side on every `financeStorageStatus({ selfHeal: true })` call).

### Shipped: PF-410 — Monthly Cash Flow

- **What was built**: `FinanceTrendsCard`'s "Income vs. expense" chart (`src/screens/personal-finance/components/finance-trends-card.tsx`) now derives `net = income - expense` per month inside `buildTrendData()` (both already LKR-normalized via each record's `convertedLkrAmount`, so no currency-mismatch risk) and plots it as a dashed blue `<Line>` alongside the existing income/expense `<Area>` series — required switching the chart from `AreaChart` to `ComposedChart` (recharts requires this to mix series types). Also added a `<Legend>` (the chart previously had none) and a "This month's net: ..." subtitle line using the already-imported `formatLkr`.
- **Incidental fix**: the local recharts type shim (`src/types/recharts.d.ts`) was missing `ComposedChart`/`Legend` exports — added both, matching the existing `ComponentType<any>` convention for every other recharts import in that file.
- **Known limitation / deliberate scope**: purely additive/client-side — no server, schema, or Postgres changes; `net` is a pure derived value from data the chart already read. No axis-domain or tick-formatter changes were made for negative net values (recharts already auto-scales the Y axis to include them).

### Shipped: PF-409 — Assets vs Liabilities

- **What was built**: the Overview tab's "Net worth breakdown" `BarChart` (`src/screens/personal-finance/personal-finance-screen.tsx`) — previously assets-only (Cash/Stocks/Fixed deposits) — now includes a `Debt` bar using `financeSummary()`'s already-computed `debtLkr` (sum of `Math.abs(balance)` over `loan`/`card` accounts), rendered in a distinct red/rose color via per-bar recharts `<Cell>` fills (asset bars stay blue). The card was renamed "Assets vs. liabilities" to match. `debtLkr` was added to `PersonalFinancePayload['summary']` (`src/screens/personal-finance/types.ts`) — confirmed already flowing over the wire from both payload builders, just previously untyped for the client, same shape of gap as PF-413's `storage` field. `Cell` was added to the local recharts type shim (`src/types/recharts.d.ts`).
- **Design decision**: rather than building a new widget or a per-account-type liability breakdown (Loans vs. Card debt separately), the minimal fix was chosen — one more bar in the existing chart, distinguished by color. This sidesteps the larger open questions research flagged (per-type liability granularity, non-LKR asset totals not currently summed anywhere, no enforced balance sign convention for loan/card accounts) without blocking on them.
- **Known limitation / deliberate scope**: `debtLkr` remains a single aggregate of `loan`+`card` types combined — no separate "Loans" vs. "Card debt" bars. Non-LKR-denominated asset-type accounts (bank/cash/crypto/broker/foreign_currency) are still not summed into any asset total (a pre-existing gap, not introduced or worsened here). No sign-convention enforcement was added for loan/card balances — the chart relies on `debtLkr`'s existing `Math.abs()` normalization.

### Shipped: PF-411 — Upcoming Money

- **What was built**: a new `UpcomingMoney` card (`src/screens/personal-finance/components/upcoming-money.tsx`) on the Overview tab, merging three previously-scattered badge computations into one sorted list: payday status (`getPaydayStatus()` + `paydayLabel()`, from `payday-status.ts`/`income-sources-panel.tsx`), contract expiry (`contractExpiryLabel()`, `income-sources-panel.tsx`), and FD maturity (`daysUntil()`/`maturityBadge()`, `fixed-deposits-panel.tsx`). All four functions were only `export`ed, not modified — zero logic duplication or change. An event is included only when its own existing tone classification is non-neutral (amber "soon" or red "overdue"), reusing each function's own urgency judgment rather than inventing a new day-count threshold; already-received payday events (`'paid'` state) are excluded entirely since they're not "upcoming." The card returns `null` (renders nothing) when no urgent events exist, matching `RecurringBillsInsight`'s idiom.
- **Verified no regression**: live-tested that the source panels (Income & Jobs' payday/contract badges, Investments' FD maturity badges) still render identically after exporting the underlying functions.
- **Known limitation / deliberate scope**: purely an aggregation view — no new data, no server/schema changes. The neutral-tone filter means a job/FD/contract with nothing urgent won't appear here even though it still shows its own (neutral) badge in its home panel — this is the intended behavior for an "upcoming" list, not a bug.

This closes out the Phase 4/8 scoping pass — see "Recommended Next Feature" above for what to scope next.

### Shipped: PF-1003 — Required Monthly Contribution

- **What was built**: `SavingsGoalsProgress` (`src/screens/personal-finance/components/savings-goals-progress.tsx`) now derives and shows a "Needs LKR X/mo to reach by <date>" line per goal, computed from the already-stored `targetAmount`/`currentAmount`/`targetDate` fields on `SavingsGoal` — no new entity, no schema change, no write-back to the separately user-entered `monthlyContribution` field (kept purely a display annotation to avoid new reconciliation questions between the two figures).
- **Edge cases resolved in-PR**: no line shown when there's no `targetDate` (can't compute) or when the goal is already met/exceeded (nothing further required); shows "Target date passed" instead of a divide-by-zero/nonsensical figure when the date has elapsed without meeting the goal.
- **Roadmap-accuracy fix bundled in the same PR**: **DATA-102 (Investment Export)** was found already fully satisfied by the existing JSON export (both `stock_holdings` and `fixed_deposits` already included) — reclassified to `existing`, no code change needed.
- **Known limitation / deliberate scope**: `monthsUntil` floors to a minimum of 1 to avoid an inflated per-month figure for near-term dates; this environment had zero live savings goals at verification time, so the feature was verified with a temporary test goal rather than real user data.

### Shipped: DATA-100 — Versioned JSON Export

- **What was built**: `GET /api/finance-export` (`src/routes/api/finance-export.ts`) now includes `schemaVersion: db.schemaVersion` in the exported object — a single field reusing the already-existing `FinanceDatabase.schemaVersion` (itself populated from the already-existing `FINANCE_SCHEMA_VERSION` constant, currently `1`). No new constant, no new concept, no server/schema changes.
- **Known limitation / deliberate scope**: this is the data's own existing schema version, not a separate export-format version — DATA-108 (Schema Version, still `planned`) would be where a distinct migration/versioning concept lives if one is ever needed; this slice deliberately didn't invent one.

This closes out Phase 42's quick wins from this scoping pass — see "Recommended Next Feature" above for what to scope next.

### Shipped: TAX-103 & TAX-104 — Potential Deduction Records and Supporting Documents

- **What was built**: the Tax records `DataTable` (`src/screens/personal-finance/personal-finance-screen.tsx`) now lists `deductionCategory` and `supportingDocument` in its `columns` array. Both fields already existed on `TaxRecord` (`src/server/finance-store.ts`) and were already populated on write — `DataTable` is fully generic and key-driven, so no other code changed.
- **Roadmap-accuracy fix bundled in the same PR**: **OPS-100 (System Health)** was found already fully shipped via PF-413's `DataHealthCard` — the row was simply stale; reclassified to `existing`, no code change needed.
- **Known limitation / deliberate scope**: none — this is a pure surfacing fix with no edge cases (missing values already render as `—` via `DataTable`'s existing `textValue()` helper).

### Shipped: OPS-105 — Gmail Health (last-synced timestamp)

- **What was built**: `GET /api/auth/gmail-connect?check=1` now returns `lastSyncedAtSeconds`, reusing the already-written `settings.gmailIngest.lastSyncedAtSeconds` (read with the same untyped-cast convention as `getCategoryCorrections()` — `gmailIngest` stays outside the `FinanceSettings` type, no schema change). `pending-ingestion-panel.tsx` shows "Last synced <date>" or "Never synced" next to the Gmail button, and the connection check was extracted into a reusable `checkGmailConnection()` now also called after a manual sync completes, so the timestamp doesn't go stale immediately after syncing.
- **External issue surfaced during verification**: the actual "Sync Gmail now" call failed with `Gmail list failed: 403` in this environment — a pre-existing external Gmail API problem (likely token/scope/quota) unrelated to this change. The read/display path was verified directly (by temporarily injecting a timestamp value) since a live successful sync wasn't available to test the write path end-to-end; flagged to Naveen for separate investigation.
- **Known limitation / deliberate scope**: single-account only (matches the app's existing single-Gmail-connection design, no multi-account disambiguation needed).

### Shipped: DOC-106, DOC-107 & DOC-113 — Receipt/Bill Document Viewing

- **What was built**: `GET /api/finance-document` (previously `kind=income_source` only, built for the employment-contract viewer) now also accepts `kind=income_record`/`kind=expense_record`, reusing the exact same auth/path-guard/`contentTypeFor` logic. `TransactionsPanel` now shows a "View document" link on any transaction with a `documentRef`, mirroring the pattern already shipped in `income-sources-panel.tsx`. `documentRef` already existed on both record types and was already stamped by `confirm_pending_ingestion` when confirming a receipt/bill via ingestion, and already flowed unmasked through `getUnifiedTransactions()` — no new data model, no write-path changes.
- **Deliberate scope decision, made explicitly before building**: this environment's `finance.json` had zero income/expense records with `documentRef` populated at shipping time (no receipt/bill had been confirmed via ingestion yet — all pending ingestions on record were employment contracts). This means the feature is correct and ready but was not immediately visible in this environment on ship day. Verified by creating a temporary test record pointing at an existing uploaded file, confirming the link rendered and served the file with the correct content-type, then cleaning up. Shipped as intentional, low-risk infrastructure for when real receipt/bill ingestion happens, per explicit confirmation before starting.
- **Known limitation**: none beyond the above — the mechanism itself has no edge cases (a record with no `documentRef` simply shows no link, matching the existing contract-viewer's own behavior).

### Shipped: AUTO-101 — Important Finance Alerts

- **What was built**: a new `FinanceAlertsCard` (`src/screens/personal-finance/components/finance-alerts-card.tsx`) mounted first on the Overview tab (above all other cards, as the highest-priority information on the page), rendering `payload.alerts` tone-coded by `level` (red for critical, amber for warning, neutral for info). `alerts: Array<{level, title, detail}>` was added to `PersonalFinancePayload` (`src/screens/personal-finance/types.ts`) — `financeAlerts()` and `financeStorageAlerts()` (`finance-store.ts`) were already computed and already merged into both `financePayload()` and `personalFinancePayload()`'s `alerts` field, just never typed or read on the client. The render shape and precedent already existed verbatim in `trading-screen.tsx`.
- **Verified live**: this environment's real (pre-existing, still-unresolved) storage-mirror-behind warning rendered correctly with amber tone-coding on first load — no synthetic test data needed.
- **Known limitation / deliberate scope**: no dismiss/acknowledge mechanism — alerts simply reflect current computed state and disappear on their own once the underlying condition clears (matching `trading-screen.tsx`'s own behavior, no new interaction model introduced).

### Shipped: PF-208 — FX Source/Freshness Metadata

- **What was built**: `TaxRecord.currency` and `TaxRecord.exchangeRateSource` (`src/server/finance-store.ts`) — both already existed and were already populated on write — added to the Tax records `DataTable`'s `columns` array (`src/screens/personal-finance/personal-finance-screen.tsx`). Same shape of gap as TAX-103/104, on the same generic `DataTable`.
- **Known limitation / deliberate scope**: `IncomeRecord.exchangeRateUsed` (a related but differently-named field, PF-205/PF-207's territory) remains unsurfaced — `IncomeRecord` has no dedicated `DataTable`/browsable view today (it's only visible via the unified `TransactionsPanel`, which doesn't use the generic column-array pattern), so this fix was scoped to Tax records only, where the fix was a trivial column addition. Extending FX metadata visibility to income records would need either a new column on `TransactionsPanel` or a design decision about whether that's worth the added row complexity — deliberately out of scope here.

This closes out the "surface an already-computed value" pattern across every phase audited this session — see "Recommended Next Feature" above for what to scope next.

### Shipped: PF-303, PF-1005 & PF-1006 — Emergency Fund Target, Emergency Fund, Coverage Months

- **Why bundled**: the roadmap split one underlying concept across two phases — PF-303 (Phase 3, Financial Rules) as a user-set *target*, and PF-1005/PF-1006 (Phase 10) as the *dedicated tracked concept* and its derived "months covered" metric. Both needed the same underlying data model, so they were designed and shipped together rather than as three separate slices.
- **What was built** (a genuine design/build effort, not a surfacing fix — nothing emergency-fund-shaped existed anywhere in the codebase before this): `FinanceSettings.emergencyFundTargetMonths` (`src/server/finance-store.ts`) stores a user-set target in months of average expenses. A new `getAverageMonthlyExpensesLkr()` function (built on top of `getMonthlySummary()`, which had zero callers anywhere in the codebase before this) computes a trailing 3-month average, excluding the current in-progress month. `personalFinancePayload()` (`src/routes/api/finance.ts`) derives an `emergencyFund` block (`targetMonths`, `avgMonthlyExpensesLkr`, `currentLkr`, `targetLkr`, `coverageMonths`, `progressPct`) and a new `set_emergency_fund_target` POST action lets the user set it. A new `EmergencyFundCard` (`src/screens/personal-finance/components/emergency-fund-card.tsx`) renders an inline "set target" control when unset, or a progress bar once configured.
- **Key design decision**: the emergency fund is tracked against real liquid cash (`cashBalanceLkr`) rather than a manually-entered `SavingsGoal` row — a `SavingsGoal.currentAmount` is manually maintained (fine for active deposits), but an emergency fund's "current amount" should be its actual cash balance, avoiding a second, driftable ledger. This also avoids repeating the only prior "special goal" precedent, `taxReserveLkr`'s fragile `goal.name.toLowerCase().includes('tax')` string match.
- **Known limitation / deliberate scope**: there's no Financial Rules Settings Page (PF-301) yet, so the target is set via a minimal inline control on the card itself rather than a dedicated settings screen — PF-300/301 remain `planned`. `cashBalanceLkr` only sums LKR-currency accounts (a pre-existing limitation, not introduced here), so foreign-currency cash doesn't count toward coverage.
- **Verified live**: set to 6 months, confirmed persistence across reload, confirmed correct "no complete month of expense history yet" messaging (this environment currently has no expense records), then reset back to unset (`0`) to leave a clean state.
