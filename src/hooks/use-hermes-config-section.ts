import { useCallback, useEffect, useState } from 'react'

/**
 * Fetches one sub-key of ~/.hermes/config.yaml (via /api/hermes-config) and
 * provides a save() that PATCHes just that sub-key. Previously each Settings
 * section (agent, display, tts, stt) hand-rolled an identical
 * fetch-on-mount + PATCH-to-save pair against the same endpoint.
 */
export function useHermesConfigSection<
  T extends Record<string, unknown> = Record<string, unknown>,
>(sectionKey: string) {
  const [config, setConfig] = useState<T>({} as T)

  useEffect(() => {
    fetch('/api/hermes-config')
      .then((r) => r.json())
      .then((d: { config?: Record<string, unknown> }) => {
        const raw = d.config?.[sectionKey] as
          | Record<string, unknown>
          | undefined
        setConfig((raw ?? {}) as T)
      })
      .catch(() => {})
  }, [sectionKey])

  const save = useCallback(
    async (key: string, value: unknown) => {
      await fetch('/api/hermes-config', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ config: { [sectionKey]: { [key]: value } } }),
      })
      setConfig((prev) => ({ ...prev, [key]: value }))
    },
    [sectionKey],
  )

  return { config, setConfig, save }
}

/**
 * "Saved"/"Failed" status message with the same 2-second auto-clear timeout
 * previously duplicated inline in every Settings section's save handler.
 */
export function useSavedMessage() {
  const [msg, setMsg] = useState<string | null>(null)

  const runWithSavedMessage = useCallback(
    async (action: () => Promise<unknown>) => {
      setMsg(null)
      try {
        await action()
        setMsg('Saved')
        setTimeout(() => setMsg(null), 2000)
      } catch {
        setMsg('Failed')
      }
    },
    [],
  )

  return { msg, runWithSavedMessage }
}
