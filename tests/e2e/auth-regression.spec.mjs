import { expect, test } from './fixtures/workshop.mjs';
import { createFixtureProjects, installProjectCatalogFixture } from './support/catalog-fixture.mjs';

const GATE_PROJECT_ID = 'fixture-project-001';
const GATE_REPAIR_ID = 'fixture-repair';

async function installGateRoutes(page) {
  const requests = { login: 0, installInfo: 0 };
  await page.route('**/api/auth/login', async route => {
    requests.login += 1;
    await route.fulfill({ status: 401, contentType: 'application/json', body: '{"error":"OAuth stopped by Playwright"}' });
  });
  await page.route(/\/api\/projects\/[^/?]+\/install-info(?:\?.*)?$/, async route => {
    requests.installInfo += 1;
    await route.fulfill({ status: 403, contentType: 'application/json', body: '{"error":"Download stopped by Playwright"}' });
  });
  return requests;
}

async function installGateBridgeFixture(page) {
  await page.addInitScript(repairId => {
    if (window !== window.top) return;
    window.__playwrightBridgeRequests = [];
    window.addEventListener('message', event => {
      const data = event.data;
      if (data?.namespace !== 'creative-workshop-bridge') return;
      window.__playwrightBridgeRequests.push(data.type);
      if ([
        'bridge:install-project',
        'bridge:uninstall-project',
        'bridge:confirm-project-update',
        'bridge:repair:project',
      ].includes(data.type)) {
        event.stopImmediatePropagation();
        return;
      }
      if (data.type === 'bridge:get-project-diff') {
        event.stopImmediatePropagation();
        event.source?.postMessage({
          namespace: 'creative-workshop-bridge',
          type: 'bridge:project-diff',
          requestId: data.requestId,
          payload: {
            projectId: data.payload?.projectId,
            diff: {
              added: { worldbookEntries: [], regexEntries: [] },
              modified: { worldbookEntries: [], regexEntries: [] },
              removed: { worldbookEntries: [], regexEntries: [] },
            },
          },
        }, '*');
        return;
      }
      if (data.type !== 'bridge:repair:scan') return;
      event.stopImmediatePropagation();
      event.source?.postMessage({
        namespace: 'creative-workshop-bridge',
        type: 'bridge:repair:scan-result',
        requestId: data.requestId,
        payload: {
          candidates: [],
          pending: [{ repairId, target: { candidateId: repairId, projectId: 'fixture-project-001' } }],
          availableWorldbookNames: [],
          enabledWorldbookNames: [],
          scannedWorldbookNames: [],
        },
      }, '*');
    }, true);
  }, GATE_REPAIR_ID);
}

async function bridgeRequestCount(page, type) {
  return page.evaluate(requestType =>
    (window.__playwrightBridgeRequests || []).filter(value => value === requestType).length, type);
}

test.beforeEach(async ({}, testInfo) => {
  testInfo.setTimeout(180_000);
});

test.describe('#44 anonymous download gate', () => {
  test.use({ profileName: 'anonymous', viewportName: 'desktop' });

  test('anonymous can browse but install/update/repair stay behind Discord login', async ({
    page,
    session,
    discover,
    project,
    updateCenter,
    diagnostics,
  }) => {
    await installGateBridgeFixture(page);
    const requests = await installGateRoutes(page);
    await installProjectCatalogFixture(page, { projects: createFixtureProjects(20) });

    await session.open();
    await updateCenter.seedInstalledProjects([]);
    await discover.openCatalog('all');

    const { overlay } = await discover.openProjectById('fixture-project-001');
    await expect(overlay.locator('.detail-project-name')).toHaveText('Fixture Project 001');

    await expect(await project.installEntry(GATE_PROJECT_ID)).toContainText('登录后安装');
    await project.clickInstallEntry(GATE_PROJECT_ID);
    await expect.poll(() => requests.login).toBe(1);
    expect(requests.installInfo).toBe(0);
    expect(await bridgeRequestCount(page, 'bridge:install-project')).toBe(0);

    await updateCenter.seedInstalledProjects([{
      projectId: GATE_PROJECT_ID,
      id: GATE_PROJECT_ID,
      projectName: 'Fixture Project 001',
      localVersion: '0.9.0',
    }]);
    await discover.openProjectById(GATE_PROJECT_ID);
    await expect(await project.updateEntry(GATE_PROJECT_ID)).toContainText('登录后更新');
    await project.clickUpdateEntry(GATE_PROJECT_ID);
    await expect.poll(() => requests.login).toBe(2);
    expect(await bridgeRequestCount(page, 'bridge:get-project-diff')).toBe(0);

    await discover.returnFromProject(GATE_PROJECT_ID);
    const repairModal = await project.openRepairEntry();
    await project.clickPendingRepair(repairModal, GATE_REPAIR_ID);
    await expect.poll(() => requests.login).toBe(3);
    expect(requests.installInfo).toBe(0);
    expect(await bridgeRequestCount(page, 'bridge:repair:project')).toBe(0);

    diagnostics.assertHealthy();
  });
});

