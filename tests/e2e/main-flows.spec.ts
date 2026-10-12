import { test, expect } from '@playwright/test';

test('goal, impact and governed external-agent flows remain connected', async ({ page }) => {
  await page.route('**/api/ui/cards', async route => {
    await new Promise(resolve => setTimeout(resolve, 150));
    await route.continue();
  });
  await page.goto('/');
  await expect(page.getByRole('heading', { name: '早上好，Alex' })).toBeVisible();

  await page.getByRole('button', { name: '2. 创建目标' }).click();
  await page.getByRole('button', { name: '下一步：查看可行性' }).click();
  await expect(page.getByText('选择适合你的节奏', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: /平衡方案/ }).click();
  await page.getByRole('button', { name: /确认以此节奏推进/ }).click();
  await expect(page.getByText('进度正常')).toBeVisible();

  await page.reload();
  await expect(page.getByText('进度正常')).toBeVisible();
  await page.getByTitle('点击切换模拟数据或事件').click();
  await page.getByRole('button', { name: /模拟突发支出 ¥900/ }).click();
  await expect(page.getByText(/两个不动应急金的办法/)).toBeVisible();
  await page.getByRole('button', { name: /方案 B · 调整目标日期/ }).click();
  await page.getByRole('button', { name: /确认应用：方案 B/ }).click();

  await page.getByTitle('个人设置').click();
  await page.getByRole('button', { name: /授权、外部 Agent 与执行记录/ }).click();
  await page.getByRole('button', { name: '确认创建交通类模拟授权' }).click();
  await page.getByRole('button', { name: '交通 Execute' }).click();
  await expect(page.getByText('EXECUTED').first()).toBeVisible();
  await expect(page.getByText(/Hash 链有效/)).toBeVisible();
  await expect(page.getByRole('link', { name: '导出 JSON' })).toBeVisible();
});
