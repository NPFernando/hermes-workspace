# Dify integration assessment

Hermes should treat Dify as an optional, separately authenticated workbench,
not as a replacement for the dashboard, agent queue, or private data paths.

## Current contract

- The feature is disabled unless `DIFY_WORKBENCH_ENABLED` is explicitly true.
- `DIFY_WORKBENCH_URL` is the browser-reachable HTTP(S) URL. Credentials,
  query strings, and fragments are rejected.
- `DIFY_HEALTHCHECK_URL` may be set to a separate server-reachable URL.
- Hermes opens Dify in a new tab. It does not iframe Dify or bypass its
  frame-ancestor policy, and it does not pass API keys or user content.
- No birth, location, account, finance, repository, or other private data is
  sent to Dify.

## Pilot gate

Use only public FAQ, release-note, or documentation drafting tasks with human
review before publication. Compare a small fixed sample with the existing
agent flow for quality, turnaround, and operator effort. Keep the existing
dashboard flow as the default unless the pilot shows a material improvement.

Before adding an API workflow, document exact fields, retention, deletion,
logs, model-provider transfers, backup/restore, and access controls. Keep any
Dify application key server-side and behind a separate feature flag.

## Operations

The Dify deployment is a separate service with its own upgrades, backups,
monitoring, authentication, and usage ownership. Verify the configured URL and
health endpoint before enabling the workbench. Do not perform deployment or
database migration as part of enabling this UI integration.
