import { describe, expect, it } from 'vitest'
import { buildInvestmentThesisHealth } from './investment-journal-panel'

describe('buildInvestmentThesisHealth', () => {
  it('summarizes an explicit thesis, buy rationale, and completed review', () => {
    expect(
      buildInvestmentThesisHealth(
        [
          {
            stockHoldingId: 'holding-1',
            symbol: 'ABC',
            entryDate: '2026-08-01',
            entryType: 'thesis',
            thesis: 'Stable cash flow',
            content: 'Initial thesis',
          },
          {
            stockHoldingId: 'holding-1',
            symbol: 'ABC',
            entryDate: '2026-08-10',
            entryType: 'buy',
            content: 'Bought after earnings review',
          },
          {
            stockHoldingId: 'holding-1',
            symbol: 'ABC',
            entryDate: '2026-09-01',
            entryType: 'review',
            content: 'Thesis remains supported',
          },
        ],
        '2026-09-10',
      ),
    ).toEqual([
      expect.objectContaining({
        symbol: 'ABC',
        status: 'healthy',
        whyBought: 'Bought after earnings review',
        reviewDate: '2026-09-01',
      }),
    ])
  })

  it('marks overdue review dates and distinguishes missing theses', () => {
    expect(
      buildInvestmentThesisHealth([
        {
          stockHoldingId: 'holding-1',
          symbol: 'ABC',
          entryDate: '2026-08-01',
          entryType: 'thesis',
          thesis: 'Growth thesis',
          content: 'Initial thesis',
          nextReviewDate: '2026-09-01',
        },
        {
          stockHoldingId: 'holding-2',
          symbol: 'XYZ',
          entryDate: '2026-09-01',
          entryType: 'buy',
          content: 'Bought for diversification',
        },
      ], '2026-09-10'),
    ).toMatchObject([
      { symbol: 'ABC', status: 'overdue' },
      { symbol: 'XYZ', status: 'no_thesis' },
    ])
  })
})
