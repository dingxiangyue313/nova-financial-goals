type Result = { id: string; impact?: string | null; nodes: unknown[] };
import AxeBuilder from '@axe-core/playwright';
import { test, expect, type Page } from '@playwright/test';

async function expectNoSeriousViolations(page: Page, screen: string) {
  const result = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
    .analyze();
  const violations = result.violations.filter((item: Result) => item.impact === 'serious' || item.impact === 'critical');
  expect(violations, `${screen}: ${violations.map((item: Result) => `${item.id} (${item.nodes.length})`).join(', ')}`).toEqual([]);
}

test('首页、工作台、可行性、影响和授权页无严重无障碍问题', async ({ page }) => {
  test.setTimeout(60_000);
  await page.route(/https:\/\/(fonts\.(googleapis|gstatic)\.com|images\.unsplash\.com|lh3\.googleusercontent\.com)\/.*/, route => route.abort());
  await page.goto('/demo-control', { waitUntil: 'domcontentloaded' });
  await page.addStyleTag({ content: '*, *::before, *::after { animation: none !important; transition: none !important; }' });
  await expect(page.getByRole('heading', { name: 'NOVA 目标工作台' })).toBeVisible();
  await page.request.post('/api/demo/load-japan');
  await page.reload();
  await expect(page.getByRole('heading', { name: '早上好，Alex' })).toBeVisible();
  await expectNoSeriousViolations(page, '首页');

  await page.getByTitle('新建目标 / NOVA 智能对话').click();
  await expect(page.getByRole('heading', { name: 'NOVA 目标工作台' })).toBeVisible();
  await expectNoSeriousViolations(page, 'NOVA 工作台');

  await page.getByRole('button', { name: '4. 目标可行性' }).click();
  await expect(page.getByText('选择适合你的节奏', { exact: true })).toBeVisible();
  await expectNoSeriousViolations(page, '目标可行性');

  await page.getByRole('button', { name: '3. 目标影响' }).click();
  await expect(page.getByRole('heading', { name: /目标影响|NOVA 洞察/ })).toBeVisible();
  await expectNoSeriousViolations(page, '目标影响');

  await page.getByRole('button', { name: '1. 首页' }).click();
  await page.getByTitle('个人设置').click();
  await page.getByRole('button', { name: /授权、外部 Agent 与执行记录/ }).click();
  await expect(page.getByRole('heading', { name: /授权与执行记录/ })).toBeVisible();
  await expectNoSeriousViolations(page, '授权与执行记录');
});
