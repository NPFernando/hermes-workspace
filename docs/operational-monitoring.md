# Operational monitoring

`scripts/ops-monitor.mjs` is a read-only release-state monitor for the deployed
workspace. It reports:

- service state, exit result, and MainPID changes;
- a missing or stale `dist/server/server.js` artifact;
- failed deployment state from systemd; and
- parked git stashes that need an owner;
- the deployed commit and the exact pending runtime files; and
- sustained resident-memory growth between checks.

Run it manually:

```bash
pnpm ops:monitor /home/ubuntu/hermes-workspace-live
```

For systemd, install the two unit files from `deploy/systemd/` and enable the
timer:

```bash
sudo cp deploy/systemd/hermes-workspace-monitor.{service,timer} /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now hermes-workspace-monitor.timer
systemctl list-timers hermes-workspace-monitor.timer
```

The monitor persists only its last observed PID and timestamp under
`.runtime/ops-monitor-state.json` (mode `0600`), including the last resident
memory sample and consecutive high-growth count. A memory-growth warning requires
both a 64 MiB increase and a 25% increase by default; tune those thresholds with
`HERMES_OPS_MEMORY_GROWTH_MIN_KB` and
`HERMES_OPS_MEMORY_GROWTH_WARN_PERCENT`. A separate restart candidate requires a
256 MiB increase, a 50% increase, and three consecutive samples by default. Tune
those thresholds with `HERMES_OPS_MEMORY_RESTART_MIN_KB`,
`HERMES_OPS_MEMORY_RESTART_PERCENT`, and
`HERMES_OPS_MEMORY_RESTART_CONSECUTIVE`. Restart is disabled by default. To
permit a guarded non-interactive `sudo -n systemctl restart hermes-workspace` after
the restart threshold is reached, explicitly set
`HERMES_OPS_MEMORY_RESTART_ENABLED=1`; the one-hour cooldown can be tuned with
`HERMES_OPS_MEMORY_RESTART_COOLDOWN_SECONDS`. A critical finding
gives the oneshot a non-zero exit status so it is visible through
`systemctl status` and the journal; warning findings remain visible in the
JSON report without causing a false deployment failure. Restart attempts and
failures are recorded in the JSON report and state file.

## Optional operator alerts

Set `HERMES_OPS_ALERT_WEBHOOK_URL` in `/home/ubuntu/.hermes/ops-monitor.env` to
enable notifications for stale builds, OOM events, failed services, and
sustained memory growth. The URL must use HTTP or HTTPS. The monitor sends
issue metadata only, times out after five seconds, and never fails the health
check because delivery failed. Each issue type is sent at most once per hour
by default; set `HERMES_OPS_ALERT_COOLDOWN_SECONDS` to change that interval.

The last-delivery state is stored in
`.runtime/ops-monitor-alerts.json` with mode `0600`. The environment file is
optional and is intentionally not committed because it can contain a private
webhook URL. After changing the environment file, restart the timer service
or wait for its next run.

The existing Hermes Telegram relay can be used instead of a generic webhook:

```dotenv
HERMES_OPS_ALERT_TELEGRAM=1
HERMES_OPS_ALERT_TELEGRAM_CHAT_ID=2130622225
```

With this opt-in configuration, the monitor reads `TELEGRAM_BOT_TOKEN` and
`TELEGRAM_RELAY_BASE` from the existing mode-0600 `~/.hermes/.env` at runtime.
It never copies either secret into the monitor environment, repository, or
alert state. A generic webhook takes precedence when both transports are set.

To validate the configured transport without sending a message or writing
cooldown state, run:

```bash
node scripts/ops-monitor.mjs /home/ubuntu/hermes-workspace-live --test-alert
```

The test mode defaults to a no-network dry run. To deliberately send one
synthetic warning, add `--send` and set
`HERMES_OPS_ALERT_TEST_CONFIRM=1` in the same command. This separate
confirmation prevents an accidental notification during routine monitoring.
