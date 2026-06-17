import { execFileSync, spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'

// ── constants ─────────────────────────────────────────────────────────────────

// Files Naveen has customized on top of upstream. Any upstream commit that
// touches these files needs review before applying.
export const NAVEEN_CUSTOM_FILES: ReadonlyArray<string> = [
  'server-entry.js',
  'src/components/settings/settings-sidebar.tsx',
  'src/components/update-center-notifier.tsx',
  'src/routes/api/harp-config.ts',
  'src/routes/api/personality-swarm.ts',
  'src/routes/settings/index.tsx',
  'src/screens/profiles/profiles-screen.tsx',
  'src/screens/settings/harp-config-screen.tsx',
  'src/server/harp-config-store.ts',
  'src/server/personality-swarm-store.ts',
  'src/server/tasks-store.ts',
  'src/lib/tasks-api.ts',
  'src/screens/tasks/task-card.tsx',
  'src/screens/tasks/tasks-screen.tsx',
]

const PNPM_BIN =
  process.env.PNPM_BIN ??
  path.join(os.homedir(), '.hermes', 'node', 'bin', 'pnpm')

const CWD = process.cwd()
const RUNTIME_DIR = path.join(CWD, '.runtime')
const STATUS_CACHE_FILE = path.join(RUNTIME_DIR, 'naveen-update-status.json')
const AI_CACHE_FILE = path.join(RUNTIME_DIR, 'naveen-ai-analysis.json')
const STATUS_CACHE_TTL = 25 * 60 * 1000

// ── types ─────────────────────────────────────────────────────────────────────

export type ConflictFile = {
  file: string
  upstreamDiffStat: string
  ourDiffStat: string
  upstreamDiff: string
  ourDiff: string
}

export type NaveenUpdateStatus = {
  available: boolean
  ourAhead: number
  upstreamBehind: number
  mergeBase: string | null
  upstreamNewCommits: Array<string>
  customFilesUpstreamTouched: Array<string>
  potentialConflicts: Array<ConflictFile>
  canAutoRebase: boolean
  checkedAt: number
  error?: string
}

export type ResolutionStrategy = 'keep_ours' | 'take_theirs'

export type NaveenApplyOptions = {
  strategy?: ResolutionStrategy | 'auto'
  perFileStrategy?: Record<string, ResolutionStrategy>
}

export type NaveenApplyResult = {
  ok: boolean
  output: string
  conflictFiles: Array<string>
  pushedToFork: boolean
  restartRequired: boolean
  error?: string
}

export type AiFileRecommendation = {
  file: string
  action: ResolutionStrategy | 'needs_manual_merge'
  confidence: number
  reason: string
}

export type NaveenAiAnalysis = {
  recommendations: Array<AiFileRecommendation>
  summary: string
  checkedAt: number
}

// ── helpers ───────────────────────────────────────────────────────────────────

function git(args: Array<string>, cwd = CWD, timeout = 10_000): string | null {
  try {
    return (
      execFileSync('git', args, {
        cwd,
        encoding: 'utf8',
        timeout,
        stdio: ['pipe', 'pipe', 'pipe'],
      }).trim() || null
    )
  } catch {
    return null
  }
}

function gitOrThrow(args: Array<string>, cwd = CWD, timeout = 60_000): string {
  return execFileSync('git', args, {
    cwd,
    encoding: 'utf8',
    timeout,
    stdio: ['pipe', 'pipe', 'pipe'],
  }).trim()
}

function resolveHermesBin(): string {
  const candidates = [
    process.env.HERMES_BIN,
    path.join(os.homedir(), '.local', 'bin', 'hermes'),
    path.join(os.homedir(), '.hermes', 'bin', 'hermes'),
    '/usr/local/bin/hermes',
  ].filter(Boolean) as Array<string>
  for (const p of candidates) {
    try {
      if (existsSync(p)) return p
    } catch {
      /* skip */
    }
  }
  return 'hermes'
}

const HERMES_BIN = resolveHermesBin()

function ensureRuntime(): void {
  mkdirSync(RUNTIME_DIR, { recursive: true })
}

function parseConflictFilesFromOutput(text: string): Array<string> {
  const files: Array<string> = []
  for (const line of text.split('\n')) {
    const m = line.match(/CONFLICT.*?:\s+Merge conflict in (.+)$/)
    if (m) files.push(m[1].trim())
  }
  return [...new Set(files)]
}

function getUnresolvedConflicts(cwd = CWD): Array<string> {
  const raw = git(['diff', '--name-only', '--diff-filter=U'], cwd)
  return raw?.split('\n').filter(Boolean) ?? []
}

function isInRebase(cwd = CWD): boolean {
  return (
    existsSync(path.join(cwd, '.git', 'rebase-merge')) ||
    existsSync(path.join(cwd, '.git', 'rebase-apply'))
  )
}

// ── cache ─────────────────────────────────────────────────────────────────────

function readStatusCache(): NaveenUpdateStatus | null {
  try {
    const raw = JSON.parse(readFileSync(STATUS_CACHE_FILE, 'utf8')) as NaveenUpdateStatus & {
      _ts?: number
    }
    if (Date.now() - (raw._ts ?? 0) < STATUS_CACHE_TTL) return raw
  } catch {
    /* ignore */
  }
  return null
}

function writeStatusCache(status: NaveenUpdateStatus): void {
  ensureRuntime()
  writeFileSync(
    STATUS_CACHE_FILE,
    JSON.stringify({ ...status, _ts: Date.now() }, null, 2) + '\n',
  )
}

export function invalidateStatusCache(): void {
  try {
    writeFileSync(STATUS_CACHE_FILE, JSON.stringify({ _ts: 0 }))
  } catch {
    /* ignore */
  }
}

// ── readNaveenUpdateStatus ────────────────────────────────────────────────────

export function readNaveenUpdateStatus(skipCache = false): NaveenUpdateStatus {
  if (!skipCache) {
    const cached = readStatusCache()
    if (cached) return cached
  }

  // Fetch upstream
  git(['fetch', 'origin', '--quiet'], CWD, 30_000)

  const mergeBase = git(['merge-base', 'HEAD', 'origin/main'])
  if (!mergeBase) {
    return {
      available: false,
      ourAhead: 0,
      upstreamBehind: 0,
      mergeBase: null,
      upstreamNewCommits: [],
      customFilesUpstreamTouched: [],
      potentialConflicts: [],
      canAutoRebase: false,
      checkedAt: Date.now(),
      error: 'Could not find common ancestor with origin/main',
    }
  }

  // LEFT = our commits ahead of origin/main (our custom work)
  // RIGHT = upstream commits we don't have yet
  const divRaw = git(['rev-list', '--left-right', '--count', `HEAD...origin/main`])
  const [leftStr = '0', rightStr = '0'] = (divRaw || '0\t0').split(/\s+/)
  const ourAhead = Number(leftStr)
  const upstreamBehind = Number(rightStr)

  if (upstreamBehind === 0) {
    const status: NaveenUpdateStatus = {
      available: false,
      ourAhead,
      upstreamBehind: 0,
      mergeBase,
      upstreamNewCommits: [],
      customFilesUpstreamTouched: [],
      potentialConflicts: [],
      canAutoRebase: true,
      checkedAt: Date.now(),
    }
    writeStatusCache(status)
    return status
  }

  // New upstream commits
  const commitsRaw = git(
    ['log', '--pretty=format:%s (%h)', `${mergeBase}..origin/main`],
    CWD,
    10_000,
  )
  const upstreamNewCommits = commitsRaw?.split('\n').filter(Boolean).slice(0, 20) ?? []

  // Files upstream changed
  const upstreamChangedRaw = git(['diff', '--name-only', mergeBase, 'origin/main'])
  const upstreamChangedFiles = new Set(upstreamChangedRaw?.split('\n').filter(Boolean) ?? [])

  // Files we changed
  const ourChangedRaw = git(['diff', '--name-only', mergeBase, 'HEAD'])
  const ourChangedFiles = new Set(ourChangedRaw?.split('\n').filter(Boolean) ?? [])

  // Custom files upstream touched
  const customFilesUpstreamTouched = NAVEEN_CUSTOM_FILES.filter((f) =>
    upstreamChangedFiles.has(f),
  )

  // Files both sides changed = potential rebase conflicts
  const potentialConflicts: Array<ConflictFile> = []
  for (const file of customFilesUpstreamTouched) {
    if (!ourChangedFiles.has(file)) continue
    const upstreamDiffStat =
      git(['diff', '--stat', mergeBase, 'origin/main', '--', file])?.split('\n')[0] ??
      'changed upstream'
    const ourDiffStat =
      git(['diff', '--stat', mergeBase, 'HEAD', '--', file])?.split('\n')[0] ??
      'changed locally'
    const upstreamDiff =
      (git(['-c', 'color.diff=never', 'diff', '-U3', mergeBase, 'origin/main', '--', file]) ?? '').slice(
        0,
        3000,
      )
    const ourDiff =
      (git(['-c', 'color.diff=never', 'diff', '-U3', mergeBase, 'HEAD', '--', file]) ?? '').slice(0, 3000)
    potentialConflicts.push({ file, upstreamDiffStat, ourDiffStat, upstreamDiff, ourDiff })
  }

  const status: NaveenUpdateStatus = {
    available: true,
    ourAhead,
    upstreamBehind,
    mergeBase,
    upstreamNewCommits,
    customFilesUpstreamTouched,
    potentialConflicts,
    canAutoRebase: customFilesUpstreamTouched.length === 0,
    checkedAt: Date.now(),
  }
  writeStatusCache(status)
  return status
}

// ── applyNaveenSmartUpdate ────────────────────────────────────────────────────

export function applyNaveenSmartUpdate(options: NaveenApplyOptions = {}): NaveenApplyResult {
  const output: Array<string> = []
  const rebaseEnv: NodeJS.ProcessEnv = {
    ...process.env,
    GIT_EDITOR: 'true',
    GIT_TERMINAL_PROMPT: '0',
    VISUAL: 'true',
    EDITOR: 'true',
  }

  if (isInRebase()) {
    return {
      ok: false,
      output: '',
      conflictFiles: [],
      pushedToFork: false,
      restartRequired: false,
      error: 'Git rebase already in progress. Run: git rebase --abort',
    }
  }

  if (git(['status', '--porcelain'])) {
    return {
      ok: false,
      output: '',
      conflictFiles: [],
      pushedToFork: false,
      restartRequired: false,
      error: 'Working tree has uncommitted changes. Cannot rebase.',
    }
  }

  // Fetch latest
  git(['fetch', 'origin', '--quiet'], CWD, 30_000)

  // Start rebase
  const rebaseResult = spawnSync('git', ['rebase', 'origin/main'], {
    cwd: CWD,
    encoding: 'utf8',
    timeout: 60_000,
    env: rebaseEnv,
  })
  output.push(rebaseResult.stdout, rebaseResult.stderr)

  if (rebaseResult.status === 0) {
    invalidateStatusCache()
    return _buildAndFinish(output, rebaseEnv)
  }

  // Conflicts found — check if we have a resolution strategy
  const { strategy, perFileStrategy } = options
  const hasStrategy =
    (strategy && strategy !== 'auto') ||
    (perFileStrategy && Object.keys(perFileStrategy).length > 0)

  if (!hasStrategy) {
    spawnSync('git', ['rebase', '--abort'], { cwd: CWD, env: rebaseEnv })
    const conflictFiles = parseConflictFilesFromOutput(
      rebaseResult.stdout + rebaseResult.stderr,
    )
    return {
      ok: false,
      output: output.filter(Boolean).join('\n'),
      conflictFiles,
      pushedToFork: false,
      restartRequired: false,
      error: `Rebase conflict in ${conflictFiles.length > 0 ? conflictFiles.join(', ') : 'unknown files'}. Choose a resolution strategy.`,
    }
  }

  // Resolve conflicts in a loop (each rebase commit may have conflicts)
  let iterations = 0
  while (iterations++ < 40) {
    const conflictFiles = getUnresolvedConflicts()
    if (conflictFiles.length === 0) break

    for (const file of conflictFiles) {
      const fileStrategy: ResolutionStrategy =
        perFileStrategy?.[file] ??
        (strategy === 'take_theirs' ? 'take_theirs' : 'keep_ours')
      const gitArg = fileStrategy === 'take_theirs' ? '--theirs' : '--ours'
      spawnSync('git', ['checkout', gitArg, '--', file], { cwd: CWD, env: rebaseEnv })
      spawnSync('git', ['add', '--', file], { cwd: CWD, env: rebaseEnv })
    }

    const continueResult = spawnSync('git', ['rebase', '--continue'], {
      cwd: CWD,
      encoding: 'utf8',
      timeout: 30_000,
      env: rebaseEnv,
    })
    output.push(continueResult.stdout, continueResult.stderr)

    if (continueResult.status === 0 && !isInRebase()) break

    // Empty commit (all changes absorbed) — skip it
    const continueText = continueResult.stdout + continueResult.stderr
    if (
      continueText.includes('nothing to commit') ||
      continueText.includes('No changes') ||
      continueText.includes('empty')
    ) {
      const skipResult = spawnSync('git', ['rebase', '--skip'], {
        cwd: CWD,
        encoding: 'utf8',
        timeout: 30_000,
        env: rebaseEnv,
      })
      output.push(skipResult.stdout, skipResult.stderr)
      if (!isInRebase()) break
    }
  }

  if (isInRebase()) {
    spawnSync('git', ['rebase', '--abort'], { cwd: CWD, env: rebaseEnv })
    return {
      ok: false,
      output: output.filter(Boolean).join('\n'),
      conflictFiles: [],
      pushedToFork: false,
      restartRequired: false,
      error: 'Rebase could not be completed automatically. Aborted.',
    }
  }

  invalidateStatusCache()
  return _buildAndFinish(output, rebaseEnv)
}

function _buildAndFinish(output: Array<string>, env: NodeJS.ProcessEnv): NaveenApplyResult {
  const changedFiles =
    git(['diff', '--name-only', 'HEAD@{1}', 'HEAD'])?.split('\n').filter(Boolean) ?? []

  if (changedFiles.some((f) => f === 'package.json' || f === 'pnpm-lock.yaml')) {
    try {
      output.push(
        execFileSync(PNPM_BIN, ['install', '--no-frozen-lockfile'], {
          cwd: CWD,
          encoding: 'utf8',
          timeout: 180_000,
          stdio: ['pipe', 'pipe', 'pipe'],
          env,
        }).trim(),
      )
    } catch (e: unknown) {
      const err = e as { stderr?: string; stdout?: string }
      output.push(String(err.stderr || err.stdout || e))
    }
  }

  const needsBuild = changedFiles.some(
    (f) =>
      f.startsWith('src/') ||
      f === 'package.json' ||
      f === 'pnpm-lock.yaml' ||
      f.startsWith('vite') ||
      f.startsWith('tsconfig'),
  )
  if (needsBuild) {
    try {
      output.push(
        execFileSync(PNPM_BIN, ['build'], {
          cwd: CWD,
          encoding: 'utf8',
          timeout: 300_000,
          stdio: ['pipe', 'pipe', 'pipe'],
          env,
        }).trim(),
      )
    } catch (e: unknown) {
      const err = e as { stderr?: string; stdout?: string }
      return {
        ok: false,
        output: output.filter(Boolean).join('\n'),
        conflictFiles: [],
        pushedToFork: false,
        restartRequired: false,
        error: `Build failed: ${String(err.stderr || err.stdout || e).slice(0, 500)}`,
      }
    }
  }

  // Push to personal fork
  let pushedToFork = false
  try {
    const branch = git(['rev-parse', '--abbrev-ref', 'HEAD']) ?? 'HEAD'
    const pushResult = spawnSync(
      'git',
      ['push', 'naveen', `${branch}:${branch}`, '--force-with-lease'],
      { cwd: CWD, encoding: 'utf8', timeout: 60_000, env },
    )
    pushedToFork = pushResult.status === 0
    output.push(pushResult.stdout, pushResult.stderr)
  } catch {
    /* push failure is non-fatal */
  }

  return {
    ok: true,
    output: output.filter(Boolean).join('\n'),
    conflictFiles: [],
    pushedToFork,
    restartRequired: needsBuild,
  }
}

// ── generateNaveenAiAnalysis ──────────────────────────────────────────────────

export function generateNaveenAiAnalysis(
  conflicts: Array<ConflictFile>,
): NaveenAiAnalysis {
  if (conflicts.length === 0) {
    return { recommendations: [], summary: 'No conflicts to analyze.', checkedAt: Date.now() }
  }

  const conflictDetails = conflicts
    .map(
      (c) => `
## File: ${c.file}

### Upstream changed:
${c.upstreamDiff || c.upstreamDiffStat}

### We changed:
${c.ourDiff || c.ourDiffStat}
`,
    )
    .join('\n---\n')

  const prompt = `You are reviewing an upstream merge for a customized Hermes workspace install (outsourc-e/hermes-workspace fork).

The upstream repo has new commits that conflict with our local customizations.
For each conflicting file, analyze: what upstream changed, what we changed, are they compatible?

Return ONLY a JSON object (no prose, no markdown fences):
{
  "summary": "one paragraph overall assessment",
  "recommendations": [
    {
      "file": "path/to/file",
      "action": "keep_ours" | "take_theirs" | "needs_manual_merge",
      "confidence": 0-100,
      "reason": "brief reason"
    }
  ]
}

Conflict files:
${conflictDetails}`

  const result = spawnSync(HERMES_BIN, ['-z', prompt], {
    encoding: 'utf8',
    timeout: 90_000,
    maxBuffer: 4 * 1024 * 1024,
  })

  if (!result.stdout.trim()) {
    return {
      recommendations: conflicts.map((c) => ({
        file: c.file,
        action: 'needs_manual_merge' as const,
        confidence: 0,
        reason: 'AI analysis unavailable',
      })),
      summary: 'AI analysis unavailable — hermes did not respond.',
      checkedAt: Date.now(),
    }
  }

  let parsed: AiAnalysisPayload | null = null
  try {
    const text = result.stdout.trim()
    let payloadText = text
    const match = text.match(/\{[\s\S]*\}/)
    if (match) payloadText = match[0]
    parsed = JSON.parse(payloadText) as AiAnalysisPayload
  } catch {
    /* ignore */
  }

  const recommendations = parsed ? parsed.recommendations : []
  const summary = parsed ? parsed.summary : result.stdout.slice(0, 500)
  const analysis: NaveenAiAnalysis = {
    recommendations: Array.isArray(recommendations)
      ? recommendations
      : [],
    summary,
    checkedAt: Date.now(),
  }

  ensureRuntime()
  writeFileSync(AI_CACHE_FILE, JSON.stringify(analysis, null, 2) + '\n')
  return analysis
}

type AiAnalysisPayload = { recommendations: Array<AiFileRecommendation>; summary: string }

export function readCachedAiAnalysis(): NaveenAiAnalysis | null {
  try {
    const raw = JSON.parse(readFileSync(AI_CACHE_FILE, 'utf8')) as NaveenAiAnalysis
    if (Date.now() - raw.checkedAt < 2 * 60 * 60 * 1000) return raw
  } catch {
    /* ignore */
  }
  return null
}
