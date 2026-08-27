import { describe, expect, it } from 'vitest'
import { parseContractExtractionJson, parseExtractionJson, promptWithCategoryHints } from './finance-extraction'

describe('parseExtractionJson', () => {
  it('parses a valid expense extraction', () => {
    const result = parseExtractionJson(
      '{"kind":"expense","amount":4520,"currency":"LKR","vendorOrSource":"Dialog","date":"2026-08-15","category":"Utilities","confidence":"high"}',
    )
    expect(result).toEqual({
      ok: true,
      data: {
        kind: 'expense',
        amount: 4520,
        currency: 'LKR',
        vendorOrSource: 'Dialog',
        date: '2026-08-15',
        category: 'Utilities',
        confidence: 'high',
      },
    })
  })

  it('strips markdown code fences before parsing', () => {
    const result = parseExtractionJson(
      '```json\n{"kind":"income","amount":1000,"currency":"USD","vendorOrSource":"Acme","date":"2026-01-01","confidence":"medium"}\n```',
    )
    expect(result.ok).toBe(true)
  })

  it('returns the model-reported reason when it declines to find a transaction', () => {
    const result = parseExtractionJson('{"error":"no_transaction_found"}')
    expect(result).toEqual({ ok: false, reason: 'no_transaction_found' })
  })

  it('rejects an invalid kind', () => {
    expect(parseExtractionJson('{"kind":"transfer","amount":10,"currency":"USD"}')).toEqual({
      ok: false,
      reason: 'malformed_response',
    })
  })

  it('rejects a non-numeric amount', () => {
    expect(
      parseExtractionJson('{"kind":"expense","amount":"lots","currency":"USD","vendorOrSource":"x","date":"2026-01-01"}'),
    ).toEqual({ ok: false, reason: 'malformed_response' })
  })

  it('returns malformed_response for unparseable content', () => {
    expect(parseExtractionJson('not json at all')).toEqual({ ok: false, reason: 'malformed_response' })
  })

  it('defaults optional fields when absent', () => {
    const result = parseExtractionJson('{"kind":"income","amount":500,"currency":"USD","vendorOrSource":"Acme","date":"2026-01-01"}')
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.data.category).toBeUndefined()
      expect(result.data.confidence).toBe('low')
    }
  })
})

describe('promptWithCategoryHints', () => {
  it('returns the base prompt unchanged when there are no hints', () => {
    expect(promptWithCategoryHints('BASE')).toBe('BASE')
    expect(promptWithCategoryHints('BASE', {})).toBe('BASE')
  })

  it('appends known vendor -> category corrections to the prompt', () => {
    const result = promptWithCategoryHints('BASE', { 'keells super': 'Groceries', netflix: 'Subscriptions' })
    expect(result).toContain('BASE')
    expect(result).toContain('"keells super" -> "Groceries"')
    expect(result).toContain('"netflix" -> "Subscriptions"')
  })

  it('caps hints at 10 entries', () => {
    const hints = Object.fromEntries(Array.from({ length: 15 }, (_, i) => [`vendor${i}`, `cat${i}`]))
    const result = promptWithCategoryHints('BASE', hints)
    expect(result.match(/^- "/gm)?.length).toBe(10)
  })
})

describe('parseContractExtractionJson', () => {
  it('parses a valid contract extraction with risks', () => {
    const result = parseContractExtractionJson(
      JSON.stringify({
        employerName: 'Acme Corp',
        employmentType: 'contract',
        monthlyIncomeAmount: 150000,
        currency: 'LKR',
        contractStartDate: '2026-01-01',
        contractEndDate: '2027-01-01',
        jobTitle: 'Software Engineer',
        confidence: 'high',
        riskSummary: 'Generally standard, but the non-compete is unusually broad.',
        risks: [
          { severity: 'high', clause: 'Non-compete', concern: 'Covers all of Sri Lanka for 3 years after leaving.' },
        ],
      }),
    )
    expect(result).toEqual({
      ok: true,
      data: {
        employerName: 'Acme Corp',
        employmentType: 'contract',
        monthlyIncomeAmount: 150000,
        currency: 'LKR',
        contractStartDate: '2026-01-01',
        contractEndDate: '2027-01-01',
        jobTitle: 'Software Engineer',
        confidence: 'high',
        riskSummary: 'Generally standard, but the non-compete is unusually broad.',
        risks: [
          { severity: 'high', clause: 'Non-compete', concern: 'Covers all of Sri Lanka for 3 years after leaving.' },
        ],
      },
    })
  })

  it('strips markdown code fences before parsing', () => {
    const result = parseContractExtractionJson(
      '```json\n{"employerName":"Acme","employmentType":"full_time","currency":"LKR","confidence":"medium","riskSummary":"Fine.","risks":[]}\n```',
    )
    expect(result.ok).toBe(true)
  })

  it('returns the model-reported reason when the document is not a contract', () => {
    expect(parseContractExtractionJson('{"error":"not_a_contract"}')).toEqual({ ok: false, reason: 'not_a_contract' })
  })

  it('defaults employmentType to other for an unrecognized value', () => {
    const result = parseContractExtractionJson(
      '{"employerName":"Acme","employmentType":"intern","currency":"LKR","confidence":"low","riskSummary":"","risks":[]}',
    )
    expect(result.ok).toBe(true)
    if (result.ok) expect(result.data.employmentType).toBe('other')
  })

  it('caps risks at 10 entries and drops malformed ones', () => {
    const risks = Array.from({ length: 15 }, (_, i) => ({ severity: 'low', clause: `Clause ${i}`, concern: `Concern ${i}` }))
    risks.push({ severity: 'high', clause: '', concern: 'missing clause label' } as never)
    const result = parseContractExtractionJson(
      JSON.stringify({ employerName: 'Acme', employmentType: 'other', currency: 'LKR', confidence: 'low', riskSummary: '', risks }),
    )
    expect(result.ok).toBe(true)
    if (result.ok) expect(result.data.risks).toHaveLength(10)
  })

  it('returns malformed_response for unparseable content', () => {
    expect(parseContractExtractionJson('not json at all')).toEqual({ ok: false, reason: 'malformed_response' })
  })
})
