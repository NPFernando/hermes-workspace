# Scheduled fork synchronization previews

The scheduled preview is read-only. It inspects the configured fork and
upstream in a disposable worktree, records patch/conflict summaries, and never
merges or pushes. Reports are created with mode `0600` and are never replaced.

Configure `/home/ubuntu/.hermes/fork-sync-preview.env` before installing the
systemd units:

```sh
HERMES_FORK_SYNC_REPO=/home/ubuntu/path/to/fork
HERMES_FORK_SYNC_REMOTE=upstream
HERMES_FORK_SYNC_REPORT_DIR=/home/ubuntu/.hermes/fork-sync-previews
```

Run manually with:

```sh
python3 scripts/fork_sync_scheduled_preview.py --repo /path/to/fork --remote upstream
```

Install the supplied `.service` and `.timer` units only after reviewing the
repository path and upstream remote. A report marked `manual-review` still
requires operator approval; no scheduled path performs a merge or push.
