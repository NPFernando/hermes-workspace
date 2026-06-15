import { useMemo, useState } from 'react'
import { HugeiconsIcon } from '@hugeicons/react'
import { Refresh01Icon, Idea01Icon, Alert01Icon, CheckmarkCircle01Icon } from '@hugeicons/core-free-icons'
import type { DashboardOverview } from '@/server/dashboard-aggregator'

type Suggestion = {
  id: string
  icon: 'idea' | 'warn' | 'ok'
  title: string
  body: string
  impact: 'high' | 'medium' | 'low'
  href?: string
}

const NEMOTRON_FREE = 'nvidia/nemotron-3-super-120b-a12b:free'

// Models considered "should have been free" — not subscription/local, not already free tier
function isPaidAndReplaceable(modelId: string): boolean {
  const id = modelId.toLowerCase()
  // Already free
  if (id.includes(':free') || id.includes('nemotron') || id.includes('gemma') || id.includes('llama')) return false
  // Subscription / local — no real cost
  if (id.startsWith('pc1-') || id.startsWith('pc2-') || id.includes('ollama') || id.includes('lmstudio') || id.includes('minimax')) return false
  if (id.includes('anthropic-oauth') || id.includes('claude-') && id.includes('oauth')) return false
  // These are real paid calls
  return id.includes('claude') || id.includes('gpt') || id.includes('deepseek') || id.includes('openai')
}

function buildSuggestions(overview: DashboardOverview | null, cycleIdx: number): Suggestion[] {
  const suggestions: Suggestion[] = []

  if (!overview) {
    suggestions.push({
      id: 'no-data',
      icon: 'idea',
      title: 'Dashboard loading',
      body: 'Overview data not yet available. Suggestions will appear once analytics are loaded.',
      impact: 'low',
    })
    return suggestions
  }

  const analytics = overview.analytics
  const status = overview.status

  // ── 1. Paid model usage that could be Nemotron free ────────────────────────
  if (analytics && analytics.source === 'analytics') {
    const paidModels = analytics.topModels.filter(
      (m) => isPaidAndReplaceable(m.id) && m.cost > 0,
    )
    if (paidModels.length > 0) {
      const top = paidModels.sort((a, b) => b.cost - a.cost)[0]
      suggestions.push({
        id: 'paid-model',
        icon: 'idea',
        title: `Route ${top.id.split('/').pop() ?? top.id} to Nemotron free`,
        body: `${top.id} has been used across ${top.sessions} session${top.sessions !== 1 ? 's' : ''} (${top.calls} calls). For non-critical tasks, ${NEMOTRON_FREE} is free and often comparable quality. Run HARP to check: harp-select-route.py --task text_summary --risk standard`,
        impact: top.cost > 0.5 ? 'high' : 'medium',
        href: '/dashboard',
      })
    }

    // ── 2. Cache hit rate low ──────────────────────────────────────────────
    const denom = analytics.cacheReadTokens + analytics.inputTokens
    if (denom > 0) {
      const rate = (analytics.cacheReadTokens / denom) * 100
      if (rate < 25) {
        suggestions.push({
          id: 'cache-low',
          icon: 'warn',
          title: 'Cache hit rate below 25%',
          body: `Only ${rate.toFixed(0)}% of input tokens are cache reads. Pin shared system prompts (HARP context, SOUL.md snippets) into a stable preamble — each cache hit saves full input cost.`,
          impact: 'medium',
          href: '/analytics',
        })
      } else if (rate > 60) {
        suggestions.push({
          id: 'cache-good',
          icon: 'ok',
          title: 'Cache efficiency is strong',
          body: `${rate.toFixed(0)}% cache hit rate — your shared preambles are working. Maintain the stable prefix structure to keep this high.`,
          impact: 'low',
        })
      }
    }

    // ── 3. High total cost this period ────────────────────────────────────
    if (analytics.estimatedCostUsd !== null && analytics.estimatedCostUsd > 2) {
      suggestions.push({
        id: 'high-spend',
        icon: 'warn',
        title: `$${analytics.estimatedCostUsd.toFixed(2)} spent this period`,
        body: `Check OpenRouter credits: run \`~/.hermes/scripts/openrouter_credits_check.sh\`. For anything < production risk, HARP should be routing to Nemotron free first before escalating.`,
        impact: 'high',
      })
    }
  }

  // ── 4. Agents needing setup ────────────────────────────────────────────
  if (status) {
    const needSetup = status.activeSessions === 0 && status.activeAgents === 0
    if (needSetup) {
      suggestions.push({
        id: 'no-sessions',
        icon: 'idea',
        title: 'No active sessions detected',
        body: 'Gateway shows no running sessions. Check that agent profiles (Astra, Novus, etc.) have been started, or trigger a cron job to wake one up.',
        impact: 'medium',
        href: '/operations',
      })
    }
  }

  // ── 5. Generic optimization if nothing else ────────────────────────────
  if (suggestions.length === 0) {
    const defaults: Suggestion[] = [
      {
        id: 'harp-tip',
        icon: 'idea',
        title: 'Use HARP before every complex task',
        body: 'Run harp-select-route.py with the task type and risk level — it scores live model availability and picks the best free option first, escalating to paid only when justified.',
        impact: 'medium',
      },
      {
        id: 'novus-tip',
        icon: 'idea',
        title: 'Novus handles private file work for free',
        body: 'File edits, code generation, and private data processing stay on-device with Novus (Ollama hermes3:8b) — zero API cost and full privacy. Route to Novus first for low-risk local tasks.',
        impact: 'low',
      },
      {
        id: 'soul-tip',
        icon: 'idea',
        title: 'All 12 agents now have personality SOUL.md',
        body: 'Astra, Novus, Nova, Luna, Ada, Maya, Helena, Larissa, Clara, Bia, Vitória, and Daiane all have rich system prompts. Edit ~/.hermes/profiles/<name>/SOUL.md to customise any agent.',
        impact: 'low',
        href: '/profiles',
      },
    ]
    return [defaults[cycleIdx % defaults.length]]
  }

  return suggestions
}

