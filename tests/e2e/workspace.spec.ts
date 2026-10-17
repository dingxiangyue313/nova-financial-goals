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
  await expect(page.getByRole('heading', { name: '连接模拟数据' })).toBeVisible();
  await page.getByRole('button', { name: '连接并开始智能守护' }).click();
  await expect(page.getByText('选择适合你的节奏', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: /平衡方案/ }).click();
  await page.getByRole('button', { name: /确认以此节奏推进/ }).click();
  await expect(page.getByText('进度正常')).toBeVisible();
}

test('对话故事一：自然语言生成目标卡，明确确认后激活并长期保留', async ({ page }) => {
  await openApp(page);
  await activateGoalFromWorkspace(page);
  await page.reload();
  await expect(page.getByText('已选择并启用计划')).toBeVisible();
  await openWorkspace(page);
  const savedThread = page.getByRole('button', { name: /我想年底去日本旅行/ }).last();
  await expect(savedThread).toBeVisible();
  await savedThread.click();
  await expect(page.getByText(/目标草案已保存/).first()).toBeVisible();
});

test('对话故事二：显著支出自动创建未读风险会话', async ({ page }) => {
  await openApp(page);
  await activateGoalFromWorkspace(page);
  await page.getByTitle('查看模拟时间与自动同步').click();
  await page.getByRole('button', { name: /推进到 9月23日/ }).click();
  await expect(page.getByRole('heading', { name: 'NOVA 目标工作台' })).toBeVisible();
  const risk = page.getByRole('button', { name: /外卖与打车持续上升影响目标/ });
  // The demo transition opens the newly-created risk conversation, so viewing it clears the unread marker.
  await expect(risk).toHaveAttribute('data-unread', 'false');
  await expect(page.getByText(/应急金/).first()).toBeVisible();
  await expect(page.getByText('哪些流水形成趋势')).toBeVisible();
  await expect(page.getByText('降低未来可选支出')).toBeVisible();
  await expect(page.getByText('增加目标投入')).toBeVisible();
  await expect(page.getByText('3. 调整目标日期', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: '确认方案 B' })).toBeVisible();
});

test('对话故事三：创建限定授权并运行受治理的外部 Agent 请求', async ({ page }) => {
  await openApp(page);
  await activateGoalFromWorkspace(page);
  await openWorkspace(page);
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

test('目标画布支持修改假设、只读试算和确认应用', async ({ page }) => {
  await openApp(page);
  await openWorkspace(page);
  await page.getByRole('button', { name: '我想年底去日本旅行，预算 ¥8,000' }).click();
  const editor = page.getByTestId('assumption-editor').first();
  await editor.getByLabel('目标金额').fill('9000');
  await editor.getByLabel('每月投入').fill('1600');
  await editor.getByLabel('目标日期').fill('2027-01-15');
  await editor.getByRole('button', { name: 'What-if 实时试算' }).click();
  await expect(page.getByText('What-if 可行性').first()).toBeVisible();
  await expect(page.getByText('计划步骤').first()).toBeVisible();
  await page.getByRole('button', { name: '确认应用' }).click();
  await expect(page.getByRole('heading', { name: '连接模拟数据' })).toBeVisible();
  await page.getByRole('button', { name: '连接并开始智能守护' }).click();
  await expect(page.getByText('选择适合你的节奏', { exact: true })).toBeVisible();
  await expect(page.getByText(/完成 38\.9%/).first()).toBeVisible();
});

test('自适应桌面工作台使用 32/68 Governed Canvas', async ({ page }, testInfo) => {
  await openApp(page);
  await page.getByTitle('切换为自适应全屏').click();
  await openWorkspace(page);
  const canvas = page.getByTestId('governed-canvas');
  if (testInfo.project.name !== 'desktop-1440') {
    await expect(canvas).toBeHidden();
    return;
  }
  await expect(canvas).toBeVisible();
  await expect(canvas.getByRole('heading', { name: '当前任务画布' })).toBeVisible();
  await page.getByPlaceholder('描述目标、风险或授权范围…').fill('我想年底去日本旅行，预算 ¥8,000');
  await page.getByRole('button', { name: '发送' }).click();
  await expect(canvas.getByText('核对并试算目标假设')).toBeVisible();
});

test('每周摘要安静呈现并可配置完整通知偏好', async ({ page }) => {
  await openApp(page);
  await activateGoalFromWorkspace(page);
  await openWorkspace(page);
  const summary = page.getByRole('button', { name: /摘要 · 每周摘要/ });
  await expect(summary).toHaveAttribute('data-unread', 'false');
  await summary.click();
  await expect(page.getByText('每周安静摘要').first()).toBeVisible();
  await page.getByRole('button', { name: '展开高级设置' }).click();
  await page.getByLabel('金额阈值').fill('650');
  await page.getByLabel('目标占比阈值').fill('6');
  await page.getByLabel('暂停守护至').fill('2026-09-22');
  await page.getByLabel('当前目标单独覆盖').check();
  await page.getByRole('button', { name: '保存守护设置' }).click();
  await expect(page.getByLabel('每周安静摘要')).toBeEnabled();
  await page.getByLabel('每周安静摘要').click();
  await expect(page.getByLabel('每周安静摘要')).not.toBeChecked();
  await expect(page.getByText('设置保存失败')).not.toBeVisible();

  await page.reload();
  await openWorkspace(page);
  await page.getByRole('button', { name: /摘要 · 每周摘要/ }).click();
  await expect(page.getByLabel('每周安静摘要')).not.toBeChecked();
  await page.getByRole('button', { name: '展开高级设置' }).click();
  await expect(page.getByLabel('金额阈值')).toHaveValue('650');
  await expect(page.getByLabel('目标占比阈值')).toHaveValue('6');
  await expect(page.getByLabel('暂停守护至')).toHaveValue('2026-09-22');
  await expect(page.getByLabel('当前目标单独覆盖')).toBeChecked();
});
