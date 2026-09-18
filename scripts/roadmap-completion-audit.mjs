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
  } catch {
    return ''
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
  const liveEvidenceFor = (index) => {
    if (index === 5) return getReadiness()?.checks?.configurationPreflight?.status === 'pass'
    if (index === 8) return hasDeploymentPreview(getDeploymentPreview())
    if (index === 9) return recentPassedDrEvidence()
    if (index === 10) return getPerformance()?.ok === true
    if (index === 11) return getReleaseHealth()?.ok === true
    if (index === 12) return recentForkPreviewEvidence()
    if (index === 14) {
      return getPrivacySecurity()?.ok === true && getReadiness()?.checks?.security?.status === 'pass'
    }
    if (index === 15) return serviceActive && hasAccessibilityEvidence(getAccessibility())
    if (index === 16) {
      const statePath = join(root, '.runtime', 'ops-monitor-state.json')
      const authFailuresPath = join(root, '.runtime', 'auth-failures.jsonl')
      let state
      try {
        state = JSON.parse(readFileSync(statePath, 'utf8'))
      } catch {
        state = null
      }
      const backupReady = getReadiness()?.checks?.backups?.status === 'pass'
      return serviceActive && backupReady && Array.isArray(state?.serviceHealthHistory) &&
        state.serviceHealthHistory.length > 0 && existsSync(authFailuresPath) &&
        readFileSync(authFailuresPath, 'utf8').trim().length > 0
    }
    return false
  }
  const items = ROADMAP.map(([title, files, liveRequirement], index) => {
    const implementationPresent = staticEvidence(roots, files)
    const liveEvidence = liveEvidenceFor(index)
    return {
      id: index + 1,
      title,
      implementationPresent,
      liveEvidence,
      status: liveEvidence ? 'verified' : implementationPresent ? 'implemented-awaiting-live-evidence' : 'missing',
      liveRequirement,
      evidence: implementationPresent ? files : [],
    }
  })
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
