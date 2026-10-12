import { test, expect, type Page } from '@playwright/test';

async function openApp(page: Page) {
  await page.route('**/api/ui/cards', async route => {
    await new Promise(resolve => setTimeout(resolve, 150));
    await route.continue();
  });
  await page.goto('/');
  await expect(page.getByRole('heading', { name: '早上好，Alex' })).toBeVisible();
}

async function activateBalancedGoal(page: Page) {
  await page.getByRole('button', { name: '2. 创建目标' }).click();
  await page.getByRole('button', { name: '下一步：查看可行性' }).click();
  await expect(page.getByText('选择适合你的节奏', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: '请选择一个方案' })).toBeDisabled();
  await page.getByRole('button', { name: /平衡方案/ }).click();
  const confirm = page.getByRole('button', { name: /确认以此节奏推进/ });
  await expect(confirm).toBeEnabled();
  await confirm.click();
  await expect(page.getByText('进度正常')).toBeVisible();
}

test('故事一：目标可行性必须先选择方案，再激活计划', async ({ page }) => {
  await openApp(page);
  await activateBalancedGoal(page);
  await page.reload();
  await expect(page.getByText('进度正常')).toBeVisible();
  await expect(page.getByText('已选择并启用计划')).toBeVisible();
});

test('故事二：小额波动保持安静，显著支出才触发目标调整', async ({ page }) => {
  await openApp(page);
  await activateBalancedGoal(page);

  await page.getByTitle('点击切换模拟数据或事件').click();
  await page.getByRole('button', { name: '小额波动 ¥10' }).click();
  await expect(page.getByText('已模拟 ¥10 支出，未触发显著影响提醒')).toBeVisible();

  await page.getByTitle('点击切换模拟数据或事件').click();
  await page.getByRole('button', { name: /模拟突发支出 ¥900/ }).click();
  await expect(page.getByText(/两个不动应急金的办法/)).toBeVisible();
  await expect(page.getByText(/应急金未受影响/)).toBeVisible();
  await page.getByRole('button', { name: /方案 B · 调整目标日期/ }).click();
  await page.getByRole('button', { name: /确认应用：方案 B/ }).click();
  await expect(page.getByText('已应用方案 B')).toBeVisible();
});

test('故事三：限定授权分别产生 Execute、Ask、Manual Review 和 Block', async ({ page }) => {
  await openApp(page);
  await activateBalancedGoal(page);
  await page.getByTitle('个人设置').click();
  await page.getByRole('button', { name: /授权、外部 Agent 与执行记录/ }).click();
  await page.getByRole('button', { name: '确认创建交通类模拟授权' }).click();

  await page.getByRole('button', { name: '交通 Execute' }).click();
  await expect(page.getByText('EXECUTED').first()).toBeVisible();
  await page.getByRole('button', { name: '购物 Ask' }).click();
  await expect(page.getByText('ASK').first()).toBeVisible();
  await page.getByRole('button', { name: '高额 Manual Review' }).click();
  await expect(page.getByText('MANUAL_REVIEW').first()).toBeVisible();
  await page.getByRole('button', { name: '超限 Block' }).click();
  await expect(page.getByText('BLOCKED').first()).toBeVisible();

  await expect(page.getByText(/Hash 链有效/)).toBeVisible();
  await expect(page.getByRole('link', { name: '导出 JSON' })).toBeVisible();
  await expect(page.getByRole('link', { name: '导出 CSV' })).toBeVisible();
});
