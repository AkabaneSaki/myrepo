import { test as base, chromium } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { WorkshopSession } from '../actions/workshop-session.mjs';
import { DiscoverActions } from '../actions/discover.mjs';
import { ProjectActions } from '../actions/project.mjs';
import { UpdateCenterActions } from '../actions/update-center.mjs';
import { createStProfileRun, getWorkshopViewport } from '../support/profiles.mjs';
import { JourneyDiagnostics } from '../support/diagnostics.mjs';

const workshopConfig = JSON.parse(readFileSync(new URL('../../../config/workshop.json', import.meta.url), 'utf8'));

export const test = base.extend({
  profileName: ['authenticated-player', { option: true }],
  viewportName: ['desktop', { option: true }],

  context: async ({ profileName, viewportName }, use) => {
    const runProfile = createStProfileRun(profileName);
    let context = null;

    try {
      context = await chromium.launchPersistentContext(runProfile.path, {
        channel: 'msedge',
        headless: process.env.ST_TEST_HEADED !== '1',
        viewport: getWorkshopViewport(viewportName),
      });

      // Startup extensions may save the active ST chat. Journeys only inspect Workshop,
      // so keep their copied browser sessions from writing to Master's real chat.
      await context.route('**/api/chats/save', route => route.fulfill({ status: 204 }));

      if (process.env.ST_WORKSHOP_PREVIEW_URL) {
        for (const path of ['/', '/assets/home.js']) {
          await context.route(`${workshopConfig.endpoints.staging}${path}`, async route => {
            const response = await route.fetch({
              url: new URL(path, process.env.ST_WORKSHOP_PREVIEW_URL).href,
              headers: { accept: '*/*' },
            });
            await route.fulfill({ response });
          });
        }
      }

      await use(context);
    } finally {
      await context?.close().catch(() => {});
      await runProfile.cleanup();
    }
  },

  page: async ({ context }, use) => {
    const pages = context.pages();
    const page = pages[0] || (await context.newPage());
    await use(page);
  },

  diagnostics: async ({ page }, use, testInfo) => {
    const diagnostics = new JourneyDiagnostics(page);
    diagnostics.start();
    await use(diagnostics);
    await diagnostics.attachFailureArtifacts(testInfo);
  },

  session: async ({ page, diagnostics, profileName, viewportName }, use) => {
    const session = new WorkshopSession({ page, diagnostics, profileName, viewportName });
    await use(session);
  },

  discover: async ({ session }, use) => {
    await use(new DiscoverActions({ session }));
  },

  project: async ({ session }, use) => {
    await use(new ProjectActions({ session }));
  },

  updateCenter: async ({ session }, use) => {
    await use(new UpdateCenterActions({ session }));
  },
});

export { expect } from '@playwright/test';
