# Secrets management and rotation

This workspace uses environment files, OS service configuration, provider
keychains, and GitHub Actions secrets. The status command reports presence only:

```sh
pnpm secrets:status
```

It never prints, hashes, or copies secret values.

## Credential policy

- `HERMES_PASSWORD` is the live workspace password and grants broad control-plane
  access. Keep it only in the live service environment and rotate it deliberately.
- `AUTH_E2E_PASSWORD` is for the authenticated browser journey. It must be a
  dedicated low-privilege test credential. Do not copy `HERMES_PASSWORD` into CI.
- `AUTH_E2E_BASE_URL` is the deployed HTTPS URL. It may be stored as a GitHub
  Actions secret or variable; it is not confidential.
- `HERMES_PG_PASSWORD` is database-only and must not be reused for workspace or
  provider authentication.
- Provider credentials should remain in the provider's supported keychain or
  environment file and must not be committed to the repository.

## GitHub Actions setup

Set the URL directly:

```sh
gh secret set AUTH_E2E_BASE_URL -R NPFernando/hermes-workspace \
  --body 'https://agent.fernandofamily.com'
```

Set the password interactively so it is not present in shell history:

```sh
gh secret set AUTH_E2E_PASSWORD -R NPFernando/hermes-workspace
```

Use a separate test deployment or a future scoped-auth account for this
credential. GitHub secret values are write-only after creation.

## Workspace rotation

1. Create a strong replacement password out-of-band.
2. Update `HERMES_PASSWORD` in `/home/ubuntu/hermes-workspace-live/.env`.
3. Restart `hermes-workspace.service`.
4. Verify `/api/auth` with the replacement credential and run the authenticated
   browser smoke test.
5. Revoke the old credential wherever it was stored.

Never put a plaintext password in a commit, command-line argument, log, issue,
or chat message.
