# Implementation Plan: Turn Focused Lint Fallback into a Package Script

## Summary
Add a `lint:changed` package script that runs ESLint only on changed source files with `--no-warn-ignored`, making auto-improvement verification repeatable and less ad-hoc. Also add a corresponding `lint:changed-strict` variant without rule overrides to document baseline debt separately.

## Files to modify
- `package.json` — add `lint:changed` and `lint:changed-strict` scripts
- (No new source files — this is a config-only change)

## Step-by-step implementation
1. Open `package.json`
2. Add a `lint:changed` script:
   ```json
   "lint:changed": "bash -c 'FILES=$(git diff --name-only HEAD -- \"*.ts\" \"*.tsx\" \"*.js\" \"*.mjs\" \"*.cjs\" 2>/dev/null | grep -v \"node_modules/\" | tr \"\\n\" \" \"); [ -z \"$FILES\" ] && echo \"No changed source files to lint\" || npx eslint --no-warn-ignored -f json $FILES'"
   ```
3. Add a `lint:changed-strict` (strict, without `--no-warn-ignored`):
   ```json
   "lint:changed-strict": "bash -c 'FILES=$(git diff --name-only HEAD -- \"*.ts\" \"*.tsx\" \"*.js\" \"*.mjs\" \"*.cjs\" 2>/dev/null | grep -v \"node_modules/\" | tr \"\\n\" \" \"); [ -z \"$FILES\" ] && echo \"No changed source files to lint\" || npx eslint -f json $FILES'"
   ```

## Verification
1. Run `pnpm lint:changed` and confirm it runs ESLint on changed files only
2. Run `pnpm lint:changed-strict` and confirm the full (stricter) lint result

## Test cases
- No changed files → prints "No changed source files to lint" and exits 0
- Changed source files present → runs ESLint on only those files
- Non-source changed files (json, md, yaml) → excluded, still prints "No changed source files to lint"

## Rollback
Revert the two script lines in `package.json` to remove `lint:changed` and `lint:changed-strict`.