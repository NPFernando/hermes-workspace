#!/usr/bin/env node
import assert from 'node:assert/strict'
import { randomBytes } from 'node:crypto'
import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { mkdtemp, rm } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'
import { chromium } from 'playwright'

const port = process.env.AGENT_COCKPIT_E2E_PORT || '4184'
const baseUrl = `http://127.0.0.1:${port}`
const browserExecutable =
  process.env.AGENT_COCKPIT_E2E_CHROMIUM_PATH ||
  (existsSync(chromium.executablePath())
    ? chromium.executablePath()
    : '/usr/bin/chromium-browser')
const password = randomBytes(32).toString('hex')
const now = Date.now()
const apiPaths = [
  '/api/auth-check',
  '/api/ops-observability',
  '/api/provider-usage',
  '/api/swarm-dispatch',
  '/api/swarm-health',
  '/api/harp-observability',
  '/api/workspace-session-health',
  '/api/dify-status',
  '/api/dify-integration',
]
const seen = new Map(apiPaths.map((path) => [path, []]))
const opsPayload = {
  ok: true,
  generatedAt: new Date(now).toISOString(),
  cost: null,
  liveness: null,
  modelUsage7d: [
    {
      model: 'hermes-agent-fixture',
      billing: 'sub',
      sessions: 3,
      billedCostUsd: 0.04,
      estCostUsd: 0.04,
      tokens: 900,
    },
  ],
  copilotUsage7d: {
    requests24h: 3,
    requests7d: 12,
    sessions7d: 2,
    inputTokens7d: 1200,
    outputTokens7d: 800,
    aiu7d: 0.5,
    lastEventAt: new Date(now).toISOString(),
  },
  copilotDailyUsage7d: [
    {
      day: new Date(now).toISOString().slice(0, 10),
      requests: 12,
      sessions: 2,
      inputTokens: 1200,
      outputTokens: 800,
      aiu: 0.5,
    },
  ],
  hermesDailyUsage7d: [
    {
      day: new Date(now).toISOString().slice(0, 10),
      sessions: 3,
      tokens: 900,
      billedCostUsd: 0.04,
      estimatedCostUsd: 0.04,
    },
  ],
  escalation: null,
  cronJobs: [],
  financeStorageMonitor: null,
  financeStorageSmokeCron: null,
  headroom: null,
}
const usagePayload = {
  ok: true,
  updatedAt: now,
  providers: [
    {
      provider: 'codex',
      displayName: 'Codex',
      status: 'ok',
      plan: 'Test subscription',
      source: 'browser-e2e fixture',
      sourceKind: 'local_auth',
      lines: [
        {
          type: 'progress',
          label: 'Session',
          measure: 'quota',
          used: 40,
          limit: 100,
          format: 'percent',
        },
      ],
      updatedAt: now,
    },
    {
      provider: 'claude',
      displayName: 'Claude',
      status: 'ok',
      plan: 'Team',
      source: 'browser-e2e fixture',
      sourceKind: 'provider_api',
      lines: [
        {
          type: 'progress',
          label: 'Weekly',
          measure: 'quota',
          used: 80,
          limit: 100,
          format: 'percent',
        },
        {
          type: 'progress',
          label: 'Extra usage',
          measure: 'spend',
          used: 12,
          limit: 50,
          format: 'dollars',
        },
      ],
      updatedAt: now,
    },
  ],
  history: [
    {
      day: new Date(now).toISOString().slice(0, 10),
      provider: 'codex',
      displayName: 'Codex',
      label: 'Session',
      measure: 'quota',
      used: 40,
      limit: 100,
      percent: 40,
      sampledAt: now,
      source: 'browser-e2e fixture',
    },
    {
      day: new Date(now).toISOString().slice(0, 10),
      provider: 'claude',
      displayName: 'Claude',
      label: 'Weekly',
      measure: 'quota',
      used: 80,
      limit: 100,
      percent: 80,
      sampledAt: now,
      source: 'browser-e2e fixture',
    },
  ],
}
const queueFixture = {
  active: null,
  waiting: [{ id: 'fixture-job', status: 'pending' }],
  recent: [
    {
      id: 'fixture-dead-job',
      status: 'failed',
      priority: 3,
      assignmentCount: 1,
      deadLetterAt: now,
    },
  ],
}
let queueRetryRequests = 0
const fixtures = {
  '/api/ops-observability': opsPayload,
  '/api/provider-usage': usagePayload,
  '/api/swarm-dispatch': queueFixture,
  '/api/swarm-health': {
    checkedAt: now,
    workers: [],
    summary: {
      totalWorkers: 2,
      degraded: false,
      workersPrimaryAuthFailed: 0,
      workersUsingFallback: 0,
    },
  },
  '/api/harp-observability': {
    ok: true,
    readiness: {
      available: true,
      checkedAt: now,
      repositoryPath: '/fixture/harp',
      report: {
        status: 'blocked',
        blockers: ['graphify_refresh_required', 'open_memory_conflicts'],
        graphify: {
          status: 'stale',
          fresh: false,
          refresh_required: true,
          changed_file_count: 3,
        },
        health: { postgres: { healthy: true, status: 'healthy' } },
        quality: { schema_available: false },
        governance: { open_conflicts: 1 },
        execution_enabled: false,
        side_effects: false,
        operator_approval_required: true,
      },
    },
  },
  '/api/workspace-session-health': {
    available: true,
    installation: { installedExecutable: true, packageVersion: 'e2e' },
    probeProcess: {
      alive: true,
      pid: 1234,
      role: 'live-state CLI probe',
    },
    sessions: [
      {
        name: 'fixture-session',
        attached: true,
        paneProcessAlive: true,
        paneDead: false,
        tuiResponsive: true,
        heartbeatLatencyMs: 12,
        keysSent: false,
      },
    ],
  },
  '/api/dify-status': {
    ok: true,
    enabled: true,
    configured: true,
    available: true,
    url: 'https://dify.example.test',
    detail: 'Dify provider is reachable.',
  },
  '/api/dify-integration': {
    ok: true,
    workflows: [],
    history: [],
    privacy: { mode: 'public-only', historyStores: 'metadata-only' },
    detail: 'No workflows configured in the fixture.',
  },
}

