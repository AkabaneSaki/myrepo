import { expect, test } from '@playwright/test';

function watchRuntimeHealth(page, baseURL) {
  const pageErrors = [];
  const serverErrors = [];
  const origin = new URL(baseURL).origin;

  page.on('pageerror', error => {
    pageErrors.push(error.message);
  });

  page.on('response', response => {
    if (response.status() < 500) return;
    try {
      const url = new URL(response.url());
      if (url.origin === origin) {
        serverErrors.push(`${response.status()} ${url.pathname}`);
      }
    } catch {
      // Ignore malformed third-party URLs reported by the browser.
    }
  });

  return {
    assertHealthy() {
      expect(pageErrors, '页面出现未捕获的 JavaScript 错误').toEqual([]);
      expect(serverErrors, 'Workshop 自己的请求出现 5xx').toEqual([]);
    },
  };
}

async function expectNoPageWideHorizontalOverflow(page) {
  const overflow = await page.evaluate(() => ({
    viewport: document.documentElement.clientWidth,
    content: document.documentElement.scrollWidth,
  }));

  expect(
    overflow.content - overflow.viewport,
    `页面横向溢出：content=${overflow.content}, viewport=${overflow.viewport}`,
  ).toBeLessThanOrEqual(1);
}

test('@quick guest can browse Discover and open a project detail', async ({ page }, testInfo) => {
  const baseURL = testInfo.project.use.baseURL;
  const runtime = watchRuntimeHealth(page, baseURL);

  await page.goto('/', { waitUntil: 'domcontentloaded' });

  await expect(page.locator('.discover-home')).toBeVisible();
  await expect(page.locator('.discover-card, .project-card').first()).toBeVisible({
    timeout: 15_000,
  });
  await expectNoPageWideHorizontalOverflow(page);

  const firstProject = page.locator('.discover-card, .project-card').first();
  await firstProject.click();

  const detail = page.locator('.modal-overlay .detail-panel');
  await expect(detail).toBeVisible();
  await expect(detail.locator('.detail-project-name')).not.toHaveText('');
  await expectNoPageWideHorizontalOverflow(page);

  const mobileBack = page.locator('.modal-overlay [data-mobile-detail-back]');
  if (await mobileBack.isVisible().catch(() => false)) {
    await mobileBack.click();
  } else {
    await page.locator('.modal-overlay .close-btn').click();
  }
  await expect(page.locator('.modal-overlay')).toHaveCount(0);
  await expect(page.locator('.discover-home')).toBeVisible();

  runtime.assertHealthy();
});

test('@quick guest session exposes Discord login without pretending to be signed in', async ({ page }, testInfo) => {
  const baseURL = testInfo.project.use.baseURL;
  const runtime = watchRuntimeHealth(page, baseURL);

  await page.goto('/', { waitUntil: 'domcontentloaded' });
  await expect(page.locator('.discover-home')).toBeVisible();

  const desktopLogin = page.locator('#loginBtn');
  const mobileLogin = page.locator('#mobileLoginBtn');

  if (await desktopLogin.isVisible().catch(() => false)) {
    await expect(desktopLogin).toContainText('Discord 登录');
  } else {
    const accountTool = page.locator('[data-mobile-tool="account"]');
    await expect(accountTool).toBeVisible();
    await accountTool.click();
    await expect(mobileLogin).toBeVisible();
    await expect(mobileLogin).toContainText('Discord 登录');
  }
  await expectNoPageWideHorizontalOverflow(page);

  runtime.assertHealthy();
});
