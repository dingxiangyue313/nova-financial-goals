import { test, expect } from '@playwright/test';

for (let attempt = 1; attempt <= 5; attempt++) {
  test(`empty-history mission completes and reloads safely, run ${attempt}`, async ({ page }) => {
    test.setTimeout(60_000);
    await page.goto('/');
    await expect(page.getByRole('button', { name: '查看账单与消费' })).toBeVisible();
    expect((await page.request.post('/api/demo/reset')).ok()).toBeTruthy();
    const started = await page.request.post('/api/mission/start', { data: { includeHistory: false } });
    expect(started.ok()).toBeTruthy();
    await page.reload();
    await page.getByRole('button', { name: '查看账单与消费' }).click();
    await page.getByRole('button', { name: '数据', exact: true }).click();
    await page.getByRole('button', { name: '导入 NOVA 合成样例' }).click();
    await page.getByRole('button', { name: '提交并去重' }).click();
    await expect(page.getByText('合成账单已提交：重复记录已去重，余额保持不变。')).toBeVisible();
    await page.getByRole('button', { name: '账单', exact: true }).click();
    await page.getByRole('button', { name: '不再使用，准备取消' }).click();
    await page.getByRole('button', { name: '确认并执行模拟操作' }).click();
    await expect(page.getByText('已关闭自动续费：CloudBox Plus')).toBeVisible();
    await page.getByRole('button', { name: '为日本旅行安排储蓄 →' }).click();
    await page.getByRole('button', { name: '预览转账安排' }).click();
    await page.getByRole('button', { name: '确认并执行模拟操作' }).click();
    await expect(page.getByText('每期 ¥1,000 · 进行中')).toBeVisible();
    const before = await (await page.request.get('/api/session')).json();
    expect(before.goal.savedCents).toBe(200000);
    await page.reload();
    const first = await (await page.request.post('/api/mission/demo-event', { data: { kind: 'salary' } })).json();
    const replay = await (await page.request.post('/api/mission/demo-event', { data: { kind: 'salary' } })).json();
    expect(first.goal.savedCents).toBe(300000);
    expect(replay.goal.savedCents).toBe(300000);
    expect(replay.finance.emergencyCents).toBe(2000000);
    expect(replay.audit.at(-1).eventHash).toBeTruthy();
    expect(replay.auditChainValid).toBe(true);
  });
}
