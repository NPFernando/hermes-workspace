import { describe, expect, it } from 'vitest'
import { buildFinanceAnswerMarkdown, formatLkr, formatMoney, formatPct } from './utils'

describe('formatMoney/formatLkr/formatPct', () => {
  it('formats an amount with a currency prefix, rounded, with thousands separators', () => {
    expect(formatMoney(125000.4, 'USD')).toBe('USD 125,000')
  })

  it('formats LKR via formatMoney', () => {
    expect(formatLkr(22000)).toBe('LKR 22,000')
  })

  it('formats a percentage to one decimal place', () => {
    expect(formatPct(12.345)).toBe('12.3%')
  })
})

describe('buildFinanceAnswerMarkdown', () => {
  it('includes the question and answer, with no chart section when chart is null', () => {
    const md = buildFinanceAnswerMarkdown('What is my net worth?', 'Your net worth is 376,437 LKR.', null)
    expect(md).toContain('# Finance Analyst')
    expect(md).toContain('**Q:** What is my net worth?')
    expect(md).toContain('Your net worth is 376,437 LKR.')
    expect(md).not.toContain('| Label | Value |')
  })

  it('renders a markdown table for the chart, with values formatted via formatLkr', () => {
    const md = buildFinanceAnswerMarkdown(
      'Break down my spending by category this month',
      'Groceries is your top category.',
      {
        title: 'Spending by category',
        data: [
          { label: 'Groceries', value: 22000 },
          { label: 'Utilities', value: 8000 },
        ],
      },
    )
    expect(md).toContain('## Spending by category')
    expect(md).toContain('| Label | Value |')
    expect(md).toContain('| Groceries | LKR 22,000 |')
    expect(md).toContain('| Utilities | LKR 8,000 |')
  })

  it('always ends with an export footer', () => {
    const md = buildFinanceAnswerMarkdown('Q', 'A', null)
    expect(md).toContain('Exported')
    expect(md).toContain('Hermes Workspace — Personal Finance')
  })
})
