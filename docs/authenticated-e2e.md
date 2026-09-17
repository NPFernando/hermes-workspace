# Authenticated browser smoke

The authenticated smoke test covers the dashboard, Finance, Dify, queue
recovery APIs, `/queue` persistence, mobile command navigation, and duplicate
startup overlays. It reads credentials only from environment variables:

```sh
AUTH_E2E_PASSWORD='provided-out-of-band' \
AUTH_E2E_BASE_URL='https://agent.example.com' \
pnpm test:e2e:auth
```

For rollback verification, capture the restored artifact's
`X-Workspace-Build` value (the deploy script derives it automatically) and set
`AUTH_E2E_EXPECTED_BUILD`. When both authentication variables are present,
`scripts/deploy.sh` invokes this browser check after its rollback release
smoke. Missing credentials do not make the deploy script read a password from
disk or fail closed on an otherwise successful unauthenticated rollback smoke;
the authenticated check remains explicitly reported as not run.

## GitHub Actions setup

For the CI journey, add these repository Actions secrets under **Settings →
Secrets and variables → Actions**:

- `AUTH_E2E_PASSWORD`: the test account password, stored only as a secret.
- `AUTH_E2E_BASE_URL`: the HTTPS base URL of the deployed test workspace.

The workspace accepts `HERMES_E2E_PASSWORD` as a separate server-side
credential. Sessions created with it are read-only: non-GET API requests are
rejected, so the browser journey cannot start agents, write memory, change
settings, or mutate Finance data. It must differ from the high-privilege
`HERMES_PASSWORD`. Configure the same value as the write-only
`AUTH_E2E_PASSWORD` Actions secret; the value is never stored in this
repository.

Then run the **CI** workflow with **Run workflow** to execute the live journey.
Pull requests deliberately skip this external-environment check and run the
local/browser test suites instead; scheduled runs execute it as release
evidence. This prevents a transient production response from blocking an
unrelated source-only pull request. The workflow never prints or attempts to
discover a password from the runner filesystem.
