import { expect, test } from './fixtures/workshop.mjs';
import {
  createFixtureProjects,
  installDailyRandomFixture,
  installProjectCatalogFixture,
} from './support/catalog-fixture.mjs';

test.use({ profileName: 'authenticated-player', viewportName: 'desktop' });

test.beforeEach(async ({}, testInfo) => {
  testInfo.setTimeout(90_000);
});

test('#33 pagination keeps a stable page session across navigation, filters, sort and resize', async ({
  page,
  session,
  discover,
  diagnostics,
}) => {
  test.setTimeout(180_000);
  const projects = createFixtureProjects(110);
  await installProjectCatalogFixture(page, { projects });

  await session.open();
  await discover.openCatalog('all');

  const firstState = await discover.paginationState();
  expect(firstState.page).toBe(1);
  expect(firstState.pageSize).toBeGreaterThan(0);
  expect(firstState.pageSizeLocked).toBe(true);

  const page1 = await discover.visibleProjectIds();
  await discover.goToPage(2);
  const page2 = await discover.visibleProjectIds();

  expect(page1.length).toBe(firstState.pageSize);
  expect(page2.length).toBe(firstState.pageSize);
  expect(page1.filter(id => page2.includes(id)), 'page 1 and page 2 must not duplicate projects').toEqual([]);

  const beforeResize = await discover.paginationState();
  const beforeResizeIds = await discover.visibleProjectIds();
  await session.setViewport('mobile');
  const afterResize = await discover.paginationState();
  const afterResizeIds = await discover.visibleProjectIds();

  expect(afterResize.page).toBe(beforeResize.page);
  expect(afterResize.pageSize).toBe(beforeResize.pageSize);
  expect(afterResizeIds).toEqual(beforeResizeIds);

  await session.setViewport('desktop');
  await discover.goToPage(3);
  const page3 = await discover.visibleProjectIds();

  const allSeen = [...page1, ...page2, ...page3];
  expect(new Set(allSeen).size, 'pagination must not duplicate project identities').toBe(allSeen.length);
  expect([...new Set(allSeen)].sort()).toEqual(projects.map(project => project.id).sort());

  await discover.goToPage(2);
  await discover.search('Fixture');
  await discover.expectPage(1);

  await discover.goToPage(2);
  await discover.sortBy('likes');
  await discover.expectPage(1);

  await discover.goToPage(2);
  await discover.selectCategory('角色');
  await discover.expectPage(1);

  diagnostics.assertHealthy();
});

test('#33 direct page jump acceptance', async ({ page, session, discover, diagnostics }) => {
  test.setTimeout(180_000);
  test.fail(true, 'Issue #33 direct page-jump control is not implemented in current staging UI.');

  await installProjectCatalogFixture(page, { projects: createFixtureProjects(110) });
  await session.open();
  await discover.openCatalog('all');
  await discover.directJumpToPage(3);
  await discover.expectPage(3);

  diagnostics.assertHealthy();
});

test('#39 browser search, category and official-tag filters keep deterministic results', async ({
  page,
  session,
  discover,
  diagnostics,
}) => {
  const projects = createFixtureProjects(110);
  await installProjectCatalogFixture(page, { projects });

  await session.open();
  await discover.openCatalog('all');

  await discover.search('Fixture Project 001');
  expect(await discover.visibleProjectIds()).toEqual(['fixture-project-001']);

  await discover.search('');
  await discover.selectCategory('角色');
  const categoryIds = await discover.visibleProjectIds();
  expect(categoryIds.length).toBeGreaterThan(0);
  expect(
    categoryIds.every(id => projects.find(project => project.id === id)?.projectType === '角色'),
  ).toBe(true);

  await discover.selectOfficialTag('人类');
  const taggedIds = await discover.visibleProjectIds();
  expect(taggedIds.length).toBeGreaterThan(0);
  expect(
    taggedIds.every(id => projects.find(project => project.id === id)?.tags.includes('人类')),
  ).toBe(true);

  const latestRequest = diagnostics.latestProjectRequests().at(-1);
  expect(latestRequest?.category).toBe('角色');
  expect(String(latestRequest?.tags || '')).toContain('人类');

  diagnostics.assertHealthy();
});

for (const viewportName of ['desktop', 'mobile']) {
  test.describe(`#47 daily random draw [${viewportName}]`, () => {
    test.use({ profileName: 'authenticated-player', viewportName });

    test('opens a public detail, blocks rapid duplicate requests and supports continue/back', async ({
      page,
      session,
      discover,
      diagnostics,
    }) => {
      test.setTimeout(180_000);
      const projects = createFixtureProjects(110);
      await installProjectCatalogFixture(page, { projects });
      const randomFixture = await installDailyRandomFixture(page, {
        projectId: 'fixture-project-001',
        initialCount: 0,
        limit: 10,
        responseDelayMs: 200,
      });

      await session.open();
      await discover.openDiscover();

      let overlay = await discover.drawRandomProjectRapidDoubleClick();
      await expect(overlay.locator('.detail-project-name')).toHaveText('Fixture Project 001');
      expect(randomFixture.getRequestCount(), 'rapid double click must create only one draw request').toBe(1);

      overlay = await discover.continueRandomDraw(overlay);
      await expect(overlay.locator('.detail-project-name')).toHaveText('Fixture Project 001');
      expect(randomFixture.getRequestCount()).toBe(2);

      await discover.backFromRandomDraw(overlay);
      await expect(session.frame.locator('.discover-home')).toBeVisible();

      diagnostics.assertHealthy();
    });

    test('draws from the selected category and returns to it', async ({
      page,
      session,
      discover,
      diagnostics,
    }) => {
      test.setTimeout(180_000);
      await installProjectCatalogFixture(page, { projects: createFixtureProjects(20) });
      const randomFixture = await installDailyRandomFixture(page, {
        projectId: 'fixture-project-001',
      });

      await session.open();
      await discover.openCatalog('角色');
      await expect(session.frame.locator('.daily-random-draw')).toContainText('从「角色」中抽取');

      const overlay = await discover.drawRandomProject();
      await expect(overlay.locator('.detail-project-name')).toHaveText('Fixture Project 001');
      expect(randomFixture.getRequestBodies()).toEqual([
        expect.objectContaining({ projectType: '角色' }),
      ]);

      await discover.backFromRandomDraw(overlay, { category: '角色' });
      diagnostics.assertHealthy();
    });
  });
}
