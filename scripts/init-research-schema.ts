/**
 * Idempotently creates the `research` schema and its tables in the `finance`
 * Postgres database. Deliberately a separate schema, not new tables in
 * `public` — Codex's finance-store migration owns `public` and is actively
 * changing (2 pre-existing tsc errors elsewhere in this repo are literally
 * in that migration); a separate schema means zero collision risk.
 *
 * Usage: pnpm exec tsx scripts/init-research-schema.ts
 */
import * as path from 'node:path'
import { Pool } from 'pg'

// CLI scripts don't get .env auto-loaded (only the running app does) — load
// it explicitly. Node 20.6+ native API, no new dependency. Assumes the
// script is run from the repo root (pnpm exec tsx scripts/...), same
// assumption every other script here already makes for relative paths.
process.loadEnvFile(path.join(process.cwd(), '.env'))

const DDL = `
CREATE SCHEMA IF NOT EXISTS research;

CREATE TABLE IF NOT EXISTS research.research_runs (
  id BIGSERIAL PRIMARY KEY,
  engine TEXT NOT NULL,
  run_type TEXT NOT NULL,
  config JSONB NOT NULL,
  result JSONB NOT NULL,
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_research_runs_engine
  ON research.research_runs (engine, created_at DESC);

CREATE TABLE IF NOT EXISTS research.parameter_changes (
  id BIGSERIAL PRIMARY KEY,
  engine TEXT NOT NULL,
  param_name TEXT NOT NULL,
  old_value JSONB,
  new_value JSONB,
  reason TEXT NOT NULL,
  evidence JSONB,
  applied_by TEXT NOT NULL,
  risk_direction TEXT NOT NULL,
  applied BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_parameter_changes_engine
  ON research.parameter_changes (engine, created_at DESC);

CREATE TABLE IF NOT EXISTS research.strategy_formula_versions (
  id BIGSERIAL PRIMARY KEY,
  engine TEXT NOT NULL,
  strategy_id TEXT,
  version_label TEXT NOT NULL,
  description TEXT NOT NULL,
  evidence JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_formula_versions_engine
  ON research.strategy_formula_versions (engine, created_at DESC);

CREATE TABLE IF NOT EXISTS research.llm_decisions (
  id BIGSERIAL PRIMARY KEY,
  symbol TEXT NOT NULL,
  context_summary JSONB NOT NULL,
  model TEXT NOT NULL,
  raw_response TEXT,
  decision TEXT NOT NULL,
  confidence DOUBLE PRECISION,
  applied BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_llm_decisions_symbol
  ON research.llm_decisions (symbol, created_at DESC);
`

async function main() {
  const connectionString = process.env.RESEARCH_DATABASE_URL
  if (!connectionString) {
    throw new Error('RESEARCH_DATABASE_URL not set in .env')
  }
  const pool = new Pool({ connectionString })
  try {
    await pool.query(DDL)
    const { rows } = await pool.query<{ table_name: string }>(
      `SELECT table_name FROM information_schema.tables WHERE table_schema = 'research' ORDER BY table_name`,
    )
    console.log('research schema ready. Tables:')
    for (const r of rows) console.log(' -', r.table_name)
  } finally {
    await pool.end()
  }
}

main().catch((err) => {
  console.error('init-research-schema failed:', err)
  process.exit(1)
})
