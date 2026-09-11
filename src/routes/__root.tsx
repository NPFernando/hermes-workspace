import {
  HeadContent,
  Outlet,
  Scripts,
  createRootRoute,
  useRouterState,
} from '@tanstack/react-router'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { Suspense, lazy, useEffect, useState } from 'react'
import appCss from '../styles.css?url'
import { getRootSurfaceState } from './-root-layout-state'
import type { AuthStatus } from '@/lib/claude-auth'
import { TerminalShortcutListener } from '@/components/terminal-shortcut-listener'
import { GlobalShortcutListener } from '@/components/global-shortcut-listener'
import KeyboardShortcuts from '@/components/KeyboardShortcuts'
import { WorkspaceShell } from '@/components/workspace-shell'
import { Toaster } from '@/components/ui/toast'
import {
  applyInterfacePreferences,
  initializeSettingsAppearance,
  useSettings,
} from '@/hooks/use-settings'
import { useApplyChatWidth } from '@/hooks/use-chat-settings'
import { useSettingsSync } from '@/hooks/use-settings-sync'
import {
  ONBOARDING_COMPLETE_EVENT,
  ONBOARDING_KEY,
} from '@/components/onboarding/onboarding-constants'
import {
  ErrorBoundary,
  StaleAssetRecoveryListener,
} from '@/components/error-boundary'
import { LoginScreen } from '@/components/auth/login-screen'
import { fetchClaudeAuthStatus } from '@/lib/claude-auth'
import { safeErrorMessage } from '@/lib/error-utils'

const UsageMeter = lazy(() =>
  import('@/components/usage-meter').then((m) => ({ default: m.UsageMeter })),
)
const SearchModal = lazy(() =>
  import('@/components/search/search-modal').then((m) => ({
    default: m.SearchModal,
  })),
)
const KeyboardShortcutsModal = lazy(() =>
  import('@/components/keyboard-shortcuts-modal').then((m) => ({
    default: m.KeyboardShortcutsModal,
  })),
)
const NotificationHub = lazy(() =>
  import('@/components/notification-hub').then((m) => ({
    default: m.NotificationHub,
  })),
)
const OnboardingTour = lazy(() =>
  import('@/components/onboarding/onboarding-tour').then((m) => ({
    default: m.OnboardingTour,
  })),
)
const ClaudeOnboarding = lazy(() =>
  import('@/components/onboarding/claude-onboarding').then((m) => ({
    default: m.ClaudeOnboarding,
  })),
)

const APP_CSP = [
  "default-src 'self'",
  "base-uri 'self'",
  "object-src 'none'",
  "form-action 'self'",
  // frame-ancestors is ignored in meta CSP and must be sent as an HTTP header.
  "script-src 'self' 'unsafe-inline' https://cdn.jsdelivr.net",
  "style-src 'self' 'unsafe-inline' https://cdn.jsdelivr.net",
  "img-src 'self' data: blob: https:",
  "font-src 'self' data:",
  "connect-src 'self' ws: wss: http: https:",
  "worker-src 'self' blob:",
  "media-src 'self' blob: data:",
  "frame-src 'self' http: https:",
].join('; ')

const THEME_STORAGE_KEY = 'claude-theme'
const DEFAULT_THEME = 'claude-nous'
const VALID_THEMES = [
  'claude-nous',
  'claude-nous-light',
  'claude-official',
  'claude-official-light',
  'claude-classic',
  'claude-classic-light',
  'claude-slate',
  'claude-slate-light',
  'matrix',
  'matrix-light',
  'scifi',
  'scifi-light',
  'odysseus',
]

const themeScript = `
(() => {
  window.process = window.process || { env: {}, platform: 'browser' };

  try {
    const root = document.documentElement
    const storedTheme = localStorage.getItem('${THEME_STORAGE_KEY}')
    const theme = ${JSON.stringify(VALID_THEMES)}.includes(storedTheme) ? storedTheme : '${DEFAULT_THEME}'
    const lightThemes = ['claude-nous-light', 'claude-official-light', 'claude-classic-light', 'claude-slate-light', 'matrix-light', 'scifi-light']
    const isDark = !lightThemes.includes(theme)
    root.classList.remove('light', 'dark', 'system')
    root.classList.add(isDark ? 'dark' : 'light')
    root.setAttribute('data-theme', theme)
    root.style.setProperty('color-scheme', isDark ? 'dark' : 'light')

    // Demo mode
    try {
      if (new URLSearchParams(window.location.search).get('demo') === '1') {
        document.documentElement.setAttribute('data-demo', 'true');
      }
    } catch {}
  } catch {}
})()
`

