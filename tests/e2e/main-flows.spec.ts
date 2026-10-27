import { test, expect, type Page } from '@playwright/test';

async function openApp(page: Page) {
  await page.route('**/api/ui/cards', async route => {
    await new Promise(resolve => setTimeout(resolve, 150));
    await route.continue();
  });
  await page.goto('/demo-control');
  await expect(page.getByTestId('nova-welcome')).toBeHidden();
  await expect(page.getByRole('heading', { name: 'NOVA 目标工作台' })).toBeVisible();
  await page.request.post('/api/demo/load-japan');
  await page.reload();
  await expect(page.getByRole('heading', { name: '早上好，Alex' })).toBeVisible();
}

async function activateBalancedGoal(page: Page) {
  await page.getByRole('button', { name: '2. 创建目标' }).click();
  await page.getByRole('button', { name: '下一步：查看可行性' }).click();
  await expect(page.getByRole('heading', { name: '连接模拟数据' })).toBeVisible();
  await page.getByRole('button', { name: '连接并开始智能守护' }).click();
  await expect(page.getByText('选择适合你的节奏', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: '请选择一个方案' })).toBeDisabled();
  await page.getByRole('button', { name: /平衡方案/ }).click();
  await expect(page.getByText('智能守护设置')).toBeVisible();
  await expect(page.getByText('¥500 或目标剩余金额的 5%')).toBeVisible();
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
  await expect(page.getByRole('button', { name: '查看计划' })).toBeVisible();
});

test('创建目标后连接三类模拟数据，再进入可行性分析', async ({ page }) => {
  await openApp(page);
  await page.getByRole('button', { name: '2. 创建目标' }).click();
  await page.getByRole('button', { name: '下一步：查看可行性' }).click();
  await expect(page.getByRole('heading', { name: '连接模拟数据' })).toBeVisible();
  await expect(page.getByRole('checkbox', { name: /银行卡/ })).toBeChecked();
  await expect(page.getByRole('checkbox', { name: /微信支付/ })).toBeChecked();
  await expect(page.getByRole('checkbox', { name: /支付宝/ })).toBeChecked();
  await page.getByRole('button', { name: '连接并开始智能守护' }).click();
  await expect(page.getByText('选择适合你的节奏', { exact: true })).toBeVisible();
  await expect(page.getByText(/已读取近 90 天模拟流水/)).toBeVisible();
});

test('故事二扩展：累计小额流水形成趋势后才解释目标风险', async ({ page }) => {
  await openApp(page);
  await activateBalancedGoal(page);

  await page.getByTitle('查看模拟时间与自动同步').click();
  await page.getByRole('button', { name: /推进到 9月22日/ }).click();
  await expect(page.getByText('自动同步完成；本次变化保持安静')).toBeVisible();
  await expect(page.getByText('外卖与打车持续上升')).not.toBeVisible();

  await page.getByTitle('查看模拟时间与自动同步').click();
  await page.getByRole('button', { name: /推进到 9月23日/ }).click();
  await expect(page.getByText('外卖与打车持续上升').first()).toBeVisible();
  await expect(page.getByText(/¥1,300/).first()).toBeVisible();
  await expect(page.getByText(/延期 16 天/).first()).toBeVisible();
  await expect(page.getByText(/应急金未受影响/).first()).toBeVisible();
});

test('故事二：自动守护只在显著趋势影响目标后提供调整', async ({ page }) => {
  await openApp(page);
  await activateBalancedGoal(page);

  await page.getByTitle('查看模拟时间与自动同步').click();
  await page.getByRole('button', { name: /推进到 9月23日/ }).click();
  await expect(page.getByText(/外卖与打车支出趋势影响日本旅行/).first()).toBeVisible();
  await expect(page.getByText(/应急金/).first()).toBeVisible();
});

test('个人设置可以撤销单个来源并保留历史覆盖信息', async ({ page }) => {
  await openApp(page);
  await activateBalancedGoal(page);

  await page.getByTitle('个人设置').click();
  await page.getByRole('button', { name: /数据连接与自动守护/ }).click();
  await expect(page.getByRole('heading', { name: '连接模拟数据' })).toBeVisible();
  const wechat = page.getByRole('region', { name: '微信支付数据来源' });
  await wechat.getByRole('button', { name: '停止后续同步' }).click();
  await expect(wechat.getByText('已停止', { exact: true })).toBeVisible();
  await expect(wechat.getByText(/覆盖/)).toBeVisible();
});

