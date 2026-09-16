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

After reviewing an eligible report (`mergeable-tests-passed` and
`manual-merge-candidate`), record explicit operator approval without changing
the repository:

```sh
python3 scripts/fork_sync_approval.py /home/ubuntu/.hermes/fork-sync-previews/report.json \
  --operator "$USER" --note "Reviewed patch summary and checks"
```

This creates a sibling `.approval.json` file containing the report SHA-256,
operator, commit heads, and a clear review-only scope. Approval is refused for
conflicts, failed checks, cached previews, or any other non-candidate report;
the artifact is evidence for a later manually executed integration.

Install the supplied `.service` and `.timer` units only after reviewing the
repository path and upstream remote. A report marked `manual-review` requires
manual investigation and cannot be approved by the command; no scheduled path
performs a merge or push.