const hermesHome = await mkdtemp(join(tmpdir(), 'hermes-agent-cockpit-e2e-'))
const viteCli = fileURLToPath(
  new URL('../node_modules/vite/bin/vite.js', import.meta.url),
)
const server = spawn(
  process.execPath,
  [viteCli, 'dev', '--host', '127.0.0.1', '--port', port, '--strictPort'],
  {
    cwd: process.cwd(),
    stdio: 'inherit',
    env: {
      ...process.env,
      HERMES_HOME: hermesHome,
      HERMES_PASSWORD: password,
      COOKIE_SECURE: '0',
      VITEST: 'true',
    },
  },
)
let browser
try {
  const deadline = Date.now() + 60_000
  while (Date.now() < deadline) {
    if (server.exitCode !== null)
      throw new Error(`Vite exited with ${server.exitCode}`)
    try {
      if ((await fetch(baseUrl)).ok) break
    } catch {}
    await delay(500)
  }
  assert.ok(Date.now() < deadline, `Vite did not become ready at ${baseUrl}`)

  browser = await chromium.launch({
    executablePath: browserExecutable,
    headless: true,
  })
  const context = await browser.newContext({
    viewport: { width: 1365, height: 1000 },
  })
  const page = await context.newPage()
  page.setDefaultTimeout(10_000)
  const pageErrors = []
  page.on('pageerror', (error) => pageErrors.push(error.message))
  await page.addInitScript(() => {
    localStorage.setItem('claude-onboarding-complete', 'true')
  })
  await page.route('**/api/**', async (route) => {
    const request = route.request()
    const url = new URL(request.url())
    if (url.pathname === '/api/auth') return route.continue()

    const requests = seen.get(url.pathname)
    if (!requests) {
      return route.fulfill({
        status: 404,
        contentType: 'application/json',
        body: JSON.stringify({ ok: false, error: 'unmocked_test_endpoint' }),
      })
    }
    if (url.pathname === '/api/auth-check') {
      const authenticated = /(?:^|;\s*)claude-auth=[^;]+/.test(
        request.headers().cookie ?? '',
      )
      if (authenticated)
        requests.push({
          method: request.method(),
          cookie: request.headers().cookie ?? '',
        })
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ authenticated, authRequired: true }),
      })
    }

    if (
      url.pathname === '/api/swarm-dispatch' &&
      request.method() === 'PATCH'
    ) {
      queueRetryRequests++
      queueFixture.recent[0] = {
        ...queueFixture.recent[0],
        status: 'pending',
        deadLetterAt: null,
      }
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ ok: true, queued: true }),
      })
    }

    requests.push({
      method: request.method(),
      cookie: request.headers().cookie ?? '',
    })
    return route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(fixtures[url.pathname]),
    })
  })

  await page.goto(`${baseUrl}/`, { waitUntil: 'domcontentloaded' })
  assert.equal(
    await page.locator('#splash-screen').isVisible(),
    false,
    'the legacy full-screen splash stays hidden from the first document paint',
  )
  assert.ok(
    (await page.locator('[data-testid="connection-startup-screen"]').count()) <=
      1,
    'the runtime startup surface is mounted at most once during first paint',
  )
  assert.ok(
    (await page
      .locator(
        '#splash-screen:visible, [data-testid="connection-startup-screen"]:visible',
      )
      .count()) <= 1,
    'the themed splash and runtime connection surface never display as duplicate full-screen loaders',
  )
  const login = await page.evaluate(async (loginPassword) => {
    const response = await fetch('/api/auth', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password: loginPassword, rememberMe: true }),
    })
    return { status: response.status, body: await response.json() }
  }, password)
  assert.equal(
    login.status,
    200,
    'the application auth endpoint accepts its temporary password',
  )
  assert.equal(login.body.ok, true)
  assert.ok(
    (await context.cookies(baseUrl)).some(
      (cookie) => cookie.name === 'claude-auth',
    ),
    'app-issued authentication cookie is stored in the browser context',
  )

  await page.goto(`${baseUrl}/dashboard`, { waitUntil: 'domcontentloaded' })
  await page
    .getByRole('heading', { name: 'Hermes Workspace', exact: true, level: 1 })
    .waitFor({ timeout: 30_000 })
  await page.locator('[data-route-page]').waitFor()
  await page.waitForTimeout(750)
  assert.ok(
    (await page.locator('[data-testid="connection-startup-screen"]').count()) <=
      1,
    'the dashboard does not mount duplicate Hermes startup screens',
  )
  assert.equal(
    await page
      .locator('[data-testid="connection-startup-screen"]:visible')
      .count(),
    0,
    'the authenticated dashboard has no leftover startup overlay',
  )
  assert.equal(
    await page.locator('#splash-screen').isVisible(),
    false,
    'the legacy splash remains hidden on the dashboard route',
  )
  assert.deepEqual(
    pageErrors,
    [],
    'the dashboard route renders without uncaught browser errors',
  )

  await page.goto(`${baseUrl}/ops-cost`, { waitUntil: 'domcontentloaded' })
  await page
    .getByRole('heading', { name: 'Cost & Routing Observability' })
    .waitFor({ timeout: 45_000 })
  await page.getByRole('heading', { name: 'Agent control plane' }).waitFor()
  await page
    .getByText('Graphify data: stale · refresh required · 3 changed files')
    .waitFor()
  await page.getByText('Unresolved memory conflicts: 1').waitFor()
  await page.getByText('Quality schema: unavailable').waitFor()
  await page
    .getByText(
      'Execution: disabled · Side effects: false · Operator approval required: true',
    )
    .waitFor()
  await page
    .getByRole('heading', { name: 'AI agent & provider usage' })
    .waitFor()
  await page.getByText('Test subscription', { exact: true }).waitFor()
  await page
    .getByRole('heading', { name: 'Daily trends · last 7 days' })
    .waitFor()
  await page.getByRole('heading', { name: 'Copilot requests' }).waitFor()
  await page.getByRole('heading', { name: 'Copilot AI units' }).waitFor()
  await page.getByText('12 usage events / 7d', { exact: true }).waitFor()
  await page.getByRole('heading', { name: 'Hermes gateway tokens' }).waitFor()
  await page.getByRole('heading', { name: 'Hermes billable cost' }).waitFor()
  await page.getByText('3 sessions', { exact: true }).waitFor()
  await page.getByRole('heading', { name: 'Claude', exact: true }).waitFor()
  await page.getByText('Team plan', { exact: true }).waitFor()
  assert.equal(
    await page
      .getByText(/USD \(actual where available; otherwise estimated\)/)
      .count(),
    2,
    'both Hermes cost trends identify estimates instead of presenting them as billed cost',
  )
  await page
    .getByText(
      /Copilot readings come from local CLI counters, not GitHub billing totals/,
    )
    .waitFor()
  await page.getByText(/OpenAI API token usage is not billing data/).waitFor()
  await page
    .getByText(/Provider limits are separate and are not a combined budget/)
    .waitFor()
  await page
    .getByText(/missing feeds are unavailable rather than estimated/)
    .waitFor()
  assert.equal(
    await page
      .getByRole('progressbar', { name: 'Claude Weekly' })
      .getAttribute('aria-valuenow'),
    '80',
    'Claude quota is rendered as an 80-percent progress value',
  )
  await page.getByText('75%+ of quota', { exact: true }).waitFor()
  await page
    .getByRole('heading', { name: 'Claude · Weekly snapshot' })
    .waitFor()
  await page
    .getByRole('heading', { name: 'Codex · Session snapshot' })
    .waitFor()
  assert.equal(
    await page
      .getByText('Source: browser-e2e fixture', { exact: false })
      .count(),
    2,
    'Codex and Claude provider cards both show the source of their readings',
  )
  await page.getByText('1 waiting', { exact: false }).waitFor()
  await page.getByText(/blocked · 2 blocker\(s\)/).waitFor()
  await page.getByText(/1 session\(s\)/).waitFor()
  await page.getByText(/pane\/process probes responsive/).waitFor()
  await page.getByText('0 pending', { exact: true }).waitFor()
  await page.getByRole('link', { name: /Open queue controls/i }).waitFor()
  assert.equal(
    await page.getByTestId('connection-startup-screen').count(),
    0,
    'the runtime startup screen is gone after the authenticated workspace renders',
  )
  assert.equal(
    await page.locator('#splash-screen').isVisible(),
    false,
    'the themed pre-hydration splash is hidden after React takes ownership',
  )

  const queueRecovery = await page.evaluate(async () => {
    const before = await (
      await fetch('/api/swarm-dispatch', { cache: 'no-store' })
    ).json()
    const retry = await fetch('/api/swarm-dispatch?id=fixture-dead-job', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ acknowledgePossibleDuplicate: true }),
    })
    const after = await (
      await fetch('/api/swarm-dispatch', { cache: 'no-store' })
    ).json()
    return {
      before,
      retry: { status: retry.status, body: await retry.json() },
      after,
    }
  })
  assert.equal(
    queueRecovery.before.recent[0].deadLetterAt,
    now,
    'queue recovery starts from a dead-lettered job',
  )
  assert.equal(queueRecovery.retry.status, 200)
  assert.equal(queueRecovery.retry.body.queued, true)
  assert.equal(
    queueRecovery.after.recent[0].deadLetterAt,
    null,
    'queue recovery refresh returns the retried job',
  )
  assert.equal(
    queueRetryRequests,
    1,
    'dead-letter retry sends one acknowledged request',
  )

  await page.goto(`${baseUrl}/dify`, { waitUntil: 'domcontentloaded' })
  await page.getByRole('heading', { name: 'Dify Workbench' }).waitFor()
  const difyLink = page.getByRole('link', { name: /Open full Dify Workbench/ })
  assert.equal(await difyLink.getAttribute('href'), 'https://dify.example.test')
  assert.equal(await difyLink.getAttribute('target'), '_blank')
  assert.match(await difyLink.getAttribute('rel'), /noopener/)
  assert.equal(
    await page.locator('iframe[title="Dify Workbench"]').count(),
    0,
    'the Dify UI is opened separately because its framing policy forbids embedding',
  )

  for (const path of apiPaths) {
    assert.ok(seen.get(path).length > 0, `${path} was requested by the cockpit`)
    assert.ok(
      seen
        .get(path)
        .every((request) => /(?:^|;\s*)claude-auth=[^;]+/.test(request.cookie)),
      `${path} requests carried the app-issued session cookie`,
    )
  }
  assert.deepEqual(
    pageErrors,
    [],
    'cockpit renders without uncaught browser errors',
  )
  console.log('✅ authenticated agent cockpit browser smoke passed')
  console.log(
    `✅ app-issued session cookie reached all ${apiPaths.length} read-only cockpit APIs`,
  )
  console.log(
    '✅ queue, usage provenance, HARP readiness, session health, and approvals rendered',
  )
} finally {
  await browser?.close()
  server.kill('SIGTERM')
  await Promise.race([
    new Promise((resolve) => server.once('exit', resolve)),
    delay(5_000),
  ])
  if (server.exitCode === null) server.kill('SIGKILL')
  await rm(hermesHome, { recursive: true, force: true })
}
