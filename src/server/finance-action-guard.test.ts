import { afterEach, describe, expect, it } from 'vitest'
import {
  financeAgentAuthenticationError,
  financeAgentScopeGuard,
  financeMutationGuard,
  financeMutationRisk,
} from './finance-action-guard'

afterEach(() => {
  delete process.env.FINANCE_AGENT_API_TOKEN
  delete process.env.FINANCE_AGENT_API_TOKENS
})

describe('financeMutationGuard', () => {
  it('requires a configured constant-time agent token only for agent callers', () => {
    const request = new Request('http://workspace.test/api/finance')
    const agentBody = {
      agentContext: { actor: 'finance_agent', scopes: ['finance.read'] },
    }
    expect(financeAgentAuthenticationError(request, {})).toBeNull()
    expect(financeAgentAuthenticationError(request, agentBody)).toEqual({
      status: 503,
      error: 'Finance agent authentication is not configured.',
    })

    process.env.FINANCE_AGENT_API_TOKEN = 'agent-secret'
    expect(financeAgentAuthenticationError(request, agentBody)).toEqual({
      status: 401,
      error: 'Finance agent token is required.',
    })
    expect(
      financeAgentAuthenticationError(
        new Request('http://workspace.test/api/finance', {
          headers: { 'x-finance-agent-token': 'wrong' },
        }),
        agentBody,
      ),
    ).toEqual({ status: 401, error: 'Invalid finance agent token.' })
    expect(
      financeAgentAuthenticationError(
        new Request('http://workspace.test/api/finance', {
          headers: { 'x-finance-agent-token': 'agent-secret' },
        }),
        agentBody,
      ),
    ).toBeNull()
  })

  it('accepts bounded plural tokens so rotation can overlap safely', () => {
    process.env.FINANCE_AGENT_API_TOKENS = 'old-token, new-token, old-token'
    const agentBody = {
      agentContext: { actor: 'finance_agent', scopes: ['finance.read'] },
    }

    expect(
      financeAgentAuthenticationError(
        new Request('http://workspace.test/api/finance', {
          headers: { 'x-finance-agent-token': 'old-token' },
        }),
        agentBody,
      ),
    ).toBeNull()
    expect(
      financeAgentAuthenticationError(
        new Request('http://workspace.test/api/finance', {
          headers: { 'x-finance-agent-token': 'new-token' },
        }),
        agentBody,
      ),
    ).toBeNull()
    expect(
      financeAgentAuthenticationError(
        new Request('http://workspace.test/api/finance', {
          headers: { 'x-finance-agent-token': 'retired-token' },
        }),
        agentBody,
      ),
    ).toEqual({ status: 401, error: 'Invalid finance agent token.' })
  })

  it('rejects unknown record kinds before storage dispatch', () => {
    expect(
      financeMutationGuard('update_record', {
        kind: 'unknown_table',
        id: 'record-1',
        payload: {},
      }),
    ).toContain('Unsupported finance record kind')
  })

  it('requires explicit delete confirmation', () => {
    expect(
      financeMutationGuard('delete_record', {
        kind: 'expense',
        id: 'record-1',
      }),
    ).toContain('Explicit confirmation')
    expect(
      financeMutationGuard('delete_record', {
        kind: 'expense',
        id: 'record-1',
        confirm: true,
      }),
    ).toBeNull()
  })

  it('requires structured transfer and split payloads', () => {
    expect(financeMutationGuard('add_transfer', {})).toContain(
      'structured payload',
    )
    expect(
      financeMutationGuard('add_split', { payload: { items: [] } }),
    ).toBeNull()
  })

  it('classifies mutation risk without changing the action contract', () => {
    expect(financeMutationRisk('delete_record')).toBe('high')
    expect(financeMutationRisk('add_transfer')).toBe('medium')
    expect(financeMutationRisk('update_record')).toBe('low')
  })

  it('enforces explicit agent scopes while leaving browser requests opt-in', () => {
    expect(financeAgentScopeGuard('update_record', {})).toBeNull()
    expect(
      financeAgentScopeGuard('update_record', {
        agentContext: { actor: 'finance_agent', scopes: ['finance.read'] },
      }),
    ).toContain('finance.write')
    expect(
      financeAgentScopeGuard('update_record', {
        agentContext: { actor: 'finance_agent', scopes: ['finance.write'] },
      }),
    ).toBeNull()
    expect(
      financeAgentScopeGuard('delete_record', {
        agentContext: { actor: 'finance_agent', scopes: ['finance.write'] },
      }),
    ).toContain('finance.delete')
    expect(
      financeAgentScopeGuard('build_finance_context', {
        agentContext: { actor: 'finance_agent', scopes: ['finance.write'] },
      }),
    ).toContain('finance.read')
    expect(
      financeAgentScopeGuard('build_finance_context', {
        agentContext: { actor: 'finance_agent', scopes: ['finance.read'] },
      }),
    ).toBeNull()
    expect(
      financeAgentScopeGuard('set_financial_rules', {
        agentContext: { actor: 'finance_agent', scopes: ['finance.read'] },
      }),
    ).toContain('finance.write')
    expect(
      financeAgentScopeGuard('new_unclassified_action', {
        agentContext: { actor: 'finance_agent', scopes: ['finance.read'] },
      }),
    ).toContain('finance.write')
  })

  it('rejects malformed and unknown agent scope declarations', () => {
    expect(
      financeAgentScopeGuard('ask_finance_question', { agentContext: [] }),
    ).toContain('agentContext must be an object')
    expect(
      financeAgentScopeGuard('ask_finance_question', {
        agentContext: { actor: 'finance_agent', scopes: ['finance.execute'] },
      }),
    ).toContain('unknown finance scope')
    expect(
      financeAgentScopeGuard('ask_finance_question', {
        agentContext: { actor: 'finance_agent', scopes: ['finance.read'] },
      }),
    ).toBeNull()
  })

  it('treats exchange-rate updates as finance writes', () => {
    expect(
      financeAgentScopeGuard('refresh_exchange_rate', {
        agentContext: { actor: 'finance_agent', scopes: ['finance.read'] },
      }),
    ).toContain('finance.write')
    expect(
      financeAgentScopeGuard('set_exchange_rate', {
        agentContext: { actor: 'finance_agent', scopes: ['finance.write'] },
      }),
    ).toBeNull()
    expect(
      financeAgentScopeGuard('set_base_currency', {
        agentContext: { actor: 'finance_agent', scopes: ['finance.read'] },
      }),
    ).toContain('finance.write')
    expect(
      financeAgentScopeGuard('queue_proactive_finance_review', {
        agentContext: { actor: 'finance_agent', scopes: ['finance.read'] },
      }),
    ).toContain('finance.write')
    expect(
      financeAgentScopeGuard('add_salary_history', {
        agentContext: { actor: 'finance_agent', scopes: ['finance.write'] },
      }),
    ).toBeNull()
  })
})
