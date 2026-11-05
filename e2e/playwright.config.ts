import { defineConfig } from '@playwright/test';

/**
 * End-to-end tests against the built API and web app. Requires a migrated and
 * seeded database (see CLAUDE.md). Run with: pnpm test:e2e
 */
const PW_CHROMIUM = process.env.PW_CHROMIUM_PATH;

export default defineConfig({
  testDir: './tests',
  timeout: 30_000,
  use: {
    baseURL: 'http://localhost:4173',
    launchOptions: PW_CHROMIUM ? { executablePath: PW_CHROMIUM } : {},
  },
  webServer: [
    {
      command: 'node ../apps/api/dist/main.js',
      url: 'http://localhost:3000/api/health/ready',
      reuseExistingServer: !process.env.CI,
      env: {
        PORT: '3000',
        DATABASE_URL: process.env.DATABASE_URL ?? 'postgres://relay:relay@localhost:5432/relay_desk',
      },
    },
    {
      command: 'pnpm --filter @relay-desk/web preview --strictPort',
      url: 'http://localhost:4173',
      reuseExistingServer: !process.env.CI,
    },
  ],
});
