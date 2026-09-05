import fs from 'node:fs/promises'
import { createFileRoute } from '@tanstack/react-router'
import { isAuthenticated } from '../../server/auth-middleware'

const APK_PATH = '/srv/projects/labs/hermes-android-twa/app-release-signed.apk'
const APK_FILENAME = 'hermes-workspace.apk'

export const Route = createFileRoute('/api/download-apk')({
  server: {
    handlers: {
      GET: async ({ request }) => {
        if (!isAuthenticated(request)) {
          return new Response('Unauthorized', { status: 401 })
        }

        let data: Buffer
        try {
          data = await fs.readFile(APK_PATH)
        } catch {
          return new Response('APK not found on server', { status: 404 })
        }

        const body = data.buffer.slice(
          data.byteOffset,
          data.byteOffset + data.byteLength,
        ) as ArrayBuffer

        return new Response(body, {
          status: 200,
          headers: {
            'Content-Type': 'application/vnd.android.package-archive',
            'Content-Disposition': `attachment; filename="${APK_FILENAME}"`,
            'Content-Length': String(data.byteLength),
            'Cache-Control': 'no-store',
          },
        })
      },
    },
  },
})
