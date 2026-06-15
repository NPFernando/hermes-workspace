import { createFileRoute } from '@tanstack/react-router'
import { json } from '@tanstack/react-start'
import { isAuthenticated } from '../../../server/auth-middleware'
import {
  listExternalMemoryCandidates,
  editExternalMemoryCandidate,
  approveExternalMemoryCandidate,
  rejectExternalMemoryCandidate,
  deleteExternalMemoryCandidate,
  getExternalMemoryProviderById,
  updateExternalMemoryCandidateMeta,
} from '../../../server/external-memory-browser'
import { retainHindsight } from '../../../server/hindsight-client'

export const Route = createFileRoute('/api/external-memory/candidates')({
  server: {
    handlers: {
      GET: ({ request }) => {
        if (!isAuthenticated(request)) {
          return json({ error: 'Unauthorized' }, { status: 401 })
        }

        try {
          const url = new URL(request.url)
          return json(
            listExternalMemoryCandidates({
              provider: url.searchParams.get('provider') || undefined,
              state: url.searchParams.get('state') || undefined,
              limit: url.searchParams.get('limit') || undefined,
              offset: url.searchParams.get('offset') || undefined,
            }),
          )
        } catch (error) {
          return json(
            {
              error:
                error instanceof Error
                  ? error.message
                  : 'Failed to list external memory candidates',
            },
            { status: 500 },
          )
        }
      },
      POST: async ({ request }) => {
        if (!isAuthenticated(request)) {
          return json({ error: 'Unauthorized' }, { status: 401 })
        }

        try {
          const body = (await request.json().catch(() => ({}))) as {
            provider?: string
            id?: string
            action?: string
            text?: string
            reason?: string
          }
          if (body.action === 'edit') {
            return json(
              editExternalMemoryCandidate({
                provider: body.provider,
                id: body.id || '',
                text: body.text || '',
              }),
            )
          }
          if (body.action === 'approve') {
            const result = approveExternalMemoryCandidate({
              provider: body.provider,
              id: body.id || '',
            })
            // For Hindsight provider: commit to daemon as part of the approve flow
            try {
              const prov = getExternalMemoryProviderById(body.provider)
              if (prov.kind === 'hindsight') {
                const { operation_id } = await retainHindsight(result.candidate.text)
                updateExternalMemoryCandidateMeta({
                  provider: body.provider,
                  id: body.id || '',
                  meta: {
                    hindsight_operation_id: operation_id,
                    hindsight_committed_at: Date.now(),
                  },
                })
                return json({ ...result, hindsight_operation_id: operation_id })
              }
            } catch {
              // non-Hindsight provider or daemon unavailable — return standard result
            }
            return json(result)
          }
          if (body.action === 'reject') {
            return json(
              rejectExternalMemoryCandidate({
                provider: body.provider,
                id: body.id || '',
                reason: body.reason || '',
              }),
            )
          }
          return json({ error: 'Unsupported action' }, { status: 400 })
        } catch (error) {
          return json(
            {
              error:
                error instanceof Error
                  ? error.message
                  : 'Failed to update external memory candidate',
            },
            { status: 500 },
          )
        }
      },
      DELETE: async ({ request }) => {
        if (!isAuthenticated(request)) {
          return json({ error: 'Unauthorized' }, { status: 401 })
        }

        try {
          const url = new URL(request.url)
          const id = url.searchParams.get('id') || ''
          const provider = url.searchParams.get('provider') || undefined
          return json(deleteExternalMemoryCandidate({ provider, id }))
        } catch (error) {
          return json(
            {
              error:
                error instanceof Error
                  ? error.message
                  : 'Failed to delete external memory candidate',
            },
            { status: 500 },
          )
        }
      },
    },
  },
})
