import { test, expect, type Page } from './fixtures';

async function openApp(page: Page) {
  await page.goto('/demo-control');
  await expect(page.getByRole('heading', { name: 'NOVA 财务助手', exact: true }).last()).toBeVisible();
  await page.request.post('/api/demo/load-japan');
  await page.request.post('/api/data-connections/connect',
    { data: { sources: ['bank', 'wechat_pay', 'alipay'] } });
  await page.reload();
  await expect(page.getByRole('heading', { name: '早上好，Alex' })).toBeVisible();
}

async function openWorkspace(page: Page) {
  await page.getByTitle('新建目标 / NOVA 智能对话').click();
  await expect(page.getByRole('heading', { name: 'NOVA 财务助手', exact: true }).last()).toBeVisible();
}

test('独立演示后台保留品牌欢迎页和空白目标工作台', async ({ page }) => {
  await page.goto('/demo-control');
  const welcome = page.getByTestId('nova-welcome');
  await expect(welcome).toBeVisible();
  await expect(welcome.getByText('不记账，也有数')).toBeVisible();
  await expect(welcome).toBeHidden();
  await expect(page.getByRole('heading', { name: 'NOVA 财务助手', exact: true }).last()).toBeVisible();
  await expect(page.getByText('你想完成什么财务目标？')).toBeVisible();
  await expect(page.getByText('日本旅行', { exact: true })).not.toBeVisible();
});

test('首次目标先提示连接模拟数据，连接后回到同一任务核算方案', async ({ page }) => {
  await page.goto('/demo-control');
  await expect(page.getByRole('heading', { name: 'NOVA 财务助手', exact: true }).last()).toBeVisible();
  await page.getByPlaceholder('描述目标、风险或授权范围…')
    .fill('我想年底去日本旅行，预算 ¥8,000，已存 0 元');
  await page.getByRole('button', { name: '发送' }).click();
  await expect(page.getByRole('heading', { name: '连接模拟数据后再核算' }).first()).toBeVisible();
  await expect(page.getByRole('button', { name: '选择此候选并核对确认' })).toHaveCount(0);
  await page.getByRole('button', { name: '选择模拟数据来源' }).first().click();
  await expect(page.getByRole('heading', { name: '连接模拟数据' })).toBeVisible();
  await page.getByRole('button', { name: '连接并开始智能守护' }).click();
  await expect(page.getByRole('heading', { name: 'NOVA 财务助手', exact: true }).last()).toBeVisible();
  await expect(page.getByRole('button', { name: '选择此候选并核对确认' }).first()).toBeVisible();
});

async function activateGoalFromWorkspace(page: Page) {
  await openWorkspace(page);
  const composer = page.getByPlaceholder('描述目标、风险或授权范围…');
  await composer.fill('我想在 12 月 15 日前存够 ¥8,000 去日本旅行，现在已经存了 ¥3,500，每月最多存 ¥1,500，¥20,000 应急金不能动。');
  await page.getByRole('button', { name: '发送' }).click();
  const choose = page.getByRole('button', { name: '选择此候选并核对确认' }).first();
  await expect(choose).toBeVisible();
  await choose.click();
  await page.getByRole('button', { name: '确认激活' }).first().click();
  await expect(page.getByText('自定义候选已激活', { exact: false }).first()).toBeVisible();
  const connected = await page.request.post('/api/data-connections/connect',
    { data: { sources: ['bank', 'wechat_pay', 'alipay'] } });
  expect(connected.ok()).toBeTruthy();
  await page.reload();
  await page.getByRole('button', { name: '1. 首页' }).click();
  await expect(page.getByRole('button', { name: '查看计划' })).toBeVisible();
}

test('对话故事一：自然语言生成目标卡，明确确认后激活并长期保留', async ({ page }) => {
  await openApp(page);
  await activateGoalFromWorkspace(page);
  await page.reload();
  await expect(page.getByRole('button', { name: '查看计划' })).toBeVisible();
  await openWorkspace(page);
  await page.getByRole('button', { name: /我想在 12 月 15 日前/ }).click();
  await expect(page.getByText(/正在核算不同月存节奏/).first()).toBeVisible();
});

