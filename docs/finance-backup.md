# Finance backup restore safety

`POST /api/finance-backup` supports encrypted export and verification. Restore
requests are preview-only by default: the backup is decrypted and verified,
but the live Finance store is not changed. The response includes the schema,
record counts, and the exact confirmation token required for an apply.

To apply a restore, send both:

```json
{
  "action": "restore",
  "mode": "apply",
  "confirmation": "RESTORE_FINANCE"
}
```

The passphrase and backup envelope are still required. Invalid or incomplete
confirmation remains a non-mutating preview. This is an application-level
safety gate; it does not replace encrypted backups, operator review, or restore
verification.

## First-time off-site setup

Configure a real, already-authenticated rclone remote with the interactive
operator command:

```sh
pnpm finance:offsite-backup:configure
```

The command validates remote access, reads and confirms a new passphrase
without echoing it or placing it in command arguments, updates only the two
dedicated keys in `~/.hermes/.env` with mode `0600`, installs/enables the
versioned systemd timer, and runs one encrypted upload/download round-trip.
The round-trip is completed before the timer is enabled, so an invalid
passphrase or remote cannot leave behind a scheduled job that is guaranteed to
fail.
It refuses to use a local path as an off-site remote and makes no changes when
remote validation or passphrase confirmation fails.
