import assert from 'node:assert/strict';
import { chromium } from '@playwright/test';
import { createFixtureProjects, installProjectCatalogFixture } from '../../tests/e2e/support/catalog-fixture.mjs';
import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';

const browser = await chromium.launch({ headless: true });
try {
  for (const viewport of [{ width: 1440, height: 900 }, { width: 390, height: 844 }]) {
    const page = await browser.newPage({ viewport });
    const pageErrors = [];
    const consoleErrors = [];
    page.on('pageerror', error => pageErrors.push(error.message));
    page.on('console', message => { if (message.type() === 'error') consoleErrors.push(message.text()); });
    const project = { ...createFixtureProjects(1)[0], version: '2.0.0', versionLabel: '2.0.0' };
    await page.route('**/api/**', route => route.fulfill({ contentType: 'application/json',
      body: JSON.stringify({ projects: [], recommendations: [], shelves: [], user: null, updates: [], hasUpdate: false }) }));
    await installProjectCatalogFixture(page, { projects: [project] });
    await page.route('**/api/projects/version-check', route => route.fulfill({ contentType: 'application/json', body: JSON.stringify({ success: true, hasUpdate: false, updates: [] }) }));
    await page.route('**/assets/home.js*', async route => {
      const response = await route.fetch();
      const source = await response.text(); const tail = source.lastIndexOf('})();');
      assert.ok(tail > 0);
      await route.fulfill({ response, body: source.slice(0, tail) + `
        window.__dlcUi = { state, handleBridgeMessage: event => { if (event.data.type === 'bridge:handshake:ok') event.data.requestId = postBridgeMessage('bridge:handshake'); handleBridgeMessage({ ...event, source: window.parent }); }, setProjects, setInstalledProjects, renderApp,
          renderProjectUpdateHeader, openProjectUpdateModal, buildProjectCardViewModel, getInstalledProjectVersionPayload, expandDlcUpdateInstances };
        ` + source.slice(tail) });
    });
    await page.addInitScript(() => {
      window.__dlcRequests = [];
      window.addEventListener('message', event => {
        if (event.data?.namespace === 'creative-workshop-bridge') {
          window.__dlcRequests.push(event.data);
          if (event.data.type === 'bridge:get-project-diff') window.__dlcUi.handleBridgeMessage({ data: {
            namespace: 'creative-workshop-bridge', type: 'bridge:project-diff', requestId: event.data.requestId,
            payload: { projectId: event.data.payload.projectId, diff: { added: { worldbookEntries: [], regexEntries: [] }, modified: { worldbookEntries: [], regexEntries: [] }, removed: { worldbookEntries: [], regexEntries: [] } } },
          } });
        }
      });
    });
    await page.goto('http://127.0.0.1:8790');
    await page.waitForFunction(() => window.__dlcUi);
    assert.ok(await page.title());
    await page.evaluate(project => {
      const ui = window.__dlcUi;
      ui.handleBridgeMessage({ data: { namespace: 'creative-workshop-bridge', type: 'bridge:handshake:ok',
        payload: { clientVersion: '2.2.1', capabilities: { verifiedDlcInstall: true, duplicateDlcConsolidation: true } } } });
      ui.setProjects([project]);
      ui.setInstalledProjects(['A', 'B'].map((worldbookName, index) => ({ projectId: project.id, name: project.name,
        localVersion: String(index + 1) + '.0.0', worldbookName, entryCount: 1, regexCount: 1, worldbookBound: true,
        regexVersionMismatch: index === 0 })), { complete: true });
      ui.state.showSubscribedAndInstalledProjects = true;
      ui.state.currentUser = { id: 'fixture-user', username: '测试用户' };
      localStorage.setItem('creative_workshop_token', 'local-test-fixture');
      ui.renderApp();
    }, project);
    const uninstallA = page.locator('.install-btn[data-worldbook-name="A"]');
    const uninstallB = page.locator('.install-btn[data-worldbook-name="B"]');
    await uninstallA.waitFor({ state: 'visible' }); await uninstallB.waitFor({ state: 'visible' });
    assert.equal(await uninstallA.count(), 1); assert.equal(await uninstallB.count(), 1);
    const cardTexts = await page.locator('.project-card').allTextContents();
    assert.ok(cardTexts.some(text => text.includes('世界书：A') && text.includes('版本：1')));
    assert.ok(cardTexts.some(text => text.includes('世界书：B') && text.includes('版本：2')));
    if (process.env.WORKSHOP_UI_EVIDENCE_DIR) {
      await mkdir(process.env.WORKSHOP_UI_EVIDENCE_DIR, { recursive: true });
      await page.screenshot({ path: join(process.env.WORKSHOP_UI_EVIDENCE_DIR, 'dlc-install-' + viewport.width + '.png') });
    }
    const versionPayload = await page.evaluate(() => window.__dlcUi.getInstalledProjectVersionPayload());
    assert.deepEqual(versionPayload, [{ id: project.id, installedVersion: null }], 'one remote check for two disagreeing instances');
    const header = await page.evaluate(project => window.__dlcUi.renderProjectUpdateHeader(project, 'A'), project);
    assert.ok(header.includes('<code>1.0.0</code>'), 'update review displays the chosen location version');
    await page.evaluate(project => window.__dlcUi.openProjectUpdateModal(project, null, 'A'), project);
    assert.ok((await page.locator('.modal-overlay').last().innerText()).includes('发现 2 处'));
    assert.ok(await page.locator('.duplicate-install-actions').evaluate(element => element.scrollWidth <= element.clientWidth + 1), 'location choices fit the viewport');
    await page.locator('[data-duplicate-cancel]').click();
    assert.equal(await page.evaluate(() => window.__dlcRequests.filter(item => item.type === 'bridge:confirm-project-update').length), 0, 'cancel sends no write');
    await page.evaluate(project => window.__dlcUi.openProjectUpdateModal(project, null, 'A'), project);
    await page.locator('[data-duplicate-keep="B"]').click();
    await page.locator('[data-update-confirm]').click();
    await page.waitForFunction(() => window.__dlcRequests.some(item => item.type === 'bridge:confirm-project-update'));
    const approved = await page.evaluate(() => window.__dlcRequests.find(item => item.type === 'bridge:confirm-project-update').payload);
    assert.equal(approved.worldbookName, 'B');
    assert.deepEqual(approved.approvedDuplicates, [{ worldbookName: 'A', localVersion: '1.0.0', entryCount: 1 }]);
    await page.evaluate(project => window.__dlcUi.handleBridgeMessage({ data: { namespace: 'creative-workshop-bridge', type: 'bridge:error', payload: { projectId: project.id, message: '测试中止请求' } } }), project);
    await uninstallA.click();
    await page.waitForFunction(() => window.__dlcRequests.some(request => request.type === 'bridge:uninstall-project'));
    const request = await page.evaluate(() => window.__dlcRequests.find(request => request.type === 'bridge:uninstall-project'));
    assert.equal(request.payload.worldbookName, 'A');
    await page.evaluate(project => window.__dlcUi.handleBridgeMessage({ data: {
      namespace: 'creative-workshop-bridge', type: 'bridge:uninstall-result', payload: { success: true, projectId: project.id,
        complete: true, projects: [{ projectId: project.id, name: project.name, localVersion: '2.0.0', worldbookName: 'B', entryCount: 1, regexCount: 1 }] },
    } }), project);
    assert.equal(await uninstallA.count(), 0); assert.equal(await uninstallB.count(), 1, 'B remains after A uninstall');
    await page.evaluate(project => window.__dlcUi.handleBridgeMessage({ data: {
      namespace: 'creative-workshop-bridge', type: 'bridge:error', payload: { projectId: project.id,
        action: 'bridge:confirm-project-update', message: '部分完成：正则未保存', complete: true,
        projects: [{ projectId: project.id, name: project.name, localVersion: '2.0.0', worldbookName: 'B', entryCount: 1, regexCount: 1, regexVersionMismatch: true }] },
    } }), project);
    const retry = await page.evaluate(project => window.__dlcUi.expandDlcUpdateInstances([{ id: project.id, latestVersion: '2.0.0' }]), project);
    assert.equal(retry.length, 1); assert.equal(retry[0].worldbookName, 'B', 'partial Regex failure remains retryable at latest worldbook version');
    await page.getByText('部分完成：正则未保存', { exact: true }).waitFor({ state: 'visible' });
    await page.evaluate(project => {
      const ui = window.__dlcUi;
      ui.setInstalledProjects(['A', 'B'].map(worldbookName => ({ projectId: project.id, name: project.name, localVersion: '1.0.0', worldbookName, entryCount: 1 })), { complete: true });
      ui.handleBridgeMessage({ data: { namespace: 'creative-workshop-bridge', type: 'bridge:update-result', payload: { projectId: project.id, complete: true,
        projects: [{ projectId: project.id, name: project.name, localVersion: '2.0.0', worldbookName: 'A', entryCount: 1 }] } } });
    }, project);
    assert.equal(await uninstallA.count(), 1); assert.equal(await uninstallB.count(), 0, 'complete consolidation scan removes stale B from UI');
    const canDowngrade = await page.evaluate(project => {
      const ui = window.__dlcUi;
      ui.setInstalledProjects([{ projectId: project.id, name: project.name, localVersion: '1.3.25', worldbookName: 'A', entryCount: 1, regexVersionMismatch: true }], { complete: true });
      const older = { ...project, version: '1.3.19' };
      ui.openProjectUpdateModal(older, null, 'A');
      return ui.buildProjectCardViewModel(older).canUpdate;
    }, project);
    assert.equal(canDowngrade, false, 'an older remote version is not an update even with Regex mismatch');
    assert.equal(await page.locator('[data-update-confirm]').count(), 0, 'no downgrade confirmation is offered');
    assert.deepEqual(pageErrors, [], 'rendered flow must not have JavaScript errors');
    assert.deepEqual(consoleErrors, [], 'rendered fixture flow must not have console errors');
    await page.close();
    console.log('DLC installed A/B UI and recovery: ok (' + viewport.width + 'px)');
  }
} finally { await browser.close(); }
