import { expect, test } from './fixtures';

test('case account applies a confirmed plan, persists it, and restores the original account', async ({ page }, testInfo) => {
  await page.goto('/');
  const before = await (await page.request.get('/api/session')).json();
  await page.getByRole('button', { name: '支出影响案例', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: '目标影响提醒' });
  await expect(dialog.getByRole('heading', { name: /日本旅行可能延期/ })).toBeVisible();
  await expect(dialog.getByRole('button', { name: /方案 A/ })).toBeEnabled();
  const caseBefore = await (await page.request.get('/api/session')).json();
  await dialog.getByRole('button', { name: /方案 A/ }).click();
  await expect(dialog.getByRole('button', { name: '确认调整计划' })).toBeEnabled();
  await page.screenshot({path: testInfo.outputPath('impact-case.png')});
  await dialog.getByRole('button', { name: '确认调整计划' }).click();
  await expect(dialog.getByRole('heading', { name: '计划已调整' })).toBeVisible();
  const applied = await (await page.request.get('/api/session')).json();
  expect(applied.goal.monthlyContributionCents).toBe(200000);
  expect(applied.goal.targetDate).toBe('2026-12-15');
  expect(applied.pendingImpact).toBeNull();
  expect(applied.finance).toEqual(caseBefore.finance);
  expect(applied.audit.some((item: {action: string}) => item.action === 'goal_plan_changed')).toBeTruthy();
  await dialog.getByRole('button', { name: '返回目标', exact: true }).click();
  await page.reload();
  const persisted = await (await page.request.get('/api/session')).json();
  expect(persisted.goal.monthlyContributionCents).toBe(200000);
  await page.getByRole('button', { name: '返回原账户', exact: true }).click();
  await expect(page.getByRole('button', { name: '返回原账户', exact: true })).toHaveCount(0);
  const after = await (await page.request.get('/api/session')).json();
  expect(after.goal).toEqual(before.goal);
  expect(after.finance).toEqual(before.finance);
  expect(after.pendingImpact).toEqual(before.pendingImpact);
});

test('expense popup uses recorded evidence and server plans without changing the goal before confirmation', async ({ page }, testInfo) => {
  await page.goto('/demo-control');
  expect((await page.request.post('/api/demo/load-japan')).ok()).toBeTruthy();
  expect((await page.request.post('/api/goals/activate', { data: { planId: 'balanced' } })).ok()).toBeTruthy();
  await page.reload();
  await page.getByRole('button', { name: '模拟数据', exact: true }).click();
  await page.getByRole('button', { name: /模拟一笔.*支出并查看提醒/ }).click();
  const impact = page.getByRole('dialog', { name: '目标影响提醒' });
  await expect(impact.getByRole('button', { name: /方案 B/ })).toBeVisible();
  const state = await (await page.request.get('/api/session')).json();
  expect(state.pendingImpact).not.toBeNull();
  expect(state.pendingImpact.title).toBe('汽车保养');
  expect(state.pendingImpact.expenseCents).toBe(90000);
  const preview = await (await page.request.post('/api/impact/plan-preview', { data: {
    impactId: state.pendingImpact.id, expectedTwinVersion: state.twinVersion,
    strategy: 'keep_monthly_contribution',
  } })).json();
  expect(preview.evidence.transactions.reduce((sum: number, item: {amountCents: number}) => sum + item.amountCents, 0)).toBe(90000);
  await expect(impact.getByRole('heading', { name: `${state.goal.title}可能延期 ${preview.candidate.delayDays} 天` })).toBeVisible();
  await expect(impact.getByRole('button', { name: /方案 B/ })).toContainText(preview.candidate.projectedDate);
  await expect(impact.getByRole('button', { name: '请选择一个方案' })).toBeDisabled();
  await expect(impact).toContainText('¥900');
  await page.screenshot({path: testInfo.outputPath('expense-dialog.png')});
  await page.keyboard.press('Escape');
  await expect(impact).not.toBeVisible();
  const after = await (await page.request.get('/api/session')).json();
  expect(after.goal).toEqual(state.goal);
  expect(after.finance).toEqual(state.finance);
});
