# Operational monitoring

`scripts/ops-monitor.mjs` is a read-only release-state monitor for the deployed
workspace. It reports:

- service state, exit result, and MainPID changes;
- a missing or stale `dist/server/server.js` artifact;
- failed deployment state from systemd; and
- parked git stashes that need an owner.

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
`.runtime/ops-monitor-state.json` (mode `0600`). It never restarts services,
deploys code, changes git state, or sends data outside the host. A critical
finding gives the oneshot a non-zero exit status so it is visible through
`systemctl status` and the journal.