test('微信模拟连接失败时安静提示，恢复后只补齐一次目标风险', async ({ page }) => {
  await openApp(page);
  await activateBalancedGoal(page);
  await page.getByTitle('查看模拟时间与自动同步').click();
  await page.getByRole('button', { name: /模拟微信支付连接失败/ }).click();
  await expect(page.getByText('部分数据待更新')).toBeVisible();

  await page.getByTitle('个人设置').click();
  await page.getByRole('button', { name: /数据连接与自动守护/ }).click();
  const wechat = page.getByRole('region', { name: '微信支付数据来源' });
  await expect(wechat.getByText('连接异常', { exact: true })).toBeVisible();
  await expect(wechat.getByText(/暂时无法连接/)).toBeVisible();

  await page.getByRole('button', { name: '返回' }).click();
  await page.getByRole('button', { name: '首页', exact: true }).click();
  await page.getByTitle('查看模拟时间与自动同步').click();
  await page.getByRole('button', { name: /推进到 9月23日/ }).click();
  await expect(page.getByText('部分数据待更新')).toBeVisible();
  await expect(page.getByText(/外卖与打车支出趋势影响日本旅行/)).not.toBeVisible();

  await page.getByTitle('个人设置').click();
  await page.getByRole('button', { name: /数据连接与自动守护/ }).click();
  await wechat.getByRole('button', { name: '重新连接' }).click();
  await expect(wechat.getByText('已连接', { exact: true })).toBeVisible();
});

test('故事三：限定授权分别产生 Execute、Ask、Manual Review 和 Block', async ({ page }) => {
  await openApp(page);
  await activateBalancedGoal(page);
  await page.getByTitle('个人设置').click();
  await page.getByRole('button', { name: /授权、外部 Agent 与执行记录/ }).click();
  await page.getByRole('button', { name: '确认创建交通类模拟授权' }).click();

  await page.getByRole('button', { name: '交通 Execute' }).click();
  await page.getByRole('button', { name: '购物 Ask' }).click();
  await page.getByRole('button', { name: '高额 Manual Review' }).click();
  await page.getByRole('button', { name: '超限 Block' }).click();
  await page.getByRole('button', { name: '前往动态页查看完整链路' }).click();
  await expect(page.getByText('已执行').first()).toBeVisible();
  await expect(page.getByText('待确认').first()).toBeVisible();
  await expect(page.getByText('待设备验证').first()).toBeVisible();
  await expect(page.getByText('已拦截').first()).toBeVisible();
  expect(await page.locator('article').first().evaluate(element => element.getBoundingClientRect().height)).toBeGreaterThan(80);
  await page.locator('article').first().locator(':scope > button').evaluate((element: HTMLButtonElement) => element.click());
  await expect(page.getByRole('list', { name: '请求执行链路' }).first()).toBeVisible();
});

test('人工复核：平台 Passkey 验证成功后才执行', async ({ page, context }) => {
  const cdp = await context.newCDPSession(page);
  await cdp.send('WebAuthn.enable');
  const { authenticatorId } = await cdp.send('WebAuthn.addVirtualAuthenticator', { options: {
    protocol: 'ctap2', transport: 'internal', hasResidentKey: true, hasUserVerification: true,
    isUserVerified: true, automaticPresenceSimulation: true,
  } });
  try {
    await openApp(page);
    await activateBalancedGoal(page);
    await page.getByTitle('个人设置').click();
    await page.getByRole('button', { name: /授权、外部 Agent 与执行记录/ }).click();
    await page.getByRole('button', { name: '确认创建交通类模拟授权' }).click();
    await page.getByRole('button', { name: '高额 Manual Review' }).click();
    await page.getByRole('button', { name: '前往动态页查看完整链路' }).click();
    const card = page.locator('article').filter({ hasText: '旅行助手请求支付交通费 ¥400' });
    const disclosure = card.locator(':scope > button').first();
    await disclosure.evaluate((element: HTMLButtonElement) => element.click());
    await expect(disclosure).toHaveAttribute('aria-expanded', 'true');
    await card.getByRole('button', { name: '启用设备验证并继续' })
      .evaluate((element: HTMLButtonElement) => element.click());
    await expect(card.getByText('已执行', { exact: true })).toBeVisible();
    await card.locator(':scope > button').first().evaluate((element: HTMLButtonElement) => element.click());
    await expect(card.getByText(/校验有效/)).toBeVisible();
  } finally {
    if (!page.isClosed()) await cdp.send('WebAuthn.removeVirtualAuthenticator', { authenticatorId });
  }
});
