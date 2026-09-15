import {
  runSwarmDispatchQueueCycle,
  closeSwarmDispatchQueuePool,
} from '../src/server/swarm-dispatch-queue.ts'

try {
  await runSwarmDispatchQueueCycle(async () => {
    await new Promise((resolve) => setTimeout(resolve, 50))
    return { worker: process.env.QUEUE_TEST_WORKER_ID ?? 'unknown' }
  })
} finally {
  await closeSwarmDispatchQueuePool()
}
