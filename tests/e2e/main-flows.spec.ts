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
  await expect(page.getByText('已选择并启用计划')).toBeVisible();
});

test('故事二扩展：累计小额流水形成趋势后才解释目标风险', async ({ page }) => {
  await openApp(page);
  await activateBalancedGoal(page);

  await page.getByTitle('点击切换模拟数据或事件').click();
  await page.getByRole('button', { name: /模拟外卖与打车趋势/ }).click();
  await expect(page.getByText('外卖与打车持续上升').first()).toBeVisible();
  await expect(page.getByText(/¥1,300/).first()).toBeVisible();
  await expect(page.getByText(/延期 16 天/).first()).toBeVisible();
  await expect(page.getByText(/应急金未受影响/)).toBeVisible();
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

test('个人设置的突发支出按钮使用默认 ¥900 金额', async ({ page }) => {
  await openApp(page);
  await activateBalancedGoal(page);

  await page.getByTitle('个人设置').click();
  await page.getByRole('button', { name: '模拟突发支出 ¥900' }).click();

  await expect(page.getByText(/两个不动应急金的办法/)).toBeVisible();
  await expect(page.getByText(/amountCents/)).not.toBeVisible();
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
    await page.getByRole('button', { name: '启用此设备验证' }).click();
    await expect(page.getByText('已启用', { exact: true })).toBeVisible();
    const card = page.locator('article').filter({ has: page.getByRole('heading', { name: 'transport · ¥400' }) });
    const disclosure = card.locator(':scope > button').first();
    await disclosure.evaluate((element: HTMLButtonElement) => element.click());
    await expect(disclosure).toHaveAttribute('aria-expanded', 'true');
    await card.getByRole('button', { name: '使用设备验证并执行' })
      .evaluate((element: HTMLButtonElement) => element.click());
    await expect(card.getByText('已执行', { exact: true })).toBeVisible();
    await expect(card.getByText(/校验有效/)).toBeVisible();
  } finally {
    if (!page.isClosed()) await cdp.send('WebAuthn.removeVirtualAuthenticator', { authenticatorId });
  }
});
