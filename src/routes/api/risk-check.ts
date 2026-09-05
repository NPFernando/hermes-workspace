import { createFileRoute } from '@tanstack/react-router'
import { json } from '@tanstack/react-start'
import { isAuthenticated } from '../../server/auth-middleware'
import {
  requireJsonContentType,
  safeErrorMessage,
} from '../../server/rate-limit'
import {
  DEFAULT_GUARDIAN_CONFIG,
  checkOrderProposal,
} from '../../server/trading-guardian'
import { readFinanceStore } from '../../server/finance-store'
import { getEngineState } from '../../server/demo-trading-engine'
import type {
  GuardianConfig,
  GuardianContext,
  GuardianVerdict,
  OrderProposal,
} from '../../server/trading-guardian'

type JsonRecord = Record<string, unknown>

async function parseJsonBody(request: Request): Promise<JsonRecord> {
  try {
    const body = (await request.json()) as unknown
    return body && typeof body === 'object' && !Array.isArray(body)
      ? (body as JsonRecord)
      : {}
  } catch {
    return {}
  }
}

function unauthorized() {
  return json({ ok: false, error: 'Unauthorized' }, { status: 401 })
}

/**
 * Builds a GuardianContext from the current finance/demo trading state
 */
function buildGuardianContext(): GuardianContext {
  const db = readFinanceStore()
  const engineState = getEngineState()

  // Extract relevant state for guardian context
  const openPositions = engineState.positions.length
  let quoteBalance = 0
  let dailyPnlQuote = 0
  let weeklyPnlQuote = 0
  const openUnrealizedPnlQuote = 0

  // Get balance from finance store if available
  const usdtAccount = db.finance_accounts.find(
    (acc: { currency: string; balance: number }) => acc.currency === 'USDT',
  )
  if (usdtAccount) {
    quoteBalance = usdtAccount.balance
  }

  // Get PnL from engine state
  dailyPnlQuote = engineState.dailyPnlQuote
  weeklyPnlQuote = engineState.dailyPnlQuote * 7 // Approximate weekly from daily

  // For simplicity, we'll estimate unrealized PnL as 0 (could be enhanced)
  // In a real implementation, we'd calculate this from open positions and current prices

  return {
    openPositions,
    quoteBalance,
    dailyPnlQuote,
    weeklyPnlQuote,
    openUnrealizedPnlQuote: 0, // Simplified - could be enhanced
    strategyLossStreak: 0, // Simplified - could be strategy-specific
    strategyCooldownUntil: null,
    now: new Date(),
  }
}

/**
 * Converts a trade recommendation to an OrderProposal
 */
function buildOrderProposal(recommendation: {
  symbol: string
  strategyId: string
  quoteAmount: number
}): OrderProposal {
  return {
    symbol: recommendation.symbol,
    strategyId: recommendation.strategyId,
    quoteAmount: recommendation.quoteAmount,
  }
}

export const Route = createFileRoute('/api/risk-check')({
  server: {
    handlers: {
      POST: async ({ request }) => {
        if (!isAuthenticated(request)) {
          return unauthorized()
        }

        const csrf = requireJsonContentType(request)
        if (csrf) return csrf

        try {
          const body = await parseJsonBody(request)

          // Validate required fields
          const symbol =
            typeof body.symbol === 'string' && body.symbol.trim()
              ? body.symbol.trim()
              : undefined
          const strategyId =
            typeof body.strategyId === 'string' && body.strategyId.trim()
              ? body.strategyId.trim()
              : undefined
          const quoteAmount =
            typeof body.quoteAmount === 'number' && body.quoteAmount > 0
              ? body.quoteAmount
              : undefined

          if (!symbol) {
            return json(
              { ok: false, error: 'symbol is required' },
              { status: 400 },
            )
          }

          if (!strategyId) {
            return json(
              { ok: false, error: 'strategyId is required' },
              { status: 400 },
            )
          }

          if (!quoteAmount) {
            return json(
              {
                ok: false,
                error: 'quoteAmount is required and must be positive',
              },
              { status: 400 },
            )
          }

          // Build the proposal and context
          const proposal = buildOrderProposal({
            symbol,
            strategyId,
            quoteAmount,
          })
          const context = buildGuardianContext()

          // Optional: allow override of guardian config
          const configOverride = body.config as
            | Partial<GuardianConfig>
            | undefined
          const config = configOverride
            ? { ...DEFAULT_GUARDIAN_CONFIG, ...configOverride }
            : DEFAULT_GUARDIAN_CONFIG

          // Run the risk check
          const verdict = checkOrderProposal(proposal, context, config)

          // Format response
          return json({
            ok: true,
            riskCheck: {
              allowed: verdict.allowed,
              approvedQuote: verdict.approvedQuote,
              blocks: verdict.blocks.map((block) => ({
                rule: block.rule,
                detail: block.detail,
              })),
            },
            proposal: {
              symbol: proposal.symbol,
              strategyId: proposal.strategyId,
              quoteAmount: proposal.quoteAmount,
            },
            context: {
              openPositions: context.openPositions,
              quoteBalance: context.quoteBalance,
              dailyPnlQuote: context.dailyPnlQuote,
              weeklyPnlQuote: context.weeklyPnlQuote,
              openUnrealizedPnlQuote: context.openUnrealizedPnlQuote,
            },
            timestamp: new Date().toISOString(),
          })
        } catch (err) {
          return json(
            { ok: false, error: safeErrorMessage(err) },
            { status: 500 },
          )
        }
      },
    },
  },
})
