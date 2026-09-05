// Types shared between the live Gateway/Conductor surface and other live
// screens (chat's AgentViewPanel via mission-store, swarm2's orchestrator
// card). Extracted from the former task-board/team-panel/agents-working-panel
// components, which were otherwise unreachable dead code and have been
// removed — only their type shapes were still in use.

export type TaskStatus = 'inbox' | 'assigned' | 'in_progress' | 'review' | 'done'

export type HubTask = {
  id: string
  title: string
  description: string
  priority: 'urgent' | 'high' | 'normal' | 'low'
  status: TaskStatus
  agentId?: string
  /** ID of the mission that created this task. Used to filter stale tasks. */
  missionId?: string
  createdAt: number
  updatedAt: number
}

// Presets shown in Agent Hub. 'auto' uses gateway default.
// Additional models from gateway providers show in the chat model switcher.
export const MODEL_PRESETS = [
  {
    id: 'auto',
    label: 'Auto (Gateway Default)',
    desc: 'Uses your configured default model',
  },
  { id: 'opus', label: 'Claude Opus 4.6', desc: 'Deep reasoning — Anthropic' },
  {
    id: 'sonnet',
    label: 'Claude Sonnet 4.6',
    desc: 'Fast & capable — Anthropic',
  },
  { id: 'codex', label: 'GPT-5 Codex', desc: 'Code specialist — OpenAI' },
  { id: 'flash', label: 'Gemini 2.5 Flash', desc: 'Quick & cheap — Google' },
  { id: 'minimax', label: 'MiniMax M3', desc: 'Cost efficient — MiniMax' },
  {
    id: 'pc1-coder',
    label: 'PC1 Coder (97 TPS)',
    desc: 'Qwen3-Coder 30B · Local · RTX 4090',
  },
  {
    id: 'pc1-planner',
    label: 'PC1 Planner (175 TPS)',
    desc: 'Qwen3-30B Sonnet Distill MoE · Local · RTX 4090',
  },
  {
    id: 'pc1-critic',
    label: 'PC1 Critic (83 TPS)',
    desc: 'Qwen3-14B Opus Distill · Local · RTX 4090',
  },
] as const

export type ModelPresetId = (typeof MODEL_PRESETS)[number]['id']

export type TeamMember = {
  id: string
  name: string
  avatar?: number
  modelId: string
  roleDescription: string
  goal: string // What this agent is trying to achieve
  backstory: string // Persona/context that shapes agent behavior
  status: string
  memoryPath?: string // Custom memory/workspace path for this agent
  skillAllowlist?: Array<string> // Skills this agent is allowed to use (empty = all)
  modelOverride?: string // Runtime model override (takes precedence over modelId)
}

export type AgentSessionStatusEntry = {
  status: 'dispatching' | 'active' | 'idle' | 'stopped' | 'error' | 'waiting_for_input'
  lastSeen: number
  lastMessage?: string
}

export type AgentWorkingStatus =
  | 'spawning'
  | 'ready'
  | 'active'
  | 'idle'
  | 'paused'
  | 'error'
  | 'none'
  | 'waiting_for_input'

export type AgentWorkingRow = {
  id: string
  name: string
  modelId: string
  status: AgentWorkingStatus
  lastLine?: string
  lastAt?: number
  taskCount: number
  currentTask?: string
  sessionKey?: string
  roleDescription?: string
}
