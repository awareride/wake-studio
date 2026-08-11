import { defineConfig, devices } from '@playwright/test'

/**
 * Playwright e2e config. Runs against the production preview server.
 * The smoke test verifies the Phase-0 shell renders the AEC->BSS->NS->KWS
 * pipeline. Mic/audio tests arrive in Phase 1.
 */
export default defineConfig({
  testDir: './e2e',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  reporter: process.env.CI ? 'github' : 'list',
  use: {
    baseURL: 'http://localhost:4173',
    trace: 'on-first-retry',
    // Fake media stream: auto-grants mic permission + provides a synthetic audio
    // device, so audio tests can run headlessly without real hardware.
    launchOptions: {
      args: [
        '--use-fake-device-for-media-stream',
        '--use-fake-ui-for-media-stream',
      ],
    },
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
  webServer: {
    // Build with the e2e harness page included (E2E_HARNESS=1), then preview.
    // The L3 inference spec needs a bundled page to import the real driver;
    // the default `build` omits it so test scaffolding never ships (the spec
    // skips itself if the page is absent, so a plain preview still works).
    command: 'E2E_HARNESS=1 pnpm build:e2e && pnpm preview',
    url: 'http://localhost:4173',
    reuseExistingServer: !process.env.CI,
    timeout: 180_000,
  },
})
