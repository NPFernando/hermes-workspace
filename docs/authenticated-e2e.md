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
