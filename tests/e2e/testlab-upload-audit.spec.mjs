import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { test, expect } from './fixtures/workshop.mjs';

const workshopConfig = JSON.parse(
  readFileSync(new URL('../../config/workshop.json', import.meta.url), 'utf8'),
);

const WORKSHOP_ORIGIN = workshopConfig.endpoints.staging;
const LOCAL_WORKER = process.env.WORKSHOP_LOCAL_WORKER || 'http://127.0.0.1:8791';
const blockedPath = fileURLToPath(
  new URL('./fixtures/workshop-qa-l-blocked.json', import.meta.url),
);
const yellowPath = fileURLToPath(
  new URL('./fixtures/workshop-qa-audit-yellow.json', import.meta.url),
);

test.use({ profileName: 'anonymous', viewportName: 'desktop' });

test('@st TestLab upload gate blocks L-series and Audit Centre shows M/U/AH findings', async ({
  page,
  context,
  session,
  diagnostics,
}, testInfo) => {
  test.setTimeout(180_000);

  let createdProjectId = null;
  let sessionAuth = '';
  const counts = {
    projectCreates: 0,
    preflightWorldbook: 0,
    adminReviewDetail: 0,
  };

  async function localApi(path, { method = 'GET', body, auth = sessionAuth } = {}) {
    const headers = {};
    if (auth) headers.authorization = auth;
    if (body !== undefined) headers['content-type'] = 'application/json';

    const response = await fetch(LOCAL_WORKER + path, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const text = await response.text();

    let data = null;
    try {
      data = text ? JSON.parse(text) : null;
    } catch {
      data = text;
    }

    if (!response.ok) {
      throw new Error(
        method + ' ' + path + ' -> ' + response.status + ': ' + String(text).slice(0, 1200),
      );
    }

    return data;
  }

  await context.route(WORKSHOP_ORIGIN + '/**', async route => {
    const request = route.request();
    const original = new URL(request.url());

    if (request.method() === 'POST' && original.pathname === '/api/projects') {
      counts.projectCreates += 1;
    }
    if (
      request.method() === 'POST' &&
      original.pathname === '/api/projects/preflight/worldbook'
    ) {
      counts.preflightWorldbook += 1;
    }
    if (
      request.method() === 'GET' &&
      original.pathname.startsWith('/api/admin/review/')
    ) {
      counts.adminReviewDetail += 1;
    }
    if (original.pathname === '/api/auth/me' && request.headers().authorization) {
      sessionAuth = request.headers().authorization;
    }

    const local = new URL(original.pathname + original.search, LOCAL_WORKER);
    const response = await route.fetch({ url: local.href });

    if (original.pathname === '/assets/home.js') {
      const source = await response.text();
      const patched = source.replace(
        /function isPrivateLocalPreviewHost\(\) \{[\s\S]*?\n\}/,
        'function isPrivateLocalPreviewHost() { return true; }',
      );
      expect(
        patched,
        'TestLab harness should enable the existing local Admin UI instead of mocking auth APIs',
      ).not.toBe(source);
      await route.fulfill({ response, body: patched });
      return;
    }

    await route.fulfill({ response });
  });

  page.on('dialog', dialog => dialog.accept().catch(() => {}));

  try {
    await session.open();
    const frame = session.frame;

    const localAdmin = frame.locator('#localAdminLoginBtn');
    await expect(localAdmin).toBeVisible({ timeout: 15_000 });
    await localAdmin.click();
    await expect(frame.locator('#userMenuTrigger')).toBeVisible({ timeout: 15_000 });

    await expect
      .poll(() => sessionAuth, {
        timeout: 10_000,
        message: 'Local Admin UI authenticated but no bearer session was observed',
      })
      .toMatch(/^Bearer /);

    let references = await localApi('/api/character-references', { auth: '' });
    if (!Array.isArray(references?.references) || !references.references.length) {
      const created = await localApi('/api/admin/character-references', {
        method: 'POST',
        body: {
          name: 'TestLab QA Reference',
          description: 'local TestLab upload/audit QA only',
        },
      });

      await localApi(
        '/api/admin/character-references/' + encodeURIComponent(created.reference.id) + '/versions',
        {
          method: 'POST',
          body: {
            versionLabel: 'QA-4.3.3',
            worldbookJson: JSON.stringify({
              entries: {
                0: {
                  uid: 1,
                  comment: '[本体]QA Base',
                  content: 'QA base content',
                  constant: true,
                  position: 0,
                },
              },
            }),
          },
        },
      );

      references = await localApi('/api/character-references', { auth: '' });
    }

    expect(Array.isArray(references?.references)).toBe(true);
    expect(references.references.length).toBeGreaterThan(0);

    async function openUpload() {
      await frame.locator('#userMenuTrigger').click();
      await expect(frame.locator('#uploadBtn')).toBeVisible({ timeout: 10_000 });
      await frame.locator('#uploadBtn').click();
      const form = frame.locator('.project-form-modal').last();
      await expect(form).toBeVisible({ timeout: 10_000 });
      return form;
    }

    // A: L-series findings must stop the upload before project creation.
    const beforeBlockedCreates = counts.projectCreates;
    let form = await openUpload();
    await form.locator('#projName').fill('TestLab QA L Blocked');
    await form.locator('#baseTag').selectOption({ label: '系统核心' });
    await form.locator('#fileInput').setInputFiles(blockedPath);

    const blockedPreview = form.locator('#worldbookUploadPreview');
    await expect(blockedPreview).toBeVisible({ timeout: 20_000 });

    const blockedStatus = blockedPreview.locator('.upload-preflight-status--error');
    await expect(blockedStatus).toBeVisible({ timeout: 20_000 });
    await expect(
      blockedStatus.locator('.upload-preflight-finding-title').filter({ hasText: '[L2]' }),
    ).toHaveCount(1);
    await expect(
      blockedStatus.locator('.upload-preflight-finding-title').filter({ hasText: '[L4]' }),
    ).toHaveCount(1);
    await expect(blockedStatus).toContainText('自动检查未通过');

    await form.getByRole('button', { name: '下一步' }).click();
    await page.waitForTimeout(500);

    await expect(form).toBeVisible();
    await expect(frame.locator('.publish-check-modal')).toHaveCount(0);
    expect(counts.projectCreates).toBe(beforeBlockedCreates);

    await form.locator('.close-btn').click();

    // B: M/U/AH findings may upload, then must appear as yellow grouped findings in Audit Centre.
    const uniqueName = 'TestLab QA Audit Yellow ' + Date.now();
    form = await openUpload();
    await form.locator('#projName').fill(uniqueName);
    await form.locator('#baseTag').selectOption({ label: '系统核心' });
    await form.locator('#fileInput').setInputFiles(yellowPath);

    const yellowPreview = form.locator('#worldbookUploadPreview');
    await expect(yellowPreview).toBeVisible({ timeout: 20_000 });
    await expect(yellowPreview).toContainText('本地检查通过', { timeout: 20_000 });

    await form.getByRole('button', { name: '下一步' }).click();

    const publish = frame.locator('.publish-check-modal').last();
    await expect(publish).toBeVisible({ timeout: 10_000 });
    await publish.locator('[data-compatibility-choice="yes"]').click();
    await publish.locator('[data-conflict-choice="no"]').click();

    const confirm = publish.locator('[data-publish-check-confirm]');
    await expect(confirm).toBeVisible({ timeout: 10_000 });
    await expect(confirm).toBeEnabled();
    await confirm.click();

    await expect(form).toHaveCount(0, { timeout: 30_000 });
    expect(counts.projectCreates).toBeGreaterThan(beforeBlockedCreates);

    const mine = await localApi('/api/my/projects');
    const created = (mine?.projects || []).find(item => item?.name === uniqueName) || null;
    expect(created?.id).toBeTruthy();
    expect(created.status).toBe('pending');
    createdProjectId = created.id;

    await frame.locator('#userMenuTrigger').click();
    await expect(frame.locator('#adminPanelBtn')).toBeVisible({ timeout: 10_000 });
    await frame.locator('#adminPanelBtn').click();

    const queue = frame.locator('.admin-review-overlay').last();
    await expect(queue).toBeVisible({ timeout: 15_000 });

    const card = queue.locator('[data-review-card]').filter({ hasText: uniqueName }).first();
    await expect(card).toBeVisible({ timeout: 15_000 });
    await card.click();

    let detail = frame.locator('.admin-review-detail-overlay').last();
    await expect(detail).toBeVisible({ timeout: 15_000 });
    await expect(detail.locator('.admin-code-check--yellow')).toBeVisible({ timeout: 15_000 });

    async function assertAuditGroups(target) {
      const sectionText = (await target.locator('.admin-code-check').innerText()).replace(/\s+/g, ' ');

      for (const [entryName, ruleId] of [
        ['QA-M4-主动网络', 'M4'],
        ['QA-U2-外部来源', 'U2'],
        ['QA-AH1-编码构造', 'AH1'],
      ]) {
        const group = target.locator('[data-audit-entry]').filter({ hasText: entryName }).first();
        await expect(group).toBeVisible({ timeout: 10_000 });
        await expect(group).toContainText('[' + ruleId + ']');
      }

      expect(sectionText).toContain('阻断 0');
      expect(sectionText).toContain('首次确认 3');
      return sectionText;
    }

    await assertAuditGroups(detail);

    const screenshotPath = testInfo.outputPath('testlab-audit-yellow.png');
    await page.screenshot({ path: screenshotPath, fullPage: true });
    await testInfo.attach('testlab-audit-yellow', {
      path: screenshotPath,
      contentType: 'image/png',
    });

    await detail.getByRole('button', { name: '刷新并重新检查' }).click();

    detail = frame.locator('.admin-review-detail-overlay').last();
    await expect(detail).toBeVisible({ timeout: 15_000 });
    await expect(detail.locator('.admin-code-check--yellow')).toBeVisible({ timeout: 15_000 });
    await assertAuditGroups(detail);

    expect(counts.preflightWorldbook).toBeGreaterThanOrEqual(1);
    expect(counts.adminReviewDetail).toBeGreaterThanOrEqual(2);
    diagnostics.assertHealthy();
  } finally {
    if (createdProjectId && sessionAuth) {
      await fetch(LOCAL_WORKER + '/api/projects/' + encodeURIComponent(createdProjectId), {
        method: 'DELETE',
        headers: { authorization: sessionAuth },
      }).catch(() => {});
    }
  }
});