const themeColorScript = `
(() => {
  try {
    const root = document.documentElement
    const theme = root.getAttribute('data-theme') || '${DEFAULT_THEME}'
    const colors = {
      'claude-nous': '#031A1A',
      'claude-nous-light': '#F8FAF8',
      'claude-official': '#0A0E1A',
      'claude-official-light': '#F7F7F1',
      'claude-classic': '#0d0f12',
      'claude-classic-light': '#F5F2ED',
      'claude-slate': '#0d1117',
      'claude-slate-light': '#F6F8FA',
      'matrix': '#020804',
      'matrix-light': '#F4FFF6',
      'scifi': '#060b18',
      'scifi-light': '#EEF1F5',
      'odysseus': '#282c34',
    }
    const nextColor = colors[theme] || colors['${DEFAULT_THEME}']
    const isDark = !['claude-nous-light', 'claude-official-light', 'claude-classic-light', 'claude-slate-light', 'matrix-light', 'scifi-light'].includes(String(theme))

    let meta = document.querySelector('meta[name="theme-color"]')
    if (!meta) {
      meta = document.createElement('meta')
      meta.setAttribute('name', 'theme-color')
      document.head.appendChild(meta)
    }
    meta.setAttribute('content', nextColor)
    root.style.setProperty('color-scheme', isDark ? 'dark' : 'light')
  } catch {}
})()
`

export const Route = createRootRoute({
  head: () => ({
    meta: [
      {
        charSet: 'utf-8',
      },
      {
        name: 'viewport',
        content:
          'width=device-width, initial-scale=1, maximum-scale=5, user-scalable=yes, viewport-fit=cover, interactive-widget=resizes-visual',
      },
      {
        title: 'Hermes Workspace',
      },
      {
        name: 'description',
        content:
          'Hermes Agent workspace for chat, tools, files, memory, and jobs.',
      },
      {
        property: 'og:image',
        content: '/cover.png',
      },
      {
        property: 'og:image:type',
        content: 'image/png',
      },
      {
        name: 'twitter:card',
        content: 'summary_large_image',
      },
      {
        name: 'twitter:image',
        content: '/cover.png',
      },
      // PWA meta tags
      {
        name: 'theme-color',
        content: '#282c34',
      },
      {
        name: 'apple-mobile-web-app-capable',
        content: 'yes',
      },
      {
        name: 'apple-mobile-web-app-status-bar-style',
        content: 'default',
      },
    ],
    links: [
      {
        rel: 'stylesheet',
        href: appCss,
      },
      {
        rel: 'icon',
        type: 'image/png',
        href: '/claude-avatar.png',
      },
      // PWA manifest and icons
      {
        rel: 'manifest',
        href: '/manifest.json',
      },
      {
        rel: 'apple-touch-icon',
        href: '/apple-touch-icon.png',
        sizes: '180x180',
      },
    ],
  }),

  shellComponent: RootDocument,
  component: RootLayout,
  errorComponent: function RootError({ error }) {
    return (
      <div className="flex flex-col items-center justify-center min-h-dvh p-6 text-center bg-[var(--theme-panel)]">
        <h1 className="text-2xl font-semibold text-[var(--theme-text)] mb-4">
          Something went wrong
        </h1>
        <pre className="p-4 bg-[var(--theme-hover)] rounded-lg text-sm text-[var(--theme-muted)] max-w-full overflow-auto mb-6">
          {safeErrorMessage(error)}
        </pre>
        <button
          onClick={() => (window.location.href = '/')}
          className="px-4 py-2 bg-accent-500 text-white rounded-lg hover:bg-accent-600 transition-colors"
        >
          Return Home
        </button>
      </div>
    )
  },
})

const queryClient = new QueryClient()

