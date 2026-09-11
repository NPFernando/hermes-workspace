# Operational readiness notes

## Finance

Personal Finance is Postgres-primary. The JSON file remains a safety net, not a
second independently maintained source of truth. Research refresh and paper
decision actions are read/research workflows and must not replace the full
dashboard payload or enable execution. A new institutions/branches entity is
intentionally deferred; continue using the existing account `platform` field
until that feature is explicitly designed and requested.

## Security

- Keep secrets server-side and redact diagnostics.
- For privacy-sensitive finance deployments, set `FINANCE_AI_LOCAL_ONLY=1` to
  keep finance prompts and document images on discovered local providers. When
  enabled, verify a local model is available; the application intentionally
  fails closed rather than falling back to a cloud provider.
- Require explicit human approval for execution-capable actions.
- Treat CodeQL, Gitleaks, and high-severity dependency findings as release
  blockers until reviewed.
- Re-run the security audit after changes to auth, file access, memory, proxy,
  terminal, or finance APIs.
- Keep `pnpm run lint:critical` clean for finance and authentication paths;
  broader legacy lint cleanup is tracked separately from release gating.

## Observability

The release smoke check validates the application health route and can validate
the personal-finance storage health payload. Runtime verification must also
confirm the process PID/start time and the Hermes/Odysseus companion health
endpoints; an install or build alone is not evidence that the live process was
replaced.

`pnpm run verify:live` performs those read-only checks on the deployment host.
When the active process is serving an older artifact, the verification failure
includes the expected local build fingerprint and the active systemd unit and
exec command to make the deployment gap diagnosable without restarting the
service.

To compare the active systemd unit with the checked-in template without
changing service state, run `pnpm run check:service-drift`. A mismatch is
reported as a warning because host-specific runtime paths and deliberate
drop-ins may be valid; review the displayed working directory, command, and
drop-in list before copying a unit or restarting production.

Finance scheduler readiness is separate from scheduler activation:
`bash scripts/install-finance-schedulers.sh --check-live` verifies the live
checkout has the referenced entrypoints and, when present, that
`.env.finance-scheduler` is private. Use `--install` and `--enable` only as
separate, explicitly reviewed operator actions.

## Accessibility and responsive QA

Every release should verify keyboard access, visible focus, semantic names,
live-region announcements for asynchronous status, reduced-motion behavior, and
usable layouts at desktop, tablet, and narrow mobile widths. Automated tests are
useful but do not replace an authenticated browser pass through the main flows.
