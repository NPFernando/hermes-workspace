import fs from 'node:fs/promises'
import { createFileRoute } from '@tanstack/react-router'
import { json } from '@tanstack/react-start'

const TWA_MANIFEST = '/srv/projects/labs/hermes-android-twa/twa-manifest.json'

export const Route = createFileRoute('/api/app-version')({
  server: {
    handlers: {
      GET: async () => {
        try {
          const raw = await fs.readFile(TWA_MANIFEST, 'utf-8')
          const m = JSON.parse(raw)
          return json({
            versionCode: m.appVersionCode ?? 1,
            versionName: String(m.appVersionName ?? '1'),
            packageId: m.packageId ?? 'com.fernandofamily.hermes',
          })
        } catch {
          return json({ versionCode: 1, versionName: '1', packageId: 'com.fernandofamily.hermes' })
        }
      },
    },
  },
})
