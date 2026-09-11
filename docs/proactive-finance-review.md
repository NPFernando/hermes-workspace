# Proactive finance review scheduler

AI-205 now has an opt-in, review-only queue. The Personal Finance Overview
toggle persists the policy; the **Queue review task** action creates one
`awaiting_approval` Finance Manager task per UTC day. It never mutates a
financial record or places a trade.

The repository entrypoint is:

```sh
FINANCE_BASE_URL=http://127.0.0.1:3000 \
  ./scripts/proactive-finance-review.sh
```

It is safe to run from a host scheduler. A disabled policy or an existing
same-day task returns successfully as a no-op. The script requests a
scheduler-safe acknowledgement and logs only status metadata under
`~/.hermes/finance/proactive-review-logs/` by default. When
password protection is enabled, provide a least-lived session cookie through
the scheduler's protected environment rather than putting credentials on the
command line:

```sh
FINANCE_BASE_URL=http://127.0.0.1:3000 \
FINANCE_SESSION_COOKIE='claude-auth=<session-token>' \
  ./scripts/proactive-finance-review.sh
```

The same `FINANCE_SESSION_COOKIE` option is supported by
`scripts/daily-finance-check.sh`.

Register it with the deployment's existing Hermes cron/systemd mechanism only
after the service URL and local-auth boundary are verified. Registration is
intentionally deployment-specific and is not performed by the build.

Before installing units, verify both the templates and the currently deployed
checkout without changing systemd state:

```sh
./scripts/install-finance-schedulers.sh --check-live
```

This command exits non-zero when the live checkout is missing any referenced
runtime script. Use `--install` only after that check passes; `--enable` remains
the separate, explicit activation step.

For the monthly read-only report, use the companion entrypoint:

```sh
FINANCE_BASE_URL=http://127.0.0.1:3000 \
  ./scripts/monthly-finance-report.sh
```

It writes to `~/.hermes/finance/monthly-reports/` by default. Set
`FINANCE_REPORT_MONTH=YYYY-MM` for a specific month and
`FINANCE_SESSION_COOKIE` when password protection is enabled.
