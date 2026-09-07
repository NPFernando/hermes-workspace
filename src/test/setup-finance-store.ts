import { beforeEach } from 'vitest'

import { __resetFinanceTestStore } from '../server/finance-store'

/**
 * The finance store's vitest backend is an in-process object held on
 * `globalThis` (so it survives `vi.resetModules()` and the `vi.importActual`
 * module pinning that ~15 suites rely on). Wipe it before every test so each
 * test starts from an empty store — the same fresh-per-test guarantee the old
 * tmp-`HOME` `finance.json` gave, now without a filesystem.
 */
beforeEach(() => {
  __resetFinanceTestStore()
})
