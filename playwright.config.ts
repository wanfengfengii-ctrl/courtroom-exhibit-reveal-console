import { defineConfig, devices } from '@playwright/test';

const PORT = process.env.WEB_PORT ?? '4173';
// 容器内一次性验收时指向 compose 网络中的 web 组件；本地运行则自带 dev server。
const baseURL = process.env.E2E_BASE_URL ?? `http://localhost:${PORT}`;

export default defineConfig({
  testDir: './e2e',
  fullyParallel: false,
  workers: 1,
  reporter: process.env.CI ? [['list'], ['html', { open: 'never' }]] : 'list',
  timeout: 30_000,
  use: {
    baseURL,
    trace: 'on-first-retry',
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'], contextOptions: { locale: 'zh-CN' } },
    },
  ],
  webServer: process.env.E2E_BASE_URL
    ? undefined
    : {
        command: `npm run dev -- --port ${PORT} --strictPort`,
        url: `${baseURL}/console.html`,
        reuseExistingServer: !process.env.CI,
        timeout: 60_000,
      },
});
