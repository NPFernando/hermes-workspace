import { describe, expect, it } from 'vitest'
import { classifyFinanceDocument } from './finance-document-classifier'

describe('classifyFinanceDocument', () => {
  it('recognises explicit upload choices with high confidence', () => {
    expect(classifyFinanceDocument({ requestedDocumentType: 'statement' })).toMatchObject({
      documentClass: 'bank_statement',
      confidence: 'high',
    })
  })

  it('recognises salary slips, trade notes, and fixed-deposit certificates', () => {
    expect(classifyFinanceDocument({ filename: 'March payslip.pdf' }).documentClass).toBe('salary_slip')
    expect(classifyFinanceDocument({ text: 'Contract note settlement date brokerage' }).documentClass).toBe('contract_note')
    expect(classifyFinanceDocument({ text: 'Fixed deposit certificate maturity value' }).documentClass).toBe('fd_certificate')
  })

  it('falls back transparently when no marker is present', () => {
    expect(classifyFinanceDocument({ filename: 'document.pdf', text: 'hello' })).toEqual({
      documentClass: 'unknown',
      confidence: 'low',
      evidence: 'No supported document markers detected',
    })
  })
})
