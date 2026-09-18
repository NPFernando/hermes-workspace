#!/usr/bin/env node
/**
 * Fail-closed completion audit for the 20-item workspace roadmap.
 *
 * A matching file or commit proves implementation activity only. An item is
 * complete here only when its liveEvidence check also passes. This prevents a
 * green build or a plausible commit from being mistaken for production proof.
 */
import { execFileSync } from 'node:child_process'
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { homedir } from 'node:os'
import { join, resolve } from 'node:path'

const DEFAULT_REPO = resolve(import.meta.dirname, '..')

const ROADMAP = [
  ['authenticated astrology smoke', ['authenticated-browser-smoke.mjs'], 'Astrology storage-state and authenticated production smoke evidence'],
  ['encrypted off-site Finance backup and restore', ['finance-offsite-backup.ts', 'disaster-recovery-exercise.ts'], 'A recent passed off-site round-trip evidence artifact'],
  ['unified roadmap status dashboard', ['cross-repository-release-status.ts'], 'Live service and authenticated roadmap dashboard evidence'],
  ['credential expiry and rotation reminders', ['secrets-rotation.mjs', 'secrets-status.mjs'], 'Current rotation metadata with no overdue required credential'],
  ['auth UX and account disconnect', ['account-session-section.tsx', 'auth-middleware.ts'], 'Live authenticated sign-in, expiry, and disconnect smoke'],
  ['production configuration preflight', ['production-readiness.mjs'], 'A current production-readiness report with configuration checks'],
  ['agent-cost budgets and anomaly alerts', ['usage-budget.ts', 'provider-usage.tsx'], 'Live provider usage response with budget/anomaly fields'],
  ['queue priority pause retry and audit', ['swarm-dispatch-queue.ts', 'swarm-dispatch-queue.sql'], 'Live queue database migration and authenticated queue controls'],
  ['deployment diff preview', ['deploy.sh', 'deploy-guard.test.mjs'], 'A current preview generated from the deploy checkout'],
  ['quarterly disaster recovery exercise', ['disaster-recovery-exercise.ts', 'hermes-disaster-recovery-exercise.timer'], 'Recent sanitized passed restore evidence'],
  ['Astrology performance improvements', ['BirthChartClient.tsx'], 'Astrology production performance/bundle evidence'],
  ['cross-repository release health', ['cross-repository-release-status.ts'], 'Live GitHub metadata/check evidence for every configured repository'],
  ['fork synchronization reports', ['fork_sync_assistant.py', 'fork_sync_scheduled_preview.py'], 'Recent non-stale fork preview with conflict classification'],
  ['safe-mode controls', ['safe-mode.ts', 'ops-cost-screen.tsx'], 'Live safe-mode status and preview-only behavior evidence'],
  ['privacy and security regressions', ['deployment-security-gate.mjs', 'check-privacy-security-regressions.mjs'], 'Current security/privacy checks passed for all in-scope repositories'],
  ['dashboard accessibility refinement', ['accessibility-browser-smoke.mjs', 'styles.css'], 'Current browser accessibility smoke evidence'],
  ['observability and service history', ['ops-monitor.mjs', 'auth-middleware.ts'], 'Recent monitor sample, backup freshness, and structured auth evidence'],
  ['grouped settings rebuild', ['settings-dialog.tsx', 'account-session-section.tsx'], 'Live settings navigation/rendering evidence'],
  ['feature flags and staged rollout', ['feature-flags.ts', 'feature-flags.test.ts'], 'Live flag response and staged rollout configuration evidence'],
  ['final roadmap completion audit', ['roadmap-completion-audit.mjs'], 'This audit itself must return ok=true'],
]

function command(file, args, cwd, env = process.env) {
  try {
    return execFileSync(file, args, {
      cwd,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
      env,
    }).trim()
  } catch (error) {
    // Several evidence collectors deliberately exit nonzero when they find a
    // blocker, while still emitting a complete JSON report on stdout. Keep
    // that report so the audit can explain the blocker instead of downgrading
    // it to an unexplained unavailable result.
    return String(error?.stdout || '').trim()
  }
}

function recentPassedDrEvidence() {
  const directory = process.env.HERMES_DR_EVIDENCE_DIR || join(homedir(), '.hermes-data', 'dr-exercises')
  try {
    return readdirSync(directory)
      .filter((file) => /^exercise-[0-9]{14,}\.json$/.test(file))
      .sort()
      .reverse()
      .some((file) => {
        try {
          const report = JSON.parse(readFileSync(join(directory, file), 'utf8'))
          return report.ok === true && Array.isArray(report.results) && report.results.every((result) => result.status === 'passed' || result.status === 'skipped')
        } catch {
          return false
        }
      })
  } catch {
    return false
  }
}

