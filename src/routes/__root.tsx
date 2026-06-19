import {
  HeadContent,
  Outlet,
  Scripts,
  createRootRoute,
  useRouterState,
} from '@tanstack/react-router'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { useEffect, useState } from 'react'
import appCss from '../styles.css?url'
import { getRootSurfaceState } from './-root-layout-state'
import type { AuthStatus } from '@/lib/claude-auth'
import { SearchModal } from '@/components/search/search-modal'
import { UsageMeter } from '@/components/usage-meter'
import { TerminalShortcutListener } from '@/components/terminal-shortcut-listener'
import { GlobalShortcutListener } from '@/components/global-shortcut-listener'
import KeyboardShortcuts from '@/components/KeyboardShortcuts'
import { WorkspaceShell } from '@/components/workspace-shell'
import { MobilePromptTrigger } from '@/components/mobile-prompt/MobilePromptTrigger'
import { Toaster } from '@/components/ui/toast'
import { OnboardingTour } from '@/components/onboarding/onboarding-tour'
import { KeyboardShortcutsModal } from '@/components/keyboard-shortcuts-modal'
import { UpdateCenterNotifier } from '@/components/update-center-notifier'
import { WhatsNewModal } from '@/components/whats-new-modal'
import {
  applyInterfacePreferences,
  initializeSettingsAppearance,
  useSettings,
} from '@/hooks/use-settings'
import { useApplyChatWidth } from '@/hooks/use-chat-settings'
import { useSettingsSync } from '@/hooks/use-settings-sync'
import {
  ClaudeOnboarding,
  ONBOARDING_COMPLETE_EVENT,
  ONBOARDING_KEY,
} from '@/components/onboarding/claude-onboarding'
import { ErrorBoundary } from '@/components/error-boundary'
import { LoginScreen } from '@/components/auth/login-screen'
import { fetchClaudeAuthStatus } from '@/lib/claude-auth'

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
const DEFAULT_THEME = 'odysseus'
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

