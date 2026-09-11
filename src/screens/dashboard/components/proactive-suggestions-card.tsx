import { useMemo, useState } from 'react'
import { useNavigate } from '@tanstack/react-router'
import { HugeiconsIcon } from '@hugeicons/react'
import {
  Alert01Icon,
  ArrowRight01Icon,
  CheckmarkCircle01Icon,
  Copy01Icon,
  Idea01Icon,
  Refresh01Icon,
  Tick02Icon,
} from '@hugeicons/core-free-icons'
import type { MouseEvent } from 'react'
import type { DashboardOverview } from '@/server/dashboard-aggregator'
import {
  safeAnalyticsModels,
  safeNumber,
} from '@/screens/dashboard/lib/analytics-normalizers'
import { writeTextToClipboard } from '@/lib/clipboard'

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
  if (
    id.includes(':free') ||
    id.includes('nemotron') ||
    id.includes('gemma') ||
    id.includes('llama')
  )
    return false
  // Subscription / local — no real cost
  if (
    id.startsWith('pc1-') ||
    id.startsWith('pc2-') ||
    id.includes('ollama') ||
    id.includes('lmstudio') ||
    id.includes('minimax')
  )
    return false
  if (
    id.includes('anthropic-oauth') ||
    (id.includes('claude-') && id.includes('oauth'))
  )
    return false
  // These are real paid calls
  return (
    id.includes('claude') ||
    id.includes('gpt') ||
    id.includes('deepseek') ||
    id.includes('openai')
  )
}