function recentPassedOffsiteEvidence() {
  const directory = process.env.HERMES_DR_EVIDENCE_DIR || join(homedir(), '.hermes-data', 'dr-exercises')
  try {
    return readdirSync(directory)
      .filter((file) => /^exercise-[0-9]{14,}\.json$/.test(file))
      .sort()
      .reverse()
      .some((file) => {
        try {
          const report = JSON.parse(readFileSync(join(directory, file), 'utf8'))
          return report.ok === true && Array.isArray(report.results) && report.results.some((result) =>
            result.name === 'finance-offsite-round-trip' &&
            result.status === 'passed' &&
            result.output?.roundTripVerified === true,
          )
        } catch {
          return false
        }
      })
  } catch {
    return false
  }
}

function recentForkPreviewEvidence() {
  const directory = process.env.HERMES_FORK_SYNC_REPORT_DIR || join(homedir(), '.hermes-data', 'fork-sync-previews')
  try {
    return readdirSync(directory)
      .filter((file) => file.endsWith('.json'))
      .map((file) => join(directory, file))
      .sort((left, right) => statSync(right).mtimeMs - statSync(left).mtimeMs)
      .some((file) => {
        try {
          const report = JSON.parse(readFileSync(file, 'utf8'))
          const ageMs = Date.now() - statSync(file).mtimeMs
          const preservation = report.customChangePreservation
          return ageMs >= 0 && ageMs <= 48 * 60 * 60 * 1000 &&
            report.scheduled === true &&
            ['clean', 'changes', 'conflicts'].includes(report.status) &&
            Array.isArray(report.conflictFiles) &&
            preservation && typeof preservation.status === 'string' &&
            Array.isArray(preservation.committedPaths) &&
            Array.isArray(preservation.untrackedPathsIncluded) &&
            Array.isArray(preservation.untrackedPathsExcluded)
        } catch {
          return false
        }
      })
  } catch {
    return false
  }
}

function astrologyAuthSmokeEvidence(run) {
  try {
    const output = run('gh', [
      'run',
      'list',
      '--repo',
      'NPFernando/fernandofamily-astrology',
      '--workflow',
      'authenticated-production-smoke.yml',
      '--limit',
      '1',
      '--json',
      'status,conclusion,createdAt,headSha',
    ])
    const latest = parseJson(output)?.[0]
    const createdAt = Date.parse(latest?.createdAt ?? '')
    const fresh = Number.isFinite(createdAt) &&
      Date.now() - createdAt >= 0 &&
      Date.now() - createdAt <= 48 * 60 * 60 * 1000
    const verified = latest?.status === 'completed' &&
      latest?.conclusion === 'success' &&
      fresh &&
      typeof latest?.headSha === 'string' &&
      latest.headSha.length > 0
    return {
      verified,
      detail: verified
        ? 'recent Astrology authenticated-production-smoke workflow passed'
        : latest?.status === 'completed' && latest?.conclusion === 'success'
          ? 'Astrology authenticated smoke evidence is stale'
          : 'no recent successful Astrology authenticated smoke workflow found',
    }
  } catch {
    return { verified: false, detail: 'Astrology authenticated smoke workflow evidence is unavailable' }
  }
}

function findFile(root, target, depth = 0) {
  if (depth > 5 || !existsSync(root)) return false
  try {
    for (const entry of readdirSync(root, { withFileTypes: true })) {
      if (['.git', 'node_modules', 'dist', '.next', 'vendor'].includes(entry.name)) continue
      const path = join(root, entry.name)
      if (entry.isFile() && entry.name === target) return true
      if (entry.isDirectory() && findFile(path, target, depth + 1)) return true
    }
  } catch {
    return false
  }
  return false
}

function staticEvidence(roots, files) {
  return files.some((file) => roots.some((root) =>
    existsSync(resolve(root, file)) ||
    existsSync(resolve(root, 'src', file)) ||
    existsSync(resolve(root, 'scripts', file)) ||
    existsSync(resolve(root, 'src/components', file)) ||
    existsSync(resolve(root, 'deploy/systemd', file)) ||
    findFile(root, file),
  ))
}

function parseJson(output) {
  try {
    return JSON.parse(output)
  } catch {
    return null
  }
}

function hasDeploymentPreview(report) {
  return report?.preview === true &&
    Array.isArray(report.changedFileList) &&
    Array.isArray(report.migrationFiles) &&
    report.rollback && typeof report.rollback === 'object' &&
    report.approval && typeof report.approval === 'object'
}

