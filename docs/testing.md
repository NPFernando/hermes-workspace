# Workspace test runners

Use the runner that matches the suite:

- `pnpm test` runs the Vitest unit/component suite in a normal checkout.
- `npx vitest run` (or `./node_modules/.bin/vitest run`) runs the same suite
  without asking pnpm to reconcile dependencies. Use this form in the shared
  workspace checkout when `node_modules` is a symlink to the separately
  managed live checkout; pnpm intentionally refuses to remove that external
  target. Do not run `pnpm install` there. Use a clean checkout for install and
  lockfile validation.
- `pnpm test:collection` checks that dedicated suites have not entered the
  default Vitest collection.
- `pnpm check:task-api-guards` checks that task routes parsing JSON retain the
  shared CSRF content-type guard.
- `pnpm check:json-api-guards` checks that every API route parsing JSON has the
  shared content-type guard or an explicit Dify-specific equivalent.
- `pnpm check:mutation-api-auth` checks that mutating API route files expose an
  explicit authentication marker, including the shared legacy config handler.
- `pnpm exec playwright test e2e` runs browser end-to-end specs.
- `pnpm exec playwright test e2e/<spec>.ts` runs one browser spec.
- `cd services/odysseus && npm test` runs the Odysseus TAP tests when that
  service's dependencies are installed.

The Vitest configuration excludes `e2e/**` and
`services/odysseus/tests/**/*.mjs`. Keep those exclusions and the collection
check together when adding a new dedicated test suite.

## Focused lint

Use `pnpm lint:changed` for an incremental lint pass over tracked and untracked
changed source files. It keeps the repository-wide baseline exceptions for
`@typescript-eslint/no-unnecessary-condition` and `no-control-regex` explicit;
all other ESLint rules remain enabled. Pass file paths to limit the check to a
specific slice, for example:

```sh
node scripts/lint-changed.mjs src/screens/tasks/tasks-screen.tsx
```

Use `pnpm lint` for the complete repository lint gate.
