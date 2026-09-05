/**
 * Onboarding storage/event keys, split from claude-onboarding.tsx so the
 * root route can read them without statically pulling the whole onboarding
 * wizard (and its dependencies) into the eager entry chunk.
 */
export const ONBOARDING_KEY = 'claude-onboarding-complete'
export const ONBOARDING_COMPLETE_EVENT = 'claude:onboarding-complete'
