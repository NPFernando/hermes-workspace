import { describe, expect, it } from 'vitest'
import {
  SwarmDispatchQueue,
  SwarmDispatchQueueFullError,
} from './swarm-dispatch-queue'

describe('SwarmDispatchQueue', () => {
  it('runs serial submissions in FIFO order and reports queue positions', async () => {
    const queue = new SwarmDispatchQueue()
    const order: Array<string> = []
    let active = 0
    let peakActive = 0
    const run = (name: string) =>
      queue.enqueue(async () => {
        active += 1
        peakActive = Math.max(peakActive, active)
        order.push(`start:${name}`)
        await new Promise((resolve) => setTimeout(resolve, 5))
        order.push(`end:${name}`)
        active -= 1
        return name
      })

    const first = run('first')
    const second = run('second')
    const third = run('third')

    expect([first.position, second.position, third.position]).toEqual([1, 2, 3])
    expect(queue.snapshot().waiting.map((item) => item.id)).toEqual([
      first.id,
      second.id,
      third.id,
    ])
    expect(
      await Promise.all([first.result, second.result, third.result]),
    ).toEqual(['first', 'second', 'third'])
    expect(queue.snapshot()).toEqual({ active: null, waiting: [] })
    expect(peakActive).toBe(1)
    expect(order).toEqual([
      'start:first',
      'end:first',
      'start:second',
      'end:second',
      'start:third',
      'end:third',
    ])
  })

  it('limits waiting capacity and continues after a failed job', async () => {
    const queue = new SwarmDispatchQueue(2)
    let releaseFirst: (() => void) | undefined
    const first = queue.enqueue(
      () => new Promise<void>((resolve) => (releaseFirst = resolve)),
    )
    await Promise.resolve()
    const second = queue.enqueue(async () => 'second')
    const third = queue.enqueue(async () => 'third')
    expect(() => queue.enqueue(async () => 'overflow')).toThrow(
      SwarmDispatchQueueFullError,
    )

    releaseFirst?.()
    await expect(first.result).resolves.toBeUndefined()
    await expect(second.result).resolves.toBe('second')
    await expect(third.result).resolves.toBe('third')

    const failing = queue.enqueue(async () => {
      throw new Error('worker failed')
    })
    const following = queue.enqueue(async () => 'still runs')
    await expect(failing.result).rejects.toThrow('worker failed')
    await expect(following.result).resolves.toBe('still runs')
  })
})
