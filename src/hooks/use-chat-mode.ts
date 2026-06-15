import { useQuery } from '@tanstack/react-query'

export type ChatMode = 'enhanced-claude' | 'portable' | 'disconnected'

interface GatewayStatus {
  capabilities: Record<string, boolean>
  claudeUrl: string
}

function deriveChatMode(capabilities: Record<string, boolean>): ChatMode {
  if (capabilities.sessions) return 'enhanced-claude'
  if (capabilities.chatCompletions || capabilities.health) return 'portable'
  return 'disconnected'
}

export function useChatMode(): ChatMode {
  const { data } = useQuery({
    queryKey: ['gateway-status'],
    queryFn: async () => {
      const res = await fetch('/api/gateway-status')
      if (!res.ok) return null
      return (await res.json()) as GatewayStatus
    },
    staleTime: 15_000,
    refetchInterval: (query) => {
      const d = query.state.data
      return d ? (d.capabilities.health ? 60_000 : 5_000) : 5_000
    },
    retry: 3,
    retryDelay: (attemptIndex: number) => Math.min(1000 * 2 ** attemptIndex, 30_000),
  })

  if (!data?.capabilities) return 'disconnected'
  return deriveChatMode(data.capabilities)
}
