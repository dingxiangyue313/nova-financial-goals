type Result = { id: string; impact?: string | null; nodes: unknown[] };
import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

test.beforeEach(({ page }) => { page.on('pageerror', error => { throw error; }); });

test('travel mission: evidence, verified cancellation, forecast and salary-triggered savings', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('button', { name: '查看账单与消费' })).toBeVisible();
  await expect(page.getByText('10月花了 ¥4,778')).toBeVisible();
  await expect(page.getByText('快速直达:')).toHaveCount(0);
  await page.screenshot({ path: `artifacts/mission-home-${test.info().project.name}.png`, fullPage: true });
  await page.getByRole('button', { name: '查看账单与消费' }).click();
  await expect(page.getByRole('heading', { name: '账单与消费' })).toBeVisible();
  await page.screenshot({ path: `artifacts/mission-bills-${test.info().project.name}.png`, fullPage: true });
  await page.getByRole('button', { name: '不再使用，准备取消' }).click();
  await expect(page.getByRole('dialog')).toContainText('不退还已支付费用');
  await page.getByRole('button', { name: '确认并执行模拟操作' }).click();
  await expect(page.getByText('已关闭自动续费：CloudBox Plus')).toBeVisible();
  await expect(page.getByText('¥3,240', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: '查看逐笔证据与排除项' }).click();
  await expect(page.getByText('邮筒美团 · 原路退款', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: '为日本旅行安排储蓄 →' }).click();
  await page.getByRole('button', { name: '预览转账安排' }).click();
  await expect(page.getByRole('dialog')).toContainText('工资实际到账后次日09:00');
  await page.getByRole('button', { name: '确认并执行模拟操作' }).click();
  await expect(page.getByText('每期 ¥1,000 · 进行中')).toBeVisible();
  const before = await (await page.request.get('/api/session')).json();
  expect(before.goal.savedCents).toBe(200000);
  await page.reload();
  const event = await page.request.post('/api/mission/demo-event', { data: { kind: 'salary' } });
  expect(event.ok()).toBeTruthy();
  const after = await event.json();
  expect(after.goal.savedCents).toBe(300000);
  expect(after.mission.receipts.at(-1).status).toBe('succeeded');
  const repeat = await (await page.request.post('/api/mission/demo-event', { data: { kind: 'salary' } })).json();
  expect(repeat.goal.savedCents).toBe(300000);
});

test('merchant timeout can be reconciled without counting unverified savings', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('button', { name: '查看账单与消费' })).toBeVisible();
  await page.request.post('/api/mission/demo-event', { data: { kind: 'cancel_timeout' } });
  await page.reload();
  await page.getByRole('button', { name: '查看账单与消费' }).click();
  await page.getByRole('button', { name: '不再使用，准备取消' }).click();
  await page.getByRole('button', { name: '确认并执行模拟操作' }).click();
  await page.getByRole('button', { name: '查询商户结果' }).click();
  await expect(page.getByRole('button', { name: '不再使用，准备取消' })).toBeVisible();
  const state = await (await page.request.get('/api/session')).json();
  expect(state.mission.subscription.nextChargeSuppressed).toBe(false);
});

test('home opens a continuous Money Mission without replacing NOVA navigation', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: '查看账单与消费' }).click();
  await expect(page.getByRole('heading', { name: '日本旅行 Money Mission' })).toBeVisible();
  await expect(page.getByRole('navigation', { name: 'Money Mission 进度' })).toBeVisible();
  await expect(page.getByRole('heading', { name: '账单与消费' })).toBeVisible();
});

test('data stage imports sample without a file picker and keeps bill evidence', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: '查看账单与消费' }).click();
  await page.getByRole('button', { name: '导入合成样例账单' }).click();
  await expect(page.getByRole('button', { name: '导入 NOVA 合成样例' })).toBeVisible();
  await expect(page.locator('input[type="file"]')).toHaveCount(0);
  await expect(page.getByText('当前不接受个人 CSV / XLSX / PDF / 图片上传')).toBeVisible();
  await page.getByRole('button', { name: '数据', exact: true }).click();
  await page.getByRole('button', { name: '账单', exact: true }).click();
  await page.getByRole('button', { name: '查看逐笔证据与排除项' }).click();
  await expect(page.getByText('邮筒美团 · 原路退款', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: '收起流水' }).click();
  await expect(page.getByRole('dialog', { name: '逐笔交易证据' })).toHaveCount(0);
});

test('mission screens support reduced motion, contrast and keyboard confirmation', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('/');
  await expect(page.getByRole('button', { name: '查看账单与消费' })).toBeVisible();
  for (const screen of ['home', 'bills', 'approval']) {
    const report = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa']).analyze();
    expect(report.violations.filter((v: Result) => v.impact === 'serious' || v.impact === 'critical'), screen).toEqual([]);
    if (screen === 'home') await page.getByRole('button', { name: '查看账单与消费' }).click();
    if (screen === 'bills') await page.getByRole('button', { name: '不再使用，准备取消' }).click();
  }
  await expect(page.getByRole('button', { name: '确认并执行模拟操作' })).toBeFocused();
  await page.keyboard.press('Shift+Tab');
  await expect(page.getByRole('button', { name: '暂不操作' })).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(page.getByRole('dialog')).toHaveCount(0);
});
