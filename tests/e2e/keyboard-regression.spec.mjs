import { expect, test } from './fixtures/workshop.mjs';
import { createFixtureProjects, installProjectCatalogFixture } from './support/catalog-fixture.mjs';

test.use({ profileName: 'authenticated-player', viewportName: 'desktop' });

test('@css-regression keyboard project modal keeps focus trapped and restores trigger focus', async ({
  page,
  session,
  discover,
  diagnostics,
}) => {
  test.setTimeout(90_000);
  test.fail(
    true,
    'Current generic Workshop modal does not yet implement the full focus-entry, Tab trap, Escape-close and focus-return contract.',
  );

  await installProjectCatalogFixture(page, { projects: createFixtureProjects(20) });
  await session.open();
  await discover.openCatalog('all');

  diagnostics.markStep('keyboard focus-visible on project trigger');
  const card = discover.projectCard('fixture-project-001');
  await card.focus();
  await expect(card).toBeFocused();
  expect(await card.evaluate(element => element.matches(':focus-visible'))).toBe(true);

  diagnostics.markStep('keyboard Enter opens project modal');
  const { overlay } = await discover.openProjectById('fixture-project-001', { keyboard: true });
  await expect(overlay).toBeVisible();

  diagnostics.markStep('focus enters project modal');
  expect(
    await session.frame.evaluate(() => {
      const modal = document.querySelector('.modal-overlay:last-of-type');
      return Boolean(modal && modal.contains(document.activeElement));
    }),
  ).toBe(true);

  diagnostics.markStep('Tab remains inside modal');
  const focusableCount = await overlay
    .locator('button:not([disabled]),a[href],input:not([disabled]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])')
    .count();
  expect(focusableCount).toBeGreaterThan(0);

  for (let index = 0; index < focusableCount + 2; index += 1) {
    await page.keyboard.press('Tab');
    expect(
      await session.frame.evaluate(() => {
        const modal = document.querySelector('.modal-overlay:last-of-type');
        return Boolean(modal && modal.contains(document.activeElement));
      }),
      `Tab #${index + 1} escaped the modal`,
    ).toBe(true);
  }

  diagnostics.markStep('Escape closes modal and restores project trigger focus');
  await page.keyboard.press('Escape');
  await expect(session.frame.locator('.modal-overlay')).toHaveCount(0);
  await expect(card).toBeFocused();

  diagnostics.assertHealthy();
});
