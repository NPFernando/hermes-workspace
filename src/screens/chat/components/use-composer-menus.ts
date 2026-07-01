import { useEffect, useRef, useState } from 'react'

// Extracted from ChatComposer: open/closed state + click-outside handling
// for the composer's popover menus (model picker, profile picker, workspace
// picker, thinking-level picker, the "+" controls menu, mobile actions
// sheet, and the inline provider-switcher expansion). Pure UI state with no
// network/streaming side effects, so it was safe to pull out without
// touching the surrounding send/attachment logic.
export function useComposerMenus() {
  const [isModelMenuOpen, setIsModelMenuOpen] = useState(false)
  const [isProfileMenuOpen, setIsProfileMenuOpen] = useState(false)
  const [isWorkspaceMenuOpen, setIsWorkspaceMenuOpen] = useState(false)
  const [isThinkingMenuOpen, setIsThinkingMenuOpen] = useState(false)
  const [isControlsMenuOpen, setIsControlsMenuOpen] = useState(false)
  const [isProviderSwitcherExpanded, setIsProviderSwitcherExpanded] = useState(false)
  const [isMobileActionsMenuOpen, setIsMobileActionsMenuOpen] = useState(false)

  const profileMenuRef = useRef<HTMLDivElement | null>(null)
  const modelSelectorRef = useRef<HTMLDivElement | null>(null)
  const thinkingMenuRef = useRef<HTMLDivElement | null>(null)
  const controlsMenuRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    if (
      !isModelMenuOpen &&
      !isProfileMenuOpen &&
      !isThinkingMenuOpen &&
      !isControlsMenuOpen
    )
      return
    function handleOutsideClick(event: MouseEvent) {
      const target = event.target as Node
      if (controlsMenuRef.current?.contains(target)) return
      if (modelSelectorRef.current?.contains(target)) return
      if (profileMenuRef.current?.contains(target)) return
      if (thinkingMenuRef.current?.contains(target)) return
      setIsControlsMenuOpen(false)
      setIsModelMenuOpen(false)
      setIsProviderSwitcherExpanded(false)
      setIsProfileMenuOpen(false)
      setIsThinkingMenuOpen(false)
    }

    document.addEventListener('mousedown', handleOutsideClick)
    return () => {
      document.removeEventListener('mousedown', handleOutsideClick)
    }
  }, [
    isModelMenuOpen,
    isProfileMenuOpen,
    isThinkingMenuOpen,
    isControlsMenuOpen,
  ])

  return {
    isModelMenuOpen, setIsModelMenuOpen,
    isProfileMenuOpen, setIsProfileMenuOpen,
    isWorkspaceMenuOpen, setIsWorkspaceMenuOpen,
    isThinkingMenuOpen, setIsThinkingMenuOpen,
    isControlsMenuOpen, setIsControlsMenuOpen,
    isProviderSwitcherExpanded, setIsProviderSwitcherExpanded,
    isMobileActionsMenuOpen, setIsMobileActionsMenuOpen,
    profileMenuRef, modelSelectorRef, thinkingMenuRef, controlsMenuRef,
  }
}
