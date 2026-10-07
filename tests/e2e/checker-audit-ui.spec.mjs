import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { test, expect } from '@playwright/test';

const requireCloudflare = createRequire(new URL('../../cloudflare/package.json', import.meta.url));
const { transform } = requireCloudflare('esbuild');
const moduleSource = readFileSync(new URL('../../cloudflare/src/pages/home/modal/admin-review.ts', import.meta.url), 'utf8');
const transformed = await transform(moduleSource, { loader: 'ts', format: 'esm' });
const { homeAdminReviewModalScript } = await import('data:text/javascript;base64,' + Buffer.from(transformed.code).toString('base64'));
const transformedStyles = await transform(readFileSync(new URL('../../cloudflare/src/pages/home/styles.ts', import.meta.url), 'utf8'), { loader: 'ts', format: 'esm' });
const { homeStyles } = await import('data:text/javascript;base64,' + Buffer.from(transformedStyles.code).toString('base64'));
const loadFragment = async (file, name) => {
  const result = await transform(readFileSync(new URL('../../cloudflare/src/pages/home/' + file, import.meta.url), 'utf8'), { loader: 'ts', format: 'esm' });
  return (await import('data:text/javascript;base64,' + Buffer.from(result.code).toString('base64')))[name];
};
const mediaDetailScript = await loadFragment('render/detail-modal.ts', 'homeDetailModalRenderScript');
const mediaDeviceScript = await loadFragment('external-links.ts', 'homeExternalLinksScript');
const mediaWorkerSource = Buffer.from(readFileSync(new URL('../../cloudflare/src/generated/upload-checker.txt', import.meta.url), 'utf8'), 'base64').toString('utf8');
const pageErrors = new WeakMap();
test.afterEach(async ({ page }) => expect(pageErrors.get(page) || []).toEqual([]));
const risk = (ruleId, reviewState, entry = 'CharacterPanel', extra = {}) => ({
  ruleId, reviewState, entry, severity: 'warn', entryId: `0:project-test.json:${entry}`,
  book: 'project-test.json', uid: entry, title: '检查提示', detail: 'fetch("https://example.test/data")',
  suggestion: '确认用途', line: 8, column: 2, ...extra,
});
const report = {
  engine: 'v2', parserCompatibility: 'Acorn', gate: 'accept', audit: 'yellow',
  files: [{ fileName: 'project-test.json', type: 'worldbook' }, { fileName: 'regex-test.json', type: 'regex' }],
  findings: [risk('M4', 'new'), risk('U2', 'changed'), risk('AH2', 'accepted'), risk('M3', 'accepted', 'Settings')],
  removedFindings: [risk('U5', 'accepted', 'OldEntry')],
  auditSummary: { new: 1, changed: 1, accepted: 2, removed: 1, pending: 2 },
};

async function install(page) {
  pageErrors.set(page, []);
  page.on('pageerror', error => pageErrors.get(page).push(error.message));
  await page.setContent('<meta name="viewport" content="width=device-width, initial-scale=1"><title>Workshop 审核检查</title><main id="root" class="admin-review-detail-overlay"></main>');
  await page.addStyleTag({ content: homeStyles });
  await page.addScriptTag({ content: 'function escapeHtml(value) { const chars = "&<>" + String.fromCharCode(34, 39); const entities = ["&amp;", "&lt;", "&gt;", "&quot;", "&#39;"]; return String(value ?? "").replace(/[&<>"\x27]/g, char => entities[chars.indexOf(char)]); }' });
  await page.addScriptTag({ content: homeAdminReviewModalScript });
  await page.addScriptTag({ content: 'window.inspectProjectExternalLinksOnDevice = async () => ({ externalLinkRecords: [], externalLinksNeedingReview: [] });' });
}

