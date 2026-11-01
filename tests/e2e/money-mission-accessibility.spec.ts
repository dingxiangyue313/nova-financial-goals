type Result = { id: string; impact?: string | null; nodes: unknown[] };
import { test, expect } from './fixtures';
import AxeBuilder from '@axe-core/playwright';

test.beforeEach(({ page }) => { page.on('pageerror', error => { throw error; }); });

test('Money Mission keeps keyboard, reduced motion and non-color status labels', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('/');
  await expect(page.getByText('快速直达:')).toHaveCount(0);
  await expect(page.getByText('Money Mission 演示后台')).toHaveCount(0);
  await page.getByRole('button', { name: '查看账单与消费' }).click();
  await page.getByRole('button',{name:'支出分析',exact:true}).click();await expect(page.getByRole('heading',{name:'钱主要花在哪里'})).toBeVisible();
  await page.getByRole('button',{name:'数据管理',exact:true}).focus();
  await page.keyboard.press('Enter');
  await expect(page.getByRole('button',{name:'导入示例账单'})).toBeVisible();
  const report = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa']).analyze();
  expect(report.violations.filter((item: Result) => item.impact === 'serious' || item.impact === 'critical')).toEqual([]);
});
