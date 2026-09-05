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
  Deliberately a poll, not a GitHub Actions webhook — a webhook would need
  an inbound trigger surface from GitHub into this VM (a secret, an open
  port, or a self-hosted runner) that a 5-minute poll simply doesn't need.

## Install / update

These files aren't automatically symlinked into `/etc/systemd/system/` —
copy them over explicitly after reviewing any change (this is a deploy
target, changes here affect production):

```bash
sudo cp deploy/systemd/hermes-workspace.service /etc/systemd/system/
sudo cp deploy/systemd/hermes-workspace-deploy.service /etc/systemd/system/
sudo cp deploy/systemd/hermes-workspace-deploy.timer /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now hermes-workspace-deploy.timer
```

`hermes-workspace.service` itself only needs re-copying if its unit
definition changes (WorkingDirectory, ExecStart, etc.) — day-to-day code
deploys go through the timer, not a unit-file change.

## Verify

```bash
systemctl status hermes-workspace-deploy.timer
systemctl list-timers hermes-workspace-deploy.timer
journalctl -u hermes-workspace-deploy.service --since "1 hour ago"
```
