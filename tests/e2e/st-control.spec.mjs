import { expect, test } from './fixtures/workshop.mjs';

test.use({ profileName: 'authenticated-player', viewportName: 'desktop' });

test('@st Laptop SillyTavern opens the signed-in Poem Workshop home', async ({
  page,
  session,
  diagnostics,
}) => {
  test.setTimeout(120_000);

  await session.open();

  await expect(session.frame.locator('.discover-home')).toBeVisible();
  await expect(session.frame.locator('#userMenuTrigger')).toBeVisible();
  await expect(session.frame.locator('#logoutBtn')).toHaveCount(1);
  await expect(session.frame.locator('#loginBtn')).toHaveCount(0);
  await expect(session.frame.locator('body')).toContainText('已连接 SillyTavern');
  await expect(page.locator('body')).not.toContainText('Initializing…');

  diagnostics.assertHealthy();
});
