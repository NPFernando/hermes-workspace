# Roadmap completion audit

Run the fail-closed audit from the deployment checkout:

```sh
pnpm roadmap:audit
```

The command evaluates all 20 roadmap items. A matching implementation file is
reported as `implemented-awaiting-live-evidence`; it is not treated as done.
An item becomes `verified` only when its current live-evidence check passes.
The command exits non-zero until every item is verified, so it is safe to use
as a release/readiness gate. The JSON output includes the required evidence for
each incomplete item and the current repository head.

The audit never reads secret values. Set `ASTROLOGY_REPO_PATH` when the
Astrology checkout is not at its default path, and configure the protected
Finance/backup environment before attempting live recovery evidence.
