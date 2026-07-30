// @ts-check
const { defineConfig } = require('@playwright/test');

/** @see https://www.electronjs.org/docs/latest/tutorial/automated-testing */
module.exports = defineConfig({
  testDir: './e2e',
  timeout: 90_000,
  expect: { timeout: 15_000 },
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [['list']],
  outputDir: 'test-results',
  use: {
    trace: 'on-first-retry',
  },
});
