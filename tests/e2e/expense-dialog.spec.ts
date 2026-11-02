import { expect, test } from './fixtures';

test('expense popup uses recorded evidence and server plans without changing the goal before confirmation', async ({ page }, testInfo) => {
  await page.goto('/demo-control');
  expect((await page.request.post('/api/demo/load-japan')).ok()).toBeTruthy();
  expect((await page.request.post('/api/goals/activate', { data: { planId: 'balanced' } })).ok()).toBeTruthy();
  await page.reload();
  await page.getByRole('button', { name: '模拟数据', exact: true }).click();
  await page.getByRole('button', { name: /模拟一笔.*支出并查看提醒/ }).click();
  const dialog = page.getByRole('dialog', { name: '模拟一笔大额支出' });
  await expect(dialog).toBeVisible();
  await dialog.getByLabel('支出金额（元）').fill('900');
  await dialog.getByRole('button', { name: '确认记录模拟支出并核算' }).click();
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
  await expect(impact.getByRole('button', { name: '确认调整计划' })).toBeDisabled();
  await expect(impact).toContainText('¥900');
  await page.screenshot({path: testInfo.outputPath('expense-dialog.png')});
  await page.keyboard.press('Escape');
  await expect(impact).not.toBeVisible();
  const after = await (await page.request.get('/api/session')).json();
  expect(after.goal).toEqual(state.goal);
  expect(after.finance).toEqual(state.finance);
});
