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
