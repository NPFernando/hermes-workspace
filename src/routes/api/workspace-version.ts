import { createFileRoute } from '@tanstack/react-router'
import { json } from '@tanstack/react-start'
import { CHANGELOG } from '@/lib/changelog'

export const Route = createFileRoute('/api/workspace-version')({
  server: {
    handlers: {
      GET: () => {
        const latest = CHANGELOG[0]
        return json({
          version: latest.version,
          date: latest.date,
          summary: latest.summary,
          apkVersion: latest.apkVersion ?? null,
        })
      },
    },
  },
})
