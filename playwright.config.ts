import { defineConfig } from '@playwright/test';

const origin = 'http://127.0.0.1:4186';
export default defineConfig({
  testDir: './tests/browser',
  use: { baseURL: origin, channel: process.env.PLAYWRIGHT_CHANNEL || undefined },
  webServer: {
    command: 'vite --host 127.0.0.1 --port 4186 --strictPort',
    url: origin,
    env: { VITE_ENABLE_WALLET_WRITES: 'false' },
  },
});
