# Plan: Systematic Root Scratch Artifact Cleanup with .gitignore Rules

**Cycle**: 2026-07-03-1830
**Category**: config
**Effort**: low
**Selected from**: IDEAS.json entry "Systematic root scratch artifact cleanup with .gitignore rules"

## Summary

The workspace root and docs/ directory contain 42+ untracked scratch, prototype, and design files that pollute `git status`, risk accidental check-in, and can cause TypeScript/test collection false positives. This plan archives them to an external report directory and adds .gitignore rules to prevent recurrence.

## Files to Modify

1. **`/home/ubuntu/hermes-workspace/.gitignore`** — add patterns for known scratch suffixes
2. **Archive destination**: `/srv/projects/auto-improvement-reports/scratch-2026-07-03/`

## Files to Archive (move out of workspace)

### Root-level scratch files (definitely archive):
- TASK_SUMMARY.md
- TASK_VERIFICATION.md
- TRADING_ALERT_SYSTEM_DESIGN.md
- WORK_SUMMARY.txt
- ebbinghaus_model.md
- investment_platforms_market_data_requirements.md
- docs/ (entire directory: PERSONAL_FINANCE_REQUIREMENTS.md, RISK_MODEL_DESIGN.md, adaptive_memory_decay_design.md, agent_learning_mechanism_design.md, trading-report-system/, trading-system-security/)
- market_data_spec/ (entire directory)
- news_intelligence_* (news_intelligence_architecture.mmd, news_intelligence_pipeline.md, news_intelligence_spec.md)
- risk_model_prototype/ (entire directory)

### Root scratch test files (definitely archive):
- test-finance-operations.js
- test-ibkr.ts
- test-paper-trading-cycle.cjs
- test-paper-trading-cycle.test.ts
- testCurrencyConversion.test.ts

### Stale source backups (definitely archive):
- src/routes/api/vt-capital.ts.backup
- src/routes/api/vt-capital.ts.backup2
- src/routes/api/vt-capital.ts.bak
- src/server/ibkr-market.service.ts.backup

### Source files to KEEP in place (intentional WIP):
- src/lib/ops-snapshot-regression.ts
- src/routes/api/native-cron-overview.ts
- src/routes/api/native-dashboard-capabilities.ts
- src/routes/api/ops-logs.ts
- src/routes/api/ops-snapshot.ts
- src/routes/api/ops-snapshots.ts
- src/routes/api/sister-readiness.ts
- src/routes/api/system-health.ts
- src/routes/logs.tsx
- src/routes/snapshots.tsx
- src/server/binance-market.service.ts
- src/server/ibkr-market.service.ts
- src/server/native-cron-overview.ts
- src/server/native-dashboard-capabilities.ts
- src/server/performance.ts

Also: remove the deleted `testCurrencyConversion.ts` from git tracking (it's already deleted in the working tree, just needs the deletion committed or the file restored and then gitignored).

## Steps

### Step 1: Create archive directory and move scratch files
```bash
ARCHIVE=/srv/projects/auto-improvement-reports/scratch-2026-07-03
mkdir -p "$ARCHIVE"/{docs,src/routes/api,src/server}

# Root scratch
mv ~/hermes-workspace/TASK_SUMMARY.md "$ARCHIVE/"
mv ~/hermes-workspace/TASK_VERIFICATION.md "$ARCHIVE/"
mv ~/hermes-workspace/TRADING_ALERT_SYSTEM_DESIGN.md "$ARCHIVE/"
mv ~/hermes-workspace/WORK_SUMMARY.txt "$ARCHIVE/"
mv ~/hermes-workspace/ebbinghaus_model.md "$ARCHIVE/"
mv ~/hermes-workspace/investment_platforms_market_data_requirements.md "$ARCHIVE/"

# docs/
mv ~/hermes-workspace/docs/* "$ARCHIVE/docs/"

# Design/spec dirs
mv ~/hermes-workspace/market_data_spec "$ARCHIVE/"
mv ~/hermes-workspace/risk_model_prototype "$ARCHIVE/"

# News intelligence
mv ~/hermes-workspace/news_intelligence_* "$ARCHIVE/"

# Scratch tests
mv ~/hermes-workspace/test-finance-operations.js "$ARCHIVE/"
mv ~/hermes-workspace/test-ibkr.ts "$ARCHIVE/"
mv ~/hermes-workspace/test-paper-trading-cycle.cjs "$ARCHIVE/"
mv ~/hermes-workspace/test-paper-trading-cycle.test.ts "$ARCHIVE/"
mv ~/hermes-workspace/testCurrencyConversion.test.ts "$ARCHIVE/"

# Stale backups
mv ~/hermes-workspace/src/routes/api/vt-capital.ts.backup "$ARCHIVE/src/routes/api/"
mv ~/hermes-workspace/src/routes/api/vt-capital.ts.backup2 "$ARCHIVE/src/routes/api/"
mv ~/hermes-workspace/src/routes/api/vt-capital.ts.bak "$ARCHIVE/src/routes/api/"
mv ~/hermes-workspace/src/server/ibkr-market.service.ts.backup "$ARCHIVE/src/server/"
```

### Step 2: Add .gitignore patterns
Edit `/home/ubuntu/hermes-workspace/.gitignore` to add:
```
# Scratch/prototype artifacts (auto-improvement cycle 2026-07-03)
TASK_SUMMARY.md
TASK_VERIFICATION.md
TRADING_ALERT_SYSTEM_DESIGN.md
WORK_SUMMARY.txt
ebbinghaus_model.md
investment_platforms_market_data_requirements.md
market_data_spec/
risk_model_prototype/
news_intelligence_*
docs/PERSONAL_FINANCE_REQUIREMENTS.md
docs/RISK_MODEL_DESIGN.md
docs/adaptive_memory_decay_design.md
docs/agent_learning_mechanism_design.md
docs/trading-report-system/
docs/trading-system-security/
test-finance-operations.js
test-ibkr.ts
test-paper-trading-cycle.*
testCurrencyConversion*
*.backup
*.bak
```

### Step 3: Stage and commit
```bash
cd ~/hermes-workspace
git add .gitignore
# Remove deleted file from tracking
git rm --cached testCurrencyConversion.ts 2>/dev/null || true
git commit -m "auto-improve: systematic root scratch artifact cleanup with .gitignore rules"
```

### Step 4: Verify
- `git status --short` should show significantly fewer untracked files
- `cd ~/hermes-workspace && npx tsc --noEmit` should pass (check that no remaining WIP src/ files break it)
- Archive directory should contain all moved files

## Verification

1. Check scratch count before and after: `git status --porcelain | grep '^??' | wc -l`
2. TypeScript compile: `cd ~/hermes-workspace && npx tsc --noEmit`
3. Archive integrity: `ls -la /srv/projects/auto-improvement-reports/scratch-2026-07-03/`
4. Git status: `cd ~/hermes-workspace && git status --short`