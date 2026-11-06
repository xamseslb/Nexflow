import { defineConfig, devices } from '@playwright/test'
export default defineConfig({
  testDir: './tests', fullyParallel: true,
  testIgnore: '**/pwa.spec.ts',
  use: { baseURL: 'http://127.0.0.1:5187', trace: 'retain-on-failure' },
  webServer: { env: { VITE_SUPABASE_URL: 'https://nexflow-e2e.invalid', VITE_SUPABASE_PUBLISHABLE_KEY: 'test-only', VITE_API_URL: '/api/v1', VITE_DEMO_MODE: 'false' }, command: 'npm run dev -- --port 5187 --strictPort', url: 'http://127.0.0.1:5187', reuseExistingServer: false },
  projects: [
    { name: 'desktop', use: { ...devices['Desktop Chrome'], channel: process.env.PLAYWRIGHT_BROWSER === 'chromium' ? undefined : 'msedge' } },
    { name: 'mobile', use: { ...devices['iPhone 13'], defaultBrowserType: 'chromium', channel: process.env.PLAYWRIGHT_BROWSER === 'chromium' ? undefined : 'msedge' } }
  ]
})
