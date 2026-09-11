# Deploy infrastructure

This directory versions the systemd units that run in production, since
they otherwise only exist as ad-hoc files on the VM with no history.

- `systemd/hermes-workspace.service` — the live service (port 3000). Runs
  out of `/home/ubuntu/hermes-workspace-live`, a clean checkout of `main`
  kept separate from whatever dev tree is being hand-edited elsewhere. See
  `scripts/deploy.sh`'s header comment for why this split exists.
- `systemd/hermes-workspace-deploy.service` + `.timer` — polls
`origin/main` every 5 minutes and runs `scripts/deploy.sh
--quiet-if-unchanged`, which no-ops unless there's actually a new commit.
Healthy unchanged polls stay silent; a failed release smoke check still emits
its build/header diagnostics to the systemd journal so stale processes are
visible.
  Deliberately a poll, not a GitHub Actions webhook — a webhook would need
  an inbound trigger surface from GitHub into this VM (a secret, an open
  port, or a self-hosted runner) that a 5-minute poll simply doesn't need.
- `systemd/hermes-finance-daily-check.service` + `.timer` — queues the
  existing opt-in, review-only daily finance task at 06:15 UTC. The timer is
  intentionally separate from the deploy timer and is not enabled by default.
- `systemd/hermes-finance-monthly-report.service` + `.timer` — writes the
  authenticated read-only monthly report at 06:30 UTC on the first day of the
  month.
- `systemd/hermes-finance-monthly-snapshot.service` + `.timer` — captures the
  idempotent monthly net-worth snapshot at 06:35 UTC on the first day of the
  month.

## Install / update

The versioned installer performs a read-only check by default and makes
activation an explicit choice:

```bash
bash scripts/install-finance-schedulers.sh
sudo bash scripts/install-finance-schedulers.sh --install
sudo bash scripts/install-finance-schedulers.sh --enable
```

`--install` copies and reloads the units but leaves all finance timers
disabled. `--enable` starts the three timers. Run the check after deploying a
new application checkout so the scheduler cannot silently point at missing
runtime scripts.

These files aren't automatically symlinked into `/etc/systemd/system/` —
copy them over explicitly after reviewing any change (this is a deploy
target, changes here affect production):

```bash
sudo cp deploy/systemd/hermes-workspace.service /etc/systemd/system/
sudo cp deploy/systemd/hermes-workspace-deploy.service /etc/systemd/system/
sudo cp deploy/systemd/hermes-workspace-deploy.timer /etc/systemd/system/
sudo cp deploy/systemd/hermes-finance-daily-check.service /etc/systemd/system/
sudo cp deploy/systemd/hermes-finance-daily-check.timer /etc/systemd/system/
sudo cp deploy/systemd/hermes-finance-monthly-report.service /etc/systemd/system/
sudo cp deploy/systemd/hermes-finance-monthly-report.timer /etc/systemd/system/
sudo cp deploy/systemd/hermes-finance-monthly-snapshot.service /etc/systemd/system/
sudo cp deploy/systemd/hermes-finance-monthly-snapshot.timer /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now hermes-workspace-deploy.timer
```

To enable the daily finance check after reviewing the opt-in policy and
authentication setup:

```bash
sudo systemctl enable --now hermes-finance-daily-check.timer
```

Enable the monthly read-only jobs separately when desired:

```bash
sudo systemctl enable --now hermes-finance-monthly-report.timer
sudo systemctl enable --now hermes-finance-monthly-snapshot.timer
```

If password protection is enabled, create
`/home/ubuntu/hermes-workspace-live/.env.finance-scheduler` with mode `0600`
and set `FINANCE_SESSION_COOKIE=claude-auth=<session-token>`. Do not put the
cookie in the unit file or command line. The scheduler scripts pass it through
a private temporary curl configuration rather than a visible process argument.

`hermes-workspace.service` itself only needs re-copying if its unit
definition changes (WorkingDirectory, ExecStart, etc.) — day-to-day code
deploys go through the timer, not a unit-file change.

## Verify

```bash
systemctl status hermes-workspace-deploy.timer
systemctl list-timers hermes-workspace-deploy.timer
journalctl -u hermes-workspace-deploy.service --since "1 hour ago"
```
