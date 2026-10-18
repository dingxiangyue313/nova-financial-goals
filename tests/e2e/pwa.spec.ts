import { test, expect } from '@playwright/test';
import type { Page } from '@playwright/test';

async function hasSavedOfflineSnapshot(page: Page): Promise<boolean> {
  return page.evaluate(() => new Promise<boolean>(resolve => {
    const open = indexedDB.open('nova-offline-cache', 1);
    open.onerror = () => resolve(false);
    open.onsuccess = () => {
      const database = open.result;
      if (!database.objectStoreNames.contains('snapshots')) {
        database.close();
        resolve(false);
        return;
      }
      const request = database.transaction('snapshots', 'readonly').objectStore('snapshots').get('latest');
      request.onerror = () => { database.close(); resolve(false); };
      request.onsuccess = () => { database.close(); resolve(Boolean(request.result)); };
    };
  }));
}

test('manifest and install entry expose NOVA as a standalone app', async ({ page, request }) => {
  const manifest = await request.get('/manifest.webmanifest');
  expect(manifest.ok()).toBe(true);
  const body = await manifest.json();
  expect(body.name).toBe('NOVA 智能财务目标导航');
  expect(body.display).toBe('standalone');
  expect(body.icons).toEqual(expect.arrayContaining([expect.objectContaining({ sizes: '192x192' }), expect.objectContaining({ sizes: '512x512' })]));

  await page.goto('/');
  await page.getByTitle('个人设置').click();
  await expect(page.getByRole('heading', { name: '安装 NOVA' })).toBeVisible();
});

test('offline reload shows only the sanitized read-only summary', async ({ page, context }) => {
  await page.goto('/');
  await expect(page.getByRole('heading', { name: '早上好，Alex' })).toBeVisible();
  await expect.poll(() => hasSavedOfflineSnapshot(page)).toBe(true);
  await page.evaluate(async () => { await navigator.serviceWorker.ready; });
  await page.reload();
  await expect.poll(() => page.evaluate(() => Boolean(navigator.serviceWorker.controller))).toBe(true);

  await context.setOffline(true);
  await page.reload({ waitUntil: 'domcontentloaded' });
  await expect(page.getByRole('heading', { name: '离线查看' })).toBeVisible();
  await expect(page.getByText(/同步与操作已暂停/)).toBeVisible();
  await expect(page.getByRole('button', { name: /确认|执行|连接并开始/ })).toHaveCount(0);
  await context.setOffline(false);
});

test('going offline stops automatic sync while the read-only snapshot is visible', async ({ page, context }) => {
  await page.clock.install();
  await page.goto('/');
  await page.evaluate(async () => {
    await fetch('/api/data-connections/connect', { method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sources: ['bank', 'wechat_pay', 'alipay'] }) });
  });
  await page.reload();
  await expect(page.getByRole('heading', { name: '早上好，Alex' })).toBeVisible();
  await expect.poll(() => hasSavedOfflineSnapshot(page)).toBe(true);
  let syncRequests = 0;
  page.on('request', request => {
    if (request.method() === 'POST' && request.url().includes('/api/data-connections/sync/ensure')) syncRequests += 1;
  });

  await context.setOffline(true);
  await expect(page.getByRole('heading', { name: '离线查看' })).toBeVisible();
  await page.clock.fastForward(61_000);
  expect(syncRequests).toBe(0);
  await context.setOffline(false);
});

test('an unreachable API uses the cached read-only snapshot even when the browser reports online', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('heading', { name: '早上好，Alex' })).toBeVisible();
  await expect.poll(() => hasSavedOfflineSnapshot(page)).toBe(true);
  await page.route('**/api/session', route => route.abort('failed'));
  await page.reload({ waitUntil: 'domcontentloaded' });
  await expect(page.getByRole('heading', { name: '离线查看' })).toBeVisible();
  await expect(page.getByText(/同步与操作已暂停/)).toBeVisible();
});
