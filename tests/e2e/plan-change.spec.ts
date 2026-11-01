import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

test('active plan opens a deeper revision page, supports cancellation and explicit delayed-date confirmation', async ({ page }, testInfo) => {
  await page.goto('/demo-control');
  await page.request.post('/api/demo/load-japan');
  await page.request.post('/api/goals/activate', { data: { planId: 'balanced' } });
  await page.reload();
  await page.getByRole('button', { name: /查看计划/ }).click();
  await expect(page.getByText('选择适合你的节奏', { exact: true })).toBeHidden();
  const stage = page.getByRole('button', { name: /阶段 04/ });
  expect((await stage.boundingBox())!.height).toBeGreaterThanOrEqual(44);
  await stage.focus();
  await stage.press('Enter');
  await expect(page.getByText('修改方案', { exact: true }).first()).toBeVisible();
  await expect(page.getByText('推演与推进阶段', { exact: true })).toBeHidden();
  await expect(page.getByRole('heading', { name: /第一步/ })).toBeFocused();
  await page.getByLabel('目标金额（元）', { exact: true }).fill('8000');
  await page.getByLabel('目标日期', { exact: true }).fill('2026-12-31');
  await page.getByLabel('已存金额（元）', { exact: true }).fill('0');
  await page.getByLabel('每月投入（元）', { exact: true }).fill('1800');
  await page.getByRole('button', { name: '重新计算', exact: true }).click();
  await page.getByRole('button', { name: /你的方案/ }).click();
  await expect(page.getByRole('button', { name: '确认修改方案' })).toBeDisabled();
  await page.getByRole('checkbox', { name: /同意将目标日期调整/ }).check();
  expect((await new AxeBuilder({ page }).include('#plan-change-panel').analyze()).violations).toEqual([]);
  await page.screenshot({ path: testInfo.outputPath('plan-change-confirmation.png') });
  await page.getByRole('button', { name: '确认修改方案' }).click();
  await expect(page.getByText('推演与推进阶段', { exact: true })).toBeVisible();
  await expect(stage).toBeVisible();
  const state = await (await page.request.get('/api/session')).json();
  expect(state.goal.monthlyContributionCents).toBe(180000);
  expect(state.goal.targetDate).toBe('2027-01-14');
  await stage.click();
  await page.getByLabel('每月投入（元）', { exact: true }).fill('1700');
  await page.getByRole('button', { name: '取消修改' }).click();
  await expect(page.getByText('推演与推进阶段', { exact: true })).toBeVisible();
  expect((await (await page.request.get('/api/session')).json()).goal.monthlyContributionCents).toBe(180000);
});

test('the top back button leaves the revision page without changing the active plan', async ({ page }) => {
  await page.goto('/demo-control');
  await page.request.post('/api/demo/load-japan');
  await page.request.post('/api/goals/activate', { data: { planId: 'balanced' } });
  await page.reload();
  await page.getByRole('button', { name: /查看计划/ }).click();
  const before = await (await page.request.get('/api/session')).json();
  await page.getByRole('button', { name: /阶段 04/ }).click();
  await page.getByLabel('每月投入（元）', { exact: true }).fill('1700');
  await page.getByRole('button', { name: /返回/ }).first().click();
  await expect(page.getByRole('button', { name: /阶段 04/ })).toBeVisible();
  const after = await (await page.request.get('/api/session')).json();
  expect(after.goal.monthlyContributionCents).toBe(before.goal.monthlyContributionCents);
});

test('a stale preview refreshes its version and preserves the draft for recomputation', async ({ page }) => {
  await page.goto('/demo-control');
  await page.request.post('/api/demo/load-japan');
  await page.request.post('/api/goals/activate', { data: { planId: 'balanced' } });
  await page.reload();
  await page.getByRole('button', { name: /查看计划/ }).click();
  await page.getByRole('button', { name: /阶段 04/ }).click();
  await page.getByLabel('每月投入（元）', { exact: true }).fill('1800');
  await page.request.post('/api/demo/clock', { data: { date: '2026-09-22' } });
  await page.getByRole('button', { name: '重新计算', exact: true }).click();
  await expect(page.getByRole('alert')).toHaveText('数据已更新，请重新计算');
  await expect(page.getByLabel('每月投入（元）', { exact: true })).toHaveValue('1800');
  await page.getByRole('button', { name: '重新计算', exact: true }).click();
  await expect(page.getByRole('heading', { name: /第二步/ })).toBeVisible();
});

test('the dated main prototype can activate its first plan and open Stage 04', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: /查看计划/ }).click();
  await page.getByRole('button', { name: /平衡方案/ }).click();
  await page.getByRole('button', { name: /确认以此节奏推进/ }).click();
  await page.getByRole('button', { name: /查看计划/ }).click();
  await expect(page.getByRole('button', { name: /阶段 04/ })).toBeVisible();
});

test('an activated plan highlights Stage 03 with the same completed color as Stage 02', async ({ page }) => {
  await page.goto('/demo-control');
  await page.request.post('/api/demo/load-japan');
  await page.request.post('/api/goals/activate', { data: { planId: 'balanced' } });
  await page.reload();
  await page.getByRole('button', { name: /查看计划/ }).click();

  const stage02 = page.getByText('阶段 02', { exact: true });
  const stage03 = page.getByText('阶段 03', { exact: true });
  await expect(stage02).toHaveCSS('color', 'rgb(39, 107, 78)');
  await expect(stage03).toHaveCSS('color', 'rgb(39, 107, 78)');
  await expect(page.getByText('event_available', { exact: true }).locator('..')).toHaveCSS('background-color', 'rgb(235, 247, 242)');
  await expect(page.getByText('checklist', { exact: true }).locator('..')).toHaveCSS('background-color', 'rgb(235, 247, 242)');
  await expect(page.getByText('checklist', { exact: true })).toHaveCSS('color', 'rgb(39, 107, 78)');
  await expect(page.getByText(/当前每月投入/).locator('span')).toHaveCSS('color', 'rgb(15, 107, 109)');
});