export function ProactiveSuggestionsCard({
  overview,
}: {
  overview: DashboardOverview | null
}) {
  const [cycleIdx, setCycleIdx] = useState(0)

  const suggestions = useMemo(
    () => buildSuggestions(overview, cycleIdx),
    [overview, cycleIdx],
  )

  // Show one suggestion at a time, cycle on refresh
  const active = suggestions[cycleIdx % suggestions.length]
  if (!active) return null

  const iconNode =
    active.icon === 'warn' ? (
      <HugeiconsIcon icon={Alert01Icon} size={13} strokeWidth={1.8} style={{ color: 'var(--theme-warning)' }} />
    ) : active.icon === 'ok' ? (
      <HugeiconsIcon icon={CheckmarkCircle01Icon} size={13} strokeWidth={1.8} style={{ color: 'var(--theme-success)' }} />
    ) : (
      <HugeiconsIcon icon={Idea01Icon} size={13} strokeWidth={1.8} style={{ color: 'var(--theme-accent)' }} />
    )

  const impactColor =
    active.impact === 'high'
      ? 'var(--theme-warning)'
      : active.impact === 'medium'
        ? 'var(--theme-accent)'
        : 'var(--theme-muted)'

  return (
    <div
      className="relative flex flex-col gap-2 overflow-hidden rounded-xl border p-3"
      style={{
        background:
          'linear-gradient(135deg, color-mix(in srgb, var(--theme-card) 97%, transparent), color-mix(in srgb, var(--theme-card) 93%, transparent))',
        borderColor: 'var(--theme-border)',
      }}
    >
      {/* top accent bar */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-x-0 top-0 h-[2px]"
        style={{
          background:
            'linear-gradient(90deg, var(--theme-accent), color-mix(in srgb, var(--theme-accent) 30%, transparent), transparent)',
        }}
      />

      <div className="flex items-center justify-between">
        <h3
          className="text-[10px] font-semibold uppercase tracking-[0.18em]"
          style={{ color: 'var(--theme-text)' }}
        >
          Optimization hint
        </h3>
        <div className="flex items-center gap-1.5">
          <span
            className="rounded-full px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-[0.1em]"
            style={{ color: impactColor, background: `color-mix(in srgb, ${impactColor} 12%, transparent)` }}
          >
            {active.impact}
          </span>
          <button
            type="button"
            aria-label="Next suggestion"
            onClick={() => setCycleIdx((i) => i + 1)}
            className="inline-flex h-5 w-5 items-center justify-center rounded-md transition-colors hover:bg-[var(--theme-bg)]"
            style={{ color: 'var(--theme-muted)' }}
          >
            <HugeiconsIcon icon={Refresh01Icon} size={11} strokeWidth={1.8} />
          </button>
        </div>
      </div>

      <div className="flex gap-2">
        <span className="mt-0.5 shrink-0">{iconNode}</span>
        <div className="min-w-0 flex-1">
          <p
            className="text-[11px] font-medium leading-tight"
            style={{ color: 'var(--theme-text)' }}
          >
            {active.title}
          </p>
          <p
            className="mt-0.5 text-[10px] leading-relaxed"
            style={{ color: 'var(--theme-muted)' }}
          >
            {active.body}
          </p>
          {active.href ? (
            <a
              href={active.href}
              className="mt-1 inline-block text-[9px] font-semibold uppercase tracking-[0.12em] transition-opacity hover:opacity-80"
              style={{ color: 'var(--theme-accent)' }}
            >
              Open →
            </a>
          ) : null}
        </div>
      </div>

      {suggestions.length > 1 ? (
        <p
          className="text-right text-[9px]"
          style={{ color: 'var(--theme-muted)' }}
        >
          {(cycleIdx % suggestions.length) + 1} / {suggestions.length}
        </p>
      ) : null}
    </div>
  )
}
