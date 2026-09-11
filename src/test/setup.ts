// React 19 requires this opt-in for act() to report updates consistently in
// jsdom tests. Keeping it in the shared Vitest setup removes noisy warnings
// without changing production runtime behavior.
;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT =
  true