const DEFAULT_SPLASH_HTML = `
<img src="/claude-avatar.webp" alt="Hermes Agent" style="width:80px;height:80px;margin-bottom:20px;border-radius:16px;filter:drop-shadow(0 8px 32px rgba(224,108,117,0.45))" />
<img src="/claude-banner.png" alt="Hermes Workspace" style="width:280px;height:auto;margin-bottom:8px;filter:drop-shadow(0 4px 16px rgba(0,0,0,0.5))" />
<div style="font:400 14px/1 'JetBrains Mono Variable',ui-monospace,monospace;letter-spacing:0.06em;color:rgba(156,222,242,0.65)">Workspace</div>
<div style="margin-top:28px;width:140px;height:3px;background:rgba(255,255,255,0.08);border-radius:3px;overflow:hidden;position:relative"><div id="splash-bar" style="width:0%;height:100%;background:#f08090;border-radius:3px;transition:width 0.4s ease"></div></div>
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
          {error instanceof Error ? error.message : String(error)}
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

type CachesLike = {
  keys: () => Promise<Array<string>>
  delete: (name: string) => Promise<boolean> | boolean
}

export async function registerAppServiceWorker({
  serviceWorker,
}: {
  serviceWorker?: ServiceWorkerLike
  cachesApi?: CachesLike
}): Promise<void> {
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
      cachesApi: 'caches' in window ? caches : undefined,
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
          {mounted && rootSurfaceState.showOnboarding ? <ClaudeOnboarding /> : null}
          {rootSurfaceState.showWorkspaceShell ? (
            <>
              <SettingsSyncMount />
              <GlobalShortcutListener />
              <TerminalShortcutListener />
              <KeyboardShortcuts />
              <WorkspaceShell>
                <ErrorBoundary
                  className="h-full min-h-0 flex-1"
                  title="Something went wrong"
                  description="This page failed to render. Reload to try again."
                >
                  <Outlet />
                </ErrorBoundary>
              </WorkspaceShell>
              <SearchModal />
              {/* Keep UsageMeter mounted so search-modal OPEN_USAGE still works even when the pill is hidden by default. */}
              <UsageMeter visible={settings.showUsageMeter} />
              <KeyboardShortcutsModal />
              <UpdateCenterNotifier />
              <WhatsNewModal />
              {rootSurfaceState.showPostOnboardingOverlays ? (
                <>
                  <MobilePromptTrigger />
                  <OnboardingTour />
                </>
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
        {/* The inline splash bootstrap mutates this node before React hydrates.
            Keep default splash markup in the server/client tree, then suppress
            parent-level style/theme mutations for this intentionally browser-owned DOM. */}
        <div
          id="splash-screen"
          aria-hidden="true"
          suppressHydrationWarning
          style={{ display: 'none' }}
          dangerouslySetInnerHTML={{ __html: DEFAULT_SPLASH_HTML }}
        />
        <script
          dangerouslySetInnerHTML={{
            __html: wrapInlineScript(`
          (function(){
            var d = document.getElementById('splash-screen');
            if (!d) return;
            var bg = '#282c34', txt = '#9cdef2', muted = 'rgba(156,222,242,0.55)', accent = '#e06c75', dotGrid = false, monoFont = true;
            try {
              var theme = localStorage.getItem('${THEME_STORAGE_KEY}') || '${DEFAULT_THEME}';
              if (theme === 'odysseus') {
                bg = '#282c34';
                txt = '#9cdef2';
                muted = 'rgba(156,222,242,0.65)';
                accent = '#f08090';
                dotGrid = true;
                monoFont = true;
              } else if (theme === 'claude-nous') {
                bg = '#031A1A';
                txt = '#F8F1E3';
                muted = '#9CB2AE';
                accent = '#FFAC02';
                dotGrid = false;
                monoFont = false;
              } else if (theme === 'claude-nous-light') {
                bg = '#F8FAF8';
                txt = '#16315F';
                muted = '#6F7D96';
                accent = '#2557B7';
              } else if (theme === 'claude-classic') {
                bg = '#0d0f12';
                txt = '#eceff4';
                muted = '#7f8a96';
                accent = '#b98a44';
              } else if (theme === 'claude-official') {
                bg = '#0a0e1a';
                txt = '#e6eaf2';
                muted = '#9aa5bd';
                accent = '#6366f1';
              } else if (theme === 'claude-official-light') {
                bg = '#F7F7F1';
                txt = '#16315F';
                muted = '#6F7D96';
                accent = '#2557B7';
              } else if (theme === 'claude-classic-light') {
                bg = '#F5F2ED';
                txt = '#1a1f26';
                muted = '#6F675E';
                accent = '#b98a44';
              } else if (theme === 'claude-slate') {
                bg = '#0d1117';
                txt = '#c9d1d9';
                muted = '#8b949e';
                accent = '#7eb8f6';
              } else if (theme === 'claude-slate-light') {
                bg = '#F6F8FA';
                txt = '#24292f';
                muted = '#57606A';
                accent = '#3b82f6';
              } else if (theme === 'matrix') {
                bg = '#020804';
                txt = '#d8ffe3';
                muted = 'rgba(216,255,227,0.58)';
                accent = '#00ff41';
              } else if (theme === 'matrix-light') {
                bg = '#F4FFF6';
                txt = '#062a12';
                muted = 'rgba(6,42,18,0.55)';
                accent = '#008f2d';
              } else if (theme === 'scifi') {
                bg = '#060b18';
                txt = '#e0f7fa';
                muted = '#5d9bb8';
                accent = '#00f0ff';
              } else if (theme === 'scifi-light') {
                bg = '#eef1f5';
                txt = '#0a1628';
                muted = '#5a6a7e';
                accent = '#0097a7';
              }
            } catch(e){}

            var isDark = !['claude-nous-light','claude-official-light','claude-classic-light','claude-slate-light','matrix-light','scifi-light'].includes(theme);
            var fontStack = monoFont ? "'JetBrains Mono Variable',ui-monospace,monospace" : "system-ui,-apple-system,sans-serif";
            var letterSpacing = monoFont ? '0.06em' : '0.04em';
            var gridStyle = dotGrid ? ';background-image:radial-gradient(rgba(53,90,102,0.45) 1px,transparent 1px);background-size:20px 20px' : '';
            var terminalQuips = ['> initializing agent runtime...','> loading ancient knowledge...','> calibrating tool chain...','> summoning your agent...','> bridging realms...','> connecting to Hermes...'];
            var quip = (dotGrid || theme === 'matrix' || theme === 'scifi') ? terminalQuips[Math.floor(Math.random() * terminalQuips.length)] : '';

            d.style.cssText = 'position:fixed;inset:0;z-index:99999;display:flex;flex-direction:column;align-items:center;justify-content:center;background:'+bg+';transition:opacity 0.5s ease'+gridStyle+';';
            d.innerHTML = '<img src="/claude-avatar.webp" alt="Hermes Agent" style="width:80px;height:80px;margin-bottom:20px;border-radius:16px;filter:drop-shadow(0 8px 32px color-mix(in srgb,'+accent+' 45%, transparent))" />'
              + '<img src="'+(isDark ? '/claude-banner.png' : '/claude-banner-light.png')+'" alt="Hermes Workspace" style="width:280px;height:auto;margin-bottom:8px;filter:drop-shadow(0 4px 16px '+(isDark ? 'rgba(0,0,0,0.5)' : 'rgba(0,0,0,0.1)')+')" />'
              + '<div style="font:400 14px/1 '+fontStack+';letter-spacing:'+letterSpacing+';color:'+muted+'">Workspace</div>'
              + (quip ? '<div style="margin-top:10px;font:400 11px/1 '+fontStack+';letter-spacing:0.08em;color:'+accent+';opacity:0.6">'+quip+'</div>' : '')
              + '<div style="margin-top:28px;width:140px;height:3px;background:'+(isDark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.08)')+';border-radius:3px;overflow:hidden;position:relative"><div id=splash-bar style="width:0%;height:100%;background:'+accent+';border-radius:3px;transition:width 0.4s ease"></div></div>';

            var bar = document.getElementById('splash-bar');
            if (bar) {
              setTimeout(function(){ bar.style.width='15%' }, 300);
              setTimeout(function(){ bar.style.width='40%' }, 800);
              setTimeout(function(){ bar.style.width='65%' }, 1500);
              setTimeout(function(){ bar.style.width='85%' }, 2500);
              setTimeout(function(){ bar.style.width='92%' }, 3200);
            }

            window.__dismissSplash = function() {
              var el = document.getElementById('splash-screen');
              if (!el) return;
              if (bar) bar.style.width = '100%';
              setTimeout(function(){
                el.style.opacity = '0';
                setTimeout(function(){
                  el.innerHTML = '';
                  el.style.cssText = 'display:none';
                }, 500);
              }, 300);
            };
            // Fallback: always dismiss after 5s
            setTimeout(function(){ window.__dismissSplash && window.__dismissSplash(); }, 5000);
            // Fast dismiss: returning users skip quickly
            try {
              if (localStorage.getItem('claude-claude-url') || localStorage.getItem('claude-url')) {
                setTimeout(function(){ window.__dismissSplash && window.__dismissSplash(); }, 600);
              }
            } catch(e) {}
          })()
        `),
          }}
        />
        <div className="root">{children}</div>
        <Scripts />
        <script
          dangerouslySetInnerHTML={{
            __html: wrapInlineScript(`
          (function(){
            var fired = false;
            function dismiss() {
              if (fired) return;
              fired = true;
              if (obs) obs.disconnect();
              window.__dismissSplash && window.__dismissSplash();
            }
            var obs = new MutationObserver(function() {
              var el = document.querySelector('nav, aside, .workspace-shell, [data-testid]');
              if (el) dismiss();
            });
            obs.observe(document.getElementById('root') || document.body, { childList: true, subtree: true });
            // Fallback: dismiss after 6s if MutationObserver never fires
            setTimeout(dismiss, 6000);
          })()
        `),
          }}
        />
      </body>
    </html>
  )
}
