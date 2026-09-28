import { expect } from '@playwright/test';
import { getStProfileDefinition, getWorkshopViewport } from '../support/profiles.mjs';

const ST_BASE_URL = process.env.ST_BASE_URL || 'http://127.0.0.1:8000/';
const SAFE_STARTUP_DISMISSALS = ['我知道了', '暂不安装'];
const CHAT_INTEGRITY_ERROR = 'SillyTavern chat-integrity warning blocks Workshop startup; stop the test before any chat overwrite.';

function chatIntegrityDialog(page) {
  return page
    .locator('dialog[open]')
    .filter({ hasText: 'Chat integrity check failed while saving the file.' })
    .last();
}

async function dismissKnownStartupNotices(page) {
  let dismissed = false;
  for (const name of SAFE_STARTUP_DISMISSALS) {
    const button = page.getByRole('button', { name }).last();
    if (!(await button.isVisible().catch(() => false))) continue;
    await button.click({ force: true, timeout: 3_000 }).catch(() => {});
    await page.waitForTimeout(250);
    dismissed = true;
  }

  if (await chatIntegrityDialog(page).isVisible().catch(() => false)) throw new Error(CHAT_INTEGRITY_ERROR);

  return dismissed;
}

export class WorkshopSession {
  constructor({ page, diagnostics, profileName = 'authenticated-player', viewportName = 'desktop' }) {
    this.page = page;
    this.diagnostics = diagnostics;
    this.profileName = profileName;
    this.viewportName = viewportName;
    this.frame = null;
  }

  async open() {
    this.diagnostics?.markStep('open SillyTavern');
    await this.page.setViewportSize(getWorkshopViewport(this.viewportName));
    const response = await this.page.goto(ST_BASE_URL, {
      waitUntil: 'domcontentloaded',
      timeout: 30_000,
    });

    expect(response?.status(), 'Laptop SillyTavern should answer successfully').toBe(200);
    await expect(this.page).toHaveTitle(/SillyTavern/i);
    await this.page.waitForFunction(
      () => document.body?.innerText.trim() !== 'Initializing…',
      { timeout: 30_000 },
    );

    this.diagnostics?.markStep('wait for Workshop entry');
    const entry = this.page.getByRole('button', { name: '命定创意工坊' });
    await Promise.race([
      entry.waitFor({ state: 'visible', timeout: 45_000 }),
      chatIntegrityDialog(this.page).waitFor({ state: 'visible', timeout: 45_000 }).then(() => {
        throw new Error(CHAT_INTEGRITY_ERROR);
      }),
    ]);

    await dismissKnownStartupNotices(this.page);

    this.diagnostics?.markStep('open Workshop');
    for (let attempt = 0; attempt < 3; attempt += 1) {
      try {
        await entry.click({ timeout: 8_000, force: true });
        break;
      } catch (error) {
        const openedFrame = await this.#findWorkshopFrame();
        if (openedFrame) {
          this.frame = openedFrame;
          break;
        }
        const dismissed = await dismissKnownStartupNotices(this.page);
        if (!dismissed || attempt === 2) throw error;
      }
    }

    this.frame ||= await this.#waitForWorkshopFrame();
    await this.#assertProfileState();

    this.diagnostics?.registerStateProvider(() => this.snapshotState());
    return this;
  }

  async #findWorkshopFrame() {
    for (const frame of this.page.frames()) {
      if (frame === this.page.mainFrame()) continue;
      if (await frame.locator('.discover-home').isVisible().catch(() => false)) {
        return frame;
      }
    }
    return null;
  }

  async #waitForWorkshopFrame() {
    for (let attempt = 0; attempt < 60; attempt += 1) {
      if (await chatIntegrityDialog(this.page).isVisible().catch(() => false)) {
        throw new Error(CHAT_INTEGRITY_ERROR);
      }
      const frame = await this.#findWorkshopFrame();
      if (frame) return frame;

      const legalNotice = this.page.getByRole('heading', { name: /免责声明/ });
      if (await legalNotice.isVisible().catch(() => false)) {
        throw new Error(
          `Profile "${this.profileName}" still needs first-run consent. Run pnpm test:st:setup:${this.profileName === 'anonymous' ? 'anonymous' : 'player'} and complete consent manually.`,
        );
      }

      await this.page.waitForTimeout(500);
    }

    throw new Error('Poem Workshop did not reach the Discover home page in time.');
  }

  async #assertProfileState() {
    const profile = getStProfileDefinition(this.profileName);
    if (profile.authenticated) {
      await expect(this.frame.locator('#userMenuTrigger')).toHaveCount(1);
      await expect(this.frame.locator('#logoutBtn')).toHaveCount(1);
      await expect(this.frame.locator('#loginBtn')).toHaveCount(0);
    } else {
      await expect(this.frame.locator('#userMenuTrigger')).toHaveCount(0);
      await expect(this.frame.locator('#loginBtn')).toHaveCount(1);
    }
  }

  async setViewport(name) {
    this.viewportName = name;
    this.diagnostics?.markStep(`resize to ${name}`);
    await this.page.setViewportSize(getWorkshopViewport(name));
    await this.page.waitForTimeout(150);
  }

  async snapshotState() {
    if (!this.frame) return { workshopOpen: false };
    return await this.frame.evaluate(() => ({
      workshopOpen: Boolean(document.querySelector('.discover-home')),
      view: document.querySelector('[data-workshop-view].active')?.getAttribute('data-workshop-view') || null,
      visibleProjectIds: Array.from(
        document.querySelectorAll('.project-card[data-id], .discover-card[data-id]'),
      )
        .filter(element => {
          const rect = element.getBoundingClientRect();
          return rect.width > 0 && rect.height > 0;
        })
        .map(element => element.getAttribute('data-id')),
      activePage:
        document.querySelector('.project-page-number.active')?.textContent?.trim() || null,
      paginationSummary:
        document.querySelector('.project-pagination-summary')?.textContent?.trim() || null,
      openModalTitle:
        document.querySelector('.modal-overlay:last-of-type .modal-header h2')?.textContent?.trim() || null,
      authenticated: Boolean(document.querySelector('#userMenuTrigger')),
      loginVisible: (() => {
        const element = document.querySelector('#loginBtn');
        if (!element) return false;
        const style = getComputedStyle(element);
        const rect = element.getBoundingClientRect();
        return style.display !== 'none' && style.visibility !== 'hidden' && rect.width > 0 && rect.height > 0;
      })(),
    }));
  }
}
