import { expect } from '@playwright/test';

function escapeAttr(value) {
  return String(value).replace(/\\/g, '\\\\').replace(/"/g, '\\"');
}

export class DiscoverActions {
  constructor({ session }) {
    this.session = session;
    this.page = session.page;
    this.diagnostics = session.diagnostics;
  }

  get root() {
    if (!this.session.frame) throw new Error('WorkshopSession is not open yet. Call session.open() first.');
    return this.session.frame;
  }

  async openDiscover() {
    this.diagnostics?.markStep('open Discover');
    const button = this.root.locator('[data-workshop-view="discover"]:visible').first();
    if (await button.count()) {
      await button.click();
    }
    await expect(this.root.locator('.discover-home')).toBeVisible();
  }

  async openCatalog(category = 'all') {
    await this.selectCategory(category);
    await expect(this.root.locator('.projects-grid')).toBeVisible();
  }

  async #openMobileTool(name) {
    const trigger = this.root.locator(`[data-mobile-tool="${escapeAttr(name)}"]:visible`).first();
    if (!(await trigger.count())) return false;
    await trigger.click();
    await expect(this.root.locator('#mobileToolSheet')).toHaveClass(/show/);
    return true;
  }

  async selectCategory(category) {
    this.diagnostics?.markStep(`filter category: ${category}`);
    let button = this.root.locator(`[data-base-tag="${escapeAttr(category)}"]:visible`).first();
    if (!(await button.count())) {
      await this.#openMobileTool('page');
      button = this.root.locator(`[data-base-tag="${escapeAttr(category)}"]:visible`).first();
    }

    await expect(button).toBeVisible();
    const responsePromise = this.#waitForProjectsResponse();
    await button.click();
    await responsePromise;
    await expect(this.root.locator(`[data-base-tag="${escapeAttr(category)}"].active`).first()).toHaveCount(1);
    await this.expectPage(1);
  }

  async search(term) {
    const query = String(term || '');
    this.diagnostics?.markStep(`search: ${query}`);

    let input = this.root.locator('#projectSearchInput:visible').first();
    if (!(await input.count())) {
      await this.#openMobileTool('search');
      input = this.root.locator('#projectSearchInputMobile:visible').first();
    }

    await expect(input).toBeVisible();
    await input.fill(query);
    const responsePromise = this.#waitForProjectsResponse();
    await input.press('Enter');
    await responsePromise;

    if (query.trim()) {
      await expect(this.root.locator('.search-summary-query:visible').first()).toContainText(query.trim());
    } else {
      await expect(this.root.locator('.search-summary-query:visible')).toHaveCount(0);
    }
    await this.expectPage(1);
  }

  async selectOfficialTag(tag) {
    const value = String(tag || '').trim();
    this.diagnostics?.markStep(`official tag: ${value}`);

    let input = this.root.locator('#projectSearchInput:visible').first();
    if (!(await input.count())) {
      await this.#openMobileTool('search');
      input = this.root.locator('#projectSearchInputMobile:visible').first();
    }

    await input.focus();
    const chip = this.root.locator(`[data-search-tag="${escapeAttr(value)}"]:visible`).first();
    await expect(chip).toBeVisible();
    const responsePromise = this.#waitForProjectsResponse();
    await chip.click();
    await responsePromise;
    const activeTagState = this.root.locator(
      `[data-search-tag="${escapeAttr(value)}"][aria-pressed="true"], [data-remove-search-tag="${escapeAttr(value)}"]`,
    );
    await expect
      .poll(() => activeTagState.count(), {
        message: `official tag "${value}" should remain active after rerender`,
      })
      .toBeGreaterThan(0);
    await this.expectPage(1);
  }

  async sortBy(value) {
    this.diagnostics?.markStep(`sort: ${value}`);
    let option = this.root.locator(`[data-sort-value="${escapeAttr(value)}"]:visible`).first();

    if (!(await option.count())) {
      const desktopTrigger = this.root.locator('#sortMenuTrigger:visible').first();
      if (await desktopTrigger.count()) {
        await desktopTrigger.click();
      } else {
        await this.#openMobileTool('sort');
      }
      option = this.root.locator(`[data-sort-value="${escapeAttr(value)}"]:visible`).first();
    }

    await expect(option).toBeVisible();
    const responsePromise = this.#waitForProjectsResponse();
    await option.click();
    await responsePromise;
    await this.expectPage(1);
  }

  async visibleProjectIds() {
    return await this.root
      .locator('.project-card[data-id]:visible, .discover-card[data-id]:visible')
      .evaluateAll(elements => elements.map(element => element.getAttribute('data-id')).filter(Boolean));
  }

  projectCard(projectId) {
    const id = escapeAttr(projectId);
    return this.root.locator(
      `.project-card[data-id="${id}"]:visible, .discover-card[data-id="${id}"]:visible`,
    ).first();
  }

  async openProjectById(projectId, { keyboard = false } = {}) {
    this.diagnostics?.markStep(`open project: ${projectId}`);
    const card = this.projectCard(projectId);
    await expect(card).toBeVisible();

    if (keyboard) {
      await card.focus();
      await expect(card).toBeFocused();
      await card.press('Enter');
    } else {
      await card.click();
    }

    const overlay = this.root.locator('.modal-overlay .detail-panel').last();
    await expect(overlay).toBeVisible({ timeout: 15_000 });
    return { card, overlay };
  }

  async returnFromProject(projectId) {
    this.diagnostics?.markStep(`return from project: ${projectId}`);
    const overlay = this.root.locator('.modal-overlay').last();
    const mobileBack = overlay.locator('[data-mobile-detail-back]:visible').first();
    if (await mobileBack.count()) {
      await mobileBack.click();
    } else {
      await overlay.locator('.close-btn').click();
    }
    await expect(overlay).toHaveCount(0);
  }

  async nextPage() {
    this.diagnostics?.markStep('pagination next');
    const current = await this.activePage();
    const responsePromise = this.#waitForProjectsResponse();
    await this.root
      .locator('.project-pagination-controls button', { hasText: '下一页' })
      .click();
    await responsePromise;
    await this.expectPage(current + 1);
  }

  async previousPage() {
    this.diagnostics?.markStep('pagination previous');
    const current = await this.activePage();
    const responsePromise = this.#waitForProjectsResponse();
    await this.root
      .locator('.project-pagination-controls button', { hasText: '上一页' })
      .click();
    await responsePromise;
    await this.expectPage(current - 1);
  }

  async goToPage(pageNumber) {
    this.diagnostics?.markStep(`pagination page ${pageNumber}`);
    const zeroBased = Number(pageNumber) - 1;
    const button = this.root.locator(`[data-project-page="${zeroBased}"]:visible`).first();
    await expect(button).toBeVisible();
    const responsePromise = this.#waitForProjectsResponse();
    await button.click();
    await responsePromise;
    await this.expectPage(pageNumber);
  }

  async directJumpToPage(pageNumber) {
    this.diagnostics?.markStep(`direct page jump: ${pageNumber}`);
    const input = this.root.locator(
      '[data-project-page-jump]:visible, input[aria-label="跳到页码"]:visible, input[aria-label="跳转页码"]:visible',
    ).first();
    await expect(input, 'Issue #33 requires a direct page-jump control').toBeVisible();
    const responsePromise = this.#waitForProjectsResponse();
    await input.fill(String(pageNumber));
    await input.press('Enter');
    await responsePromise;
    await this.expectPage(pageNumber);
  }

  async activePage() {
    const text = await this.root.locator('.project-page-number.active').textContent();
    return Number(String(text || '').trim() || '1');
  }

  async expectPage(pageNumber) {
    const active = this.root.locator('.project-page-number.active');
    await expect(active).toHaveText(String(pageNumber));
  }

  async paginationSummary() {
    return String(
      (await this.root.locator('.project-pagination-summary').textContent().catch(() => '')) || '',
    ).trim();
  }

  async paginationState() {
    const latestRequest = this.diagnostics?.latestProjectRequests().at(-1) || null;
    const nextButton = this.root
      .locator('.project-pagination-controls button', { hasText: '下一页' })
      .first();
    return {
      page: await this.activePage(),
      pageSize: Number(latestRequest?.pageSize || 0),
      pageSizeLocked: Boolean(latestRequest?.pageSize),
      hasMore: (await nextButton.count()) > 0 ? !(await nextButton.isDisabled()) : false,
    };
  }

  async drawRandomProject() {
    this.diagnostics?.markStep('daily random draw');
    const button = this.root.locator('#dailyRandomDrawBtn:visible').first();
    await expect(button).toBeVisible();
    await expect(button).toBeEnabled();
    await button.click();

    const overlay = this.root.locator('.modal-overlay.daily-random-detail-modal').last();
    await expect(overlay).toBeVisible({ timeout: 15_000 });
    const projectName = String(
      (await overlay.locator('.detail-project-name').textContent().catch(() => '')) || '',
    ).trim();
    expect(projectName, 'daily draw must open a valid public project detail').not.toBe('');
    return overlay;
  }

  async drawRandomProjectRapidDoubleClick() {
    this.diagnostics?.markStep('daily random draw rapid double click');
    const button = this.root.locator('#dailyRandomDrawBtn:visible').first();
    await expect(button).toBeVisible();
    await expect(button).toBeEnabled();
    await button.evaluate(element => {
      element.click();
      element.click();
    });

    const overlay = this.root.locator('.modal-overlay.daily-random-detail-modal').last();
    await expect(overlay).toBeVisible({ timeout: 15_000 });
    await expect(overlay.locator('.detail-project-name')).not.toHaveText('');
    return overlay;
  }

  async continueRandomDraw(overlay) {
    this.diagnostics?.markStep('continue daily random draw');
    const next = overlay.locator('[data-daily-random-next]:visible').first();
    await expect(next).toBeVisible();
    await next.click();

    const nextOverlay = this.root.locator('.modal-overlay.daily-random-detail-modal').last();
    await expect(nextOverlay).toBeVisible({ timeout: 15_000 });
    await expect(nextOverlay.locator('.detail-project-name')).not.toHaveText('');
    return nextOverlay;
  }

  async backFromRandomDraw(overlay, { category = null } = {}) {
    this.diagnostics?.markStep('back from daily random draw');
    const back = overlay.locator('[data-daily-random-back]:visible').first();
    await expect(back).toBeVisible();
    await back.click();
    await expect(overlay).toHaveCount(0);
    if (category) {
      await expect(this.root.locator('.projects-grid')).toBeVisible();
      await expect(this.root.locator(`[data-base-tag="${escapeAttr(category)}"].active`).first()).toHaveCount(1);
    } else {
      await expect(this.root.locator('.discover-home')).toBeVisible();
    }
  }

  async clearOfficialTags() {
    this.diagnostics?.markStep('clear official tags');
    const clear = this.root.locator('[data-clear-all-search-tags]:visible').first();
    if (!(await clear.count())) return;
    const responsePromise = this.#waitForProjectsResponse();
    await clear.click();
    await responsePromise;
    await this.expectPage(1);
  }

  async firstOfficialTag() {
    let chip = this.root.locator('[data-search-tag]:visible').first();
    if (!(await chip.count())) {
      let input = this.root.locator('#projectSearchInput:visible').first();
      if (!(await input.count())) {
        await this.#openMobileTool('search');
        input = this.root.locator('#projectSearchInputMobile:visible').first();
      }
      await input.focus();
      chip = this.root.locator('[data-search-tag]:visible').first();
    }
    await expect(chip).toBeVisible();
    return await chip.getAttribute('data-search-tag');
  }

  async #waitForProjectsResponse() {
    return await this.page
      .waitForResponse(
        response => {
          try {
            const url = new URL(response.url());
            return url.origin === 'https://workshop-test.uika.cc.cd' && url.pathname === '/api/projects';
          } catch {
            return false;
          }
        },
        { timeout: 15_000 },
      )
      .catch(() => null);
  }
}