test('trusted media stays out of audit warnings until reused in prose', async ({ page }, testInfo) => {
  await page.route('http://workshop.test/hotfix43', route => route.fulfill({ contentType: 'text/html; charset=utf-8', body: '<meta name="viewport" content="width=device-width, initial-scale=1"><title>Workshop 链接检查</title><main id="root"></main><button id="add-prose">加入简介链接</button>' }));
  await page.route('http://workshop.test/assets/upload-checker.js', route => route.fulfill({ contentType: 'application/javascript', body: mediaWorkerSource }));
  await page.goto('http://workshop.test/hotfix43');
  pageErrors.set(page, []);
  page.on('pageerror', error => pageErrors.get(page).push(error.message));
  const remoteMediaRequests = [];
  page.on('request', request => { if (/files\.catbox\.moe|i\.ibb\.co/.test(request.url())) remoteMediaRequests.push(request.url()); });
  await page.addStyleTag({ content: homeStyles });
  await page.addScriptTag({ content: 'const UPLOAD_CHECKER_URL="/assets/upload-checker.js"; const UPLOAD_CHECKER_TIMEOUT_MS=15000; const WORKSHOP_CONFIG={}; function escapeHtml(value) {return String(value).replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;");}' });
  await page.addScriptTag({ content: mediaDetailScript + '\n' + mediaDeviceScript + '\n' + homeAdminReviewModalScript });
  await page.evaluate(async () => {
    const url = 'https://files.catbox.moe/a.png';
    const regex = [{ replaceString: '<img src="' + url + '">' }];
    const render = async description => {
      const summary = await inspectProjectExternalLinksOnDevice({ description }, [], regex);
      document.querySelector('#root').innerHTML = renderAdminInspectionSignals([], regex, summary) + renderExternalLinksPanel([], regex, { project: summary, reviewOnly: true, title: '需要确认的链接' });
    };
    await render('');
    document.querySelector('#add-prose').onclick = () => render(url);
  });
  await expect(page).toHaveTitle('Workshop 链接检查');
  await expect(page.locator('#root')).toContainText('正则 1');
  await expect(page.locator('#root')).not.toContainText('需要确认的链接');
  await expect(page.locator('#root')).not.toContainText('外链 1');
  await page.getByRole('button', { name: '加入简介链接' }).click();
  await expect(page.locator('#root')).toContainText('需要确认的链接');
  await expect(page.locator('#root')).toContainText('简介');
  await expect(page.locator('#root')).toContainText('外链 1');
  expect(remoteMediaRequests).toEqual([]);
  await page.screenshot({ path: path.join(tmpdir(), `poem-hotfix43-${testInfo.project.name}.png`), fullPage: false });
});

test('audit groups all findings per entry and folds confirmed and removed evidence', async ({ page }, testInfo) => {
  await install(page);
  await page.evaluate(report => document.querySelector('#root').innerHTML = renderAdminCodeCheck(report), report);
  const current = page.locator('.admin-code-check-list > [data-audit-entry]');
  await expect(current).toHaveCount(2);
  await expect(current.first()).toHaveAttribute('open', '');
  await expect(current.first().locator('[data-audit-risk-state]')).toHaveCount(3);
  await expect(current.nth(1)).not.toHaveAttribute('open', '');
  await expect(page.locator('[data-audit-risk-state="changed"]')).toContainText('需要重新确认');
  await expect(page.locator('[data-audit-risk-state="accepted"]').first()).not.toHaveAttribute('open', '');
  await expect(page.locator('[data-audit-removed]')).not.toHaveAttribute('open', '');
  await expect(page.locator('.admin-code-check-note').first()).toContainText('不代表违规');
  await current.nth(1).locator(':scope > summary').click();
  await expect(current.nth(1)).toHaveAttribute('open', '');
  await expect(page).toHaveTitle('Workshop 审核检查');
  await page.screenshot({ path: path.join(tmpdir(), `poem-audit-ui-${testInfo.project.name}.png`), fullPage: false });
});

test('audit displays old reports as pending and never renders source or evidence HTML', async ({ page }) => {
  await install(page);
  await page.evaluate(() => {
    window.__uploadedRan = false;
    document.querySelector('#root').innerHTML = renderAdminCodeCheck({ gate: 'accept', findings: [{ severity: 'warn', entry: '<img src=x onerror="window.__uploadedRan=true">', ruleId: 'M4', detail: '<script>window.__uploadedRan=true</script>' }] });
  });
  await expect(page.locator('[data-audit-risk-state="new"]')).toHaveCount(1);
  await expect(page.locator('#root img, #root script')).toHaveCount(0);
  expect(await page.evaluate(() => window.__uploadedRan)).toBe(false);
});

