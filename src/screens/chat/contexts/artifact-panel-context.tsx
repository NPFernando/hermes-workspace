import { createContext, useContext } from 'react'
import type { InlineArtifact } from '../components/message-item'

export type ArtifactPanelState = {
  artifacts: Array<InlineArtifact>
  activeIndex: number
}

type ArtifactPanelContextValue = {
  open: (artifacts: Array<InlineArtifact>, index: number) => void
}

export const ArtifactPanelContext = createContext<ArtifactPanelContextValue | null>(null)

export function useArtifactPanel() {
  return useContext(ArtifactPanelContext)
}
