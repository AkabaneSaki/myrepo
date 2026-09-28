import { expect } from '@playwright/test';

export class UpdateCenterActions {
  constructor({ session }) {
    this.session = session;
    this.page = session.page;
    this.diagnostics = session.diagnostics;
  }

  get root() {
    if (!this.session.frame) throw new Error('WorkshopSession is not open yet. Call session.open() first.');
    return this.session.frame;
  }

  async dispatchBridge(type, payload = {}) {
    await this.root.evaluate(
      ({ messageType, messagePayload }) => {
        window.dispatchEvent(
          new MessageEvent('message', {
            data: {
              namespace: 'creative-workshop-bridge',
              type: messageType,
              payload: messagePayload,
            },
          }),
        );
      },
      { messageType: type, messagePayload: payload },
    );
  }

  async seedInstalledProjects(projects) {
    this.diagnostics?.markStep('seed installed-project fixture');
    await this.root.evaluate(() => {
      localStorage.removeItem('creative_workshop_dlc_update_status_v1');
    });
    await this.dispatchBridge('bridge:installed-projects', {
      projects,
      complete: true,
    });
  }

  async mockVersionCheck(payloadOrFactory) {
    await this.page.route('**/api/projects/version-check', async route => {
      const payload =
        typeof payloadOrFactory === 'function' ? payloadOrFactory() : payloadOrFactory;
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(payload),
      });
    });
  }

  async open() {
    this.diagnostics?.markStep('open Update Center');
    let button = this.root.locator('#dlcUpdateStatusBtn:visible').first();
    if (!(await button.count())) {
      const account = this.root.locator('[data-mobile-tool="account"]:visible').first();
      if (await account.count()) {
        await account.click();
        button = this.root.locator('#mobileDlcUpdateStatusBtn:visible').first();
      }
    }
    await expect(button).toBeVisible();
    await button.click();
    const modal = this.root.locator('.modal-overlay').last();
    await expect(modal).toBeVisible({ timeout: 10_000 });
    return modal;
  }

  async expectUpdateState(projectId) {
    const modal = await this.open();
    await expect(modal.locator(`[data-dlc-update-project="${projectId}"]`)).toBeVisible();
    await expect(modal).toContainText('有更新');
    return modal;
  }

  async expectNoUpdateState() {
    this.diagnostics?.markStep('expect no-update state');
    const status = this.root.locator('.workshop-update-status-ok:visible').first();
    await expect(status).toBeVisible();
    await expect(status).toContainText('无更新');
    await expect(this.root.locator('#dlcUpdateStatusBtn:visible')).toHaveCount(0);
    return null;
  }

  async close(modal) {
    if (!modal) return;
    const close = modal.locator('.close-btn').first();
    if (await close.count()) {
      await close.click();
      await expect(modal).toHaveCount(0);
    }
  }

  async seedScriptDependencyState(dependency) {
    this.diagnostics?.markStep('seed script dependency fixture');
    await this.dispatchBridge('bridge:script-dependencies', {
      supported: true,
      scripts: [
        {
          scriptName: 'Fixture Script',
          dependencies: [dependency],
        },
      ],
    });
  }

  async expectUnknownVersionState() {
    this.diagnostics?.markStep('expect unknown-version state');
    const body = this.root.locator('body');
    await expect(body).toContainText(/版本无法确认|未知版本|无法确认版本/);
  }

  async simulateBridgeFailure() {
    this.diagnostics?.markStep('simulate bridge failure');
    await this.dispatchBridge('bridge:context', { connected: false });
    await this.dispatchBridge('bridge:script-dependencies', {
      supported: false,
      scripts: [],
    });
    await expect(this.root.locator('.discover-home')).toBeVisible();
  }
}
