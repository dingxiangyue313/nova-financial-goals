import { test, expect } from '@playwright/test';

test('NOVA preserves Chinese composition and sends only the committed text', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('heading', { name: '连接模拟数据', exact: true }).waitFor();
  await page.getByRole('button', { name: '返回', exact: true }).click();
  await page.getByRole('button', { name: 'NOVA', exact: true }).click();
  const input = page.getByRole('textbox', { name: '告诉 NOVA 你的需求' });
  const sent: string[] = [];
  await page.route('**/api/agent/chat', async route => {
    sent.push(route.request().postDataJSON().message);
    await route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ error: '测试请求未发送' }) });
  });
  await input.focus();
  await input.dispatchEvent('compositionstart', { data: '' });
  await input.fill('wo xiang');
  await input.press('Enter');
  await input.evaluate(node => node.closest('form')!.requestSubmit());
  expect(sent).toEqual([]);
  await expect(input).toHaveValue('wo xiang\n');
  await input.fill('我想明年六月底去日本旅行');
  await input.dispatchEvent('compositionend', { data: '我想明年六月底去日本旅行' });
  // Distinct user action after the IME confirmation event.
  await expect(page.getByRole('button', { name: '发送', exact: true })).toBeEnabled();
  await page.waitForTimeout(150);
  await expect(input).toHaveValue('我想明年六月底去日本旅行');
  await page.getByRole('button', { name: '发送', exact: true }).click();
  await expect.poll(() => sent).toEqual(['我想明年六月底去日本旅行']);
  await expect(input).toHaveValue('我想明年六月底去日本旅行');
});
