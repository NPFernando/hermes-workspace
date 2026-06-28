-- Hermes Finance Management, Investment Monitoring, and Controlled Trading schema
-- Runtime MVP stores data in ~/.hermes/finance/finance.json; this SQL schema documents
-- the durable relational shape for the production database migration.

CREATE TABLE IF NOT EXISTS finance_accounts (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  type TEXT NOT NULL,
  currency TEXT NOT NULL,
  balance REAL NOT NULL DEFAULT 0,
  masked_identifier TEXT,
  platform TEXT,
  source TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS income_records (
  id TEXT PRIMARY KEY,
  date_received TEXT NOT NULL,
  source_name TEXT NOT NULL,
  income_type TEXT NOT NULL,
  original_currency TEXT NOT NULL,
  original_amount REAL NOT NULL,
  exchange_rate_used REAL NOT NULL DEFAULT 1,
  converted_lkr_amount REAL NOT NULL,
  account_id TEXT REFERENCES finance_accounts(id),
  taxable INTEGER NOT NULL DEFAULT 1,
  notes TEXT,
  document_ref TEXT,
  source TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS expense_records (
  id TEXT PRIMARY KEY,
  date TEXT NOT NULL,
  vendor TEXT NOT NULL,
  category TEXT NOT NULL,
  subcategory TEXT,
  account_id TEXT REFERENCES finance_accounts(id),
  currency TEXT NOT NULL,
  amount REAL NOT NULL,
  converted_lkr_amount REAL NOT NULL,
  recurring INTEGER NOT NULL DEFAULT 0,
  work_related INTEGER NOT NULL DEFAULT 0,
  tax_deductible_possible INTEGER NOT NULL DEFAULT 0,
  notes TEXT,
  document_ref TEXT,
  source TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS budget_categories (
  id TEXT PRIMARY KEY,
  month TEXT NOT NULL,
  category TEXT NOT NULL,
  currency TEXT NOT NULL,
  budget_amount REAL NOT NULL,
  source TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS savings_goals (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  target_amount REAL NOT NULL,
  current_amount REAL NOT NULL DEFAULT 0,
  currency TEXT NOT NULL,
  target_date TEXT,
  monthly_contribution REAL NOT NULL DEFAULT 0,
  priority INTEGER NOT NULL DEFAULT 3,
  progress_percentage REAL GENERATED ALWAYS AS (CASE WHEN target_amount > 0 THEN current_amount * 100.0 / target_amount ELSE 0 END) VIRTUAL,
  linked_account_id TEXT REFERENCES finance_accounts(id),
  status TEXT NOT NULL,
  source TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS tax_records (
  id TEXT PRIMARY KEY,
  tax_year TEXT NOT NULL,
  income_type TEXT NOT NULL,
  amount REAL NOT NULL,
  currency TEXT NOT NULL,
  converted_lkr_amount REAL NOT NULL,
  exchange_rate_source TEXT NOT NULL,
  deduction_category TEXT,
  estimated_taxable_amount REAL NOT NULL DEFAULT 0,
  tax_paid REAL NOT NULL DEFAULT 0,
  tax_due REAL NOT NULL DEFAULT 0,
  requires_confirmation INTEGER NOT NULL DEFAULT 1,
  notes TEXT,
  supporting_document TEXT,
  source TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS exchange_rates (id TEXT PRIMARY KEY, base_currency TEXT NOT NULL, quote_currency TEXT NOT NULL, rate REAL NOT NULL, source TEXT NOT NULL, observed_at TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS investment_accounts (id TEXT PRIMARY KEY, platform TEXT NOT NULL, name TEXT NOT NULL, currency TEXT NOT NULL, masked_identifier TEXT, source TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS trading_platforms (id TEXT PRIMARY KEY, name TEXT NOT NULL, mode TEXT NOT NULL, live_enabled INTEGER NOT NULL DEFAULT 0, source TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS api_connections (id TEXT PRIMARY KEY, platform TEXT NOT NULL, permission_scope TEXT NOT NULL, key_reference TEXT NOT NULL, withdrawals_enabled INTEGER NOT NULL DEFAULT 0, trading_enabled INTEGER NOT NULL DEFAULT 0, source TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS assets (id TEXT PRIMARY KEY, platform TEXT NOT NULL, symbol TEXT NOT NULL, asset_type TEXT NOT NULL, exchange TEXT, currency TEXT NOT NULL, verified INTEGER NOT NULL DEFAULT 0, blocked_reason TEXT, source TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS market_prices (id TEXT PRIMARY KEY, platform TEXT NOT NULL, symbol TEXT NOT NULL, price REAL NOT NULL, bid REAL, ask REAL, spread REAL, volume REAL, currency TEXT NOT NULL, observed_at TEXT NOT NULL, source TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS historical_candles (id TEXT PRIMARY KEY, platform TEXT NOT NULL, symbol TEXT NOT NULL, interval TEXT NOT NULL, open REAL NOT NULL, high REAL NOT NULL, low REAL NOT NULL, close REAL NOT NULL, volume REAL NOT NULL, opened_at TEXT NOT NULL, closed_at TEXT NOT NULL, source TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS news_items (id TEXT PRIMARY KEY, source_name TEXT NOT NULL, source_url TEXT NOT NULL, publish_date TEXT, related_symbol TEXT NOT NULL, summary TEXT NOT NULL, sentiment TEXT NOT NULL, risk_impact TEXT NOT NULL, confidence_score REAL NOT NULL, changed_decision INTEGER NOT NULL DEFAULT 0, source TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS sentiment_scores (id TEXT PRIMARY KEY, related_symbol TEXT NOT NULL, score REAL NOT NULL, label TEXT NOT NULL, input_refs TEXT NOT NULL, source TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS risk_scores (id TEXT PRIMARY KEY, platform TEXT NOT NULL, symbol TEXT NOT NULL, risk_level TEXT NOT NULL, risk_score REAL NOT NULL, confidence_score REAL NOT NULL, blockers TEXT NOT NULL, inputs_json TEXT NOT NULL, source TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS trading_plans (id TEXT PRIMARY KEY, platform TEXT NOT NULL, symbol TEXT NOT NULL, asset_type TEXT NOT NULL, decision TEXT NOT NULL, reason TEXT NOT NULL, risk_level TEXT NOT NULL, risk_score REAL NOT NULL, confidence_score REAL NOT NULL, suggested_entry_price REAL, suggested_exit_price REAL, stop_loss REAL, take_profit REAL, position_size REAL, expected_holding_period TEXT, maximum_acceptable_loss REAL, data_used TEXT NOT NULL, news_reviewed TEXT NOT NULL, expected_outcome TEXT, alternative_option TEXT, final_recommendation TEXT NOT NULL, status TEXT NOT NULL, user_approval_status TEXT NOT NULL, execution_status TEXT NOT NULL, actual_outcome TEXT, profit_loss REAL, strategy_used TEXT, agent_notes TEXT, source TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS trade_orders (id TEXT PRIMARY KEY, plan_id TEXT REFERENCES trading_plans(id), platform TEXT NOT NULL, symbol TEXT NOT NULL, side TEXT NOT NULL, quantity REAL NOT NULL, order_type TEXT NOT NULL, status TEXT NOT NULL, broker_order_id TEXT, source TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS trade_executions (id TEXT PRIMARY KEY, order_id TEXT REFERENCES trade_orders(id), platform TEXT NOT NULL, symbol TEXT NOT NULL, side TEXT NOT NULL, quantity REAL NOT NULL, price REAL NOT NULL, fees REAL NOT NULL DEFAULT 0, executed_at TEXT NOT NULL, source TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS portfolio_positions (id TEXT PRIMARY KEY, platform TEXT NOT NULL, symbol TEXT NOT NULL, asset_type TEXT NOT NULL, quantity REAL NOT NULL, average_cost REAL NOT NULL, market_value REAL NOT NULL, unrealized_pnl REAL NOT NULL, source TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS account_balances (id TEXT PRIMARY KEY, account_id TEXT NOT NULL, currency TEXT NOT NULL, cash_balance REAL NOT NULL, buying_power REAL, source TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS strategy_results (id TEXT PRIMARY KEY, strategy_id TEXT NOT NULL, win_rate REAL, loss_rate REAL, average_profit REAL, average_loss REAL, profit_factor REAL, max_drawdown REAL, confidence REAL, disabled INTEGER NOT NULL DEFAULT 0, source TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS prediction_results (id TEXT PRIMARY KEY, plan_id TEXT, symbol TEXT NOT NULL, prediction TEXT NOT NULL, actual_result TEXT, accuracy REAL, source TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS agent_memory (id TEXT PRIMARY KEY, memory_type TEXT NOT NULL, related_ref TEXT, summary TEXT NOT NULL, metrics_json TEXT, source TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS audit_logs (id TEXT PRIMARY KEY, action TEXT NOT NULL, actor TEXT NOT NULL, details_json TEXT NOT NULL, source TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS error_logs (id TEXT PRIMARY KEY, component TEXT NOT NULL, error_code TEXT, message TEXT NOT NULL, details_json TEXT, source TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