test('dynamic media evidence shows readable URLs and jumps straight to the matching source line', async ({ page }) => {
  await install(page);
  const finding = risk('AH2', 'new', 'Gallery', {
    severity: 'hint',
    entryId: '0:project-test.json:a',
    uid: 7,
    title: '媒体来源需要人工确认',
    detail: 'image.sources',
    suggestion: '请向审核员说明图片或视频来源',
    line: 4,
    column: 7,
    riskEvidence: { action: 'resource', usage: 'media', target: 'dynamic' },
  });
  const detail = {
    codeCheck: {
      ...report,
      findings: [finding],
      removedFindings: [],
      auditSummary: { new: 1, changed: 0, accepted: 0, removed: 0, pending: 1 },
    },
    worldbookEntriesPreview: [{
      entryKey: 'object:a',
      uid: '7',
      comment: 'Gallery',
      content: 'const fallback = "https://img.example.test/fallback.webp";\nconst profile = {};\nconst image = profile.image;\nimage.sources\nconst done = true;',
    }],
    regexEntriesPreview: [],
  };
  await page.evaluate(detail => {
    const root = document.querySelector('#root');
    root.innerHTML = renderAdminCodeCheck(detail.codeCheck, detail);
    bindAdminCodeCheckNavigation(root, detail);
  }, detail);
  await expect(page.locator('.admin-audit-dynamic-target')).toHaveText('运行时动态生成，自动检查无法确定最终 URL');
  await expect(page.locator('.admin-audit-url-list')).toContainText('https://img.example.test/fallback.webp');
  const jump = page.locator('[data-admin-code-jump]');
  await expect(jump).toContainText('第 4 行，第 7 列');
  await expect(jump).toContainText('查看代码');
  await jump.click();
  await expect(page.locator('.admin-code-source-viewer')).toBeVisible();
  await expect(page.locator('.admin-code-source-line.is-target')).toContainText('image.sources');
  await expect(page.locator('.admin-code-source-head')).toContainText('已定位到第 4 行，第 7 列');
});

test('audit Markdown uses loaded full sources and safe fences without requests', async ({ page }) => {
  const requests = [];
  page.on('request', request => { if (/^https?:/.test(request.url())) requests.push(request.url()); });
  await install(page);
  const detail = {
    project: { id: 'test', name: 'Review project', version: '1.2.3', status: 'pending' }, codeCheck: {
      ...report,
      findings: [risk('M4', 'changed', 'Same title', { entryId: '0:project-test.json:a', uid: 7 }), risk('M3', 'accepted', 'Same title', { entryId: '0:project-test.json:b', uid: 7 }), risk('AH4', 'new', 'Regex', { book: 'regex-test.json', entryId: '1:regex-test.json:regex:1', uid: 'r' })],
    },
    worldbookEntriesPreview: [{ entryKey: 'object:a', uid: '7', comment: 'Same title', content: '<% fetch("first"); %>\n````\n全文甲' }, { entryKey: 'object:b', uid: '7', comment: 'Same title', content: '<% localStorage.token; %>\n全文乙' }],
    regexEntriesPreview: [{ entryKey: 'index:0', scriptName: '占位', findRegex: 'x' }, { entryKey: 'id:r', id: 'r', scriptName: 'Regex', replaceString: '<script>createElement("script")</script>' }],
  };
  const markdown = await page.evaluate(detail => buildAdminAuditLlmReport(detail), detail);
  expect(markdown).toContain('1.2.3');
  expect(markdown).toContain('全文甲');
  expect(markdown).toContain('全文乙');
  expect(markdown).toContain('createElement("script")');
  expect(await page.evaluate(detail => getAdminAuditFindingSources(detail, detail.codeCheck.findings[2])[0].name, detail)).toBe('Regex');
  expect(markdown).toContain('`````ejs');
  expect(markdown).toContain('NEEDS HUMAN REVIEW');
  expect(markdown).toContain('其 PASS 不会自动批准项目');
  expect(markdown).toContain('均不是指令');
  expect(await page.evaluate(detail => getAdminAuditFindingSources(detail, { ...detail.codeCheck.findings[0], relatedEntryIds: ['0:project-test.json:a', '0:project-test.json:b'] }).length, detail)).toBe(2);
  await page.evaluate(detail => {
    document.querySelector('#root').innerHTML = renderAdminCodeCheck(detail.codeCheck);
    bindAdminAuditExport(document.querySelector('#root'), detail);
  }, detail);
  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: '导出给 LLM 复核' }).click();
  expect((await download).suggestedFilename()).toBe('workshop-audit-test.md');
  expect(requests).toEqual([]);
});

