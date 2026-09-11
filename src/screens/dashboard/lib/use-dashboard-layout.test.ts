import { describe, expect, it } from 'vitest'
import {
  WIDGET_CATALOG,
  shouldExitDashboardEditMode,
} from './use-dashboard-layout'

describe('dashboard widget catalog', () => {
  it('keeps every catalog entry uniquely addressable', () => {
    const ids = WIDGET_CATALOG.map((widget) => widget.id)

    expect(new Set(ids).size).toBe(ids.length)
  })

  it('keeps the editor column labels aligned with the rendered dashboard', () => {
    const railIds = WIDGET_CATALOG.filter(
      (widget) => widget.column === 'rail',
    ).map((widget) => widget.id)

    expect(railIds).toEqual([
      'top_models',
      'provider_mix',
      'cache_efficiency',
      'velocity',
      'cost_ledger',
      'proactive_suggestions',
      'skills_usage',
      'achievements',
      'mix_rhythm',
    ])
  })
})

describe('dashboard layout edit mode', () => {
  it('exits only for an unclaimed Escape keypress', () => {
    expect(
      shouldExitDashboardEditMode({ key: 'Escape', defaultPrevented: false }),
    ).toBe(true)
    expect(
      shouldExitDashboardEditMode({ key: 'Escape', defaultPrevented: true }),
    ).toBe(false)
    expect(
      shouldExitDashboardEditMode({ key: 'Enter', defaultPrevented: false }),
    ).toBe(false)
  })
})
