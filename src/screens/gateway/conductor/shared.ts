export type AvailableModel = {
  id?: string
  provider?: string
  name?: string
}

export type HistoryMessage = {
  role?: string
  content?: string | Array<{ type?: string; text?: string }>
}

export const AGENT_NAMES  = ['Astra', 'Nova', 'Ada',  'Maya', 'Vega', 'Atlas', 'Lyra', 'Forge']
export const AGENT_EMOJIS = ['✨',    '🔎',  '💻',   '🔨',   '📈',  '🗺️',   '💡',   '🏗️']

export function getAgentPersona(index: number) {
  return {
    name: AGENT_NAMES[index % AGENT_NAMES.length],
    emoji: AGENT_EMOJIS[index % AGENT_EMOJIS.length],
  }
}

export function getShortModelName(model: string | null | undefined): string {
  if (!model) return 'Unknown'
  const parts = model.split('/')
  return parts[parts.length - 1] || model
}

export function extractMessageText(message: HistoryMessage | undefined): string {
  if (!message) return ''
  if (typeof message.content === 'string') return message.content
  if (Array.isArray(message.content)) {
    return message.content
      .map((part) => (typeof part.text === 'string' ? part.text : ''))
      .filter(Boolean)
      .join('\n')
  }
  return ''
}

export function getLastAssistantMessage(messages: Array<HistoryMessage> | undefined): string {
  if (!Array.isArray(messages)) return ''
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages.at(index)
    if (message?.role !== 'assistant') continue
    const text = extractMessageText(message)
    if (text.trim()) return text.trim()
  }
  return ''
}
