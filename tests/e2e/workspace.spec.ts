import { test, expect, type Page } from '@playwright/test';

async function openApp(page: Page) {
  await page.goto('/');
  await expect(page.getByRole('heading', { name: '早上好，Alex' })).toBeVisible();
}

async function openWorkspace(page: Page) {
  await page.getByTitle('新建目标 / NOVA 智能对话').click();
  await expect(page.getByRole('heading', { name: 'NOVA 目标工作台' })).toBeVisible();
}

async function activateGoalFromWorkspace(page: Page) {
  await openWorkspace(page);
  await page.getByRole('button', { name: '我想年底去日本旅行，预算 ¥8,000' }).click();
  await expect(page.getByText('确认目标草案')).toBeVisible();
  await page.getByRole('button', { name: '确认保存目标草案' }).click();
  await expect(page.getByText('三种推进节奏')).toBeVisible();
  await page.getByRole('button', { name: '确认平衡方案' }).click();
  await expect(page.getByText(/目标计划已激活/).first()).toBeVisible();
}

test('对话故事一：自然语言生成目标卡，明确确认后激活并长期保留', async ({ page }) => {
  await openApp(page);
  await activateGoalFromWorkspace(page);
  await page.reload();
  await openWorkspace(page);
  await expect(page.getByRole('button', { name: /我想年底去日本旅行/ }).first()).toBeVisible();
  await expect(page.getByText(/目标计划已激活/).first()).toBeVisible();
});

test('对话故事二：显著支出自动创建未读风险会话', async ({ page }) => {
  await openApp(page);
  await activateGoalFromWorkspace(page);
  await page.getByRole('button', { name: '返回首页' }).click();
  await page.getByTitle('点击切换模拟数据或事件').click();
  await page.getByRole('button', { name: /模拟突发支出 ¥900/ }).click();
  await expect(page.getByText(/两个不动应急金的办法/)).toBeVisible();
  await page.getByRole('button', { name: '1. 首页' }).click();
  await openWorkspace(page);
  const risk = page.getByRole('button', { name: /汽车保养影响目标/ });
  await expect(risk).toHaveAttribute('data-unread', 'true');
  await risk.click();
  await expect(risk).toHaveAttribute('data-unread', 'false');
  await expect(page.getByText(/应急金/).first()).toBeVisible();
  await expect(page.getByRole('button', { name: '确认方案 B' })).toBeVisible();
});

test('对话故事三：创建限定授权并运行受治理的外部 Agent 请求', async ({ page }) => {
  await openApp(page);
  await activateGoalFromWorkspace(page);
  const composer = page.getByPlaceholder('描述目标、风险或授权范围…');
  await composer.fill('允许旅行 Agent 在 ¥500 内订票');
  await page.getByRole('button', { name: '发送' }).click();
  await page.getByRole('button', { name: '确认创建授权' }).click();
  await page.getByRole('button', { name: '确认发起Execute' }).click();
  await expect(page.getByText(/EXECUTED/).first()).toBeVisible();
  await expect(page.getByText('治理与审计')).toBeVisible();
});

test('历史会话继续提问时自动创建可写会话，不暴露归档错误', async ({ page }) => {
  await openApp(page);
  await openWorkspace(page);
  await page.getByRole('button', { name: '＋ 新会话' }).click();
  await page.getByRole('button', { name: '归档' }).click();
  const composer = page.getByPlaceholder('历史会话仅供查看；发送会新建会话');
  await expect(composer).toBeEnabled();
  await composer.fill('我想年底去日本旅行，预算 ¥8,000');
  await page.getByRole('button', { name: '发送' }).click();
  await expect(page.getByText('确认目标草案')).toBeVisible();
  await expect(page.getByText('THREAD_ARCHIVED')).not.toBeVisible();
});

test('首页与空工作台使用同一透明 NOVA 标志', async ({ page }) => {
  await openApp(page);
  const homeMark = page.getByTestId('nova-mark');
  await expect(homeMark).toBeVisible();
  await expect(homeMark).toHaveAttribute('data-size', '32');
  await expect(homeMark).toHaveAttribute('data-transparent', 'true');

  await openWorkspace(page);
  const workspaceMark = page.getByTestId('nova-mark');
  await expect(workspaceMark).toBeVisible();
  await expect(workspaceMark).toHaveAttribute('data-size', '64');
  await expect(workspaceMark).toHaveAttribute('data-transparent', 'true');
});
