import { expect } from '@playwright/test';

function escapeAttr(value) {
  return String(value).replace(/\\/g, '\\\\').replace(/"/g, '\\"');
}

export class ProjectActions {
  constructor({ session }) {
    this.session = session;
    this.diagnostics = session.diagnostics;
  }

  get root() {
    if (!this.session.frame) throw new Error('WorkshopSession is not open yet. Call session.open() first.');
    return this.session.frame;
  }

  installButton(projectId) {
    const id = escapeAttr(projectId);
    return this.root.locator(
      `.detail-install-btn[data-id="${id}"], .install-btn[data-id="${id}"]`,
    ).last();
  }

  updateButton(projectId) {
    const id = escapeAttr(projectId);
    return this.root.locator(
      `.detail-update-btn[data-id="${id}"], .update-btn[data-id="${id}"]`,
    ).last();
  }

  async installEntry(projectId) {
    this.diagnostics?.markStep(`install entry: ${projectId}`);
    const button = this.installButton(projectId);
    await expect(button).toBeVisible();
    return button;
  }

  async updateEntry(projectId) {
    this.diagnostics?.markStep(`update entry: ${projectId}`);
    const button = this.updateButton(projectId);
    await expect(button).toBeVisible();
    return button;
  }

  async repairEntry() {
    this.diagnostics?.markStep('repair entry');
    let button = this.root.locator('#dlcRepairBtn:visible').first();
    if (!(await button.count())) {
      const account = this.root.locator('[data-mobile-tool="account"]:visible').first();
      await expect(account).toBeVisible();
      await account.click();
      button = this.root.locator('#mobileDlcRepairBtn:visible').first();
    }
    await expect(button).toBeVisible();
    return button;
  }

  async stubLoginPopup() {
    await this.root.evaluate(() => {
      window.__workshopTestLoginPopupOpened = false;
      openLoginPopup = () => {
        window.__workshopTestLoginPopupOpened = true;
      };
    });
  }

  async assertAnonymousDownloadGate(actionLabel) {
    this.diagnostics?.markStep(`anonymous gate: ${actionLabel}`);
    await this.stubLoginPopup();
    const allowed = await this.root.evaluate(label => requireDiscordLoginForDownload(label), actionLabel);
    expect(allowed).toBe(false);
    expect(
      await this.root.evaluate(() => Boolean(window.__workshopTestLoginPopupOpened)),
      'anonymous gate should enter the existing Discord login flow',
    ).toBe(true);
  }

  async assertAuthenticatedDownloadGate(actionLabel) {
    this.diagnostics?.markStep(`authenticated gate: ${actionLabel}`);
    const allowed = await this.root.evaluate(label => requireDiscordLoginForDownload(label), actionLabel);
    expect(allowed).toBe(true);
  }

  async assertAnonymousInstallGate(projectId) {
    const button = await this.installEntry(projectId);
    await expect(button).toContainText('登录后安装');
    await this.assertAnonymousDownloadGate('安装 DLC');
  }

  async assertAuthenticatedInstallCanContinue(projectId) {
    const button = await this.installEntry(projectId);
    await expect(button).not.toContainText('登录后安装');
    await expect(button).not.toBeDisabled();
  }

  async openRepairEntry() {
    const button = await this.repairEntry();
    await button.click();
    const modal = this.root.locator('.modal-overlay').last();
    await expect(modal).toBeVisible();
    return modal;
  }
}
