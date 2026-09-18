# Production change journal

Every successful `scripts/deploy.sh` run appends one sanitized JSONL entry to
`.runtime/deployment-history.jsonl`. The dashboard reads this file and shows
the deployment correlation ID, deployed commit, previous rollback target, build
and runtime checks, plus
links to the source commit, CI checks, and deployment record when the deploy
environment provides them.

Deployments may provide approval evidence through environment variables:

```sh
DEPLOY_APPROVAL_STATUS=approved \
DEPLOY_APPROVAL_ACTOR=release-manager \
DEPLOY_APPROVAL_REF=github-environment-production \
DEPLOY_CHECKS_URL=https://github.com/OWNER/REPO/actions/runs/RUN_ID \
DEPLOYMENT_URL=https://github.com/OWNER/REPO/deployments \
scripts/deploy.sh
```

The default status `local-deploy-gate-passed` records that the local security,
canary, release-smoke, and service checks passed; it does not claim a human
approval. Values are limited to links and operator metadata—secrets, tokens,
request content, and environment files are never written to the journal.

The file is mode `0600` and is capped at the most recent 100 entries. A failed
deployment is not recorded as successful; the existing rollback path remains
the source of truth for recovery.
