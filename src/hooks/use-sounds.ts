/**
 * React hook for sound notifications in ClawSuite
 */
import { useCallback, useMemo } from 'react'

import type { SoundEvent } from '@/lib/sounds'

import {
  getSoundVolume,
  isSoundEnabled,
  playAgentComplete,
  playAgentFailed,
  playAgentSpawned,
  playAlert,
  playChatComplete,
  playChatNotification,
  playSound,
  playThinking,
  setSoundEnabled,
  setSoundVolume,
} from '@/lib/sounds'

interface UseSoundsReturn {
  // Play functions
  playAgentSpawned: () => void
  playAgentComplete: () => void
  playAgentFailed: () => void
  playChatNotification: () => void
  playChatComplete: () => void
  playAlert: () => void
  playThinking: () => void
  playSound: (event: SoundEvent) => void

  // Control functions
  volume: number
  setVolume: (vol: number) => void
  enabled: boolean
  setEnabled: (enabled: boolean) => void
}

/**
 * Hook that provides sound-playing functions and volume/enabled controls.
 */
export function useSounds(): UseSoundsReturn {
  // Stable callbacks
  const setVolume = useCallback((vol: number) => {
    setSoundVolume(vol)
  }, [])

  const setEnabled = useCallback((enabled: boolean) => {
    setSoundEnabled(enabled)
  }, [])

  // Return memoized object for stable reference
  return useMemo(
    () => ({
      // Play functions (stable references from module)
      playAgentSpawned,
      playAgentComplete,
      playAgentFailed,
      playChatNotification,
      playChatComplete,
      playAlert,
      playThinking,
      playSound,

      // Control
      volume: getSoundVolume(),
      setVolume,
      enabled: isSoundEnabled(),
      setEnabled,
    }),
    [setVolume, setEnabled],
  )
}

// Re-export types and functions for convenience
export type { SoundEvent }
export {
  playAgentSpawned,
  playAgentComplete,
  playAgentFailed,
  playChatNotification,
  playChatComplete,
  playAlert,
  playThinking,
  setSoundVolume,
  setSoundEnabled,
  isSoundEnabled,
  getSoundVolume,
  playSound,
}
