/**
 * Shared type for agent swarm session data, consumed by the swarm
 * visualization components (isometric office, activity panel).
 *
 * The zustand polling store that used to live in this file was removed:
 * its `startPolling`/`stopPolling` actions were never called anywhere in
 * the app, so `sessions` stayed permanently empty and the sound-notification
 * effect that watched it in `use-sounds.ts` never fired. The swarm
 * visualization components get their session data from elsewhere and only
 * need this type.
 */
import type { GatewaySession } from '@/lib/gateway-api'

export type SwarmSession = GatewaySession & {
  /** Derived status for UI rendering */
  swarmStatus: 'running' | 'thinking' | 'complete' | 'failed' | 'error' | 'idle'
  /** Time since last update in ms */
  staleness: number
}
