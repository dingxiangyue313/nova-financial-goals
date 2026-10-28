type Result = { id: string; impact?: string | null; nodes: unknown[] };
import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

test.beforeEach(({ page }) => { page.on('pageerror', error => { throw error; }); });

test('Money Mission keeps keyboard, reduced motion and non-color status labels', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('/');
  await expect(page.getByText('快速直达:')).toHaveCount(0);
  await expect(page.getByText('Money Mission 演示后台')).toHaveCount(0);
  await page.getByRole('button', { name: '查看账单与消费' }).click();
  await expect(page.getByRole('navigation', { name: 'Money Mission 进度' })).toBeVisible();
  await page.getByRole('button', { name: /数据.*已完成/ }).focus();
  await page.keyboard.press('Enter');
  await expect(page.getByRole('button', { name: '导入 NOVA 合成样例' })).toBeVisible();
  await expect(page.getByText('事实').or(page.getByText('限制')).first()).toBeVisible();
  const report = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa']).analyze();
  expect(report.violations.filter((item: Result) => item.impact === 'serious' || item.impact === 'critical')).toEqual([]);
});
