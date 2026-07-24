/**
 * Hook that polls the workspace approvals API and merges pending approvals
 * into the existing gateway-level localStorage approvals store.
 *
 * Usage: call this alongside the existing gateway approval polling.
 * Returns a function to create a workspace-level approval via fetch.
 */
import { useEffect } from 'react'
import { loadApprovals, saveApprovals, type ApprovalRequest } from '@/screens/gateway/lib/approvals-store'

type OnApprovalCallback = (approval: ApprovalRequest) => void

/**
 * Polls /api/approvals/pending and merges workspace-level approvals
 * into the existing approvals store.
 */
export function useWorkspaceApprovalPoller(
  activeSessionKey: string | null | undefined,
  onNewApproval: OnApprovalCallback,
  setPendingApprovals: (approvals: Array<ApprovalRequest>) => void,
) {
  useEffect(() => {
    if (!activeSessionKey) return

    let aborted = false

    async function pollWorkspaceApprovals() {
      try {
        const res = await fetch(
          `/api/approvals/pending?session_id=${encodeURIComponent(activeSessionKey!)}`,
        )
        if (!res.ok || aborted) return

        const data = (await res.json()) as {
          ok: boolean
          pending: {
            id: string
            session_id: string
            task_id?: string | null
            title: string
            body: string
            options: Array<{ label: string; value: string; description?: string }>
            status: string
            response?: string | null
            created_at: string
            timeout_minutes: number
          } | null
        }

        if (!data.ok || !data.pending) return

        const pending = data.pending
        const currentApprovals = loadApprovals()
        const exists = currentApprovals.some(
          (entry) => entry.id === pending.id && entry.status === 'pending',
        )
        if (exists) {
          setPendingApprovals(
            currentApprovals.filter((entry) => entry.status === 'pending'),
          )
          return
        }

        // Convert workspace approval to ApprovalRequest format
        const approvalReq: ApprovalRequest = {
          id: pending.id,
          agentId: 'workspace',
          agentName: 'Hermes Workflow',
          action: pending.title,
          context: `${pending.body}\n\nOptions: ${pending.options.map((o) => o.label).join(', ')}`,
          requestedAt: new Date(pending.created_at).getTime(),
          status: 'pending',
          source: 'gateway', // reuse gateway path for API resolution
          gatewayApprovalId: pending.id,
        }

        saveApprovals([approvalReq, ...currentApprovals])
        onNewApproval(approvalReq)
        setPendingApprovals(
          [approvalReq, ...currentApprovals].filter(
            (entry) => entry.status === 'pending',
          ),
        )
      } catch {
        // API not available yet — noop
      }
    }

    pollWorkspaceApprovals()
    const interval = window.setInterval(pollWorkspaceApprovals, 5000)
    return () => {
      aborted = true
      window.clearInterval(interval)
    }
  }, [activeSessionKey, onNewApproval, setPendingApprovals])
}

/**
 * Resolves a workspace approval via POST /api/approvals/resolve.
 * Call this from the approval resolution handler.
 */
export async function resolveWorkspaceApproval(
  approvalId: string,
  status: 'approved' | 'rejected',
  response?: string,
): Promise<boolean> {
  try {
    const res = await fetch('/api/approvals/resolve', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: approvalId, status, response }),
    })
    const data = (await res.json()) as { ok: boolean }
    return data.ok === true
  } catch {
    return false
  }
}