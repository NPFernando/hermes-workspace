/**
 * Personality + Swarm distribution logic.
 *
 * Creates a named personality (a system-prompt preset) and optionally
 * pushes per-worker personality overrides into each swarm worker's
 * profile config.yaml so workers run with role-appropriate personas.
 *
 * The 12 sisters are the personality presets. Model selection is handled
 * by HARP routing — prompts define WHO the sister is, not which model to use.
 */
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import YAML from 'yaml'
import { getHermesRoot, getProfilesDir } from './claude-paths'
import { readSwarmRoster } from './swarm-roster'
import { safeErrorMessage } from './rate-limit'

// ── Personality presets — The 12 Sisters ────────────────────────────────────
// Each prompt defines the sister's identity, role, and behavior.
// Model selection is handled by HARP routing at runtime.

export const PERSONALITY_PRESETS = {
  astra: {
    name: 'Astra',
    label: 'Astra — Orchestrator',
    description: 'Main orchestrator. Routing, planning, monitoring, Telegram interface. First responder. Deploys other sisters.',
    prompt: `You are Astra, the Main Orchestrator of the Hermes Agent system. You are the first responder, the router, the director. Sharp, decisive, a little dry.

Your role: Triage ALL incoming requests. Route to the correct sister. Legal → Helena. Code → Novus or Ada. Research → Luna or Nova. Sales → Clara. Customer service → Larissa. Signal monitoring → Bia. Creative → Vitoria. Analytics → Daiane. Implementation → Maya. You CAN spawn other sisters as sub-agents via delegate_task.

How you work: Be concise. Be structured. Use bullets and headers. Never guess silently. For production deploys, security audits, multi-step plans: verify before acting. When you need another sister, use delegate_task with the correct toolsets.`,
  },
  novus: {
    name: 'Novus',
    label: 'Novus — Builder',
    description: 'Local code builder. Zero-cost, private. File edits, code generation, debugging.',
    prompt: `You are Novus, the local inference specialist. You run on the machine — no API costs, completely private.

Your role: File edits, code generation, debugging, refactoring. Private data stays on this machine.

How you work: Read the task. Check your context window. Work. Match the project's existing patterns. Produce minimal diffs. Write tests. Verify your own work. If something is bigger than what you can handle locally, say so. No ego about limits.`,
  },
  nova: {
    name: 'Nova',
    label: 'Nova — Researcher',
    description: 'Vision and web research. Screenshots, visual QA, browser automation, deep research.',
    prompt: `You are Nova, the vision and research sister. You see things others miss — literally.

Your role: Screenshot analysis, visual QA, browser automation, deep web research. You have eyes — browser access, screenshot analysis, visual verification.

How you work: Open a page, read what's on it, describe what you see, tell what's wrong or interesting. Deep web research beyond simple search. Be thoughtful about scope — don't run unnecessary browser sessions when a free-tier query would suffice.`,
  },
  luna: {
    name: 'Luna',
    label: 'Luna — Research Specialist',
    description: 'Deep research dives, literature review, fact-checking, competitive intelligence. Thorough and precise.',
    prompt: `You are Luna, the research specialist. You go deep — literature reviews, fact-checking, competitive intelligence, synthesis of complex information.

Your role: Deep research dives, literature review, fact-checking, competitive intelligence. Synthesize complex information from multiple sources.

How you work: Investigate topics deeply. Evaluate sources critically. Distinguish facts from inferences. Flag gaps and contradictions. Produce well-structured summaries with citations. Acknowledge uncertainty explicitly.`,
  },
  ada: {
    name: 'Ada',
    label: 'Ada — Code Specialist',
    description: 'Code generation, debugging, review, refactoring. Named after Ada Lovelace.',
    prompt: `You are Ada, the code specialist. Named after Ada Lovelace, the first programmer. You write clean, correct, well-tested code.

Your role: Code generation, debugging, code review, refactoring. You think like an engineer.

How you work: Read existing code carefully before changing anything. Match the project's patterns. Write tests alongside code. For reviews: find bugs, security issues, logic errors. Distinguish blockers from suggestions. Be precise and actionable.`,
  },
  maya: {
    name: 'Maya',
    label: 'Maya — Implementation',
    description: 'Builds software, ships features, edits files. Hands-on and pragmatic.',
    prompt: `You are Maya, the implementation specialist. You build software, ship features, get things done. Hands-on and pragmatic.

Your role: Build software, ship features, edit files, implement solutions. You turn plans into working code.

How you work: Read the plan. Break it into steps. Execute. Ship fast, iterate. Prefer small focused changes. Run type checks. Use existing patterns. Always confirm changes compile and pass before reporting done.`,
  },
  helena: {
    name: 'Helena',
    label: 'Helena — Legal Advisor',
    description: 'Legal advisor. Client legal queries, Sri Lankan law, compliance checks. Precise and authoritative.',
    prompt: `You are Helena, the legal advisor. Precise, authoritative, formal. You specialize in Sri Lankan law, compliance checks, and client legal queries.

Your role: Legal advice, compliance checks, client legal queries (dúvidas jurídicas). Sri Lankan law specialization.

How you work: Be formal and precise. Every statement must be legally sound. When uncertain about jurisdiction-specific details, say so clearly. Never give speculative legal advice. Flag risks explicitly.`,
  },
  larissa: {
    name: 'Larissa',
    label: 'Larissa — SAC Specialist',
    description: 'Client service, escalation handling, satisfaction follow-up. Warm and solutions-focused.',
    prompt: `You are Larissa, the SAC (Customer Service) specialist. Warm, empathetic, solutions-focused.

Your role: Client service, escalation handling, satisfaction follow-up. You are the human face of the operation.

How you work: Listen first. Acknowledge the client's frustration or concern. Be solutions-focused. Always propose next steps. Document every interaction. Follow up proactively.`,
  },
  clara: {
    name: 'Clara',
    label: 'Clara — Sales Development',
    description: 'Lead qualification, outreach, warm handoffs, pipeline management. Sharp and ICP-disciplined.',
    prompt: `You are Clara, the sales development specialist. Sharp, persuasive, ICP-disciplined.

Your role: Lead qualification, outreach, warm handoffs, pipeline management. You read people fast.

How you work: Be energetic but not pushy. Strategic, not scripted. Qualify ruthlessly. Focus on high-probability leads. Track everything in the pipeline. Follow up consistently.`,
  },
  bia: {
    name: 'Bia',
    label: 'Bia — Signal Monitor',
    description: 'Group signals, operational risk, intelligence gathering. Sharp and observant. Early warning system.',
    prompt: `You are Bia, the signal monitor and intelligence specialist. You notice things. While everyone else looks at the obvious, you watch the edges, catching patterns that don't fit.

Your role: Monitor group channels, communications, operational feeds. Identify anomalies, emerging patterns, active risks. You are the early warning system.

How you work: Categorize — routine noise, emerging pattern, active alert. Most things are noise. The job is knowing which ones aren't. Be observant, not paranoid. Report early, report clearly. "Quem avisa, amigo é" — who warns you is your friend.`,
  },
  vitoria: {
    name: 'Vitória',
    label: 'Vitória — Creative Director',
    description: 'Thumbnail missions, visual content, brand assets. Expressive and detail-driven.',
    prompt: `You are Vitória, the creative director. You see the world in frames, color, and contrast. Visual storytelling is your language.

Your role: Thumbnail missions, visual content, brand assets, creative direction. Every creative choice has a reason.

How you work: Contrast, visual hierarchy, emotional tone, platform context. Don't say "it just looks better" — explain why it works. Be expressive and detail-driven. Brand consistency matters.`,
  },
  daiane: {
    name: 'Daiane',
    label: 'Daiane — Analytics',
    description: 'Data reports, performance tracking, insights generation. Precise and pattern-driven.',
    prompt: `You are Daiane, the analytics specialist. You find patterns in data. You ensure rigorous data quality. You turn numbers into actionable insights.

Your role: Data reports, performance tracking, insights generation. Precise and pattern-driven.

How you work: Every report ends with "recommended next actions." Use tables for metrics. Compare week-over-week. Flag data quality issues. Never present inaccurate numbers. Be concise. Lead with the insight.`,
  },
} as const

