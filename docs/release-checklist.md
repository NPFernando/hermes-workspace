# Release checklist

Use this checklist for a production deployment. A green build is necessary but
does not prove that the live process was replaced.

## Before merge

- `pnpm install --frozen-lockfile`
- `pnpm run typecheck`
- `pnpm run lint`
- `pnpm test` (in a clean checkout; use `npx vitest run` in the shared
  workspace checkout when its `node_modules` points at the live checkout)
- `pnpm build`
- `pnpm audit --prod --audit-level high` (must report no known vulnerabilities)
- Confirm the build reports the initial JS/CSS bundle budget without an
  unreviewed threshold increase.
- Review CodeQL, Gitleaks, and dependency-audit results.
- Keep `pnpm-lock.yaml` and the explicit security overrides in
  `pnpm-workspace.yaml` under review when resolving audit findings; do not
  bypass lockfile or package freshness policy with generated exceptions.
- For encrypted finance retention, provision a dedicated passphrase file with
  mode `0600`, set `FINANCE_BACKUP_PASSPHRASE_FILE`, and run
  `pnpm run finance:backup:encrypted`; verify the reported backup path and
  retention count without ever logging or committing the passphrase.
- Restore only from a verified encrypted backup with an explicit operator
  confirmation: `pnpm run finance:restore:encrypted -- --file /path/backup.enc.json --confirm`.
  The command creates a fresh encrypted pre-restore safety backup first,
  refuses future schema versions, writes through the Postgres-primary store,
  and preserves the existing append-only audit stream.
- Confirm finance changes preserve Postgres-primary reads and the JSON safety net.
- If `FINANCE_AI_LOCAL_ONLY=1` is enabled, verify the configured local provider
  is reachable and review logs for `local_provider_unavailable`; do not treat a
  cloud-provider fallback as an acceptable recovery path.
- Confirm no live-trading or execution behavior was enabled by the change.

## After deployment

```bash
node scripts/release-smoke.mjs http://127.0.0.1:3000
RELEASE_SMOKE_FINANCE=1 node scripts/release-smoke.mjs http://127.0.0.1:3000
# Optional stale-process check after recording the expected build fingerprint:
# RELEASE_SMOKE_EXPECTED_BUILD=92cab793587af9ed node scripts/release-smoke.mjs http://127.0.0.1:3000
curl --fail http://127.0.0.1:8642/health
curl --fail http://127.0.0.1:7100/api/health
```

- Check the systemd service has a new start time and healthy PID.
- If using `scripts/start-stable.sh`, treat its success message as valid only
  after its built-in release smoke passes; it now refuses to report a service
  healthy when security headers or the build fingerprint are missing.
- The same smoke also checks `/dashboard` has no legacy splash timers or visible
  splash marker, catching stale artifacts that render both legacy splash logic
  and WorkspaceShell.
- Treat a successful health response with an unchanged service PID as a failed
  deployment, not as evidence that the replacement is live.
- Open the application in an authenticated browser session.
- Exercise finance overview, alert settings, research refresh, and paper
  decision recording.
- Exercise chat queue add/list/clear/resume and verify FIFO draining.
- Check desktop and narrow/mobile layouts at 1280px, 768px, and 390px.
- Run `pnpm run smoke:browser http://127.0.0.1:3000` for unauthenticated
  responsive smoke coverage. Complete the authenticated product-flow pass
  separately when credentials are available.
- When credentials are available, run `pnpm run smoke:queue:browser` to verify
  `/queue` submission while a response is active and safe recovery when it is
  stopped. The smoke intercepts the stream, so no prompt reaches the agent.
- On the production host, run `pnpm run verify:live` and confirm the reported
  service PID/start time is the replacement process.
- If `verify:live` reports missing security headers or `x-workspace-build`,
  treat the result as a stale-runtime failure. The command prints the local
  expected build and active systemd unit/exec details; inspect those before
  considering any restart or deployment action.
- If finance scheduler units are planned for this deployment, run
  `bash scripts/install-finance-schedulers.sh --check-live` before installing
  them. This must pass before `--install`; `--enable` remains a separate
  explicit operator action. If `.env.finance-scheduler` exists, the check also
  requires it to be a private regular file with no group/other permissions;
  the check never prints its contents.
- Check keyboard-only navigation, visible focus, dialog focus return, and
  screen-reader names for controls.
- Review logs for startup errors, auth failures, storage errors, and unexpected
  sensitive values before declaring the deployment complete.

## Rollback trigger

Roll back if health fails, the deployed PID does not change, Postgres reads are
unhealthy, sensitive data appears in logs, or any execution gate changes state
without an explicit operator action.
