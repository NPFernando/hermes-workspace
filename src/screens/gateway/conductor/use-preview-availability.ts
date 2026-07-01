import { useQuery } from '@tanstack/react-query'
import { useEffect, useRef, useState } from 'react'

export function usePreviewAvailability(previewUrl: string | null, enabled: boolean) {
  const [failedProbes, setFailedProbes] = useState(0)
  const [timedOut, setTimedOut] = useState(false)
  const lastProbeRef = useRef(0)

  useEffect(() => {
    setFailedProbes(0)
    setTimedOut(false)
    lastProbeRef.current = 0
  }, [enabled, previewUrl])

  useEffect(() => {
    if (!enabled || !previewUrl) return
    const timer = window.setTimeout(() => setTimedOut(true), 6_000)
    return () => window.clearTimeout(timer)
  }, [enabled, previewUrl])

  const exhausted = enabled && !!previewUrl && (failedProbes >= 4 || timedOut)

  const probeQuery = useQuery({
    queryKey: ['conductor', 'preview-probe', previewUrl],
    queryFn: async () => {
      if (!previewUrl) return false
      try {
        const res = await fetch(previewUrl)
        if (!res.ok) return false
        const text = await res.text()
        return text.length > 20 && (text.includes('<') || text.includes('html'))
      } catch {
        return false
      }
    },
    enabled: enabled && !!previewUrl && !exhausted,
    retry: false,
    refetchInterval: (query) => (query.state.data === true || exhausted ? false : 1_500),
    staleTime: 5_000,
  })

  useEffect(() => {
    if (!enabled || !previewUrl || probeQuery.data === true || probeQuery.dataUpdatedAt === 0) return
    if (lastProbeRef.current === probeQuery.dataUpdatedAt) return
    lastProbeRef.current = probeQuery.dataUpdatedAt
    setFailedProbes((current) => current + 1)
  }, [enabled, previewUrl, probeQuery.data, probeQuery.dataUpdatedAt])

  return {
    ready: probeQuery.data === true,
    loading: enabled && !!previewUrl && !exhausted && probeQuery.data !== true,
    unavailable: enabled && !!previewUrl && exhausted && probeQuery.data !== true,
  }
}

