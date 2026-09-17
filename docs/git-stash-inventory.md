# Parked Git stash inventory

Audited 2026-09-17 from the deployment worktree. These entries were not
applied, deleted, stashed again, or otherwise changed. The object IDs below
allow recovery even if stash numbering changes later.

| Current ref | Created | Object | Subject | Summary |
| --- | --- | --- | --- | --- |
| `stash@{0}` | 2026-09-15 05:17 +0530 | `2ac39d66e8a33532351d309d4819bdb52c4b203d` | `feat/unregistered-sender-candidates`: savings-goal-band-wip-check-main-regression | 2 files, +82/-8 |
| `stash@{1}` | 2026-09-11 23:55 +0530 | `341d605040da5ed7110b02b1f6784068e84a2a56` | `pf-pg-integration-tests`: mixed experimental finance snapshot | 396 files, +29668/-7010 |
| `stash@{2}` | 2026-09-11 21:37 +0530 | `f5f0d838080546f2f2cb761a65ee088260752a04` | `main`: preserve before formal release merge | 406 files, +31558/-15925 |
| `stash@{3}` | 2026-09-11 20:51 +0530 | `580009975d83ce8c348e844089656277f4b6194f` | `main`: preserve before budget rollover release | 405 files, +31434/-15562 |
| `stash@{4}` | 2026-09-11 20:33 +0530 | `7e4a23d2d5a54e9bc7ca3c97a9d1ceb7c08965e7` | `main`: preserve remaining worktree after runtime fix | 405 files, +31434/-15562 |
| `stash@{5}` | 2026-09-11 20:29 +0530 | `8dc255d40d4acf9be4d25568ace1adacd27e8928` | `main`: preserve before scheduled finance rollout | 407 files, +31646/-14746 |
| `stash@{6}` | 2026-09-11 13:30 +0530 | `55b0d1413e88375953c0f00059c69da8550a284e` | `main`: auto-deploy-parked | No tracked-file diff reported |
| `stash@{7}` | 2026-09-11 13:03 +0530 | `7d4dfb151a6e99c3718ba9e096925ade26d33258` | `main`: auto-deploy-parked | No tracked-file diff reported |
| `stash@{8}` | 2026-09-09 06:23 +0530 | `81b7fbabca9db8497401af09df4346761087081b` | `main`: auto-deploy-parked | 2 files, +18/-3 |

The broad snapshots contain overlapping release-era work and should not be
removed without confirming which one, if any, is still needed. The next safe
cleanup step is an owner review followed by an explicit per-entry decision;
this inventory itself is the preservation record.
