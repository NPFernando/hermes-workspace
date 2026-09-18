# Multi-agent scheduling and provider budgets

Swarm dispatch now has a provider-aware scheduling boundary. It groups worker
models into provider buckets, reports the projected daily budget state with
each dispatch, and applies configured per-provider concurrency limits to
parallel batches.

The policy is advisory by default. Configure it on the server with:

```text
HERMES_PROVIDER_DAILY_BUDGETS_JSON={"codex":{"limitUsd":10,"reservationUsd":0.05},"claude":5}
HERMES_PROVIDER_CONCURRENCY_JSON={"codex":2,"claude":1}
HERMES_PROVIDER_BUDGET_MODE=advisory
```

`limitUsd` is the observed daily spend ceiling. `reservationUsd` reserves a
small amount for each task in the dispatch so a parallel batch cannot oversubscribe
the remaining budget. A numeric budget uses
`HERMES_PROVIDER_RESERVATION_USD` as its reservation value. Provider usage is
read from the existing provider-usage adapters; missing usage remains explicit
as `no_data` and never becomes zero.

Set `HERMES_PROVIDER_BUDGET_MODE=enforce` only after provider readings and
limits have been validated. In enforce mode, a configured provider with missing
usage, an unconfigured provider, or a projected budget breach blocks the
dispatch with HTTP 429. In advisory mode the dispatch proceeds and returns the
schedule evidence for operator review.

The policy is independent of the durable serial queue: serial jobs still use
the queue and re-evaluate the provider policy when the worker starts, while
parallel jobs honor configured provider concurrency slots.