test('对话故事二：显著支出自动创建未读风险会话', async ({ page }) => {
  await openApp(page);
  await activateGoalFromWorkspace(page);
  await page.getByTitle('查看模拟时间与自动同步').click();
  await page.getByRole('button', { name: /推进到 9月23日/ }).click();
  await expect(page.getByRole('heading', { name: 'NOVA 财务助手', exact: true }).last()).toBeVisible();
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

test('主动询问支出时展示只读对比，不新增模拟流水', async ({ page }) => {
  await openApp(page);
  await activateGoalFromWorkspace(page);
  await openWorkspace(page);
  const before = await page.request.get('/api/session');
  const twinVersionBefore = (await before.json()).twinVersion;
  await page.getByPlaceholder('描述目标、风险或授权范围…').fill('这笔¥900支出会影响目标吗？');
  await page.getByRole('button', { name: '发送' }).click();
  await expect(page.getByRole('heading', { name: '这笔支出对目标的影响' }).first()).toBeVisible();
  await expect(page.getByText(/支出前.*支出后/).first()).toBeVisible();
  await expect(page.getByText('查看计算依据').first()).toBeVisible();
  const after = await page.request.get('/api/session');
  expect((await after.json()).twinVersion).toBe(twinVersionBefore);
});

test('对话故事三：创建限定授权并运行受治理的外部 Agent 请求', async ({ page }) => {
  await openApp(page);
  await activateGoalFromWorkspace(page);
  await openWorkspace(page);
  const composer = page.getByPlaceholder('描述目标、风险或授权范围…');
  await composer.fill('允许旅行 Agent 在 ¥500 内订票');
  await page.getByRole('button', { name: '发送' }).click();
  await page.getByRole('button', { name: '确认创建授权' }).click();
  await page.getByLabel('全选').check();
  await page.getByRole('button', { name: '发起所选模拟请求' }).click();
  await expect(page.getByText(/已生成 4 个独立请求/).first()).toBeVisible();
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
  await expect(page.getByText('请确认已存金额').first()).toBeVisible();
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

test('目标画布由 NOVA 核算多个候选并逐项解释', async ({ page }) => {
  await openApp(page);
  await openWorkspace(page);
  await page.getByPlaceholder('描述目标、风险或授权范围…')
    .fill('我想年底去日本旅行，预算 ¥4,000，已存 0 元');
  await page.getByRole('button', { name: '发送' }).click();
  const card = page.locator('article').filter({ hasText: '已核验的参考方案' }).first();
  await expect(card).toBeVisible();
  await expect(card.getByRole('button', { name: '选择此候选并核对确认' })).toHaveCount(3);
  await card.getByText('看看计算依据').first().click();
  await expect(card.getByText(/首月可动用额度/).first()).toBeVisible();
  await expect(page.getByTestId('assumption-editor')).toHaveCount(0);
  await card.getByRole('button', { name: '选择此候选并核对确认' }).first().click();
  await expect(page.getByText('核对并激活候选方案').first()).toBeVisible();
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
  await expect(canvas.getByText('请确认已存金额')).toBeVisible();
});

test('只读调查在刷新后保留真实步骤，并适配工作台宽度', async ({ page }) => {
  await openApp(page);
  await openWorkspace(page);
  await page.getByPlaceholder('描述目标、风险或授权范围…')
    .fill('我想年底去日本旅行，预算 ¥8,000，已经存了 ¥0，每月最多存 ¥2,000');
  await page.getByRole('button', { name: '发送' }).click();
  await expect(page.getByText('规则试算已完成')).toBeVisible();
  await expect(page.getByText('已完成目标方案试算').first()).toBeVisible();
  await page.reload();
  await openWorkspace(page);
  await expect(page.getByText('规则试算已完成')).toBeVisible();
  await expect(page.getByText('已完成目标方案试算').first()).toBeVisible();
  const overflow = await page.evaluate(() => ({ amount: document.documentElement.scrollWidth - document.documentElement.clientWidth,
    elements: [...document.querySelectorAll('*')].filter(element => element.getBoundingClientRect().right > window.innerWidth + 1)
      .slice(0, 8).map(element => ({ tag: element.tagName, className: element.className, text: element.textContent?.slice(0, 35) })) }));
  expect(overflow.amount, JSON.stringify(overflow.elements)).toBeLessThanOrEqual(1);
});

test('未确认已存金额时先追问，补充后再开始只读调查', async ({ page }) => {
  await openApp(page);
  await openWorkspace(page);
  const composer = page.getByPlaceholder('描述目标、风险或授权范围…');
  await composer.fill('我想年底去日本旅行，预算 ¥8,000');
  await page.getByRole('button', { name: '发送' }).click();
  await expect(page.getByText('请确认已存金额')).toBeVisible();
  await expect(page.getByText('规则试算已完成')).not.toBeVisible();
  await composer.fill('已存 0 元');
  await page.getByRole('button', { name: '发送' }).click();
  await expect(page.getByText('规则试算已完成')).toBeVisible();
  await expect(page.getByText('已完成目标方案试算').first()).toBeVisible();
});

test('已验证候选单独确认后才能启用目标监测与奖金跟进', async ({ page }) => {
  await openApp(page);
  await openWorkspace(page);
  await page.getByPlaceholder('描述目标、风险或授权范围…')
    .fill('我想年底去日本旅行，预算 ¥8,000，已经存了 ¥0，每月最多存 ¥2,000');
  await page.getByRole('button', { name: '发送' }).click();
  const choose = page.getByRole('button', { name: '选择此候选并核对确认' }).first();
  await expect(choose).toBeVisible();
  await choose.click();
  await expect(page.getByText('核对并激活候选方案').first()).toBeVisible();
  const before = await page.evaluate(async () => (await (await fetch('/api/session')).json()).goal.status);
  expect(before).not.toBe('active');
  await page.getByRole('button', { name: '确认激活' }).first().click();
  await expect(page.getByText('自定义候选已激活', { exact: false }).first()).toBeVisible();
  const after = await page.evaluate(async () => (await (await fetch('/api/session')).json()).goal);
  expect(after.status).toBe('active');
  expect(after.selectedPlanId).toBe('custom');
  expect(after.targetCents).toBe(800000);
  expect(after.monthlyContributionCents).toBe(200000);
  await page.getByRole('button', { name: '启用目标监测' }).first().click();
  await expect(page.getByText('已启用应用内目标监测', { exact: false }).first()).toBeVisible();
  await page.getByRole('button', { name: '安排下个月跟进' }).first().click();
  await expect(page.getByText('已安排在模拟日期 2026-10-01 核对奖金', { exact: false }).first()).toBeVisible();
  await page.reload();
  await openWorkspace(page);
  await page.getByRole('button', { name: /我想年底去日本旅行，预算 ¥8,000，已经/ }).click();
  await expect(page.getByRole('button', { name: '暂停监测' }).first()).toBeVisible();
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
