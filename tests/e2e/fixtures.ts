import { test as base, expect } from '@playwright/test';

// Existing business-flow suites begin after the first-use connection screen.
// The dedicated input/navigation suites exercise that entry explicitly.
export const test = base.extend({
  page: async ({ page }, use) => {
    // Establish the cookie before browser bootstrap and API scenario setup can
    // race to create two different simulated sessions.
    await page.request.get('/api/session');
    await page.route(/https:\/\/(fonts\.(googleapis|gstatic)\.com|images\.unsplash\.com|lh3\.googleusercontent\.com)\/.*/, route => route.abort());
    // Keep business scenarios on their explicitly created goals. Sample-gallery
    // seeding is independent of the banking operations exercised by these suites.
    await page.route('**/api/product/goal-samples', async route => {
      const session = await page.request.get('/api/session');
      await route.fulfill({ json: await session.json() });
    });
    const goto = page.goto.bind(page);
    const reload = page.reload.bind(page);
    const finishEntry = async () => {
      if (new URL(page.url()).pathname !== '/') return;
      await expect(page.getByRole('heading', { name: '连接模拟数据', exact: true })).toBeVisible();
      await page.getByRole('button', { name: '返回', exact: true }).click();
    };
    page.goto = async (url, options) => { const response = await goto(url, { waitUntil: 'domcontentloaded', ...options }); await finishEntry(); return response; };
    page.reload = async (...args) => { const response = await reload(...args); await finishEntry(); return response; };
    await use(page);
  },
});
export { expect };
export type { Page } from '@playwright/test';

export async function openCategory(page: import('@playwright/test').Page, name: string) {
  const entry = page.getByRole('button', { name, exact: true });
  if (!await entry.isVisible()) {
    const workspaceTitle = page.getByRole('banner').getByRole('heading', { name: 'NOVA 财务助手', exact: true });
    if (!await workspaceTitle.isVisible()) {
      const back = page.getByRole('button', { name: '返回', exact: true });
      if (await back.isVisible()) await back.click();
    }
    await expect(workspaceTitle).toBeVisible();
    await expect(entry).toBeVisible();
  }
  await entry.click();
}
