import type { AgentRegistryCardData, AgentRegistryStatus } from '@/components/agent-view/agent-registry-card'

export type AgentGatewayEntry = {
  id?: string
  name?: string
  role?: string
  category?: string
  color?: string
  [key: string]: unknown
}

export type AgentsData = {
  defaultId?: string
  mainKey?: string
  scope?: string
  agents?: Array<AgentGatewayEntry>
  [key: string]: unknown
}

export type SessionEntry = {
  key?: string
  friendlyId?: string
  label?: string
  displayName?: string
  title?: string
  derivedTitle?: string
  task?: string
  status?: string
  updatedAt?: number | string
  enabled?: boolean
  [key: string]: unknown
}

export type AgentDefinition = {
  id: string
  name: string
  category: string
  role: string
  color: AgentRegistryCardData['color']
  aliases: Array<string>
}

export type AgentRuntime = AgentRegistryCardData & {
  matchedSessions: Array<SessionEntry>
}

export type AgentConfigToolEntry = {
  id: string
  enabled: boolean
  source: 'allowed' | 'denied' | 'explicit' | 'unknown'
}

export type AgentConfigSkillEntry = {
  id: string
  enabled: boolean
}

export type AgentConfigChannelEntry = {
  id: string
  enabled: boolean | null
  config: Record<string, unknown>
}

export type AgentConfigData = {
  agentId: string
  name: string
  workspacePath: string
  primaryModel: string
  fallbackModels: Array<string>
  modelOverride: string
  tools: Array<AgentConfigToolEntry>
  skills: Array<AgentConfigSkillEntry>
  channels: Array<AgentConfigChannelEntry>
  readOnly: boolean
  supportsPatch: boolean
  sourceMethod?: string
  warning?: string
}

export type AgentConfigDraft = {
  modelOverride: string
  tools: Record<string, boolean>
  skills: Record<string, boolean>
  channels: Record<string, { enabled: boolean | null; config: Record<string, unknown> }>
}

export type AgentConfigPatchPayload = {
  modelOverride?: string
  tools: Record<string, boolean>
  skills: Record<string, boolean>
  channels: Record<string, Record<string, unknown>>
}

export const CATEGORY_ORDER = ['Core', 'Coding', 'System', 'Integrations'] as const

export const STATUS_SORT_ORDER: Record<AgentRegistryStatus, number> = {
  active: 0,
  idle: 1,
  available: 2,
  paused: 3,
}

export const RUNNING_STATUSES = new Set([
  'running',
  'active',
  'thinking',
  'processing',
  'streaming',
  'in-progress',
  'inprogress',
])

export const PAUSED_STATUSES = new Set(['paused', 'pause', 'suspended'])

export const ACTIVE_HEARTBEAT_MS = 30_000

// Temporary fallback registry until the gateway exposes a dedicated agent registry schema.
export const FALLBACK_AGENT_REGISTRY: Array<AgentDefinition> = [
  {
    id: 'aurora-main',
    name: 'Astra',
    category: 'Core',
    role: 'Orchestrator',
    color: 'orange',
    aliases: ['aurora-main', 'aurora', 'astra'],
  },
  {
    id: 'codex',
    name: 'Codex',
    category: 'Coding',
    role: 'Coding specialist',
    color: 'blue',
    aliases: ['codex', 'coding'],
  },
  {
    id: 'memory-consolidator',
    name: 'Memory consolidator',
    category: 'System',
    role: 'Memory service',
    color: 'violet',
    aliases: ['memory-consolidator', 'memory'],
  },
  {
    id: 'telegram-gateway',
    name: 'Telegram gateway',
    category: 'Integrations',
    role: 'Channel bridge',
    color: 'cyan',
    aliases: ['telegram-gateway', 'telegram'],
  },
]

