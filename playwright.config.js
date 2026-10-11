import { defineConfig } from '@playwright/test';
export default defineConfig({ testDir: './tests/browser', workers: 1, timeout: 120000, reporter: 'list',
  webServer: { command: 'node tests/server.mjs', url: 'http://127.0.0.1:4173', reuseExistingServer: false } });
