import { test as base, expect } from '@playwright/test';

// Existing business-flow suites begin after the first-use connection screen.
// The dedicated input/navigation suites exercise that entry explicitly.
export const test = base.extend({
  page: async ({ page }, use) => {
    const goto = page.goto.bind(page);
    const reload = page.reload.bind(page);
    const finishEntry = async () => {
      if (new URL(page.url()).pathname !== '/') return;
      await expect(page.getByRole('heading', { name: '连接模拟数据', exact: true })).toBeVisible();
      await page.getByRole('button', { name: '返回', exact: true }).click();
    };
    page.goto = async (...args) => { const response = await goto(...args); await finishEntry(); return response; };
    page.reload = async (...args) => { const response = await reload(...args); await finishEntry(); return response; };
    await use(page);
  },
});
export { expect };
export type { Page } from '@playwright/test';
