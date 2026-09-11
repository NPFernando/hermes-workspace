import { describe, expect, it } from 'vitest'
import {
  inboxPriorityScore,
  isBatchApprovable,
  matchesDocumentSearch,
} from './pending-ingestion-panel'
import type { PendingIngestion } from '../types'

const base: PendingIngestion = {
  id: 'pending-1',
  status: 'awaiting_review',
  source: 'upload',
  documentType: 'transaction',
  extracted: {
    kind: 'expense',
    amount: 100,
    currency: 'LKR',
    vendorOrSource: 'Shop',
    date: '2026-09-01',
    confidence: 'high',
  },
}

describe('isBatchApprovable', () => {
  it('allows reviewed transaction extractions with a finite amount', () => {
    expect(isBatchApprovable(base)).toBe(true)
  })

  it('excludes contracts, password items, and failed amounts', () => {
    expect(isBatchApprovable({ ...base, documentType: 'contract' })).toBe(false)
    expect(isBatchApprovable({ ...base, status: 'awaiting_password' })).toBe(false)
    expect(
      isBatchApprovable({
        ...base,
        extracted: { ...base.extracted!, amount: Number.NaN },
      }),
    ).toBe(false)
  })
})

describe('inboxPriorityScore', () => {
  it('puts extraction failures and missing categories before routine reviews', () => {
    expect(inboxPriorityScore({ ...base, error: 'Extraction failed', extracted: undefined })).toBe(0)
    expect(inboxPriorityScore({ ...base, extracted: { ...base.extracted!, category: '' } })).toBe(1)
    expect(inboxPriorityScore({ ...base, extracted: { ...base.extracted!, confidence: 'low' } })).toBe(1)
    expect(inboxPriorityScore({ ...base, extracted: { ...base.extracted!, confidence: 'high', category: 'Food' } })).toBe(3)
  })
})

describe('matchesDocumentSearch', () => {
  it('searches safe document metadata without requiring a source path', () => {
    expect(matchesDocumentSearch(base, 'shop')).toBe(true)
    expect(matchesDocumentSearch(base, 'upload')).toBe(true)
    expect(matchesDocumentSearch(base, 'pdf')).toBe(false)
    expect(matchesDocumentSearch(base, '')).toBe(true)
  })

  it('supports searching active review items as well as document history', () => {
    expect(matchesDocumentSearch(base, 'shop')).toBe(true)
    expect(matchesDocumentSearch(base, 'awaiting_review')).toBe(true)
    expect(matchesDocumentSearch(base, 'employer-that-is-not-here')).toBe(false)
  })
})
