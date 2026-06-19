export type ChangeKind = 'added' | 'fixed' | 'improved' | 'removed'

export type ChangeEntry = {
  kind: ChangeKind
  text: string
}

export type VersionEntry = {
  version: string       // semver e.g. "2.4.0"
  date: string          // ISO date e.g. "2026-06-19"
  apkVersion?: string   // e.g. "1.2" — set when APK also shipped this release
  summary: string       // one-line headline
  changes: Array<ChangeEntry>
}

export const CHANGELOG: Array<VersionEntry> = [
  {
    version: '2.4.0',
    date: '2026-06-19',
    apkVersion: '1.2',
    summary: 'Android app permissions, cross-platform sizing & settings polish',
    changes: [
      { kind: 'added',    text: 'Android app: camera, microphone, and file storage permissions declared in manifest — web APIs now work inside the TWA' },
      { kind: 'added',    text: 'TWA safe-area-inset-top detection — content no longer starts behind the Android status bar' },
      { kind: 'added',    text: 'Settings → Android App: version badge, full-width download button, "Show install reminder" toggle' },
      { kind: 'added',    text: 'Settings → Network Access: Tailscale + local network setup cards, gateway tip' },
      { kind: 'improved', text: 'All 100vh occurrences replaced with 100dvh / var(--vvh) — panels resize correctly when the mobile keyboard opens' },
      { kind: 'improved', text: 'Mobile scrollbars hidden globally — no layout shift on small screens' },
      { kind: 'fixed',    text: 'Settings → Android App and Network Access sections were not rendering (wrong component scope + React.useState type-only import)' },
      { kind: 'fixed',    text: 'Install popup modal used hardcoded text-white — now follows active theme' },
    ],
  },
  {
    version: '2.3.0',
    date: '2026-06-17',
    apkVersion: '1.1',
    summary: 'Orientation lock fix, update detection & APK download flow',
    changes: [
      { kind: 'fixed',    text: 'Android TWA: screen rotated even when OS rotation lock was on — Chrome overrode the Activity setting after load; intercepting setRequestedOrientation() in LauncherActivity fixes it' },
      { kind: 'added',    text: 'APK download page at /download-apk with version display and install steps' },
      { kind: 'added',    text: 'Update detection: tracks last downloaded APK version in localStorage and shows banner when server has a newer build' },
      { kind: 'added',    text: 'MobilePromptTrigger: shows install prompt after delay on mobile, update banner inside the TWA when new version available' },
      { kind: 'improved', text: 'Digital Asset Links updated with new keystore fingerprint after keystore regeneration' },
    ],
  },
  {
    version: '2.2.0',
    date: '2026-06-10',
    summary: 'HARP routing config screen, sister growth tracking',
    changes: [
      { kind: 'added',    text: 'HARP routing config screen in Settings — shows tier routing table and active model overrides' },
      { kind: 'added',    text: 'Sister growth tracking writes to ~/.hermes/cron/jobs.json' },
      { kind: 'improved', text: 'Agent-animated task cards with AgentStateBadge and SourceBadge' },
      { kind: 'improved', text: 'Tasks screen: "Ask Astra" button, adaptive polling (4 s active / 30 s idle)' },
    ],
  },
]

export const CURRENT_VERSION = CHANGELOG[0].version
