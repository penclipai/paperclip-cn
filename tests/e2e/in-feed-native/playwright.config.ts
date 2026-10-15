import { defineConfig } from '@playwright/test';
// Windows cold starts include the embedded PostgreSQL bootstrap. Keep the
// journey budget explicit so fixture evidence is not cut off while the app is
// still becoming healthy.
export default defineConfig({ testDir: '.', testMatch: '*.spec.ts', workers: 1, timeout: 300_000,
  use: { actionTimeout: 15_000, headless: true, screenshot: 'only-on-failure', trace: 'retain-on-failure' },
  outputDir: process.env.IN_FEED_OUTPUT_DIR ?? '../../../test-results/in-feed-native', reporter: [['list']] });