function hasAccessibilityEvidence(report) {
  return report?.ok === true && report.audit &&
    Array.isArray(report.audit.unnamed) &&
    Array.isArray(report.audit.imagesMissingAlt) &&
    Array.isArray(report.audit.duplicateIds) &&
    Array.isArray(report.audit.hiddenFocusable)
}

function recentAuthenticatedSmokeEvidence(root) {
  const path = process.env.HERMES_AUTH_E2E_EVIDENCE_PATH ||
    join(root, '.runtime', 'authenticated-browser-smoke.json')
  try {
    const report = JSON.parse(readFileSync(path, 'utf8'))
    const generatedAt = Date.parse(report.generatedAt)
    const labels = new Set(
      Array.isArray(report.checks)
        ? report.checks.filter((check) => check?.passed === true).map((check) => check.label)
        : [],
    )
    const fresh = Number.isFinite(generatedAt) &&
      Date.now() - generatedAt >= 0 &&
      Date.now() - generatedAt <= 48 * 60 * 60 * 1000
    return {
      ok: report.ok === true && fresh,
      labels,
      detail: report.ok !== true
        ? 'authenticated smoke did not pass'
        : !fresh
          ? 'authenticated smoke evidence is stale'
          : 'recent authenticated smoke evidence is available',
    }
  } catch {
    return { ok: false, labels: new Set(), detail: 'authenticated smoke evidence is unavailable' }
  }
}

function recentDeploymentCorrelationEvidence(root, now = Date.now()) {
  const path = join(root, '.runtime', 'deployment-history.jsonl')
  try {
    return readFileSync(path, 'utf8')
      .split(/\r?\n/)
      .filter(Boolean)
      .slice(-20)
      .some((line) => {
        try {
          const entry = JSON.parse(line)
          const at = Date.parse(entry?.at ?? '')
          return Number.isFinite(at) &&
            now - at >= 0 &&
            now - at <= 48 * 60 * 60 * 1000 &&
            typeof entry?.deploymentId === 'string' &&
            entry.deploymentId.length > 0 &&
            typeof entry.at === 'string' &&
            typeof entry.commit === 'string'
        } catch {
          return false
        }
      })
  } catch {
    return false
  }
}

