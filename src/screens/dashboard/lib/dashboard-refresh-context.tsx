import { createContext, useContext } from 'react'
import type { ReactNode } from 'react'

type DashboardRefreshContextValue = {
  refresh: () => void
  isRefreshing: boolean
  globalUnavailable: boolean
}

const DashboardRefreshContext =
  createContext<DashboardRefreshContextValue | null>(null)

export function DashboardRefreshProvider({
  refresh,
  isRefreshing = false,
  globalUnavailable = false,
  children,
}: {
  refresh: () => void
  isRefreshing?: boolean
  globalUnavailable?: boolean
  children?: ReactNode
}) {
  return (
    <DashboardRefreshContext.Provider
      value={{ refresh, isRefreshing, globalUnavailable }}
    >
      {children}
    </DashboardRefreshContext.Provider>
  )
}

export function useDashboardRefresh() {
  return useContext(DashboardRefreshContext)
}
