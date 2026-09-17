# Release checklist

`pnpm run release:check` is a read-only, fail-closed validation of a release:

1. PWA manifest, icons, service-worker offline shell, and cache privacy rules.
2. Built SSR/client asset integrity.
3. The configured systemd workspace service is active.
4. The live root, asset graph, and authentication boundary pass release smoke.

The deploy script runs this checklist after restart and before advancing the
deployment marker. A failure leaves the rollback trap active; the checklist
does not restart services or modify deployment state itself.