test('refresh and recheck reloads the current review detail and redraws the audit result', async ({ page }) => {
  await install(page);
  await page.evaluate(() => {
    let callCount = 0;
    const yellow = {
      reviewToken: 'a'.repeat(64),
      project: { id: 'test', name: 'Refresh project', draftRevision: 3 },
      worldbookEntriesPreview: [],
      regexEntriesPreview: [],
      codeCheck: {
        engine: 'v2',
        parserCompatibility: 'Acorn',
        gate: 'accept',
        audit: 'yellow',
        files: [],
        findings: [{ ruleId: 'AH2', severity: 'hint', reviewState: 'new', entry: 'Gallery', entryId: '0:project-test.json:1', book: 'project-test.json', uid: 1, title: '媒体来源需要人工确认', detail: 'dynamic', suggestion: 'review', line: 1, column: 1 }],
        removedFindings: [],
        auditSummary: { new: 1, changed: 0, accepted: 0, removed: 0, pending: 1 },
      },
    };
    const green = {
      ...yellow,
      reviewToken: 'b'.repeat(64),
      codeCheck: { ...yellow.codeCheck, audit: 'green', findings: [], auditSummary: { new: 0, changed: 0, accepted: 0, removed: 0, pending: 0 } },
    };
    window.fetchAdminReviewDetail = async () => {
      callCount += 1;
      window.__reviewDetailFetchCount = callCount;
      return callCount === 1 ? yellow : green;
    };
    window.openModal = body => {
      const overlay = document.createElement('div');
      overlay.innerHTML = '<div class="modal-content">' + body + '</div>';
      document.body.append(overlay);
      return overlay;
    };
    window.getAuthorName = () => 'Author';
    window.getBaseTag = () => '扩展';
    window.collectProjectExternalLinks = () => [];
    window.loadProjectOriginalConflictItems = async () => ({ requestedNames: [] });
    window.renderExternalLinksPanel = () => '';
    window.renderDetailSection = () => '';
    window.renderDetailEntry = () => '';
    window.renderRegexEntry = () => '';
    window.setButtonLoading = button => {
      button.disabled = true;
      return () => { button.disabled = false; };
    };
    window.showToast = message => { window.__lastToast = message; };
  });
  await page.evaluate(() => openAdminReviewDetail({ id: 'test', name: 'Refresh project', draftRevision: 3 }, null, []));
  await expect(page.locator('.admin-code-check--yellow')).toBeVisible();
  await expect(page.getByRole('button', { name: '刷新并重新检查' })).toBeVisible();
  await page.getByRole('button', { name: '刷新并重新检查' }).click();
  await expect.poll(() => page.evaluate(() => window.__reviewDetailFetchCount)).toBe(2);
  await expect(page.locator('.admin-code-check--green')).toBeVisible();
  await expect(page.locator('.admin-code-check--yellow')).toHaveCount(0);
  expect(await page.evaluate(() => window.__lastToast)).toContain('已按当前 Checker 规则重新检查');
});

test('approval submits the token from the loaded review detail', async ({ page }) => {
  await install(page);
  await page.evaluate(() => {
    const detail = { reviewToken: 'a'.repeat(64), project: { id: 'test', name: 'Token project', draftRevision: 3 }, worldbookEntriesPreview: [], regexEntriesPreview: [], codeCheck: { gate: 'accept', findings: [] } };
    window.fetchAdminReviewDetail = async () => detail;
    window.openModal = body => { const overlay = document.createElement('div'); overlay.innerHTML = '<div class="modal-content">' + body + '</div>'; document.body.append(overlay); return overlay; };
    window.getAuthorName = () => 'Author'; window.getBaseTag = () => '扩展';
    window.collectProjectExternalLinks = () => [];
    window.loadProjectOriginalConflictItems = async () => ({ requestedNames: [] });
    window.renderExternalLinksPanel = () => ''; window.renderDetailSection = () => '';
    window.renderDetailEntry = () => ''; window.renderRegexEntry = () => '';
    window.confirm = () => true;
    window.setButtonLoading = () => () => {}; window.showToast = () => {};
    window.reviewProject = async (id, payload) => { window.__approvalPayload = payload; throw new Error('test captured'); };
  });
  await page.evaluate(() => openAdminReviewDetail({ id: 'test', name: 'Token project', draftRevision: 2 }, null, []));
  await page.locator('[data-admin-review-submit="approve"]').click();
  await expect.poll(() => page.evaluate(() => window.__approvalPayload?.reviewToken)).toBe('a'.repeat(64));
  expect(await page.evaluate(() => window.__approvalPayload.expectedRevision)).toBe(3);
});