export function getRootLayoutMode(
  onboardingComplete: string | null,
): 'onboarding' | 'workspace' {
  return onboardingComplete === 'true' ? 'workspace' : 'onboarding'
}

export function wrapInlineScript(source: string): string {
  return `(() => {\n  try {\n${source}\n  } catch (error) {\n    console.error('Inline bootstrap script failed', error)\n  }\n})()`
}

type ServiceWorkerLike = {
  register: (
    scriptURL: string,
    options?: RegistrationOptions,
  ) => Promise<unknown>
}

export async function registerAppServiceWorker({
  serviceWorker,
}: {
  serviceWorker?: ServiceWorkerLike
}): Promise<void> {
  // Do not clear browser caches on every mount. The service worker owns
  // versioned cache cleanup during activation; purging here made every
  // reload a cold launch and amplified the duplicate-loading perception.
  await serviceWorker
    ?.register('/sw.js', { scope: '/' })
    .catch((error: unknown) => {
      console.warn('PWA service worker registration failed', error)
    })
}

function SettingsSyncMount() {
  useSettingsSync()
  return null
}

function RootLayout() {
  const { settings } = useSettings()
  const pathname = useRouterState({
    select: (state) => state.location.pathname,
  })
  const [onboardingComplete, setOnboardingComplete] = useState<boolean | null>(
    null,
  )
  const [authStatus, setAuthStatus] = useState<AuthStatus | null>(null)
  const [mounted, setMounted] = useState(false)
  useApplyChatWidth()

  useEffect(() => {
    applyInterfacePreferences(settings)
  }, [settings])

  useEffect(() => {
    setMounted(true)
    initializeSettingsAppearance()

    // The inline SSR splash belongs only to the pre-hydration bootstrap. Once
    // React owns the document, dismiss it from the root layout rather than
    // waiting for a particular child surface (such as the connection checker)
    // to mount. This prevents the themed bootstrap and a runtime startup
    // surface from ever being visible as duplicate loading screens.
    window.__dismissSplash?.()

    const syncOnboardingCompletion = () => {
      try {
        setOnboardingComplete(localStorage.getItem(ONBOARDING_KEY) === 'true')
      } catch {
        setOnboardingComplete(false)
      }
    }

    if (typeof window === 'undefined') {
      return undefined
    }

    syncOnboardingCompletion()

    const handleStorage = (event: StorageEvent) => {
      if (event.key && event.key !== ONBOARDING_KEY) return
      syncOnboardingCompletion()
    }

    const handleOnboardingCompleteChanged = () => {
      syncOnboardingCompletion()
    }

    window.addEventListener('storage', handleStorage)
    window.addEventListener(
      ONBOARDING_COMPLETE_EVENT,
      handleOnboardingCompleteChanged,
    )

    void registerAppServiceWorker({
      serviceWorker:
        'serviceWorker' in navigator ? navigator.serviceWorker : undefined,
    })

    return () => {
      window.removeEventListener('storage', handleStorage)
      window.removeEventListener(
        ONBOARDING_COMPLETE_EVENT,
        handleOnboardingCompleteChanged,
      )
    }
  }, [])

  useEffect(() => {
    if (typeof window === 'undefined') return undefined
    let cancelled = false
    fetchClaudeAuthStatus()
      .then((status) => {
        if (cancelled) return
        setAuthStatus(status)
        if (status.authenticated || !status.authRequired) {
          void fetch('/api/connection-status')
            .then((res) => (res.ok ? res.json() : null))
            .then(
              (
                connectionStatus: {
                  ok?: boolean
                  chatReady?: boolean
                  modelConfigured?: boolean
                } | null,
              ) => {
                if (
                  !cancelled &&
                  (connectionStatus?.ok ||
                    (connectionStatus?.chatReady &&
                      connectionStatus.modelConfigured))
                ) {
                  localStorage.setItem(ONBOARDING_KEY, 'true')
                  setOnboardingComplete(true)
                }
              },
            )
            .catch(() => undefined)
        }
      })
      .catch(() => {
        if (!cancelled) {
          setAuthStatus(
            (prev) => prev ?? { authenticated: false, authRequired: true },
          )
        }
      })
    return () => {
      cancelled = true
    }
  }, [])

  const isPublicSurface = pathname === '/download-apk'
  const rootSurfaceState = isPublicSurface
    ? {
        showLogin: false,
        showOnboarding: false,
        showWorkspaceShell: true,
        showPostOnboardingOverlays: false,
      }
    : getRootSurfaceState(onboardingComplete, authStatus)

  return (
    <QueryClientProvider client={queryClient}>
      <Toaster />
      <StaleAssetRecoveryListener />
      {isPublicSurface ? (
        <ErrorBoundary
          className="min-h-dvh"
          title="Something went wrong"
          description="This page failed to render. Reload to try again."
        >
          <Outlet />
        </ErrorBoundary>
      ) : (
        <>
          {mounted && rootSurfaceState.showLogin ? <LoginScreen /> : null}
          {mounted && rootSurfaceState.showOnboarding ? (
            <Suspense fallback={null}>
              <ClaudeOnboarding />
            </Suspense>
          ) : null}
          {rootSurfaceState.showWorkspaceShell ? (
            <>
              <SettingsSyncMount />
              <GlobalShortcutListener />
              <TerminalShortcutListener />
              <KeyboardShortcuts />
              <WorkspaceShell initialAuthStatus={authStatus}>
                <ErrorBoundary
                  className="h-full min-h-0 flex-1"
                  title="Something went wrong"
                  description="This page failed to render. Reload to try again."
                >
                  <Outlet />
                </ErrorBoundary>
              </WorkspaceShell>
              <Suspense fallback={null}>
                <SearchModal />
              </Suspense>
              {/* Keep UsageMeter mounted so search-modal OPEN_USAGE still works even when the pill is hidden by default. */}
              <Suspense fallback={null}>
                <UsageMeter visible={settings.showUsageMeter} />
              </Suspense>
              <Suspense fallback={null}>
                <KeyboardShortcutsModal />
              </Suspense>
              <Suspense fallback={null}>
                <NotificationHub />
              </Suspense>
              {rootSurfaceState.showPostOnboardingOverlays ? (
                <Suspense fallback={null}>
                  <OnboardingTour />
                </Suspense>
              ) : null}
            </>
          ) : null}
        </>
      )}
    </QueryClientProvider>
  )
}

