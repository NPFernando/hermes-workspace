# Release checklist

`pnpm run release:check` is a read-only, fail-closed validation of a release:

1. PWA manifest, icons, service-worker offline shell, cache privacy rules, and browser-level offline navigation.
2. Built SSR/client asset integrity.
3. JavaScript/CSS bundle-size budgets.
4. The configured systemd workspace service is active.
5. The live root, asset graph, and authentication boundary pass release smoke.

The deploy script runs this checklist after restart and before advancing the
deployment marker. A failure leaves the rollback trap active; the checklist
does not restart services or modify deployment state itself.

To inspect the release target without changing the working tree, building,
restarting the service, or advancing the marker, run:

```sh
./scripts/deploy.sh --preview
```

Preview output is JSON containing the current commit, `origin/main` target,
whether the checkout is dirty, the changed-file count, and the action that a
normal deployment would take. The preview may refresh the local remote-tracking
reference, but never merges, builds, restarts, or writes deployment state.
