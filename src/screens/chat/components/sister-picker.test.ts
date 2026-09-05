import { describe, expect, it } from 'vitest'

import { dedupeSistersForPicker } from './sister-picker'
import type { SisterOption } from './sister-picker'

const sister = (
  over: Partial<SisterOption> & Pick<SisterOption, 'id' | 'name'>,
): SisterOption => ({
  emoji: '✦',
  description: '',
  type: 'ai_sister',
  ...over,
})

describe('dedupeSistersForPicker', () => {
  const luna = sister({ id: 'luna', name: 'Luna' })
  const ada = sister({ id: 'ada', name: 'Ada' })
  const researcher = sister({
    id: 'researcher',
    name: 'Luna',
    type: 'delegation_profile',
    role: 'researcher',
  })
  const translator = sister({
    id: 'translator',
    name: 'Iris',
    type: 'delegation_profile',
    role: 'translator',
  })

  it('drops delegation profiles whose name collides with an AI sister', () => {
    const result = dedupeSistersForPicker([luna, ada, researcher])
    expect(result.map((s) => s.id)).toEqual(['luna', 'ada'])
  })

  it('keeps delegation profiles with unique names', () => {
    const result = dedupeSistersForPicker([luna, translator])
    expect(result.map((s) => s.id)).toEqual(['luna', 'translator'])
  })

  it('compares names case-insensitively', () => {
    const shouty = sister({
      id: 'researcher',
      name: 'LUNA',
      type: 'delegation_profile',
    })
    expect(dedupeSistersForPicker([luna, shouty]).map((s) => s.id)).toEqual([
      'luna',
    ])
  })

  it('keeps a colliding profile while it is active (selected/auto-routed)', () => {
    const result = dedupeSistersForPicker(
      [luna, researcher],
      new Set(['researcher']),
    )
    expect(result.map((s) => s.id)).toEqual(['luna', 'researcher'])
  })

  it('does not treat business agents as name-blockers', () => {
    const biz = sister({ id: 'biz-luna', name: 'Luna', type: 'business_agent' })
    const result = dedupeSistersForPicker([biz, researcher])
    expect(result.map((s) => s.id)).toEqual(['biz-luna', 'researcher'])
  })
})