test.describe('#44 authenticated player gate', () => {
  test.use({ profileName: 'authenticated-player', viewportName: 'desktop' });

  test('authenticated player can continue install/update/repair flows without OAuth', async ({
    page,
    session,
    discover,
    project,
    updateCenter,
    diagnostics,
  }) => {
    await installGateBridgeFixture(page);
    const requests = await installGateRoutes(page);
    const projects = createFixtureProjects(20);
    await installProjectCatalogFixture(page, { projects });
    await page.route(/\/api\/projects\/fixture-project-001(?:\?.*)?$/, async route => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          project: projects[0],
          worldbookEntriesPreview: [],
          regexEntriesPreview: [{ id: 'fixture-regex', name: 'Fixture Regex' }],
        }),
      });
    });

    await session.open();
    await updateCenter.seedInstalledProjects([]);
    await discover.openCatalog('all');

    await discover.openProjectById('fixture-project-001');
    await project.assertAuthenticatedInstallCanContinue(GATE_PROJECT_ID);
    await project.clickInstallEntry(GATE_PROJECT_ID);
    await expect.poll(() => requests.installInfo).toBe(1);
    expect(await bridgeRequestCount(page, 'bridge:install-project')).toBe(0);

    await updateCenter.seedInstalledProjects([{
      projectId: GATE_PROJECT_ID,
      id: GATE_PROJECT_ID,
      projectName: 'Fixture Project 001',
      localVersion: '0.9.0',
    }]);
    await discover.openProjectById(GATE_PROJECT_ID);
    await project.clickUpdateEntry(GATE_PROJECT_ID);
    await expect.poll(() => bridgeRequestCount(page, 'bridge:get-project-diff')).toBe(1);
    const updateModal = session.frame.locator('.modal-overlay').last();
    await expect(session.frame.locator('.modal-overlay')).toHaveCount(2);
    await expect(updateModal).toContainText('更新');
    await updateCenter.close(updateModal);
    await discover.returnFromProject(GATE_PROJECT_ID);

    const repairModal = await project.openRepairEntry();
    await project.clickPendingRepair(repairModal, GATE_REPAIR_ID);
    await expect.poll(() => requests.installInfo).toBe(2);
    expect(await bridgeRequestCount(page, 'bridge:repair:project')).toBe(0);
    expect(requests.login).toBe(0);

    diagnostics.assertHealthy();
  });
});

test.describe('#45 Update Center states', () => {
  test.use({ profileName: 'authenticated-player', viewportName: 'desktop' });

  test('Update Center shows deterministic update state', async ({
    page,
    session,
    updateCenter,
    diagnostics,
  }) => {
    await installProjectCatalogFixture(page, { projects: createFixtureProjects(20) });
    await updateCenter.mockVersionCheck({
      success: true,
      hasUpdate: true,
      updates: [
        {
          id: 'fixture-project-001',
          name: 'Fixture Project 001',
          installedVersion: '0.9.0',
          latestVersion: '1.0.1',
        },
      ],
    });

    await session.open();
    await updateCenter.seedInstalledProjects([
      {
        projectId: 'fixture-project-001',
        id: 'fixture-project-001',
        projectName: 'Fixture Project 001',
        localVersion: '0.9.0',
      },
    ]);

    const modal = await updateCenter.expectUpdateState('fixture-project-001');
    await expect(modal).toContainText('0.9.0');
    await expect(modal).toContainText('1.0.1');
    await updateCenter.close(modal);

    diagnostics.assertHealthy();
  });

  test('Update Center shows deterministic no-update state', async ({
    page,
    session,
    updateCenter,
    diagnostics,
  }) => {
    await installProjectCatalogFixture(page, { projects: createFixtureProjects(20) });
    await updateCenter.mockVersionCheck({
      success: true,
      hasUpdate: false,
      updates: [],
    });

    await session.open();
    await updateCenter.seedInstalledProjects([
      {
        projectId: 'fixture-project-001',
        id: 'fixture-project-001',
        projectName: 'Fixture Project 001',
        localVersion: '1.0.1',
      },
    ]);

    const modal = await updateCenter.expectNoUpdateState();
    await updateCenter.close(modal);

    diagnostics.assertHealthy();
  });

  test('unknown script version has a visible non-guessing state', async ({
    page,
    session,
    updateCenter,
    diagnostics,
  }) => {
    test.fail(
      true,
      'Issue #45 backend distinguishes uncertain versions, but current UI does not surface an unknown-version state.',
    );

    await installProjectCatalogFixture(page, { projects: createFixtureProjects(20) });
    await session.open();

    await updateCenter.seedScriptDependencyState({
      repository: 'uikawinwing/CharInfo-Manager',
      refKind: 'commit',
      ref: 'fixture-commit',
      installedVersion: '',
    });

    const summary = await session.frame.evaluate(() => getScriptDependencyHealthSummary());
    expect(summary.uncertain.length).toBe(1);
    expect(summary.outdated.length).toBe(0);

    await updateCenter.expectUnknownVersionState();
    diagnostics.assertHealthy();
  });

  test('bridge failure does not break Workshop browsing', async ({
    page,
    session,
    updateCenter,
    diagnostics,
  }) => {
    await installProjectCatalogFixture(page, { projects: createFixtureProjects(20) });
    await session.open();

    await updateCenter.simulateBridgeFailure();
    await expect(session.frame.locator('.discover-home')).toBeVisible();

    diagnostics.assertHealthy();
  });
});
