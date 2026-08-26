import { FinanceScreen } from '../finance/finance-screen'

/**
 * Stopgap for Phase 1 of the finance/trading refactor — renders the
 * existing finance-screen.tsx pinned to the "personal" workspace with its
 * tab switcher hidden, since nav is now the switching mechanism between
 * /trading and /personal-finance. Superseded by a dedicated dashboard in
 * Phase 4.
 */
export function PersonalFinanceScreen() {
  return <FinanceScreen initialWorkspace="personal" showWorkspaceTabs={false} />
}
