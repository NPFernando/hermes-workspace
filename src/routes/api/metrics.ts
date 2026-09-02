import { createFileRoute } from '@tanstack/react-router'
import { json } from '@tanstack/react-start'
import { isAuthenticated } from '../../server/auth-middleware'
import { readdirSync, statSync, existsSync } from 'node:fs'
import { join } from 'node:path'

export const Route = createFileRoute('/api/metrics')({
  server: {
    handlers: {
      GET: ({ request }) => {
        if (!isAuthenticated(request)) {
          return json({ error: 'Unauthorized' }, { status: 401 })
        }

        const distDir = join(process.cwd(), 'dist')
        const bundleSizes: Record<string, number> = {}

        // Read client directory
        const clientDir = join(distDir, 'client')
        if (existsSync(clientDir)) {
          const clientFiles = readdirSync(clientDir)
          for (const file of clientFiles) {
            const filePath = join(clientDir, file)
            const stats = statSync(filePath)
            bundleSizes[`client/${file}`] = stats.size
          }
        }

        // Read server directory
        const serverDir = join(distDir, 'server')
        if (existsSync(serverDir)) {
          const serverFiles = readdirSync(serverDir)
          for (const file of serverFiles) {
            const filePath = join(serverDir, file)
            const stats = statSync(filePath)
            bundleSizes[`server/${file}`] = stats.size
          }
        }

        return json({
          bundleSizes,
          timestamp: Date.now(),
        })
      },
    },
  },
})