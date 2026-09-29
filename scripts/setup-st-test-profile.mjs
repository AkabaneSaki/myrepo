import { chromium } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import { getStProfileDefinition, getStProfilePath } from '../tests/e2e/support/profiles.mjs';

const AGREEMENT_STORAGE_KEY = 'creative_workshop_agreement_accepted';

const profileName = process.argv[2] || 'authenticated-player';
const profile = getStProfileDefinition(profileName);
const profileDir = getStProfilePath(profileName);

mkdirSync(profileDir, { recursive: true });

const context = await chromium.launchPersistentContext(profileDir, {
  channel: 'msedge',
  headless: false,
  viewport: { width: 1440, height: 900 },
});

const pages = context.pages();
const page = pages[0] || (await context.newPage());

console.log(`[st-setup] profile=${profileName}`);
console.log('[st-setup] Opening SillyTavern in the dedicated test Edge profile...');
await page.goto(process.env.ST_BASE_URL || 'http://127.0.0.1:8000/', {
  waitUntil: 'domcontentloaded',
  timeout: 30_000,
});

await page.waitForFunction(
  () => document.body?.innerText.trim() !== 'Initializing…',
  { timeout: 30_000 },
);

if (!profile.authenticated) {
  // Master already accepted the same Workshop disclaimer once. Reuse only that
  // non-account acknowledgement for the anonymous test profile; never copy OAuth state.
  await page.evaluate(storageKey => {
    localStorage.setItem(storageKey, 'true');
  }, AGREEMENT_STORAGE_KEY);
  console.log('[st-setup] Reused Workshop disclaimer acknowledgement for anonymous profile only.');
}

const workshopEntry = page.getByRole('button', { name: '命定创意工坊' });
await workshopEntry.waitFor({ state: 'visible', timeout: 45_000 });

for (const name of ['我知道了', '暂不安装']) {
  const button = page.getByRole('button', { name }).last();
  if (await button.isVisible().catch(() => false)) {
    await button.click({ force: true, timeout: 3_000 }).catch(() => {});
    await page.waitForTimeout(250);
  }
}

try {
  await workshopEntry.click({ timeout: 8_000 });
} catch {
  for (const name of ['我知道了', '暂不安装']) {
    const button = page.getByRole('button', { name }).last();
    if (await button.isVisible().catch(() => false)) {
      await button.click({ force: true, timeout: 3_000 }).catch(() => {});
      await page.waitForTimeout(250);
    }
  }
  await workshopEntry.click({ timeout: 8_000 });
}

if (!profile.authenticated) {
  let workshopFrame = null;
  for (let attempt = 0; attempt < 40; attempt += 1) {
    workshopFrame = page
      .frames()
      .find(frame => frame.url().startsWith('https://workshop-test.uika.cc.cd'));
    if (workshopFrame) break;
    await page.waitForTimeout(500);
  }

  if (!workshopFrame) {
    throw new Error('Anonymous Workshop frame did not load.');
  }

  await workshopFrame.locator('.discover-home').waitFor({ state: 'visible', timeout: 15_000 });
  const loggedIn = await workshopFrame.locator('#userMenuTrigger').isVisible().catch(() => false);
  const loginVisible = await workshopFrame.locator('#loginBtn').isVisible().catch(() => false);

  if (loggedIn || !loginVisible) {
    throw new Error('Anonymous profile is not anonymous. Refusing to save it as the anonymous fixture.');
  }

  console.log('[st-setup] Anonymous Workshop profile verified: consent reused, Discord remains logged out.');
  await context.close();
  console.log('[st-setup] Anonymous profile setup complete.');
  process.exit(0);
}

console.log('');
console.log(`[st-setup] Workshop is open for profile "${profileName}".`);
console.log('[st-setup] Ensure Discord is logged in. OAuth is only needed during setup, not normal test runs.');
console.log('[st-setup] When the Workshop home page is ready, CLOSE THIS EDGE WINDOW.');
console.log('[st-setup] The persistent profile will be reused by future automation.');

await new Promise(resolve => {
  let settled = false;
  const finish = () => {
    if (settled) return;
    settled = true;
    resolve();
  };
  context.on('close', finish);
  page.on('close', finish);
});

await context.close().catch(() => {});
console.log('[st-setup] Profile setup window closed; persistent state has been flushed.');