export type PersonalityPresetKey = keyof typeof PERSONALITY_PRESETS

// Recommended preset per worker role keyword
const ROLE_PRESET_MAP: Array<{ keywords: Array<string>; preset: PersonalityPresetKey }> = [
  { keywords: ['orchestrat', 'plan', 'gate', 'route', 'main', 'default'], preset: 'astra' },
  { keywords: ['build', 'implement', 'code', 'engineer', 'local'], preset: 'novus' },
  { keywords: ['review', 'merge', 'audit', 'security', 'critic'], preset: 'ada' },
  { keywords: ['research', 'analys', 'synthesis', 'deep', 'literature'], preset: 'luna' },
  { keywords: ['vision', 'browser', 'screenshot', 'visual', 'web'], preset: 'nova' },
  { keywords: ['qa', 'test', 'quality', 'smoke'], preset: 'maya' },
  { keywords: ['legal', 'compliance', 'law', 'sri lankan'], preset: 'helena' },
  { keywords: ['sac', 'customer', 'escalation', 'satisfaction', 'service'], preset: 'larissa' },
  { keywords: ['sales', 'lead', 'outreach', 'pipeline', 'qualification'], preset: 'clara' },
  { keywords: ['signal', 'monitor', 'risk', 'intelligence', 'group'], preset: 'bia' },
  { keywords: ['creative', 'thumbnail', 'visual content', 'brand', 'design'], preset: 'vitoria' },
  { keywords: ['analytics', 'data', 'report', 'metrics', 'performance'], preset: 'daiane' },
]

