import { describe, expect, it } from 'vitest'
import { getFinanceManagerAgentProfile } from './finance-agent-profile'

describe('Finance Manager Agent profile (AI-100)', () => {
  it('declares the finance context, scopes, and approval boundaries', () => {
    const profile = getFinanceManagerAgentProfile()
    expect(profile).toMatchObject({
      id: 'finance-manager',
      role: 'personal_finance_analyst',
      contextVersion: 'finance-agent-v1',
    })
    expect(profile.scopes).toContain('finance.read')
    expect(profile.allowedActions).toContain('build_finance_context')
    expect(profile.prohibitedActions).toContain('live trading or order execution')
    expect(profile.approvalRequiredFor).toContain('delete_record')
  })

  it('returns defensive copies of mutable capability lists', () => {
    const first = getFinanceManagerAgentProfile()
    first.scopes.pop()
    expect(getFinanceManagerAgentProfile().scopes).toContain('finance.approve')
  })
})
