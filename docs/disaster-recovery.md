# Disaster recovery runbook

This runbook defines the quarterly restore exercise for Hermes Workspace. It
keeps recovery evidence separate from production data and records only
sanitized counts, statuses, and timings. Never paste passphrases, database
URLs, backup payloads, or remote credentials into an issue or chat message.

## Recovery targets

- **RPO:** 24 hours for Finance data, assuming the encrypted off-site timer is
  configured and its last successful round-trip is less than one day old.
- **RTO:** 4 hours for the Workspace service after an infrastructure or host
  failure, subject to PostgreSQL and secret-provider availability.
- **Recovery authority:** an operator must approve any restoration into a
  production database. The automated exercise restores only into a temporary
  database and never writes to `finance`.

## Quarterly exercise

Run from the deployment checkout using the same release that is currently
deployed:

```sh
pnpm dr:exercise -- --plan
pnpm dr:exercise -- --run
```

The local drill creates a custom dump of the canonical `finance` database,
restores it into a uniquely named `finance_backup_it_<timestamp>` database,
compares every public-table row count, and removes the temporary database and
dump even when the comparison fails. Evidence is written with mode `0600` to
`~/.hermes-data/dr-exercises/` (or `HERMES_DR_EVIDENCE_DIR`) and contains no
database credentials or backup contents.

When the off-site provider is configured and the operator wants to exercise
that path too:

```sh
HERMES_DR_RUN_OFFSITE=1 pnpm dr:exercise -- --run
```

That step requires `HERMES_FINANCE_BACKUP_PASSPHRASE` and
`HERMES_FINANCE_BACKUP_RCLONE_REMOTE` from the protected Hermes environment.
It uploads an encrypted envelope, downloads the same object, and verifies the
authentication tag, digest, schema, and record counts. If either secret is
missing, the underlying command fails closed rather than creating an
unencrypted artifact.

## Exercise checklist

1. Confirm the release commit with `git rev-parse HEAD` and record it beside the
   evidence file.
2. Run the plan and inspect the target database names and configured steps.
3. Run the local restore exercise and confirm `ok: true`, `rowCountsMatch`,
   and cleanup success.
4. Run the off-site round-trip when the protected remote is configured; confirm
   `encrypted: true` and `roundTripVerified: true`.
5. Confirm `systemctl is-active hermes-workspace.service`, the public health
   endpoint, and the latest deployment journal entry.
6. Review the evidence with the operator, record any RPO/RTO variance, and
   schedule remediation before the next quarter.

## Failure handling

Do not retry a failed restore against `finance` or edit the backup payload.
Capture the sanitized error, preserve the temporary-database cleanup warning
if one is reported, and investigate credentials, PostgreSQL availability,
remote access, or schema drift. A failed or missing quarterly exercise keeps
DR readiness incomplete.

## Ownership and cadence

The service owner schedules this exercise once per quarter and after any
database migration that changes Finance tables. Deployment evidence and the
exercise JSON are linked from the production change journal; the JSON is
retained according to the operator's backup-retention policy.

## Automated quarterly run and dashboard download

Install the supplied units after reviewing the environment and confirming the
deployment checkout path:

```sh
sudo install -m 0644 deploy/systemd/hermes-disaster-recovery-exercise.{service,timer} /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable hermes-disaster-recovery-exercise.timer
sudo systemctl start hermes-disaster-recovery-exercise.timer
systemctl list-timers hermes-disaster-recovery-exercise.timer
```

The timer runs `pnpm dr:exercise -- --run` on the quarterly systemd calendar,
with persistence for missed runs and a randomized delay. The authenticated
Agent control plane lists the latest sanitized evidence and exposes a private,
no-store JSON download. The download intentionally excludes child command
output, database names, credentials, backup contents, and remote paths.
