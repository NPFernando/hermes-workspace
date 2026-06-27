import { createFileRoute, redirect } from '@tanstack/react-router'

export const Route = createFileRoute('/swarm2')({
  beforeLoad: () => { throw redirect({ to: '/swarm' }) },
})
