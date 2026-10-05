import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { createHmac } from 'node:crypto';

test.use({ bypassCSP: true }); // Inject a minimal harness; the checker asset and API are real localhost services.
async function module(relative) {
  return import('data:text/javascript;base64,' + Buffer.from(readFileSync(relative, 'utf8')).toString('base64'));
}
async function harness(page) {
  await page.goto('http://127.0.0.1:8791');
  await page.setContent('<meta name="viewport" content="width=device-width, initial-scale=1"><main id="overlay"><form id="projectForm"><input id="fileInput" type="file"><input id="regexInput" type="file" multiple><input id="coverInput" type="file"><div id="fileDrop">选择世界书</div><div id="regexDrop">选择正则</div><div id="coverDrop">选择图片</div><div id="worldbookUploadPreview"></div><div id="regexUploadPreview"></div><div id="coverUploadPreview"></div><button type="button" id="submit">提交检查</button><button type="button" id="responsive">页面响应</button><output id="clicks">0</output></form></main>');
  const { homeApiScript } = await module('cloudflare/src/pages/home/api.ts');
  const { homeUploadPreviewScript } = await module('cloudflare/src/pages/home/upload-preview.ts');
  const { homeProjectEditorModalScript } = await module('cloudflare/src/pages/home/modal/project-editor.ts');
  const { homeStyles } = await module('cloudflare/src/pages/home/styles.ts');
  const revision = JSON.parse(readFileSync('cloudflare/src/generated/upload-checker-revision.json')).revision;
  const encode = value => Buffer.from(JSON.stringify(value)).toString('base64url');
  const now = Math.floor(Date.now() / 1000), head = encode({ alg: 'HS256', typ: 'JWT' });
  const payload = encode({ userId: 'cw_browser_content_qa', username: 'Browser QA', avatar: '', isAdmin: false, iat: now, exp: now + 3600 });
  const authJwt = `${head}.${payload}.${createHmac('sha256', 'cw-local-api-test').update(`${head}.${payload}`).digest('base64url')}`;
  await page.addStyleTag({ content: homeStyles });
  await page.addScriptTag({ content: `const TOKEN_KEY=['local','content','qa'].join('-');localStorage.setItem(TOKEN_KEY,${JSON.stringify(authJwt)}); const WORKSHOP_LIMITS={projectUploadBytes:10485760,projectUploadLabel:'10MB'};const PROJECT_TAXONOMY={};const PROJECT_CONTENT_POLICY={'系统核心':{required:['worldbook']}};const UPLOAD_CHECKER_URL='/assets/upload-checker.js?v=${revision}';const UPLOAD_CHECKER_TIMEOUT_MS=30000;function escapeHtml(v){const el=document.createElement('div');el.textContent=String(v??'');return el.innerHTML;}function renderDetailSection(label,icon,entries){return '<p>'+entries.length+' 条内容</p>';}function renderDetailEntry(){}function renderRegexEntry(){}function showToast(){}function parseTagsInput(){return [];}\n` + homeApiScript + '\n' + homeUploadPreviewScript + '\n' + homeProjectEditorModalScript + `\nconst formHarness=prepareProjectForm(document.querySelector('#overlay'));document.querySelector('#submit').onclick=()=>formHarness.checkSubmission().then(()=>document.body.dataset.submission='ok',()=>document.body.dataset.submission='rejected');document.querySelector('#responsive').onclick=()=>document.querySelector('#clicks').textContent=String(Number(document.querySelector('#clicks').textContent)+1);` });
}
const upload = scripts => ({ name: 'scripts.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(scripts)) });
test('browser checks locally; M1 fails server submission with a reason', async ({ page }, testInfo) => {
  await harness(page);
  let serverChecks = 0;
  page.on('request', request => { if (request.url().includes('/api/projects/preflight/')) serverChecks++; });
  await page.locator('#regexInput').setInputFiles(upload([{ id: 'eval', scriptName: '动态代码示例', findRegex: 'x', replaceString: '<script>eval("1")</script>' }]));
  await expect(page.locator('#regexUploadPreview')).toContainText('本地检查通过，提交时还会再次检查');
  expect(serverChecks).toBe(0);
  await page.locator('#submit').click();
  await expect(page.locator('body')).toHaveAttribute('data-submission', 'rejected');
  await expect(page.locator('#regexUploadPreview')).toContainText('eval');
  await expect(page.locator('#regexUploadPreview')).toContainText('改为明确的函数调用');
  expect(serverChecks).toBe(1);
  await page.screenshot({ path: testInfo.outputPath('two-phase-rejected.png'), fullPage: true });
});
test('200 scripts run in a background thread and oversized code gets an actionable local failure', async ({ page }) => {
  await harness(page);
  const scripts = Array.from({ length: 200 }, (_, i) => ({ id: String(i), scriptName: '脚本 ' + i, findRegex: 'x', replaceString: '<script>(()=>{const local=1;return local;})();</script>' }));
  await page.locator('#regexInput').setInputFiles(upload(scripts));
  await page.locator('#responsive').click();
  await expect(page.locator('#clicks')).toHaveText('1');
  await expect(page.locator('#regexUploadPreview')).toContainText('本地检查通过');
  await page.locator('#submit').click();
  await expect(page.locator('body')).toHaveAttribute('data-submission', 'ok');
  await page.evaluate(() => regexInput._fileDropController.clear());
  await page.locator('#regexInput').setInputFiles(upload([{ id: 'large', scriptName: '过大脚本', findRegex: 'x', replaceString: '<script>' + '0;'.repeat(40000) + '</script>' }]));
  await expect(page.locator('#regexUploadPreview')).toContainText('处理上限');
  await expect(page.locator('#regexUploadPreview')).toContainText('减少本次提交');
  await expect(page.locator('#regexUploadPreview')).not.toContainText('本地检查通过');
});
