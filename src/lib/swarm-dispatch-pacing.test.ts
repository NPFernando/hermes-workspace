import { describe, expect, it } from 'vitest'
import { buildPacingPreview } from './swarm-dispatch-pacing'

describe('buildPacingPreview', () => {
  it('creates a stable one-at-a-time preview and excludes empty work', () => {
    expect(
      buildPacingPreview([
        { workerId: 'swarm2', task: 'Build the feature' },
        { workerId: 'swarm3', task: '   ' },
        { workerId: 'swarm6', task: 'Review the feature' },
      ]),
    ).toEqual([
      {
        workerId: 'swarm2',
        task: 'Build the feature',
        position: 1,
        total: 2,
      },
      {
        workerId: 'swarm6',
        task: 'Review the feature',
        position: 2,
        total: 2,
      },
    ])
  })

  it('returns an empty preview when there is no dispatchable work', () => {
    expect(buildPacingPreview([])).toEqual([])
  })
})
