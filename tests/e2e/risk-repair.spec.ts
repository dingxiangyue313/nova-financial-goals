import { expect, test } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

async function loadActiveRisk(page: import('@playwright/test').Page) {
  await page.goto('/demo-control');
  await page.request.post('/api/demo/load-japan');
  await page.request.post('/api/goals/activate', { data: { planId: 'balanced' } });
  await page.request.post('/api/demo/spending-trend', { data: { idempotencyKey: 'e2e-risk-repair' } });
  await page.reload();
  await page.getByRole('button', { name: '3. 目标影响' }).click();
}

test('GoalGuard compares server previews, confirms once, and resolves the risk', async ({ page }, testInfo) => {
  await loadActiveRisk(page);
  await expect(page.getByRole('heading', { name: /可能延期/ })).toBeVisible();
  const optionA = page.getByRole('button', { name: /方案 A · 保持目标日期/ });
  const optionB = page.getByRole('button', { name: /方案 B · 保持每月投入/ });
  await expect(optionA).toBeVisible();
  await expect(optionB).toBeVisible();
  await expect(page.getByRole('button', { name: '确认调整计划' })).toBeDisabled();
  await optionA.click();
  await expect(page.getByRole('table', { name: '计划调整前后对比' })).toBeVisible();
  await expect(page.getByText('仅模拟数据，不会自动扣款')).toBeVisible();
  const violations = (await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']).analyze())
    .violations.filter(item => item.impact === 'serious' || item.impact === 'critical');
  expect(violations).toEqual([]);
  await page.screenshot({ path: testInfo.outputPath('risk-repair-confirmation.png') });
  await page.getByRole('button', { name: '确认调整计划' }).click();
  await expect(page.getByRole('heading', { name: '计划已调整' })).toBeVisible();
  const state = await (await page.request.get('/api/session')).json();
  expect(state.pendingImpact).toBeNull();
  expect(state.riskSignals[0].status).toBe('resolved');
});

test('later makes the homepage quiet while the NOVA risk evidence remains retrievable', async ({ page }) => {
  await loadActiveRisk(page);
  await page.getByRole('button', { name: '稍后处理' }).click();
  await expect(page.getByRole('heading', { name: '早上好，Alex' })).toBeVisible();
  await expect(page.getByText(/目标可能延期/)).toBeHidden();
  const state = await (await page.request.get('/api/session')).json();
  expect(state.pendingImpact).not.toBeNull();
  expect(state.riskSignals[0].status).toBe('later');
});
