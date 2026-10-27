import { defineConfig } from '@playwright/test';
export default defineConfig({
  testDir: './tests/e2e',
  fullyParallel: false,
  workers: 1,
  reporter: [['list'], ['json', { outputFile: 'test-results/results.json' }]],
  timeout: 60000,
  use: { browserName: 'chromium', viewport: { width: 1440, height: 1000 }, trace: 'retain-on-failure' },
});
