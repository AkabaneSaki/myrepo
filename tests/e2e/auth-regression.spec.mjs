import { expect, test } from './fixtures/workshop.mjs';
import { createFixtureProjects, installProjectCatalogFixture } from './support/catalog-fixture.mjs';

test.beforeEach(async ({}, testInfo) => {
  testInfo.setTimeout(90_000);
});

test.describe('#44 anonymous download gate', () => {
  test.use({ profileName: 'anonymous', viewportName: 'desktop' });

  test('anonymous can browse but install/update/repair stay behind Discord login', async ({
    page,
    session,
    discover,
    project,
    diagnostics,
  }) => {
    await installProjectCatalogFixture(page, { projects: createFixtureProjects(20) });

    await session.open();
    await discover.openCatalog('all');

    const { overlay } = await discover.openProjectById('fixture-project-001');
    await expect(overlay.locator('.detail-project-name')).toHaveText('Fixture Project 001');

    await project.assertAnonymousInstallGate('fixture-project-001');
    await project.assertAnonymousDownloadGate('更新 DLC');
    await project.assertAnonymousDownloadGate('修复 DLC');

    await discover.returnFromProject('fixture-project-001');
    await expect(await project.repairEntry()).toBeVisible();

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
    diagnostics,
  }) => {
    await installProjectCatalogFixture(page, { projects: createFixtureProjects(20) });

    await session.open();
    await discover.openCatalog('all');

    await discover.openProjectById('fixture-project-001');
    await project.assertAuthenticatedInstallCanContinue('fixture-project-001');
    await project.assertAuthenticatedDownloadGate('安装 DLC');
    await project.assertAuthenticatedDownloadGate('更新 DLC');
    await project.assertAuthenticatedDownloadGate('修复 DLC');
    await expect(await project.repairEntry()).toBeVisible();

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
