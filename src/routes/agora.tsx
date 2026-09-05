import { createFileRoute, redirect } from '@tanstack/react-router'
import { usePageTitle } from '@/hooks/use-page-title'
import { AgoraScreen } from '@/screens/agora/agora-screen'
import { useSettingsStore } from '@/hooks/use-settings'

export const Route = createFileRoute('/agora')({
  ssr: false,
  beforeLoad: () => {
    const { settings } = useSettingsStore.getState()
    if (!settings.experimentalAgora) {
      throw redirect({ to: '/command' })
    }
  },
  component: AgoraRoute,
})

function AgoraRoute() {
  usePageTitle('Agora')
  return <AgoraScreen />
}
