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
memory sample. A memory-growth warning requires both a 64 MiB increase and a
25% increase by default; tune those thresholds with
`HERMES_OPS_MEMORY_GROWTH_MIN_KB` and
`HERMES_OPS_MEMORY_GROWTH_WARN_PERCENT`. It never restarts services, deploys
code, changes git state, or sends data outside the host. A critical finding
gives the oneshot a non-zero exit status so it is visible through
`systemctl status` and the journal; warning findings remain visible in the
JSON report without causing a false deployment failure.

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
