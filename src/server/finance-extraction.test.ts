import { describe, expect, it } from 'vitest'
import { parseExtractionJson } from './finance-extraction'

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
