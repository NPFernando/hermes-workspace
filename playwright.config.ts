import { defineConfig } from '@playwright/test'

const baseURL = process.env.HERMES_WORKSPACE_URL || 'http://127.0.0.1:3000'

export default defineConfig({
  testDir: './e2e',
  testMatch: '**/*.spec.ts',
  timeout: 30_000,
  fullyParallel: false,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 2 : 0,
  reporter: process.env.CI ? 'github' : 'line',
  use: {
    baseURL,
    storageState: process.env.HERMES_WORKSPACE_E2E_STORAGE_STATE || undefined,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
})
