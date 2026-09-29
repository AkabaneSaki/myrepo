import { readFileSync } from 'node:fs';
import { defineConfig, devices } from '@playwright/test';

const workshopConfig = JSON.parse(
  readFileSync(new URL('./config/workshop.json', import.meta.url), 'utf8'),
);

const baseURL = process.env.WORKSHOP_BASE_URL || workshopConfig.endpoints.staging;

export default defineConfig({
  testDir: './tests/e2e',
  timeout: 30_000,
  expect: {
    timeout: 10_000,
  },
  fullyParallel: false,
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  reporter: [
    ['line'],
    ['html', { outputFolder: 'playwright-report', open: 'never' }],
  ],
  use: {
    baseURL,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
  },
  projects: [
    {
      name: 'desktop-chromium',
      testIgnore: /(?:st-control|issue-regression|css-regression|keyboard-regression|auth-regression)\.spec\.mjs/,
      use: {
        ...devices['Desktop Chrome'],
        viewport: { width: 1440, height: 900 },
      },
    },
    {
      name: 'mobile-chromium',
      testIgnore: /(?:st-control|issue-regression|css-regression|keyboard-regression|auth-regression)\.spec\.mjs/,
      use: {
        ...devices['Pixel 7'],
      },
    },
    {
      name: 'st-edge',
      testMatch: /(?:st-control|issue-regression|css-regression|keyboard-regression|auth-regression)\.spec\.mjs/,
      use: {
        ...devices['Desktop Chrome'],
        channel: 'msedge',
        viewport: { width: 1440, height: 900 },
      },
    },
  ],
});
