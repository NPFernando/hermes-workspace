# AI usage budgets

The authenticated `/ops-cost` view shows provider readings, seven-day trends,
and shared budgets. Budget readings do not claim billing authority when a
provider feed is missing.

Configure budgets with either environment variables or the Hermes config YAML:

```sh
HERMES_SHARED_DAILY_BUDGET_USD=10
HERMES_SHARED_MONTHLY_BUDGET_USD=200
HERMES_SHARED_BUDGET_MODE=advisory
```

Set `HERMES_SHARED_BUDGET_MODE=enforce` to pause remote provider requests when
an observed daily or monthly spend budget reaches 100%. Warning levels remain
allowed. Missing or degraded usage data remains non-blocking and is reported as
`no_data`, never as zero usage. Local-provider model requests are not blocked by
the shared remote-provider budget.

Equivalent YAML keys are `paid_budget_daily_usd` and
`paid_budget_monthly_usd`. The environment variables take precedence. Set
`HERMES_SHARED_BUDGET_CONFIG=disabled` to hide both configured policy values
while preserving provider readings.

The monthly signal sums the latest daily `spend` sample per provider and label
from the rolling 31-day history. Only aggregate provider, label, measure,
value, and timestamp data are stored; raw provider responses are not persisted.
No history is reported as `no_data`, never as zero usage. The dashboard labels
the result as advisory and shows the remaining amount and threshold state.
