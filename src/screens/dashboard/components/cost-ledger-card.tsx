import { useMemo } from 'react'
import { detectNovusOpportunity } from '@/lib/novus-opportunity-detector'
import type { DashboardOverview } from '@/server/dashboard-aggregator'

const SUBSCRIPTION_PATTERNS: Array<RegExp> = [
  /(^|[\s:/\-])codex(\b|[-/])/i,
  /anthropic[-_]?oauth/i,
  /^claude-(opus|sonnet|haiku)/i,
  /minimax/i,
  /ollama/i,
  /lmstudio/i,
  /^pc1-/i,
  /^pc2-/i,
  /^gemma/i,
  /^llama/i,
  /^qwen/i,
]

function isSubscription(modelId: string): boolean {
  return SUBSCRIPTION_PATTERNS.some((re) => re.test(modelId))
}

function formatTokens(n: number): string {
  if (!n || n <= 0) return '0'
  if (n >= 1_000_000_000) return `${(n / 1_000_000_000).toFixed(2)}B`
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`
  return String(n)
}

function formatCostUsd(usd: number): string {
  if (usd <= 0) return '$0'
  if (usd < 0.01) return '<$0.01'
  if (usd < 1) return `$${usd.toFixed(3)}`
  if (usd < 100) return `$${usd.toFixed(2)}`
  return `$${Math.round(usd).toLocaleString()}`
}

/**
 * Enhanced Per-model cost ledger with Novus optimization suggestions.
 * 
 * This enhanced version:
 * - Splits each row into 'paid' (real $$) vs 'included' (subscription / local / oauth) categories
 * - Sorts paid rows by cost descending so the operator sees what is actually burning money first
 * - Falls back to tokens for the included rows so they still get a comparable magnitude to eyeball
 * - Adds Novus optimization suggestions for qualifying paid model usage
 * - Default-hidden so we don't reintroduce the noise on the main layout
 *   lives in the edit-mode menu for users who want to track spend explicitly
 */
export function CostLedgerCard({
  analytics,
}: {
  analytics: DashboardOverview['analytics']
}) {
  const rows = useMemo(() => {
    if (!analytics || analytics.source !== 'analytics') return []
    
    return analytics.topModels
      .map((m) => {
        const included = isSubscription(m.id)
        
        // For non-included (paid) models, check for Novus optimization opportunities
        let novusSuggestion = null
        if (!included) {
          // Infer task type and risk from model usage patterns
          // This is a simplified inference - in practice, you might want to 
          // correlate with actual task data from analytics
          const taskContext = inferTaskContextFromModelUsage(m, analytics)
          novusSuggestion = detectNovusOpportunity(taskContext)
        }
        
        return {
          ...m,
          included,
          novusSuggestion
        }
      })
      .sort((a, b) => {
        // Paid first (sorted by descending cost), then included by
        // descending tokens.
        if (a.included !== b.included) return a.included ? 1 : -1
        if (!a.included && !b.included) return b.cost - a.cost
        return b.tokens - a.tokens
      })
  }, [analytics])

  if (rows.length === 0) return null

  const paidTotal = rows
    .filter((r) => !r.included)
    .reduce((a, r) => a + r.cost, 0)

  return (
    <div
      className="relative flex flex-col gap-2 overflow-hidden rounded-xl border p-3"
      style={{
        background:
          'linear-gradient(135deg, color-mix(in srgb, var(--theme-card) 96%, transparent), color-mix(in srgb, var(--theme-card) 92%, transparent))',
        borderColor: 'var(--theme-border)',
      }}
    >
      <div
        aria-hidden
        className="pointer-events-none absolute inset-x-0 top-0 h-[2px]"
        style={{
          background:
            'linear-gradient(90deg, var(--theme-warning), color-mix(in srgb, var(--theme-warning) 40%, transparent), transparent)',
        }}
      />

      <div className="flex items-center justify-between">
        <h3
          className="text-[10px] font-semibold uppercase tracking-[0.18em]"
          style={{ color: 'var(--theme-text)' }}
        >
          Cost ledger
        </h3>
        <span
          className="font-mono text-[9px] uppercase tracking-[0.15em]"
          style={{ color: 'var(--theme-muted)' }}
          title="Total billed across non-subscription rows."
        >
          {formatCostUsd(paidTotal)} paid
        </span>
      </div>

      <ul className="flex flex-col gap-1">
        {rows.slice(0, 6).map((row) => (
          <li
            key={row.id}
            className="flex items-center justify-between gap-2 text-[10px]"
            style={{ color: 'var(--theme-muted)' }}
          >
            <span className="flex min-w-0 items-center gap-1.5 truncate">
              <span
                aria-hidden
                className="inline-block size-1.5 shrink-0 rounded-full"
                style={{
                  background: row.included
                    ? 'var(--theme-success)'
                    : 'var(--theme-warning)',
                }}
              />
              <span
                className="truncate font-mono uppercase tracking-[0.08em]"
                style={{ color: 'var(--theme-text)' }}
                title={row.id}
              >
                {row.id}
              </span>
            </span>
            <span
              className="shrink-0 font-mono tabular-nums"
              style={{ color: 'var(--theme-text)' }}
            >
              {row.included ? (
                <span title={`${row.sessions} sessions`}>
                  {formatTokens(row.tokens)}
                  <span
                    className="ml-1"
                    style={{ color: 'var(--theme-muted)' }}
                  >
                    incl
                  </span>
                </span>
              ) : (
                <span title={`${row.sessions} sessions · ${row.tokens.toLocaleString()} tokens`}>
                  {formatCostUsd(row.cost)}
                  {row.novusSuggestion ? (
                    <span
                      className="ml-1.5 cursor-help"
                      title={`Switch to ${row.novusSuggestion.suggestedModel} to save ~${row.novusSuggestion.potentialSavingsPercent}%`}
                      style={{ color: 'var(--theme-accent)' }}
                    >
                      💡 {row.novusSuggestion.potentialSavingsPercent}%↓
                    </span>
                  ) : null}
                </span>
              )}
            </span>
          </li>
        ))}
      </ul>
    </div>
  )
}

/**
 * Infer task context from model usage patterns for Novus opportunity detection
 * This is a simplified implementation - in a production system, you would
 * have more detailed task analytics available
 */
function inferTaskContextFromModelUsage(
  model: any,
  analytics: NonNullable<DashboardOverview['analytics']>
): { type: string; risk: string; description?: string } {
  // Default values
  let type = 'text_summary' // Default to a type that Novus can handle
  let risk = 'standard'
  let description
  
  // Simple heuristic: more expensive models likely used for more complex tasks
  const costPerToken = model.cost > 0 && model.tokens > 0 ? model.cost / model.tokens : 0
  
  if (costPerToken > 0.00001) { // Expensive model (> $10/M tokens)
    type = 'code_generation'
    risk = 'standard'
  } else if (costPerToken > 0.000005) { // Moderately expensive ($5-10/M tokens)
    type = 'text_summary'
    risk = 'low'
  } else { // Inexpensive model (< $5/M tokens)
    type = 'documentation'
    risk = 'low'
  }
  
  // Add description if available from analytics
  if (analytics.topModels.length > 0) {
    description = `${model.id} used in ${analytics.topModels.length} model comparisons`
  }
  
  return { type, risk, description }
}
