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
