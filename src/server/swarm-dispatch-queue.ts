export class SwarmDispatchQueueFullError extends Error {
  constructor() {
    super('Serial dispatch queue is full; retry after a queued batch finishes.')
    this.name = 'SwarmDispatchQueueFullError'
  }
}

export type SwarmDispatchQueueItem = {
  id: string
  position: number
  queuedAt: number
  startedAt: number | null
  assignmentCount: number
}

export type SwarmDispatchQueueSnapshot = {
  active: SwarmDispatchQueueItem | null
  waiting: Array<SwarmDispatchQueueItem>
}

/** FIFO queue shared by serial dispatch requests handled by this server process. */
export class SwarmDispatchQueue {
  private tail: Promise<void> = Promise.resolve()
  private active: SwarmDispatchQueueItem | null = null
  private waiting: Array<SwarmDispatchQueueItem> = []
  private sequence = 0

  constructor(private readonly maxPending = 12) {}

  canAccept(): boolean {
    return this.waiting.length < this.maxPending
  }

  snapshot(): SwarmDispatchQueueSnapshot {
    return {
      active: this.active ? { ...this.active, position: 0 } : null,
      waiting: this.waiting.map((item, index) => ({
        ...item,
        position: index + (this.active ? 2 : 1),
      })),
    }
  }

  enqueue<T>(
    task: () => Promise<T>,
    assignmentCount = 1,
  ): { id: string; position: number; result: Promise<T> } {
    if (!this.canAccept()) throw new SwarmDispatchQueueFullError()

    const item: SwarmDispatchQueueItem = {
      id: `serial-${Date.now().toString(36)}-${(++this.sequence).toString(36)}`,
      position: 0,
      queuedAt: Date.now(),
      startedAt: null,
      assignmentCount: Math.max(1, Math.floor(assignmentCount)),
    }
    this.waiting.push(item)
    const position = this.waiting.length + (this.active ? 1 : 0)
    const result = this.tail.then(async () => {
      this.waiting = this.waiting.filter((queued) => queued.id !== item.id)
      item.startedAt = Date.now()
      this.active = item
      try {
        return await task()
      } finally {
        this.active = null
      }
    })
    this.tail = result.then(
      () => undefined,
      () => undefined,
    )
    return { id: item.id, position, result }
  }
}

export const swarmDispatchQueue = new SwarmDispatchQueue()