export function buildRoadmapAudit({ root = DEFAULT_REPO, run = command } = {}) {
  const roots = [
    root,
    process.env.ASTROLOGY_REPO_PATH || '/home/ubuntu/workspace/projects/fernandofamily-astrology',
  ]
  const serviceActive = run('systemctl', ['is-active', 'hermes-workspace.service'], root) === 'active'
  const currentHead = run('git', ['rev-parse', 'HEAD'], root)
  let readinessReport
  let deploymentPreview
  let accessibilityReport
  let privacySecurityReport
  let performanceReport
  let releaseHealthReport
  let rotationReport
  const getReadiness = () => {
    if (readinessReport === undefined) {
      readinessReport = parseJson(run(process.execPath, ['scripts/production-readiness.mjs', '--skip-tests', '--json'], root))
    }
    return readinessReport
  }
  const getDeploymentPreview = () => {
    if (deploymentPreview === undefined) {
      deploymentPreview = parseJson(run('bash', ['scripts/deploy.sh', '--preview'], root))
    }
    return deploymentPreview
  }
  const getAccessibility = () => {
    if (accessibilityReport === undefined) {
      accessibilityReport = parseJson(run(process.execPath, ['scripts/accessibility-browser-smoke.mjs', 'http://127.0.0.1:3000'], root))
    }
    return accessibilityReport
  }
  const getPrivacySecurity = () => {
    if (privacySecurityReport === undefined) {
      privacySecurityReport = parseJson(run(process.execPath, ['scripts/check-privacy-security-regressions.mjs', '--json'], root))
    }
    return privacySecurityReport
  }
  const getPerformance = () => {
    if (performanceReport === undefined) {
      const astrologyRoot = roots[1]
      performanceReport = parseJson(run(
        process.execPath,
        ['apps/web/scripts/check-mobile-performance.mjs'],
        astrologyRoot,
        {
          ...process.env,
          PERF_URL: process.env.ASTROLOGY_PERF_URL || 'https://astrology.fernandofamily.com',
        },
      ))
    }
    return performanceReport
  }
  const getReleaseHealth = () => {
    if (releaseHealthReport === undefined) {
      releaseHealthReport = parseJson(run(process.execPath, ['scripts/release-health-audit.mjs'], root))
    }
    return releaseHealthReport
  }
  const getRotationReport = () => {
    if (rotationReport === undefined) {
      rotationReport = parseJson(run(process.execPath, ['scripts/secrets-rotation.mjs', 'status'], root))
    }
    return rotationReport
  }
  const liveEvidenceFor = (index) => {
    const evidence = (verified, detail) => ({ verified, detail })
    if (index === 0) {
      const smoke = astrologyAuthSmokeEvidence(run)
      return evidence(smoke.verified, smoke.detail)
    }
    if (index === 1) {
      const verified = recentPassedOffsiteEvidence()
      return evidence(verified, verified
        ? 'recent encrypted Finance off-site round trip passed'
        : 'no recent passed encrypted Finance off-site round trip found')
    }
    if (index === 2) {
      const smoke = recentAuthenticatedSmokeEvidence(root)
      const verified = smoke.ok && smoke.labels.has('unified release dashboard API returns repository evidence')
      return evidence(verified, verified ? 'authenticated unified release dashboard evidence passed' : `unified dashboard evidence: ${smoke.detail}`)
    }
    if (index === 5) {
      const status = getReadiness()?.checks?.configurationPreflight?.status
      return evidence(status === 'pass', `configuration preflight: ${status || 'unavailable'}`)
    }
    if (index === 6) {
      const smoke = recentAuthenticatedSmokeEvidence(root)
      const verified = smoke.ok && smoke.labels.has('provider usage API returns budgets and anomaly telemetry')
      return evidence(verified, verified ? 'authenticated provider usage budget and anomaly telemetry passed' : `provider usage evidence: ${smoke.detail}`)
    }
    if (index === 7) {
      const smoke = recentAuthenticatedSmokeEvidence(root)
      const verified = smoke.ok && smoke.labels.has('queue API exposes durable priority retry and dead-letter controls')
      return evidence(verified, verified ? 'authenticated queue control evidence passed' : `queue control evidence: ${smoke.detail}`)
    }
    if (index === 3) {
      const statuses = getRotationReport()?.status
      const expired = Array.isArray(statuses)
        ? statuses.filter((entry) => entry.state === 'expired')
        : []
      const untrackedConfigured = Array.isArray(statuses)
        ? statuses.filter((entry) => entry.configured === true && entry.state === 'untracked')
        : []
      const verified = Array.isArray(statuses) && expired.length === 0 && untrackedConfigured.length === 0
      return evidence(
        verified,
        verified
          ? 'all configured credentials have tracked, current rotation metadata'
          : `rotation metadata blocked: ${expired.length} expired; ${untrackedConfigured.length} configured credential(s) untracked`,
      )
    }
    if (index === 4) {
      const smoke = recentAuthenticatedSmokeEvidence(root)
      const verified = smoke.ok && smoke.labels.has('account session can re-authenticate after disconnect')
      return evidence(verified, verified ? 'recent authenticated session and auth UX smoke passed' : `authenticated UX evidence: ${smoke.detail}`)
    }
    if (index === 8) {
      const verified = hasDeploymentPreview(getDeploymentPreview())
      return evidence(verified, verified ? 'deployment preview is current' : 'deployment preview is unavailable or incomplete')
    }
    if (index === 9) {
      const verified = recentPassedDrEvidence()
      return evidence(verified, verified ? 'recent passed restore evidence found' : 'no recent passed restore evidence found')
    }
    if (index === 10) {
      const report = getPerformance()
      return evidence(report?.ok === true, report?.ok === true
        ? `live mobile performance passed (FCP ${report.metrics?.firstContentfulPaintMs ?? '?'} ms, LCP ${report.metrics?.largestContentfulPaintMs ?? '?'} ms)`
        : 'live mobile performance evidence is unavailable or failed')
    }
    if (index === 11) {
      const report = getReleaseHealth()
      const blockers = report?.repositories?.flatMap((repo) => repo.blockers || []) || []
      return evidence(report?.ok === true, report?.ok === true
        ? 'all configured repositories have passing release evidence'
        : blockers.length ? `release blockers: ${blockers.slice(0, 3).join('; ')}` : 'cross-repository release evidence is unavailable')
    }
    if (index === 12) {
      const verified = recentForkPreviewEvidence()
      return evidence(verified, verified ? 'recent scheduled fork preview includes preservation classification' : 'no recent complete fork preservation report found')
    }
    if (index === 14) {
      const privacy = getPrivacySecurity()
      const securityStatus = getReadiness()?.checks?.security?.status
      return evidence(privacy?.ok === true && securityStatus === 'pass', `privacy guard: ${privacy?.ok === true ? 'pass' : 'fail/unavailable'}; deployment security evidence: ${securityStatus || 'unavailable'}`)
    }
    if (index === 13) {
      const smoke = recentAuthenticatedSmokeEvidence(root)
      const verified = smoke.ok && smoke.labels.has('ops API returns safe-mode, runtime-build, and deployment-correlation evidence')
      return evidence(verified, verified ? 'authenticated safe-mode and runtime evidence passed' : `safe-mode evidence: ${smoke.detail}`)
    }
    if (index === 15) {
      const report = getAccessibility()
      return evidence(serviceActive && hasAccessibilityEvidence(report), serviceActive
        ? report?.ok === true ? 'live accessibility smoke passed' : `accessibility smoke failed: ${(report?.failures || []).slice(0, 2).join('; ') || 'evidence incomplete'}`
        : 'Hermes service is not active')
    }
    if (index === 16) {
      const statePath = join(root, '.runtime', 'ops-monitor-state.json')
      const authFailuresPath = join(root, '.runtime', 'auth-failures.jsonl')
      let state
      try {
        state = JSON.parse(readFileSync(statePath, 'utf8'))
      } catch {
        state = null
      }
      const readiness = getReadiness()
      const backupReady = readiness?.checks?.backups?.status === 'pass'
      const runtimeBuildReady = readiness?.checks?.deploymentIdentity?.status === 'pass'
      const correlatedDeployment = recentDeploymentCorrelationEvidence(root)
      const verified = serviceActive && backupReady && correlatedDeployment && Array.isArray(state?.serviceHealthHistory) &&
        state.serviceHealthHistory.length > 0 && existsSync(authFailuresPath) &&
        readFileSync(authFailuresPath, 'utf8').trim().length > 0 && runtimeBuildReady
      return evidence(verified, verified
        ? 'deployment correlation, service history, backup freshness, structured auth evidence, and runtime build identity are coherent'
        : `deployment correlation, service history, backup freshness, structured auth evidence, or runtime build identity is missing/degraded`)
    }
    if (index === 17) {
      const smoke = recentAuthenticatedSmokeEvidence(root)
      const verified = smoke.ok && smoke.labels.has('mobile command search opens Settings')
      return evidence(verified, verified ? 'authenticated grouped-settings navigation passed' : `settings navigation evidence: ${smoke.detail}`)
    }
    if (index === 18) {
      const smoke = recentAuthenticatedSmokeEvidence(root)
      const verified = smoke.ok && smoke.labels.has('feature-flag API returns staged rollout decisions')
      return evidence(verified, verified ? 'authenticated feature-flag rollout smoke passed' : `feature-flag evidence: ${smoke.detail}`)
    }
    if (index === 19) {
      return evidence(false, 'final audit status is derived after all prerequisite items are evaluated')
    }
    return evidence(false, 'no live evidence collector is configured for this roadmap item')
  }
  const items = ROADMAP.map(([title, files, liveRequirement], index) => {
    const implementationPresent = staticEvidence(roots, files)
    const live = liveEvidenceFor(index)
    const liveEvidence = live.verified
    return {
      id: index + 1,
      title,
      implementationPresent,
      liveEvidence,
      status: liveEvidence ? 'verified' : implementationPresent ? 'implemented-awaiting-live-evidence' : 'missing',
      liveRequirement,
      liveEvidenceDetail: live.detail,
      evidence: implementationPresent ? files : [],
    }
  })
  const prerequisiteItems = items.slice(0, -1)
  const finalItem = items.at(-1)
  if (finalItem) {
    const prerequisitesVerified = prerequisiteItems.every((item) => item.status === 'verified')
    finalItem.liveEvidence = prerequisitesVerified
    finalItem.status = prerequisitesVerified ? 'verified' : 'implemented-awaiting-live-evidence'
    finalItem.liveEvidenceDetail = prerequisitesVerified
      ? 'all preceding roadmap items have current live evidence'
      : `waiting for ${prerequisiteItems.filter((item) => item.status !== 'verified').length} preceding roadmap item(s) to verify`
  }
  // A live service is useful context, never proof that every roadmap item is complete.
  return {
    generatedAt: new Date().toISOString(),
    repository: root,
    head: currentHead || null,
    serviceActive,
    ok: items.every((item) => item.status === 'verified'),
    completionRule: 'Every item requires current live evidence; implementation files alone are insufficient.',
    items,
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const report = buildRoadmapAudit()
  console.log(JSON.stringify(report, null, 2))
  if (!report.ok) process.exitCode = 1
}
