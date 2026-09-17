# Parked Git stashes

These stashes were audited on 2026-09-17 from the clean deployment worktree.
They are intentionally preserved. Stash references such as `stash@{0}` are
mutable; use the commit hashes below when inspecting or recovering work.

No stash is safe to delete solely because it is old. The auto-deploy-created
entries require an owner decision before removal, and the named feature/release
entries may contain work that is not represented on `main`.

| Hash | Origin | Created | Summary | Disposition |
| --- | --- | --- | --- | --- |
| `2ac39d66e8a33532351d309d4819bdb52c4b203d` | `feat/unregistered-sender-candidates` | 2026-09-15 | Savings-goal timeline and panel changes | Preserve; finance feature owner review required |
| `341d605040da5ed7110b02b1f6784068e84a2a56` | `pf-pg-integration-tests` | 2026-09-11 | Mixed finance integration snapshot, including workflow and lockfile changes | Preserve; finance/integration owner review required |
| `f5f0d838080546f2f2cb761a65ee088260752a04` | `main` | 2026-09-11 | Before formal release merge | Preserve until release-history review |
| `580009975d83ce8c348e844089656277f4b6194f` | `main` | 2026-09-11 | Before budget-rollover release | Preserve until finance release review |
| `7e4a23d2d5a54e9bc7ca3c97a9d1ceb7c08965e7` | `main` | 2026-09-11 | Remaining worktree after runtime fix | Preserve until runtime-fix review |
| `8dc255d40d4acf9be4d25568ace1adacd27e8928` | `main` | 2026-09-11 | Before scheduled finance rollout | Preserve until finance rollout review |
| `55b0d1413e88375953c0f00059c69da8550a284e` | `main` | 2026-09-11 | Auto-deploy parked work | Preserve; identify owner before removal |
| `7d4dfb151a6e99c3718ba9e096925ade26d33258` | `main` | 2026-09-11 | Auto-deploy parked work | Preserve; identify owner before removal |
| `81b7fbabca9db8497401af09df4346761087081b` | `main` | 2026-09-09 | Auto-deploy parked work | Preserve; identify owner before removal |

Useful recovery commands:

```bash
git stash show --stat <hash>
git stash show --format=fuller --patch <hash>
git stash branch recover/<short-name> <hash>
```

After an owner confirms a stash is obsolete and its changes are represented
elsewhere, remove that exact hash with `git stash drop <hash>` and record the
decision in the release notes.
