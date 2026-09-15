# Safe fork-sync assistant

The assistant discovers GitHub forks and configured fork/upstream pairs, then
assesses upstream changes in a disposable detached worktree. It does not merge
into the checkout, create a lasting branch, push, build the live application,
or restart services.

## Discover repositories

Scan only the root and nearby repositories you select:

```sh
python3 scripts/fork_sync_assistant.py scan --root /path/to/workspaces --max-depth 3
```

GitHub fork metadata is queried with `gh repo view` when GitHub CLI is installed
and authenticated. The assistant queries GitHub URLs from configured remotes
explicitly, rather than assuming that `origin` is the fork; it matches the
reported parent repository to a configured remote and prints that remote in
the preview command. This supports layouts such as `fork` pointing to the
owner's copy and `origin` pointing to the parent. Without GitHub metadata, a
distinct `origin` and `upstream` pair is only reported as a probable fork
configuration; arbitrary remote pairs are not treated as proof of a fork.
Remote credentials and URL query strings are removed from displayed URLs.

## Preview one repository

Set up the correct upstream remote yourself, then preview its branch:

```sh
git -C /path/to/fork remote -v
python3 scripts/fork_sync_assistant.py preview \
  --repo /path/to/fork --remote upstream --branch main \
  --check-command "pnpm test" \
  --check-command "pnpm build"
```

When `--branch` is omitted, an online preview resolves the upstream's
symbolic `HEAD`; a cached preview uses the cached remote `HEAD`, or the
current branch when a matching cached upstream ref exists.

Add `--format summary` for a compact decision brief (commit delta, conflicts,
snapshotted/excluded untracked files, checks, and whether anything was applied/pushed).
The default JSON output remains available as the complete machine-readable
report.
Use `--output /path/to/review.json` to save the selected report format for later
review. The command creates a new file and refuses to overwrite an existing
one; the parent directory must already exist. JSON is the default format.

If an online preview cannot fetch the selected branch, it automatically falls
back to the locally cached `refs/remotes/<remote>/<branch>` when one exists.
The result is explicitly labeled `cached-potentially-stale`, records the fetch
fallback, and can only recommend manual review. Use `--cached` to skip network
access entirely and assess the cached ref directly:

```sh
python3 scripts/fork_sync_assistant.py preview \
  --repo /path/to/fork --remote upstream --branch main --cached --format summary
```

Cached previews explicitly report `cached-potentially-stale`, add a stale-ref
risk flag, and can only recommend manual review. A cached preview is a
preliminary comparison against the last fetched commit, not evidence that the
current upstream is safe to merge. Retry a normal fetched preview once upstream
is reachable.

If the repository is shallow and Git cannot find a merge base during an online
preview, the assistant makes one bounded deepening attempt (up to 2,000
additional commits) for the selected upstream branch and the current branch's
tracking remote, then retries the comparison. It reports
`shallow-history-incomplete` instead of claiming the histories are unrelated
if ancestry is still unresolved. Cached/offline previews never deepen history;
checks are not run while ancestry is unresolved.

The command fetches only the selected branch into a remote-tracking ref. It
assesses committed local changes plus staged/unstaged tracked edits and
ordinary untracked files in a temporary worktree. Untracked regular files are
copied without following symlinks; symlinks themselves are snapshotted as links.
Ignored files are not copied. Unsafe files, directories (including nested
Git repositories), and untracked regular files over 64 MiB are listed
individually and excluded, while the safely captured subset can still be
replayed and checked. Such a report is explicitly
`partial-preview-manual-review`; passing checks cover only the captured subset
and can never justify merging excluded local paths. Directory-prefix overlaps
with upstream paths are also reported. Conflicts, unavailable checks, failing
checks, and missing sandbox support remain manual-review outcomes. At least one
check command must pass before a complete snapshot can say
`mergeable-tests-passed`; even then it recommends a manual merge, not automatic
integration.

Checks require Linux `bubblewrap` (`bwrap`). They run with network namespaces
isolated, the checkout's `node_modules` mounted read-only when available,
credentials and most environment variables removed, and only the scratch
worktree writable. Treat the results as risk evidence, not a security proof or
an approval to merge. Review dependency/install scripts and the full diff before
integrating upstream changes.

## Legacy updater

`scripts/upstream-sync.py` is now a check-only compatibility command. Its
default behavior fetches and reports; `--status` reads cached refs only; and
`--apply` exits with an explicit refusal. Notifications require `--notify`.
No code path in that script rebases, builds, restarts, or pushes.
