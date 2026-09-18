# External-write safe mode

Set `HERMES_SAFE_MODE=1` in the service environment and restart the workspace
to enter fail-closed safe mode. The Operations dashboard reports the current
state. Safe mode is process-level and cannot be switched on accidentally from
an untrusted browser request.

While enabled, read-only previews and diagnostics remain available, while the
following external side effects are rejected:

- signed Binance order, cancel, and test-order requests;
- Dify workflow runs and rollbacks;
- Swarm agent dispatches;
- trading engines that use the shared execution gate.

The guard returns a structured `SAFE_MODE_EXTERNAL_WRITE_BLOCKED` error. The
normal kill switch, provider budgets, authentication, and per-integration
checks remain active as additional protections. Disable the variable and
restart the service to resume external writes.
