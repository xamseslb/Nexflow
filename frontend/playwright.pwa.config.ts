import { defineConfig, devices } from '@playwright/test'
export default defineConfig({
  testDir: './tests', testMatch: '**/pwa.spec.ts',
  use: { ...devices['Desktop Chrome'], baseURL: 'http://127.0.0.1:4173', channel: process.env.PLAYWRIGHT_BROWSER === 'chromium' ? undefined : 'msedge' },
  webServer: { command: 'npm run preview -- --port 4173 --strictPort', url: 'http://127.0.0.1:4173', reuseExistingServer: !process.env.CI }
})
