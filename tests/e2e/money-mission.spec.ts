import { test, expect, type Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

// Request routing must reach the page instead of the production service worker.
test.use({ serviceWorkers: 'block' });

async function home(page: Page) {
  await page.request.get('/api/session');
  await page.request.post('/api/demo/load-japan');
  await page.goto('/demo-control', { waitUntil: 'domcontentloaded' });
  await expect(page.getByTestId('nova-welcome')).toBeHidden();
  await expect(page.getByRole('heading', { name: '早上好，Alex' })).toBeVisible();
}

test('home opens a continuous Money Mission without replacing NOVA navigation', async ({ page }) => {
  await home(page);
  await page.getByRole('button', { name: '继续日本旅行 Money Mission' }).click();
  await expect(page.getByRole('heading', { name: '日本旅行 Money Mission', exact: true })).toBeVisible();
  const progress = page.getByRole('navigation', { name: 'Money Mission 进度' });
  await expect(progress).toBeVisible();
  await expect(progress.getByRole('button')).toHaveCount(7);
  await expect(progress.getByRole('button', { name: /数据.*当前/ })).toHaveAttribute('aria-current', 'step');
  await progress.getByRole('button', { name: /目标.*已完成/ }).click();
  await expect(page.getByRole('status').filter({ hasText: '此阶段已完成，可随时回看。' })).toBeVisible();
  await page.getByRole('button', { name: '返回当前阶段' }).click();
  await expect(page.getByRole('heading', { name: '连接或导入数据', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: '首页', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: '目标', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: '返回', exact: true })).toBeVisible();
  await page.getByTitle('切换为自适应全屏').click();
  await expect(page.getByTitle('切换为手机尺寸 390x844')).toBeVisible();
  await page.addStyleTag({content:'*,*::before,*::after{transition:none!important;animation:none!important}'});
  const layout = page.getByTestId('money-mission-layout');
  const stage = page.getByRole('region', { name: '当前任务' });
  const layoutBox = await layout.boundingBox(); const stageBox = await stage.boundingBox();
  expect(layoutBox).not.toBeNull(); expect(stageBox).not.toBeNull();
  if (page.viewportSize()!.width >= 1024) {
    expect(stageBox!.x).toBeGreaterThan(layoutBox!.x + layoutBox!.width * 0.25);
    expect(stageBox!.width / layoutBox!.width).toBeGreaterThan(0.6);
  } else {
    expect(Math.abs(stageBox!.x - layoutBox!.x)).toBeLessThan(2);
    expect(stageBox!.y).toBeGreaterThan((await progress.boundingBox())!.y);
  }
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  const accessibility = await new AxeBuilder({ page }).include('[aria-labelledby="money-mission-title"]')
    .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']).analyze();
  expect(accessibility.violations.filter(item => item.impact === 'serious' || item.impact === 'critical')).toEqual([]);
  const screenshot = test.info().outputPath('money-mission-responsive-shell.png');
  await page.screenshot({ path: screenshot });
  await test.info().attach('money-mission-responsive-shell', { path: screenshot, contentType: 'image/png' });
  await page.getByRole('button', { name: '首页', exact: true }).click();
  await expect(page.getByRole('heading', { name: '早上好，Alex' })).toBeVisible();
});

test('mission read API is private to its session and never cached', async ({ page, browser }) => {
  await home(page);
  const response = await page.request.get('/api/money-mission');
  expect(response.status()).toBe(200);
  expect(response.headers()['cache-control']).toContain('no-store');
  expect((await response.json()).currentStage).toBe('data');
  const other = await browser.newContext();
  try {
    const empty = await other.request.get('http://localhost:3177/api/money-mission');
    expect((await empty.json()).currentStage).toBe('goal');
  } finally { await other.close(); }
});

test('navigation stays clickable when the icon font falls back to text', async ({ page }) => {
  await home(page);
  await page.addStyleTag({ content: '.material-symbols-outlined { font-family: sans-serif !important; }' });
  await page.getByTitle('个人设置').click();
  await page.getByRole('button', { name: '首页', exact: true }).click({ timeout: 3000 });
  await expect(page.getByRole('heading', { name: '早上好，Alex' })).toBeVisible();
});

test('shell exposes loading, recoverable failure and empty states', async ({ page }) => {
  await home(page);
  let release!: () => void;
  const wait = new Promise<void>(resolve => { release = resolve; });
  await page.route('**/api/money-mission', async route => {
    await wait;
    await route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ error: '暂时无法读取任务' }) });
  });
  await page.getByRole('button', { name: '继续日本旅行 Money Mission' }).click();
  await expect(page.getByRole('status').filter({ hasText: '正在读取 Money Mission' })).toBeVisible();
  release();
  await expect(page.getByRole('alert')).toContainText('暂时无法读取任务');
  await page.unroute('**/api/money-mission');
  await page.getByRole('button', { name: '重新读取任务' }).click();
  await expect(page.getByRole('navigation', { name: 'Money Mission 进度' })).toBeVisible();
  await page.request.post('/api/demo/reset');
  await page.getByRole('button', { name: '刷新任务进度' }).click();
  await expect(page.getByText('还没有任务数据，先描述你的旅行目标。')).toBeVisible();
});