function RootDocument({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <meta httpEquiv="Content-Security-Policy" content={APP_CSP} />
        <script
          dangerouslySetInnerHTML={{
            __html: wrapInlineScript(`
          // Polyfill crypto.randomUUID for non-secure contexts (HTTP access via LAN IP)
          if (typeof crypto !== 'undefined' && !crypto.randomUUID) {
            crypto.randomUUID = function() {
              return ([1e7]+-1e3+-4e3+-8e3+-1e11).replace(/[018]/g, function(c) {
                return (c ^ crypto.getRandomValues(new Uint8Array(1))[0] & 15 >> c / 4).toString(16);
              });
            };
          }
        `),
          }}
        />
        <script
          dangerouslySetInnerHTML={{ __html: wrapInlineScript(themeScript) }}
        />
        <HeadContent />
        <script
          dangerouslySetInnerHTML={{
            __html: wrapInlineScript(themeColorScript),
          }}
        />
      </head>
      <body>
        {/* Stable marker retained so older cached scripts can safely no-op. The
            mounted app owns login, onboarding, and connection states. */}
        <div
          id="splash-screen"
          aria-hidden="true"
          suppressHydrationWarning
          style={{ display: 'none' }}
        />
        <script
          dangerouslySetInnerHTML={{
            __html: wrapInlineScript(`
          (function(){
            var d = document.getElementById('splash-screen');
            if (!d) return;
            window.__dismissSplash = function() {
              var el = document.getElementById('splash-screen');
              if (!el) return;
              el.replaceChildren();
              el.style.cssText = 'display:none';
            };
            window.__dismissSplash();
          })()
        `),
          }}
        />
        <div className="root">{children}</div>
        <Scripts />
        <script
          dangerouslySetInnerHTML={{
            __html: wrapInlineScript(`
          // Kept as a no-op compatibility hook for older cached bundles. The
          // current bootstrap script dismisses the hidden marker immediately,
          // and the mounted root calls the same idempotent function once more.
          if (window.__dismissSplash) window.__dismissSplash();
        `),
          }}
        />
      </body>
    </html>
  )
}
