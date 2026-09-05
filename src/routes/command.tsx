import { createFileRoute } from '@tanstack/react-router'
import { CommandCenterScreen } from '@/screens/command/command-center-screen'

export const Route = createFileRoute('/command')({
  ssr: false,
  component: function CommandCenterRoute() {
    return <CommandCenterScreen />
  },
})