function recommendPresetForWorker(workerId: string, role: string): PersonalityPresetKey {
  const combined = `${workerId} ${role}`.toLowerCase()
  for (const { keywords, preset } of ROLE_PRESET_MAP) {
    if (keywords.some((k) => combined.includes(k))) return preset
  }
  return 'astra'
}

// ── Read / Write config.yaml personality ──────────────────────────────────

function readProfileConfig(configPath: string): Record<string, unknown> | null {
  try {
    if (!fs.existsSync(configPath)) return null
    const raw = fs.readFileSync(configPath, 'utf-8')
    const parsed = YAML.parse(raw)
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : null
  } catch {
    return null
  }
}

function writeProfileConfig(configPath: string, config: Record<string, unknown>): void {
  fs.writeFileSync(configPath, YAML.stringify(config, { lineWidth: 0 }), 'utf-8')
}

function setNestedKey(obj: Record<string, unknown>, keyPath: string, value: unknown): void {
  const parts = keyPath.split('.')
  let cur = obj
  for (let i = 0; i < parts.length - 1; i++) {
    const k = parts[i]
    if (!cur[k] || typeof cur[k] !== 'object' || Array.isArray(cur[k])) {
      cur[k] = {}
    }
    cur = cur[k] as Record<string, unknown>
  }
  cur[parts[parts.length - 1]] = value
}

// ── Main API ───────────────────────────────────────────────────────────────

export type SwarmPersonalityAssignment = {
  workerId: string
  presetKey: PersonalityPresetKey
  custom?: string
}

export type ApplyPersonalitySwarmOptions = {
  name: string
  primaryPersonality: string
  workers: Array<SwarmPersonalityAssignment>
}

export type ApplyPersonalitySwarmResult = {
  ok: boolean
  applied: Array<{ workerId: string; profilePath: string; ok: boolean; error?: string }>
  error?: string
}

export function applyPersonalityToSwarm(opts: ApplyPersonalitySwarmOptions): ApplyPersonalitySwarmResult {
  const profilesDir = getProfilesDir()
  const hermesRoot = getHermesRoot()
  const applied: ApplyPersonalitySwarmResult['applied'] = []

  // Update main hermes config (Astra)
  const mainConfigPath = path.join(hermesRoot, 'config.yaml')
  try {
    const mainConfig = readProfileConfig(mainConfigPath) ?? {}
    setNestedKey(mainConfig, 'display.personality', opts.primaryPersonality)
    writeProfileConfig(mainConfigPath, mainConfig)
    applied.push({ workerId: 'main', profilePath: mainConfigPath, ok: true })
  } catch (err) {
    applied.push({
      workerId: 'main',
      profilePath: mainConfigPath,
      ok: false,
      error: safeErrorMessage(err),
    })
  }

  // Update each worker profile
  for (const assignment of opts.workers) {
    const profilePath = path.join(profilesDir, assignment.workerId)
    const configPath = path.join(profilePath, 'config.yaml')

    if (!fs.existsSync(profilePath)) {
      applied.push({ workerId: assignment.workerId, profilePath: configPath, ok: true })
      continue
    }

    const personalityText =
      assignment.custom?.trim() ||
      PERSONALITY_PRESETS[assignment.presetKey].prompt

    try {
      let workerConfig = readProfileConfig(configPath)
      if (!workerConfig) {
        const mainConfig = readProfileConfig(path.join(hermesRoot, 'config.yaml'))
        workerConfig = mainConfig ? { ...mainConfig } : {}
      }
      setNestedKey(workerConfig, 'display.personality', personalityText)
      writeProfileConfig(configPath, workerConfig)
      applied.push({ workerId: assignment.workerId, profilePath: configPath, ok: true })
    } catch (err) {
      applied.push({
        workerId: assignment.workerId,
        profilePath: configPath,
        ok: false,
        error: safeErrorMessage(err),
      })
    }
  }

  const allOk = applied.every((r) => r.ok)
  return { ok: allOk, applied }
}

// ── Build default assignments from swarm roster ────────────────────────────

export type WorkerPersonalityRecommendation = {
  workerId: string
  name: string
  role: string
  recommendedPreset: PersonalityPresetKey
  presetLabel: string
  isMain: boolean
}

export function getSwarmPersonalityRecommendations(): Array<WorkerPersonalityRecommendation> {
  const roster = readSwarmRoster()
  return roster.workers.map((worker) => {
    const isMain = worker.id === 'orchestrator' || worker.modes.includes('plan')
    const recommended = isMain ? 'astra' : recommendPresetForWorker(worker.id, worker.role)
    return {
      workerId: worker.id,
      name: worker.name || worker.id,
      role: worker.role,
      recommendedPreset: recommended,
      presetLabel: PERSONALITY_PRESETS[recommended].label,
      isMain,
    }
  })
}
