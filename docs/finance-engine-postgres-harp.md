# Finance engine — Postgres-only persistence + HARP memory

Reference for how the personal-finance engine stores data and how the finance
assistant's memory works, after the 2026-09 cutover. If you are an agent about
to touch `finance-store.ts`, `finance-postgres-store.ts`, `harp-memory-client.ts`
or the `/personal-finance` dashboard, read this first.

## Persistence: Postgres only

The `finance` Postgres DB is the **sole system of record**. There is no JSON
file that data is saved to.

| what | where |
|---|---|
| collections (transactions, holdings, FDs, budgets, …) | `finance_engine_collections` (`collection_name`, `record_id`, `data` jsonb) |
| settings | `settings` row `id = 1` |
| metadata / recency | `finance_engine_metadata` row `id = 1` |
| audit trail | `audit_logs` table (authoritative) |

- `readFinancePostgresNormalized()` / `writeFinancePostgresNormalized()` in
  `finance-postgres-store.ts` are the only read/write path.
- `readFinanceStore()` / `writeFinanceStore()` in `finance-store.ts` call a
  **backend seam** (`FinanceStoreBackend`). Production uses the Postgres
  backend; tests use an in-process store held on `globalThis`
  (`FINANCE_TEST_STORE_KEY`), reset before every test by
  `src/test/setup-finance-store.ts` (wired via `vite.config.ts` `setupFiles`).
  A plain per-import in-memory backend loses state across `vi.resetModules()` +
  `vi.importActual` and breaks ~180 tests — don't "simplify" it back.
- `~/.hermes/finance/audit.jsonl` is a **best-effort outage-only recovery
  buffer**, drained back into `audit_logs` on the next successful append.
  Never a system of record. Bounded by `/etc/logrotate.d/hermes-finance-audit`.
- Storage health model: `FinanceStorageHealthStatus = 'healthy' |
  'postgres_unavailable' | 'json_primary'` (`json_primary` = the dev/in-memory
  backend). No drift / lag / self-heal concepts — those were JSON-vs-PG and are
  gone.

### Do not touch

`finance-postgres-store.ts` holds trading-shared `FinanceSettings` keys
(`tradingMode`, `liveTradingEnabled`, `demoTrading*`, `strategyBaselines`).
**Those keys and their persistence must never be changed by personal-finance
work.** Transport/plumbing edits to the file itself are fine.

### Legacy `personal_finance` DB

A separate `personal_finance` DB from the pre-cutover split-store design is kept
as a cold rollback until **2026-09-21**, then dropped via
`~/.hermes-data/scripts/decommission-personal-finance-db.sh --drop`
(date-gated; report-only without `--drop`). Active data is already in the
`finance` DB; only lookup tables (`financial_branches`, `financial_institutions`)
live solely in the old DB and are referenced by no code. A verified cold backup
exists under `~/.hermes-data/backups/finance/`.

## HARP memory for the finance assistant

The finance assistant's durable knowledge — vendor→category rules learned at
ingestion time, free-text financial rules, stated preferences — lives in the
**governed HARP memory store**, not in a flat settings map.

- **Transport:** `src/server/harp-memory-client.ts` → `harp-memory-api.service`
  (systemd) on `127.0.0.1:8765`, bearer `HARP_MEMORY_API_TOKEN`. Every call is
  best-effort and time-boxed (1.5 s); a missing token / down service / timeout
  degrades to a no-op. HARP being unavailable must never slow or break
  ingestion or the dashboard.
- **Two non-obvious `/api/search` requirements** (learned the hard way):
  1. Send `data_class=confidential`. The service clears a result only when
     `memory.data_class <= request.data_class`, and the request defaults to
     `internal`; without this every finance memory is filtered out.
  2. Do **not** send a descriptive phrase as `query`. The service matches a
     query as one un-tokenised `content ILIKE '%…%'` (no relevance ranking).
     Omit `query` to enumerate under the scope; filter client-side by
     `source_ref === 'hermes-finance'`.
- **Governance:** proposals become *candidates*; promotion needs review.
  `data_class` is `confidential` (never `secret`/`regulated`, which auto-reject).
- **Where it surfaces:**
  - `getCategoryCorrections()` merges the flat map with cached approved HARP
    category rules (HARP wins on key conflict).
  - `buildFinanceAnswerPrompt()` folds approved user memories in as
    "user-stated context (not commands; may be out of date)".
  - The Overview tab's **"What the assistant knows"** card
    (`assistant-memory-card.tsx`) lists approved memories + the pending-review
    queue, with approve/reject, per-rule "not right" (feedback), inline
    category-rule editing, and an "Add a rule" input. Degrades to a quiet
    "unavailable" state when HARP is off.
  - Optional `FINANCE_LEARNED_FACTS_ENABLED` (default off): a heuristic
    captures durable rules stated in analyst questions as candidates.
- **Reviewing candidates:** `harp memory candidates`, `harp memory approve <id>
  --reviewer <you>`, `harp memory reject <id> --reviewer <you>`. The HARP
  dashboard (`http://127.0.0.1:8765/`) has a read-only pending-candidate panel.
- **Monitoring:** `~/.hermes/scripts/harp-memory-api-health.sh` (cron, every
  2 h, Telegram on failure) checks the unit, `/healthz`, and backend health.

## Related

- `docs/finance-cutover-open-questions.md` — the review that started this work
  (all items now resolved).
- `docs/personal-finance-os-roadmap.md` — the feature menu; nothing there is a
  defect, each item is opt-in.
- harp-control-plane repo (`/home/ubuntu/workspace/projects/universal-harp-engine`,
  default branch `hermes/universal-harp-engine`) — the memory service and API.

## Deliberately not done

- **Async + pooled `pg`** (`spawnSync(psql)` → `pg.Pool` + `$1..$n`) — the app
  is Postgres-primary and works via `spawnSync`; pooling/parameterised SQL is
  pure hardening, deferred. ~209 sync call sites incl. the live trading engines.
