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
| PF-006 | Fix Fixed Deposit Rate Labelling | planned, **ready** | Confirmed bug — needs "p.a." qualifier distinct from payout frequency |
| PF-007 | Improve Investment P/L Display | planned, **ready** | Confirmed gap — no percentage shown alongside LKR gain/loss (row-level or Overview aggregate) |
| PF-008 | Remove Developer/API Language From User UI | planned | Not yet audited line-by-line |
| PF-009 | Standardize Money Formatting | planned | Needs a currency-aware formatter, not LKR-only |
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
| PF-109 | Categories | partial | Free-text `category` field exists on expenses/budgets, not a proper entity; still the join key `TransactionsPanel` and budget-vs-actual both rely on |
| PF-110 | Subcategories | planned | Deferred by the PF-104 slice |
| PF-111 | Merchant Registry | planned | Deferred by the PF-104 slice |
| PF-112 | Tags | planned | Deferred by the PF-104 slice |
| PF-113 | Pending/Cleared/Reconciled Status | planned | Deferred by the PF-104 slice |
| PF-114 | Transaction Search and Filters | partial | `TransactionsPanel` now has basic counterparty/category search + kind filter (client-side); no date-range or amount filters yet |
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
| PF-208 | FX Source/Freshness Metadata | partial | `exchangeRateSource` field exists on `IncomeRecord`/`TaxRecord` |
| PF-209 | Multi-Currency UI | partial | Currency exposure card + per-currency grouped totals exist (PR #69) |
| PF-210 | Multi-Currency Testing | partial | Some unit tests touch currency fields, not comprehensive |

## Phase 3 — Personal Financial Rules

**Goal:** Personalized recommendations without AI guessing preferences. **Depends on:** Phase 1. **Status:** planned.

| ID | Feature | Status |
|---|---|---|
| PF-300 | Financial Rules Model | planned |
| PF-301 | Financial Rules Settings Page | planned |
| PF-302 | Minimum Cash Reserve | planned |
| PF-303 | Emergency Fund Target | planned |
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
| PF-409 | Assets vs Liabilities | partial | `debtLkr` exists (loan/card account types); no dedicated liabilities view |
| PF-410 | Monthly Cash Flow | partial | `FinanceTrendsCard` income/expense chart |
| PF-411 | Upcoming Money | partial | Payday/FD-maturity/contract-expiry badges are an informal version |
| PF-412 | Financial Health | planned | No composite score |
| PF-413 | Data Health | partial | `financeStorageStatus()` health/self-heal exists, not surfaced as its own card |
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
| PF-806 | Remaining Budget | partial (variance/percentUsed computed) |
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
| PF-1003 | Required Monthly Contribution | partial (stored, not auto-calculated) |
| PF-1004 | Account-Linked Goals | partial (`linkedAccountId` field exists) |
| PF-1005 | Emergency Fund | planned (no dedicated concept) |
| PF-1006 | Emergency Coverage Months | planned |
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
| CSE-205 | P/L % | planned (same gap as PF-007) |
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
| AUTO-101 | Important Finance Alerts | partial |
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
| PF-1100 | Annual Interest Rate | existing (needs PF-006's label fix) |
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
| DOC-106 | Receipts | partial (stored, not browsable) |
| DOC-107 | Bills | partial (stored, not browsable) |
| DOC-108 | Tax | planned |
| DOC-109 | Insurance | planned |
| DOC-110 | Loans | blocked |
| DOC-111 | Property | blocked |
| DOC-112 | Search | planned |
| DOC-113 | Record Linking | partial (`documentRef` pattern, income_source only) |
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
| TAX-103 | Potential Deduction Records | partial (`deductionCategory` field, no dedicated flow) |
| TAX-104 | Supporting Documents | partial (`supportingDocument` field exists) |
| TAX-105 | Tax Export | partial (covered generically by JSON export) |
| TAX-106 | Tax Review Queue | planned (`requiresConfirmation` field exists, no queue UI) |

## Phase 42 — Backup, Import and Restore

**Depends on:** Phase 1. **Status:** partial.

| ID | Feature | Status |
|---|---|---|
| DATA-100 | Versioned JSON Export | partial (export exists, PR #71; no explicit schema version) |
| DATA-101 | CSV Transaction Export | planned |
| DATA-102 | Investment Export | partial (covered by general JSON export) |
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
| OPS-100 | System Health | partial (`financeStorageStatus()`) |
| OPS-101 | Database Health | existing (self-heal logic) |
| OPS-102 | Hermes Health | planned (not finance-specific) |
| OPS-103 | CSE Provider Health | partial (`priceFetchFailed` handling) |
| OPS-104 | FX Provider Health | planned |
| OPS-105 | Gmail Health | partial (connect-check exists) |
| OPS-106 | AI Provider Health | planned |
| OPS-107 | Backup Health | planned (backups exist, no in-app health surface) |
| OPS-108 | Background Job Monitoring | planned |
| OPS-109 | Error Reporting | partial (`safeErrorMessage` pattern) |
| OPS-110 | Integration Retry | partial (HARP fallback chains for AI; CSE fetch has no retry, just fail→manual) |

---

## Ready Now

Dependencies met, scope clear — this is informational status only, nothing here is queued for autonomous work:

- **PF-006** — Fix Fixed Deposit Rate Labelling (zero dependencies)
- **PF-007** — Improve Investment P/L Display (zero dependencies)
- **PF-009** — Standardize Money Formatting (zero dependencies)
- **PF-109** — Categories as a real entity (now that PF-104's unified view and budget-vs-actual both depend on the same free-text join — the next Phase 1 feature)

## Recommended Next Feature

**PF-109 — Categories.** `ExpenseRecord.category`/`BudgetCategory.category`/`IncomeRecord.incomeType` are all free text today, joined by exact string match (case- and whitespace-sensitive) between budgets and expenses. Now that `TransactionsPanel` (PF-104) is the single place users add/edit both kinds, promoting category to a real entity (with an ID, not just a string) would fix the fragile budget join and unlock PF-110 (Subcategories) and PF-111 (Merchant Registry) cleanly.

PF-006 and PF-007 remain independent zero-risk quick wins that can be done any time without touching Phase 1.

### Shipped: PF-100/101/102/103 — Account Model

- **What was built**: `openingBalance?`/`openingBalanceDate?` added to `FinanceAccount` (`src/server/finance-store.ts`) and the `personal_finance` Postgres mirror; a dedicated `AccountsPanel` (`src/screens/personal-finance/components/accounts-panel.tsx`) replacing the generic DataTable in the Accounts & Records tab — add/edit/delete, human-readable account-type labels, a per-currency total-balance line, and an opening-balance secondary line per account.
- **Known limitation**: `balance` is still a manually-maintained current figure, not derived from transactions — that's explicitly PF-104's job, not attempted here.
- **Not built** (deliberately deferred, not dropped): a separate `institutions` entity — the existing free-text `platform` field is reused for "which bank/broker" for now; worth revisiting once multiple accounts actually share an institution and dedup value emerges.

### Shipped: PF-104 — Unified Transaction Model (+ partial PF-105, PF-114)

- **What was built**: an additive read layer, not a storage migration — `getUnifiedTransactions()` (`src/server/finance-store.ts`) maps `income_records`/`expense_records` into one shared `UnifiedTransaction` shape (renaming `dateReceived`→`date`, `sourceName`→`vendor`-equivalent `counterparty`, `incomeType`→`category`, etc.) and sorts them together by date. `TransactionsPanel` (`src/screens/personal-finance/components/transactions-panel.tsx`) replaces the two separate, no-create `DataTable`s (income records in the Income & Jobs tab, expense records in Accounts & Records) with one panel: an income/expense toggle add-form, inline edit, delete, a counterparty/category search box, and a kind filter — all routed through the existing `add_record`/`update_record`/`delete_record` dispatch under the hood. `transactions` is now included in both `personalFinancePayload()` (GET) and `financePayload()` (the shape every mutation's POST response returns via `useFinanceAction`), matching how `budgetVsActual` is already present in both.
- **Known limitation / deliberate scope**: `income_records` and `expense_records` remain two separate collections in storage (JSON + both Postgres mirrors) — `financeSummary`, `budgetVsActual`, `getMonthlySummary`, and duplicate-detection are all untouched and still read the original collections directly. A real storage migration to one `transactions` table (PF-106 types, PF-107 transfers, PF-108 splits, PF-113 reconciliation status, PF-116 soft delete) was deliberately deferred as a separate, larger, higher-risk future feature rather than bundled into this slice.
- **Not built** (deliberately deferred, not dropped): transfers between the user's own accounts (no transfer concept exists anywhere in the codebase today — confirmed via full-file grep), a formal transaction-type enum, merchant/tag entities, and date-range/amount filters (only counterparty/category text search + kind filter shipped).
