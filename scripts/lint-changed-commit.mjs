/**
 * lint-changed-commit.mjs
 *
 * Lints the TypeScript/TSX files changed in the latest Git commit,
 * excluding known baseline strict-type debt (@typescript-eslint/no-unnecessary-condition).
 *
 * Usage: node scripts/lint-changed-commit.mjs
 *   Exit 0 = no new errors, Exit 1 = errors found
 *
 * This differs from `pnpm lint:changed` (which compares HEAD vs working tree)
 * by comparing HEAD~1 vs HEAD — only files the last commit actually touched.
 * Intended for auto-improvement cycle verification.
 */

import { execSync } from 'child_process';

function run(cmd, opts = {}) {
  return execSync(cmd, { encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'], ...opts });
}

try {
  // Get files changed in the latest commit, under src/
  const raw = run("git diff --name-only HEAD~1 HEAD -- 'src/**/*.ts' 'src/**/*.tsx'");
  const files = raw.split('\n').map(s => s.trim()).filter(Boolean);

  if (files.length === 0) {
    console.log('No src/ TypeScript/TSX files changed in the latest commit. Nothing to lint.');
    process.exit(0);
  }

  console.log(`Files to lint (${files.length}):`);
  files.forEach(f => console.log(`  ${f}`));
  console.log();

  // Run ESLint with baseline-rule overrides for known strict-type debt
  const eslintArgs = [
    'npx',
    'eslint',
    '-f', 'json',
    '--no-warn-ignored',
    '--rule', "'@typescript-eslint/no-unnecessary-condition: off'",
    ...files,
  ];

  const result = run(eslintArgs.join(' '));
  const reports = JSON.parse(result);

  let totalErrors = 0;
  let totalWarnings = 0;

  for (const report of reports) {
    const fileErrors = report.messages.filter(m => m.severity === 2).length;
    const fileWarnings = report.messages.filter(m => m.severity === 1).length;
    totalErrors += fileErrors;
    totalWarnings += fileWarnings;

    if (fileErrors > 0 || fileWarnings > 0) {
      console.log(`\n${report.filePath}: ${fileErrors} errors, ${fileWarnings} warnings`);
      for (const msg of report.messages) {
        const level = msg.severity === 2 ? 'error' : 'warning';
        console.log(`  ${msg.line}:${msg.column}  ${level}  ${msg.message}  (${msg.ruleId})`);
      }
    }
  }

  console.log(`\nTotal: ${totalErrors} errors, ${totalWarnings} warnings in ${reports.length} files`);

  process.exit(totalErrors > 0 ? 1 : 0);
} catch (err) {
  // If git command fails (e.g. only one commit), fall back to current HEAD
  if (err.message?.includes('HEAD~1')) {
    console.log('Repository has only one commit. Falling back to HEAD vs working tree.');
    try {
      const raw = run("git diff --name-only HEAD -- 'src/**/*.ts' 'src/**/*.tsx'");
      const files = raw.split('\n').map(s => s.trim()).filter(Boolean);
      if (files.length === 0) {
        console.log('No src/ TypeScript/TSX files changed. Nothing to lint.');
        process.exit(0);
      }
      console.log(`Files to lint (${files.length}):`);
      files.forEach(f => console.log(`  ${f}`));
      console.log();

      const eslintArgs = [
        'npx',
        'eslint',
        '-f', 'json',
        '--no-warn-ignored',
        '--rule', "'@typescript-eslint/no-unnecessary-condition: off'",
        ...files,
      ];

      const result = run(eslintArgs.join(' '));
      const reports = JSON.parse(result);

      let totalErrors = 0;
      let totalWarnings = 0;
      for (const report of reports) {
        totalErrors += report.messages.filter(m => m.severity === 2).length;
        totalWarnings += report.messages.filter(m => m.severity === 1).length;
      }
      console.log(`\nTotal: ${totalErrors} errors, ${totalWarnings} warnings in ${reports.length} files`);
      process.exit(totalErrors > 0 ? 1 : 0);
    } catch (fallbackErr) {
      console.error('Fallback also failed:', fallbackErr.message);
      process.exit(1);
    }
  }
  console.error('Unexpected error:', err.message);
  process.exit(1);
}