function buildSuggestions(
  overview: DashboardOverview | null,
  cycleIdx: number,
): Array<Suggestion> {
  const suggestions: Array<Suggestion> = []

  // No fake "Dashboard loading" suggestion here — the card renders a real
  // loading state instead, so a placeholder never wears a hint's impact
  // chip and icon while data is still on the way.
  if (!overview) return suggestions

  const analytics = overview.analytics
  const status = overview.status

  // ── 1. Paid model usage that could be Nemotron free ────────────────────────
  if (analytics && analytics.source === 'analytics') {
    const paidModels = safeAnalyticsModels(analytics).filter(
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
      })
    }

    // ── 2. Cache hit rate low ──────────────────────────────────────────────
    const denom =
      safeNumber(analytics.cacheReadTokens) + safeNumber(analytics.inputTokens)
    if (denom > 0) {
      const rate = (safeNumber(analytics.cacheReadTokens) / denom) * 100
      if (rate < 25) {
        suggestions.push({
          id: 'cache-low',
          icon: 'warn',
          title: 'Cache hit rate below 25%',
          body: `Only ${rate.toFixed(0)}% of input tokens are cache reads. Pin shared system prompts (HARP context, SOUL.md snippets) into a stable preamble — each cache hit saves full input cost.`,
          impact: 'medium',
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
    const estimatedCostUsd = safeNumber(analytics.estimatedCostUsd)
    if (estimatedCostUsd > 2) {
      suggestions.push({
        id: 'high-spend',
        icon: 'warn',
        title: `$${estimatedCostUsd.toFixed(2)} spent this period`,
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
        href: '/command',
      })
    }
  }

  // ── 5. Generic optimization if nothing else ────────────────────────────
  if (suggestions.length === 0) {
    const defaults: Array<Suggestion> = [
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
  unavailable = false,
}: {
  overview: DashboardOverview | null
  unavailable?: boolean
}) {
  const navigate = useNavigate()
  const [cycleIdx, setCycleIdx] = useState(0)
  const [copied, setCopied] = useState(false)

  const suggestions = useMemo(
    () => buildSuggestions(overview, cycleIdx),
    [overview, cycleIdx],
  )

  // Loading state — same card frame, but visibly a placeholder rather
  // than a suggestion dressed with an icon and impact chip.
  if (!overview) {
    if (unavailable) {
      return (
        <div
          className="relative flex min-h-[120px] flex-col justify-between gap-2 overflow-hidden rounded-xl border p-3"
          style={{
            background:
              'linear-gradient(135deg, color-mix(in srgb, var(--theme-card) 97%, transparent), color-mix(in srgb, var(--theme-card) 93%, transparent))',
            borderColor: 'var(--theme-border)',
          }}
          role="group"
          aria-label="Optimization hint: unavailable. Optimization hints will return when workspace telemetry reconnects."
        >
          <h2 className="text-[10px] font-semibold uppercase tracking-[0.18em] text-[var(--theme-text)]">
            Optimization hint
          </h2>
          <p className="text-[11px] leading-relaxed text-[var(--theme-muted)]">
            Optimization hints will return when workspace telemetry reconnects.
          </p>
        </div>
      )
    }

    return (
      <div
        className="relative flex flex-col gap-2 overflow-hidden rounded-xl border p-3"
        style={{
          background:
            'linear-gradient(135deg, color-mix(in srgb, var(--theme-card) 97%, transparent), color-mix(in srgb, var(--theme-card) 93%, transparent))',
          borderColor: 'var(--theme-border)',
        }}
        role="status"
        aria-busy="true"
        aria-label="Loading optimization hint"
      >
        <h2 className="text-[10px] font-semibold uppercase tracking-[0.18em] text-[var(--theme-text)]">
          Optimization hint
        </h2>
        <div
          className="flex motion-safe:animate-pulse flex-col gap-1.5"
          aria-hidden
        >
          <div className="h-2.5 w-2/3 rounded bg-[var(--theme-border)]" />
          <div className="h-2 w-full rounded bg-[color-mix(in_srgb,var(--theme-border)_60%,transparent)]" />
          <div className="h-2 w-4/5 rounded bg-[color-mix(in_srgb,var(--theme-border)_60%,transparent)]" />
        </div>
        <span className="sr-only">Loading suggestions…</span>
      </div>
    )
  }

  // Show one suggestion at a time, cycle on refresh
  const active = suggestions[cycleIdx % suggestions.length]

  const copyHint = async () => {
    try {
      await writeTextToClipboard(`${active.title}\n\n${active.body}`)
      setCopied(true)
      window.setTimeout(() => setCopied(false), 1_600)
    } catch {
      setCopied(false)
    }
  }

  const iconNode =
    active.icon === 'warn' ? (
      <HugeiconsIcon
        icon={Alert01Icon}
        size={13}
        strokeWidth={1.8}
        className="text-[var(--theme-warning)]"
      />
    ) : active.icon === 'ok' ? (
      <HugeiconsIcon
        icon={CheckmarkCircle01Icon}
        size={13}
        strokeWidth={1.8}
        className="text-[var(--theme-success,#50fa7b)]"
      />
    ) : (
      <HugeiconsIcon
        icon={Idea01Icon}
        size={13}
        strokeWidth={1.8}
        className="text-[var(--theme-accent)]"
      />
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
        <h2 className="text-[10px] font-semibold uppercase tracking-[0.18em] text-[var(--theme-text)]">
          Optimization hint
        </h2>
        <div className="flex items-center gap-1.5">
          <span
            className="rounded-full px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-[0.1em]"
            style={{
              color: impactColor,
              background: `color-mix(in srgb, ${impactColor} 12%, transparent)`,
            }}
          >
            {active.impact}
          </span>
          <button
            type="button"
            aria-label="Next suggestion"
            onClick={() => setCycleIdx((i) => i + 1)}
            className="inline-flex min-h-11 min-w-11 items-center justify-center rounded-md text-[var(--theme-muted)] motion-safe:transition-colors hover:bg-[var(--theme-bg)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--theme-accent)] focus-visible:ring-inset lg:min-h-0 lg:min-w-0 lg:size-5"
          >
            <HugeiconsIcon icon={Refresh01Icon} size={11} strokeWidth={1.8} />
          </button>
        </div>
      </div>

      <div className="flex gap-2">
        <span className="mt-0.5 shrink-0">{iconNode}</span>
        <div className="min-w-0 flex-1">
          <p className="text-[11px] font-medium leading-tight text-[var(--theme-text)]">
            {active.title}
          </p>
          <p
            className="mt-0.5 line-clamp-4 text-[10px] leading-relaxed text-[var(--theme-muted)]"
            title={active.body}
          >
            {active.body}
          </p>
          <div className="mt-1 flex flex-wrap items-center gap-1">
            <button
              type="button"
              onClick={() => void copyHint()}
              className="inline-flex min-h-11 items-center gap-1 rounded px-2 text-[9px] font-semibold uppercase tracking-[0.12em] text-[var(--theme-accent)] motion-safe:transition-colors hover:bg-[var(--theme-accent-subtle)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--theme-accent)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--theme-card)] lg:min-h-0"
              aria-label={
                copied ? 'Hint copied' : 'Copy full optimization hint'
              }
            >
              <HugeiconsIcon
                icon={copied ? Tick02Icon : Copy01Icon}
                size={12}
                strokeWidth={1.8}
              />
              <span>{copied ? 'Copied' : 'Copy hint'}</span>
            </button>
            {active.href ? (
              <a
                href={active.href}
                aria-label={`Open ${active.title}`}
                onClick={(event: MouseEvent<HTMLAnchorElement>) => {
                  if (
                    !active.href?.startsWith('/') ||
                    event.button !== 0 ||
                    event.metaKey ||
                    event.ctrlKey ||
                    event.shiftKey ||
                    event.altKey
                  ) {
                    return
                  }
                  event.preventDefault()
                  navigate({ to: active.href as never })
                }}
                className="inline-flex min-h-11 items-center gap-1 rounded px-2 text-[9px] font-semibold uppercase tracking-[0.12em] text-[var(--theme-accent)] motion-safe:transition-opacity hover:opacity-80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--theme-accent)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--theme-card)] lg:min-h-0"
              >
                <span>Open</span>
                <HugeiconsIcon
                  icon={ArrowRight01Icon}
                  size={12}
                  strokeWidth={1.8}
                />
              </a>
            ) : null}
          </div>
        </div>
      </div>

      {suggestions.length > 1 ? (
        <p className="text-right text-[9px] text-[var(--theme-muted)]">
          {(cycleIdx % suggestions.length) + 1} / {suggestions.length}
        </p>
      ) : null}
    </div>
  )
}
