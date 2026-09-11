import { timingSafeEqual } from 'node:crypto'

const RECORD_KINDS = new Set([
  'income',
  'expense',
  'account',
  'goal',
  'tax',
  'budget_category',
  'category',
  'subcategory_entry',
  'merchant',
  'tag',
  'income_source',
  'stock_holding',
  'fixed_deposit',
  'investment_journal',
  'ai_task',
  'loan',
  'property',
  'beneficiary',
  'transfer',
  'split',
])

export type FinanceMutationRisk = 'low' | 'medium' | 'high'

export const FINANCE_AGENT_SCOPES = [
  'finance.read',
  'finance.write',
  'finance.delete',
  'finance.approve',
] as const

export type FinanceAgentScope = (typeof FINANCE_AGENT_SCOPES)[number]

export type FinanceAgentAuthenticationFailure = {
  status: 401 | 503
  error: string
}

const MAX_FINANCE_AGENT_TOKENS = 16

function configuredFinanceAgentTokens(): Array<string> {
  const values = [process.env.FINANCE_AGENT_API_TOKEN]
  // The plural form allows a new token to be deployed before the old one is
  // revoked. Keep the legacy singular variable as the first-class compatible
  // form and bound the list so an accidental oversized environment value
  // cannot turn authentication into an unbounded comparison loop.
  values.push(...(process.env.FINANCE_AGENT_API_TOKENS ?? '').split(','))
  return [
    ...new Set(values.map((value) => value?.trim()).filter(Boolean)),
  ].slice(0, MAX_FINANCE_AGENT_TOKENS) as Array<string>
}

/**
 * Authenticate callers that opt into the agent contract. Browser requests do
 * not send agentContext and continue to use the normal workspace session.
 * The token is read at request time so deployments can inject it without a
 * module restart during tests or controlled secret rotation.
 */
export function financeAgentAuthenticationError(
  request: Request,
  body: Record<string, unknown>,
): FinanceAgentAuthenticationFailure | null {
  if (body.agentContext === undefined) return null

  const expectedTokens = configuredFinanceAgentTokens()
  if (expectedTokens.length === 0) {
    return {
      status: 503,
      error: 'Finance agent authentication is not configured.',
    }
  }
  const supplied = (request.headers.get('x-finance-agent-token') || '').trim()
  if (!supplied) {
    return { status: 401, error: 'Finance agent token is required.' }
  }
  const suppliedBytes = Buffer.from(supplied, 'utf8')
  const valid = expectedTokens.some((expected) => {
    const expectedBytes = Buffer.from(expected, 'utf8')
    return (
      expectedBytes.length === suppliedBytes.length &&
      timingSafeEqual(expectedBytes, suppliedBytes)
    )
  })
  if (!valid) {
    return { status: 401, error: 'Invalid finance agent token.' }
  }
  return null
}

/**
 * Actions that are safe to authorize with the read-only agent scope. Keep
 * this list explicit: an action added to /api/finance must not accidentally
 * become executable by a read-only agent because it fell through a default.
 */
export const FINANCE_AGENT_READ_ACTIONS = new Set([
  'ask_finance_question',
  'build_finance_context',
  'download_encrypted_backup',
  'export_ai_task_review',
  'finance_audit_status',
  'get_finance_agent_profile',
  'list_ai_tasks',
  'list_finance_audit_archives',
  'list_finance_documents',
  'list_pending_ingestions',
  'preview_finance_audit_prune',
  'verify_encrypted_backup',
  'verify_finance_audit_archive',
])

function requiredFinanceAgentScope(action: string): FinanceAgentScope {
  if (action === 'delete_record' || action === 'restore_record')
    return 'finance.delete'
  if (
    action === 'confirm_pending_ingestion' ||
    action === 'reject_pending_ingestion'
  )
    return 'finance.approve'
  // Fail closed. Only the explicit read-only allowlist above may run with
  // finance.read; new or unclassified actions require write authorization.
  return FINANCE_AGENT_READ_ACTIONS.has(action)
    ? 'finance.read'
    : 'finance.write'
}

/**
 * AI-102/103: explicit, opt-in capability contract for agent callers.
 * Browser requests omit agentContext and retain the existing UI behavior.
 */
export function financeAgentScopeGuard(
  action: string,
  body: Record<string, unknown>,
): string | null {
  if (body.agentContext === undefined) return null
  if (
    !body.agentContext ||
    typeof body.agentContext !== 'object' ||
    Array.isArray(body.agentContext)
  )
    return 'agentContext must be an object with actor and scopes.'
  const context = body.agentContext as Record<string, unknown>
  if (context.actor !== 'finance_agent')
    return 'agentContext.actor must be finance_agent.'
  if (!Array.isArray(context.scopes))
    return 'agentContext.scopes must be an array.'
  const scopes = context.scopes.filter(
    (scope): scope is FinanceAgentScope =>
      typeof scope === 'string' &&
      FINANCE_AGENT_SCOPES.includes(scope as FinanceAgentScope),
  )
  if (scopes.length !== context.scopes.length)
    return 'agentContext contains an unknown finance scope.'
  const required = requiredFinanceAgentScope(action)
  if (!scopes.includes(required))
    return `Finance agent scope ${required} is required for ${action}.`
  return null
}

export function financeMutationRisk(action: string): FinanceMutationRisk {
  if (action === 'delete_record' || action === 'restore_record') return 'high'
  if (action === 'add_transfer' || action === 'add_split') return 'medium'
  if (action === 'confirm_pending_ingestion') return 'medium'
  return 'low'
}

/** AI-104: validates the public finance mutation contract before storage code runs. */
export function financeMutationGuard(
  action: string,
  body: Record<string, unknown>,
): string | null {
  if (
    ['add_record', 'update_record', 'delete_record', 'restore_record'].includes(
      action,
    )
  ) {
    const kind = typeof body.kind === 'string' ? body.kind : ''
    if (!RECORD_KINDS.has(kind))
      return `Unsupported finance record kind: ${kind || 'missing'}.`
  }
  if (['update_record', 'delete_record', 'restore_record'].includes(action)) {
    if (typeof body.id !== 'string' || !body.id.trim()) return 'id is required.'
  }
  if (action === 'delete_record' && body.confirm !== true) {
    return 'Explicit confirmation is required before deleting a finance record.'
  }
  if (['add_transfer', 'add_split'].includes(action)) {
    if (
      !body.payload ||
      typeof body.payload !== 'object' ||
      Array.isArray(body.payload)
    ) {
      return 'A structured payload is required.'
    }
  }
  if (
    ['confirm_pending_ingestion', 'reject_pending_ingestion'].includes(action)
  ) {
    if (typeof body.id !== 'string' || !body.id.trim()) return 'id is required.'
  }
  return null
}
