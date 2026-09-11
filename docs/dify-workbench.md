# Dify Workbench

Hermes Workspace can expose selected Dify applications through the native
`/dify` Workbench. The integration is disabled by default and keeps Dify
credentials on the server. It does not embed Dify's frontend or share the
Hermes database with Dify.

## Configuration

Set these variables in the server environment (never in browser-exposed
configuration):

```dotenv
DIFY_ENABLED=true
DIFY_BASE_URL=http://127.0.0.1:5200
DIFY_APPS_JSON=[{"id":"research","label":"Research assistant","keyEnv":"DIFY_RESEARCH_KEY","enabled":true,"rateLimit":30}]
DIFY_RESEARCH_KEY=replace-with-a-dify-app-api-key
# Optional: per-client/app operation window, default 20 requests per 10 minutes
DIFY_RATE_LIMIT=20
# Optional: comma-separated MIME allowlist for uploads
# DIFY_ALLOWED_FILE_TYPES=application/pdf,text/plain,image/png,image/jpeg
# Optional: metadata-only audit path; inputs and keys are never recorded
# DIFY_AUDIT_PATH=/var/lib/hermes/dify-audit.jsonl
# Optional: fixed executable that receives a temporary upload path and exits 0 when safe
# DIFY_FILE_SCANNER_COMMAND=/usr/local/bin/clamdscan
```

Each registry entry maps a stable Workbench app ID to one environment variable
containing that Dify app's API key. `rateLimit` optionally overrides the global
per-client/app window for that app. The UI receives labels and capability
metadata only; it never receives the key. Use Dify's `/v1/info` and `/v1/parameters`
endpoints to verify an app, then run only the supported chat/workflow requests
from the Workbench.

## Local Dify deployment

Run Dify as a separate service using the official Dify Docker Compose files.
Do not start it from Hermes' application process. If the host already uses
ports 80 or 443, create a local override next to the checked-out Dify compose
file and bind its reverse proxy to loopback ports instead:

```yaml
services:
  ollama:
    image: ollama/ollama:latest
    restart: unless-stopped
    volumes:
      - /usr/share/ollama/.ollama:/root/.ollama
  nginx:
    ports:
      - '127.0.0.1:5200:80'
      - '127.0.0.1:5243:443'
  plugin_daemon:
    ports: !override []
```

Then set `DIFY_BASE_URL` to `http://127.0.0.1:5200` and start the Dify stack
independently. Keep Dify's PostgreSQL, Redis, sandbox, plugin daemon, and
storage isolated from Hermes. A hosted Dify URL can be used instead of the
local URL without changing the Workbench.

For this workspace's local deployment, the official checkout is expected at
`/home/ubuntu/workspace/projects/dify` and the protected Hermes environment
file is `/home/ubuntu/.hermes-dify-local.env`. Start it with:

```bash
bash scripts/start-dify-local.sh
```

The helper uses the local Compose override, keeps Dify bound to loopback, and
does not print credentials. The first Dify admin password is kept separately
in `/home/ubuntu/.dify-local-credentials`; change it after initial setup.
The local model provider uses the internal `ollama` service and reuses the
host's Ollama model store without publishing Ollama's API port. Configure the
selected model and credentials in Dify's console; this deployment currently
uses `qwen2.5:3b` for the research app.

## Current scope

- Read app metadata and published input parameters.
- Run chat or workflow apps with blocking or streaming responses.
- Stop active runs and reconnect to workflow event streams.
- Use an explicit allowlist of configured apps.
- Apply server-side JSON/size validation, rate limiting, and metadata-only audit logging.
- Keep recent run metadata in the browser's local storage without storing API keys.
- Partition Dify conversations by an opaque hash of the authenticated Hermes
  session; raw Hermes cookies are never forwarded to Dify.
- Open a short server-side circuit after repeated upstream network failures.
- Enforce an explicit MIME allowlist for uploaded files.
- Expose authenticated operational metrics from metadata-only audit events.
- Support an optional fail-closed file scanner hook before forwarding uploads.

Hermes does not expose app editing, provider administration, knowledge-base
mutation, or destructive Dify operations. Configure those through Dify's
authenticated console. Automatic Dify startup remains intentionally outside
the Hermes application process.

When `DIFY_FILE_SCANNER_COMMAND` is set, Hermes invokes that executable with a
temporary file path. A non-zero exit, timeout, or execution error rejects the
upload and the temporary file is removed. Keep the command as a fixed absolute
path; do not populate it from user input.
