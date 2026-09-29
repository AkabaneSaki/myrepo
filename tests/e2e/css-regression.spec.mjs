import { expect, test } from './fixtures/workshop.mjs';
import { createFixtureProjects, installProjectCatalogFixture } from './support/catalog-fixture.mjs';
import { captureCssBaseline } from './support/visual.mjs';

async function runCssRegressionJourney({
  page,
  session,
  discover,
  project,
  updateCenter,
  diagnostics,
  viewportName,
}) {
  const projects = createFixtureProjects(110);
  await installProjectCatalogFixture(page, { projects });
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

  diagnostics.markStep(`${viewportName}: Discover shelves`);
  await discover.openDiscover();
  await expect(session.frame.locator('.discover-home')).toBeVisible();
  await expect(session.frame.locator('.discover-shelf').first()).toBeVisible();
  await expect(discover.projectCard('fixture-project-001')).toBeVisible();
  await captureCssBaseline(session.frame.locator('body'), `${viewportName}-discover.png`, {
    mask: [
      session.frame.locator('#userMenuTrigger'),
      session.frame.locator('.mobile-nav-avatar'),
    ],
  });

  diagnostics.markStep(`${viewportName}: project detail`);
  let { overlay } = await discover.openProjectById('fixture-project-001');
  await expect(overlay.locator('.detail-project-name')).toHaveText('Fixture Project 001');
  await captureCssBaseline(overlay, `${viewportName}-detail.png`);
  await project.installEntry('fixture-project-001');
  await discover.returnFromProject('fixture-project-001');

  diagnostics.markStep(`${viewportName}: search/tag/sort`);
  await discover.openCatalog('all');
  await discover.search('Fixture');
  await discover.selectOfficialTag('人类');
  await discover.sortBy('likes');
  await captureCssBaseline(session.frame.locator('body'), `${viewportName}-filters.png`, {
    mask: [
      session.frame.locator('#userMenuTrigger'),
      session.frame.locator('.mobile-nav-avatar'),
    ],
  });

  diagnostics.markStep(`${viewportName}: pagination`);
  await discover.clearOfficialTags();
  await discover.search('');
  await discover.sortBy('published');
  await discover.nextPage();
  await expect(await discover.activePage()).toBe(2);

  diagnostics.markStep(`${viewportName}: install/update/repair entry points`);
  await discover.search('Fixture Project 001');
  ({ overlay } = await discover.openProjectById('fixture-project-001'));
  await project.installEntry('fixture-project-001');
  await discover.returnFromProject('fixture-project-001');

  await updateCenter.seedInstalledProjects([
    {
      projectId: 'fixture-project-001',
      id: 'fixture-project-001',
      projectName: 'Fixture Project 001',
      localVersion: '0.9.0',
    },
  ]);

  await discover.search('Fixture Project 001');
  ({ overlay } = await discover.openProjectById('fixture-project-001'));
  await project.updateEntry('fixture-project-001');
  await discover.returnFromProject('fixture-project-001');
  await expect(await project.repairEntry()).toBeVisible();

  diagnostics.markStep(`${viewportName}: Update Center`);
  const updateModal = await updateCenter.expectUpdateState('fixture-project-001');
  await captureCssBaseline(updateModal, `${viewportName}-update-center.png`);
  await updateCenter.close(updateModal);

  diagnostics.assertHealthy();
}

for (const viewportName of ['desktop', 'mobile']) {
  test.describe(`@css-regression ${viewportName}`, () => {
    test.use({ profileName: 'authenticated-player', viewportName });

    test(`Discover → detail → filters → pagination → action entries → Update Center [${viewportName}]`, async ({
      page,
      session,
      discover,
      project,
      updateCenter,
      diagnostics,
    }) => {
      session.diagnostics.markStep(`css regression ${viewportName}`);
      test.setTimeout(120_000);
      await runCssRegressionJourney({
        page,
        session,
        discover,
        project,
        updateCenter,
        diagnostics,
        viewportName,
      });
    });
  });
}
