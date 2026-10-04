import { test, expect } from '@playwright/test';
import { pathToFileURL } from 'node:url';
import path from 'node:path';
import { readFileSync } from 'node:fs';

async function sourceModule(relativePath) {
  return import('data:text/javascript;base64,' + Buffer.from(readFileSync(path.resolve(relativePath), 'utf8')).toString('base64'));
}

const toolUrl = pathToFileURL(path.resolve('util/ejs-preflight.html')).href;

async function loadEntries(page, entries, name = 'case.json') {
  await page.goto(toolUrl);
  await page.locator('#fileInput').setInputFiles({
    name,
    mimeType: 'application/json',
    buffer: Buffer.from(JSON.stringify({ entries })),
  });
  return page.locator('#findings');
}

async function loadBooks(page, books) {
  await page.goto(toolUrl);
  await page.locator('#fileInput').setInputFiles(
    books.map(({ name, entries }) => ({
      name,
      mimeType: 'application/json',
      buffer: Buffer.from(JSON.stringify({ entries })),
    })),
  );
  return page.locator('#findings');
}

async function loadRegex(page, script, name = 'regex-case.json') {
  await page.goto(toolUrl);
  await page.locator('#fileInput').setInputFiles({
    name,
    mimeType: 'application/json',
    buffer: Buffer.from(JSON.stringify(script)),
  });
  return page.locator('#findings');
}

test('offline coworker fixture selftest passes', async ({ page }) => {
  await page.goto(toolUrl + '?selftest=1');
  await expect(page).toHaveTitle(/SELFTEST PASS/);
  await expect(page.locator('#selftest')).toHaveText('SELFTEST PASS');
});

test('v2 reports preserve uploader controls, exports and admin findings', async ({ page }, testInfo) => {
  const errors=[];
  page.on('pageerror', error=>errors.push(error.message));
  await loadEntries(page,{1:{uid:1,comment:'修改条目',content:'<% const exposed = 1; %>'}});
  await expect(page.locator('#certSummary')).toContainText('检查版本：v2');
  const report=await page.evaluate(()=>window.EjsPreflight.getReport());
  const {homeUploadPreviewScript}=await sourceModule('cloudflare/src/pages/home/upload-preview.ts');
  const {homeAdminReviewModalScript}=await sourceModule('cloudflare/src/pages/home/modal/admin-review.ts');
  const {homeStyles}=await sourceModule('cloudflare/src/pages/home/styles.ts');
  await page.setContent('<main class="container"><div id="upload" class="upload-preview"><div class="upload-preview-summary"></div></div><div id="admin"></div></main>');
  await page.addStyleTag({content:homeStyles});
  await page.addScriptTag({content:'function escapeHtml(value){return String(value??" ").replace(/[&<>"\']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",\'"\':"&quot;","\'":"&#39;"}[c]))} async function copyTextToClipboard(text){window.copiedText=text;return true} function showToast(){}\n'+homeUploadPreviewScript+'\n'+homeAdminReviewModalScript});
  await page.evaluate(report=>{
    const prepared={entries:[{uid:1,comment:'修改条目',content:'<% const exposed = 1; %>'}]};
    renderUploadPreflightStatus(document.querySelector('#upload'),'error','检查未通过',report,prepared,'worldbook');
    document.querySelector('#admin').innerHTML=renderAdminCodeCheck(report);
  },report);
  await expect(page.locator('#upload')).toContainText('检查版本：v2');
  await expect(page.locator('#admin')).toContainText('检查版本：v2');
  await expect(page.locator('#admin')).toContainText('[L2]');
  await page.locator('[data-upload-copy-group]').click();
  expect(await page.evaluate(()=>window.copiedText)).toContain('<% const exposed = 1; %>');
  await page.locator('[data-upload-copy-all]').click();
  expect(await page.evaluate(()=>window.copiedText)).toContain('[L2]');
  const downloadPromise=page.waitForEvent('download');
  await page.locator('[data-upload-export-report]').click();
  const download=await downloadPromise;
  const exported=readFileSync(await download.path(),'utf8');
  expect(exported).toContain('检查版本：v2');
  expect(exported).toContain('语法检查依据：EJS 3.1.9');
  expect(exported).toContain('[L2]');
  expect(errors).toEqual([]);
  await page.screenshot({path:testInfo.outputPath('v2-upload-admin.png'),fullPage:true});
});

test('plain-text links cover unknown, HTTP, IPv4 and IPv6 without EJS', async ({ page }) => {
  const findings = await loadEntries(page, {
    1: { uid: 1, comment: 'official', content: 'https://testingcf.jsdelivr.net/gh/StageDog/tavern_resource/dist/util/mvu_zod.js' },
    2: { uid: 2, comment: 'unknown', content: 'https://ejs-fixture.example.com/tool.js' },
    3: { uid: 3, comment: 'http-upper', content: 'HTTP://ejs-fixture.example.com/tool.js' },
    4: { uid: 4, comment: 'ipv4', content: 'https://203.0.113.10/ejs-fixture.js' },
    5: { uid: 5, comment: 'ipv6', content: 'HTTPS://[2001:db8::1]/ejs-fixture.js' },
    6: { uid: 6, comment: 'protocol-relative-third-party', content: '//cdn.other-example.net/tool.js' },
    7: { uid: 7, comment: 'protocol-relative-official', content: '//testingcf.jsdelivr.net/gh/StageDog/tavern_resource/dist/util/mvu_zod.js' },
    8: { uid: 8, comment: 'plain-comment', content: '<% { const x = 1; // this is only a comment\n void x; } %>' },
  }, 'links.json');

  await expect(findings).not.toContainText('official');
  await expect(findings).toContainText('[U2]');
  await expect(findings).toContainText('[U3]');
  await expect(findings).toContainText('[U4]');
  await expect(page.locator('.finding').filter({ hasText: 'ipv6' })).toContainText('[U4]');
  await expect(page.locator('.finding').filter({ hasText: 'protocol-relative-third-party' })).toContainText('[U2]');
  await expect(page.locator('.finding').filter({ hasText: 'protocol-relative-official' })).toHaveCount(0);
  await expect(page.locator('.finding').filter({ hasText: 'plain-comment' }).filter({ hasText: '[U2]' })).toHaveCount(0);
  await expect(page.locator('#mEntries')).toHaveText('8');
  await expect(page.locator('#mStatus')).toHaveText('需确认');
});

test('U2 third-party domains are deduplicated across entries and files', async ({ page }) => {
  await loadBooks(page, [
    {
      name: 'book-a.json',
      entries: {
        1: { uid: 1, comment: 'same-host-a1', content: 'https://shared-third-party.example.com/a.js' },
        2: { uid: 2, comment: 'same-host-a2', content: 'https://shared-third-party.example.com/b.png' },
      },
    },
    {
      name: 'book-b.json',
      entries: {
        1: { uid: 1, comment: 'same-host-b1', content: 'https://shared-third-party.example.com/c.css' },
        2: { uid: 2, comment: 'other-host-b2', content: 'https://other-third-party.example.net/d.js' },
      },
    },
  ]);

  const u2 = page.locator('.finding').filter({ hasText: '[U2]' });
  await expect(u2).toHaveCount(2);
  await expect(u2.filter({ hasText: 'shared-third-party.example.com' })).toHaveCount(1);
  await expect(u2.filter({ hasText: 'other-third-party.example.net' })).toHaveCount(1);
});

test('parse errors are explicit and include repair fields', async ({ page }) => {
  await loadEntries(page, {
    1: { uid: 1, comment: 'broken-ejs', content: '<% const broken = ; %>' },
  }, 'broken.json');

  const finding = page.locator('.finding').filter({ hasText: 'broken-ejs' }).first();
  await expect(finding).toContainText('[EJS-PARSE]');
  await expect(finding).toContainText('位置：第 1 行，第 19 列');
  await expect(finding).toContainText('怎么处理：');
  await expect(page.locator('#mStatus')).toHaveText('未通过');
});

test('Workshop policy blocks unisolated top-level declarations but accepts local blocks and loop headers', async ({ page }) => {
  await loadEntries(page, {
    1: { uid: 1, comment: 'ordinary-top', content: '<% let one = 1; const two = 2; %><%= one + two %>' },
    2: { uid: 2, comment: 'safe-block', content: '<% { let state = {}; const step = {}; state = step; } %>' },
    3: { uid: 3, comment: 'loop-only', content: '<% for (let i = 0; i < 3; i++) { void i; } %>' },
    4: { uid: 4, comment: 'destructure-top', content: '<% const { alpha } = { alpha: 1 }; %>' },
    5: { uid: 5, comment: 'multi-top', content: '<% const first = 1, second = 2; %>' },
  });

  await expect(page.locator('.finding').filter({ hasText: 'ordinary-top' }).filter({ hasText: '[L2]' })).toHaveCount(2);
  await expect(page.locator('.finding').filter({ hasText: 'safe-block' }).filter({ hasText: '[L2]' })).toHaveCount(0);
  await expect(page.locator('.finding').filter({ hasText: 'safe-block' }).filter({ hasText: '[L4]' })).toHaveCount(0);
  await expect(page.locator('.finding').filter({ hasText: 'loop-only' }).filter({ hasText: '[L2]' })).toHaveCount(0);
  await expect(page.locator('.finding').filter({ hasText: 'destructure-top' }).filter({ hasText: '[L2]' })).toHaveCount(1);
  await expect(page.locator('.finding').filter({ hasText: 'multi-top' }).filter({ hasText: '[L2]' })).toHaveCount(1);
  await expect(page.locator('#mStatus')).toHaveText('未通过');
});

test('multi and destructuring declarations register every binding without hiding real implicit writes', async ({ page }) => {
  await loadEntries(page, {
    1: { uid: 1, comment: 'multi-local', content: '<% { let first = 1, second = 2; second = 3; void first; } %>' },
    2: { uid: 2, comment: 'object-local', content: '<% { let { alpha = 1, source: alias = 2, nested: { gamma }, ...rest } = sourceObj; alpha = 3; alias = 4; gamma = 5; rest = {}; } %>' },
    3: { uid: 3, comment: 'array-local', content: '<% { let [head = 1, , tail, ...others] = sourceList; head = 2; tail = 3; others = []; } %>' },
    4: { uid: 4, comment: 'real-leak', content: '<% { let first = (declarationLeak = 1), second = 2; void first; void second; } %>' },
    5: { uid: 5, comment: 'multi-top-a', content: '<% const uniqueA = 1, sharedSecond = 2; %>' },
    6: { uid: 6, comment: 'multi-top-b', content: '<% const uniqueB = 1, sharedSecond = 3; %>' },
    7: { uid: 7, comment: 'destructure-top-a', content: '<% const { sharedDestructured } = sourceA; %>' },
    8: { uid: 8, comment: 'destructure-top-b', content: '<% const { value: sharedDestructured } = sourceB; %>' },
    9: { uid: 9, comment: 'var-local', content: '<% { function read(){ var firstVar = 1, secondVar = 2; var { thirdVar = 3 } = sourceVar; secondVar = 4; thirdVar = 5; return firstVar; } void read(); } %>' },
    10: { uid: 10, comment: 'for-of-destructure', content: '<% for (let { itemA, itemB } of sourceItems) { itemA = 1; itemB = 2; } %>' },
  });

  for (const name of ['multi-local', 'object-local', 'array-local', 'var-local', 'for-of-destructure']) {
    await expect(page.locator('.finding').filter({ hasText: name }).filter({ hasText: '[L4]' })).toHaveCount(0);
  }
  await expect(page.locator('.finding').filter({ hasText: 'real-leak' }).filter({ hasText: '[L4]' })).toHaveCount(1);
  const multiCollision = page.locator('.finding').filter({ hasText: '[L6]' }).filter({ hasText: 'sharedSecond' });
  await expect(multiCollision).toHaveCount(1);
  await expect(multiCollision).toContainText('multi-top-a');
  await expect(multiCollision).toContainText('multi-top-b');
  const destructureCollision = page.locator('.finding').filter({ hasText: '[L6]' }).filter({ hasText: 'sharedDestructured' });
  await expect(destructureCollision).toHaveCount(1);
  await expect(destructureCollision).toContainText('destructure-top-a');
  await expect(destructureCollision).toContainText('destructure-top-b');
});

test('top-level var is a policy blocker, repeated var is explicit, and local var is only info', async ({ page }) => {
  await loadEntries(page, {
    1: { uid: 1, comment: 'unique-var', content: '<% var uniqueVar = 1; %>' },
    2: { uid: 2, comment: 'repeat-var', content: '<% var repeated = 1; var repeated = 2; %>' },
    3: { uid: 3, comment: 'var-a', content: '<% var sharedVar = "A"; %>' },
    4: { uid: 4, comment: 'var-b', content: '<% var sharedVar = "B"; %>' },
    5: { uid: 5, comment: 'local-var', content: '<% { function f(){ var inside = 1; return inside; } void f(); } %>' },
  });

  await expect(page.locator('.finding').filter({ hasText: 'unique-var' }).filter({ hasText: '[L1]' })).toContainText('阻断');
  await expect(page.locator('.finding').filter({ hasText: 'repeat-var' }).filter({ hasText: '重复声明同名 var' })).toHaveCount(1);
  const collision = page.locator('.finding').filter({ hasText: '[L6]' }).filter({ hasText: 'sharedVar' });
  await expect(collision).toHaveCount(1);
  await expect(collision).toContainText('var-a');
  await expect(collision).toContainText('var-b');
  const local = page.locator('.finding').filter({ hasText: 'local-var' }).filter({ hasText: '[L1]' });
  await expect(local).toHaveCount(1);
  await expect(local).toContainText('信息');
});

test('top-level lexical/function/class declarations are blocked and duplicate names add L6 context', async ({ page }) => {
  await loadEntries(page, {
    1: { uid: 1, comment: 'lex-a', content: '<% const sharedLex = "A"; %>' },
    2: { uid: 2, comment: 'lex-b', content: '<% const sharedLex = "B"; %>' },
    3: { uid: 3, comment: 'fn-a', content: '<% function sameFn(){ return "A"; } %><%= sameFn() %>' },
    4: { uid: 4, comment: 'fn-b', content: '<% function sameFn(){ return "B"; } %><%= sameFn() %>' },
    5: { uid: 5, comment: 'class-top', content: '<% class HelperClass {} %>' },
  });

  await expect(page.locator('.finding').filter({ hasText: '[L2]' }).filter({ hasText: 'lex-a' })).toHaveCount(1);
  await expect(page.locator('.finding').filter({ hasText: '[L2]' }).filter({ hasText: 'lex-b' })).toHaveCount(1);
  await expect(page.locator('.finding').filter({ hasText: '[L3]' }).filter({ hasText: 'fn-a' })).toHaveCount(1);
  await expect(page.locator('.finding').filter({ hasText: '[L3]' }).filter({ hasText: 'fn-b' })).toHaveCount(1);
  await expect(page.locator('.finding').filter({ hasText: '[L3]' }).filter({ hasText: 'class-top' })).toHaveCount(1);
  await expect(page.locator('.finding').filter({ hasText: '[L6]' }).filter({ hasText: 'sharedLex' })).toHaveCount(1);
  await expect(page.locator('.finding').filter({ hasText: '[L6]' }).filter({ hasText: 'sameFn' })).toHaveCount(1);
});

test('block scope and valid @@private isolate declarations while invalid decorators fall back to public scope', async ({ page }) => {
  await loadEntries(page, {
    1: { uid: 1, comment: 'block-a', content: '<% { const isolated = "A"; } %>' },
    2: { uid: 2, comment: 'block-b', content: '<% { const isolated = "B"; } %>' },
    3: { uid: 3, comment: 'private-a', content: '@@private\n<% const privateSame = "A"; %>' },
    4: { uid: 4, comment: 'private-b', content: '@@private\n<% const privateSame = "B"; %>' },
    5: { uid: 5, comment: 'private-leak', content: '@@private\n<% leakedFromPrivate = 99; %>' },
    6: { uid: 6, comment: 'private-leading-blank', content: '\n@@private\n<% const privateLeading = "bad"; %>' },
    7: { uid: 7, comment: 'private-workshop-meta', content: '<%# poem-workshop-meta:v1-start\nproject: demo\npoem-workshop-meta:v1-end %>\n@@private\n<% const privateFromMeta = "bad"; %>' },
    8: { uid: 8, comment: 'late-private-not-decorator', content: 'Visible text first\n@@private\n<% const stillTopLevel = 1; %>' },
    9: { uid: 9, comment: 'split-decorators', content: '@@activate\n\n@@private\n<% const splitPrivate = 1; %>' },
    10: { uid: 10, comment: 'continuous-decorators', content: '@@activate\n@@private\n<% const continuousPrivate = 1; %>' },
  });

  for (const name of ['block-a', 'block-b', 'private-a', 'private-b', 'continuous-decorators']) {
    await expect(page.locator('.finding').filter({ hasText: name }).filter({ hasText: '[L2]' })).toHaveCount(0);
    await expect(page.locator('.finding').filter({ hasText: name }).filter({ hasText: '[L7]' })).toHaveCount(0);
  }
  await expect(page.locator('.finding').filter({ hasText: 'private-leak' }).filter({ hasText: '[L4]' })).toHaveCount(1);
  for (const name of ['private-leading-blank', 'private-workshop-meta', 'late-private-not-decorator', 'split-decorators']) {
    await expect(page.locator('.finding').filter({ hasText: name }).filter({ hasText: '[L7]' })).toHaveCount(1);
    await expect(page.locator('.finding').filter({ hasText: name }).filter({ hasText: '[L2]' })).toHaveCount(1);
  }
  await expect(page.locator('.finding').filter({ hasText: 'private-leading-blank' }).filter({ hasText: '[L7]' })).toContainText('第 2 行，第 1 列');
  await expect(page.locator('.finding').filter({ hasText: 'private-workshop-meta' }).filter({ hasText: '[L7]' })).toContainText('第 4 行，第 1 列');
  const l7Prompt = await page.evaluate(() => {
    const f = window.EjsPreflight.getReport().findings.find(x => x.ruleId === 'L7' && x.entry === 'private-workshop-meta');
    return window.EjsPreflight.buildLlmFixPrompt(f);
  });
  expect(l7Prompt).toContain('[L7]');
  expect(l7Prompt).toContain('先修 L7');
  expect(l7Prompt).toContain('poem-workshop-meta:v1-start');
});

test('implicit env/global writes are strict: bare writes block, explicit globals require review, generic globals block', async ({ page }) => {
  await loadEntries(page, {
    1: { uid: 1, comment: 'env-write', content: '<% userName = "HIJACKED"; %>' },
    2: { uid: 2, comment: 'custom-a', content: '<% customShared = 1; %>' },
    3: { uid: 3, comment: 'custom-b', content: '<% customShared = 2; %>' },
    4: { uid: 4, comment: 'generic-bare', content: '<% result = 3; %>' },
    5: { uid: 5, comment: 'global-unique', content: '<% globalThis.projectSpecificState = "A"; %>' },
    6: { uid: 6, comment: 'global-generic', content: '<% globalThis.state = "B"; %>' },
  });

  await expect(page.locator('.finding').filter({ hasText: 'env-write' }).filter({ hasText: '[L4]' })).toContainText('阻断');
  await expect(page.locator('.finding').filter({ hasText: 'generic-bare' }).filter({ hasText: '[L5]' })).toContainText('阻断');
  await expect(page.locator('.finding').filter({ hasText: 'global-unique' }).filter({ hasText: '[L4]' })).toContainText('确认');
  await expect(page.locator('.finding').filter({ hasText: 'global-generic' }).filter({ hasText: '[L5]' })).toContainText('阻断');
  await expect(page.locator('.finding').filter({ hasText: '[L6]' }).filter({ hasText: 'customShared' })).toHaveCount(1);
});

test('documented explicit global remains review-only until project namespace can be verified', async ({ page }) => {
  await loadEntries(page, {
    1: {
      uid: 1,
      comment: 'documented-global',
      content: '<%\n// Intentional shared state. Owner: this entry.\n// Lifecycle: one render. Cleanup: delete globalThis.documentedState.\nglobalThis.documentedState = 1;\n%>',
    },
  });

  const finding = page.locator('.finding').filter({ hasText: 'documented-global' }).filter({ hasText: '[L4]' });
  await expect(finding).toHaveCount(1);
  await expect(finding).toContainText('确认');
  await expect(page.locator('#mStatus')).toHaveText('需确认');
});

test('ternary and comma implicit assignments are caught', async ({ page }) => {
  await loadEntries(page, {
    1: { uid: 1, comment: 'ternary-write', content: '<% true ? (hiddenGlobal = 1) : 0; %>' },
    2: { uid: 2, comment: 'comma-write', content: '<% (firstGlobal = 1, secondGlobal = 2); %>' },
  });

  await expect(page.locator('.finding').filter({ hasText: 'ternary-write' }).filter({ hasText: '[L4]' })).toHaveCount(1);
  await expect(page.locator('.finding').filter({ hasText: 'comma-write' }).filter({ hasText: '[L4]' })).toHaveCount(2);
});

test('default parameter bindings are not mistaken for implicit globals', async ({ page }) => {
  await loadEntries(page, {
    1: { uid: 1, comment: 'function-default', content: '<% { function pick(value = 1) { return value; } void pick(); } %>' },
    2: { uid: 2, comment: 'arrow-default', content: '<% { const pick = (value = 1) => value; void pick(); } %>' },
    3: { uid: 3, comment: 'destructure-default', content: '<% { function pick({ limit = 3, source: alias = 4 } = {}) { return limit + alias; } void pick(); } %>' },
    4: { uid: 4, comment: 'method-default', content: '<% { const helper = { pick(value = 1) { return value; } }; void helper; } %>' },
    5: { uid: 5, comment: 'initializer-leak', content: '<% { function pick(value = (leakedFromDefault = 1)) { return value; } void pick(); } %>' },
    6: { uid: 6, comment: 'after-parameter-leak', content: '<% { function pick(value = 1) { return value; } value = 2; } %>' },
  });

  for (const name of ['function-default', 'arrow-default', 'destructure-default', 'method-default']) {
    await expect(page.locator('.finding').filter({ hasText: name }).filter({ hasText: '[L4]' })).toHaveCount(0);
    await expect(page.locator('.finding').filter({ hasText: name }).filter({ hasText: '[L5]' })).toHaveCount(0);
  }
  await expect(page.locator('.finding').filter({ hasText: 'initializer-leak' }).filter({ hasText: '[L4]' })).toHaveCount(1);
  await expect(page.locator('.finding').filter({ hasText: 'after-parameter-leak' }).filter({ hasText: '[L4]' })).toHaveCount(1);
});

test('template literal text is masked but executable interpolation stays visible to checks', async ({ page }) => {
  await loadEntries(page, {
    1: { uid: 1, comment: 'template-text-only', content: '<% { const text = `eval("not code") globalThis.fake = 1`; void text; } %>' },
    2: { uid: 2, comment: 'template-eval', content: '<% { const text = `value: ${eval("1 + 1")}`; void text; } %>' },
    3: { uid: 3, comment: 'template-global', content: '<% { const text = `value: ${templateLeak = 1}`; void text; } %>' },
    4: { uid: 4, comment: 'template-expression-string', content: '<% { const text = `${"eval(\\\"still string\\\")"}`; void text; } %>' },
    5: { uid: 5, comment: 'template-nested', content: '<% { const text = `outer ${`inner ${eval("2 + 2")}`}`; void text; } %>' },
    6: { uid: 6, comment: 'template-escaped', content: '<% { const text = `\\${eval("not code")}`; void text; } %>' },
    7: { uid: 7, comment: 'template-regex-brace', content: '<% { const text = `${/}/.test("}") ? eval("3 + 3") : 0}`; void text; } %>' },
  });

  await expect(page.locator('.finding').filter({ hasText: 'template-text-only' }).filter({ hasText: '[M1]' })).toHaveCount(0);
  await expect(page.locator('.finding').filter({ hasText: 'template-text-only' }).filter({ hasText: '[L4]' })).toHaveCount(0);
  await expect(page.locator('.finding').filter({ hasText: 'template-eval' })).toContainText('[M1]');
  await expect(page.locator('.finding').filter({ hasText: 'template-global' })).toContainText('[L4]');
  await expect(page.locator('.finding').filter({ hasText: 'template-expression-string' }).filter({ hasText: '[M1]' })).toHaveCount(0);
  await expect(page.locator('.finding').filter({ hasText: 'template-nested' })).toContainText('[M1]');
  await expect(page.locator('.finding').filter({ hasText: 'template-escaped' }).filter({ hasText: '[M1]' })).toHaveCount(0);
  await expect(page.locator('.finding').filter({ hasText: 'template-regex-brace' })).toContainText('[M1]');
});

test('regex literals do not blind later checks and M5 never hides syntax errors', async ({ page }) => {
  await loadEntries(page, {
    1: { uid: 1, comment: 'regex-then-global', content: '<% { const re = /["\']/; globalThis.appState = 1; } %>' },
    2: { uid: 2, comment: 'broken-loop', content: '<% { while (true) { let broken = ; } } %>' },
  });

  await expect(page.locator('.finding').filter({ hasText: 'regex-then-global' })).toContainText('[L4]');
  await expect(page.locator('.finding').filter({ hasText: 'broken-loop' }).filter({ hasText: '[EJS-PARSE]' })).toHaveCount(1);
  await expect(page.locator('.finding').filter({ hasText: 'broken-loop' }).filter({ hasText: '[M5]' })).toHaveCount(1);
});

test('Function variants and sensitive-storage shapes generalize without property-name false positives', async ({ page }) => {
  await loadEntries(page, {
    1: { uid: 1, comment: 'function-direct', content: "<% { const f = Function('return 1'); } %>" },
    2: { uid: 2, comment: 'function-window', content: "<% { const f = window.Function('return 1'); } %>" },
    3: { uid: 3, comment: 'function-globalThis', content: "<% { const f = globalThis.Function('return 1'); } %>" },
    4: { uid: 4, comment: 'safe-property', content: '<% { const cfg = { localStorage: null }; const v = cfg.localStorage; } %>' },
    5: { uid: 5, comment: 'cookie-bracket', content: "<% { const c = document['cookie']; } %>" },
    6: { uid: 6, comment: 'storage-window', content: "<% { const t = window.localStorage.getItem('qy18_theme'); } %>" },
    7: { uid: 7, comment: 'sensitive-token', content: "<% { const t = localStorage.getItem('discord_token'); } %>" },
    8: { uid: 8, comment: 'author-key', content: "<% { const t = localStorage.getItem('author'); } %>" },
    9: { uid: 9, comment: 'writer-name-key', content: "<% { const t = localStorage.getItem('author_name'); } %>" },
    10: { uid: 10, comment: 'authentication-mode-key', content: "<% { const t = localStorage.getItem('authenticationMode'); } %>" },
    11: { uid: 11, comment: 'tokenizer-key', content: "<% { const t = localStorage.getItem('tokenizer_model'); } %>" },
    12: { uid: 12, comment: 'sensitive-camel-token', content: "<% { const t = localStorage.getItem('accessToken'); } %>" },
    13: { uid: 13, comment: 'sensitive-hyphen-secret', content: "<% { const t = sessionStorage.getItem('api-secret'); } %>" },
    14: { uid: 14, comment: 'sensitive-session-id', content: "<% { const t = localStorage.getItem('session_id'); } %>" },
  });

  await expect(page.locator('.finding').filter({ hasText: 'function-direct' })).toContainText('[M2]');
  await expect(page.locator('.finding').filter({ hasText: 'function-window' })).toContainText('[M2]');
  await expect(page.locator('.finding').filter({ hasText: 'function-globalThis' })).toContainText('[M2]');
  await expect(page.locator('.finding').filter({ hasText: 'safe-property' }).filter({ hasText: '[M3]' })).toHaveCount(0);
  await expect(page.locator('.finding').filter({ hasText: 'cookie-bracket' })).toContainText('[M3]');
  for (const name of ['storage-window', 'author-key', 'writer-name-key', 'authentication-mode-key', 'tokenizer-key']) {
    await expect(page.locator('.finding').filter({ hasText: name }).filter({ hasText: '[M3]' })).toHaveCount(0);
  }
  for (const name of ['sensitive-token', 'sensitive-camel-token', 'sensitive-hyphen-secret', 'sensitive-session-id']) {
    await expect(page.locator('.finding').filter({ hasText: name })).toContainText('[M3]');
  }
});

test('implicit globals are detected beyond the generic-name allowlist', async ({ page }) => {
  await loadEntries(page, {
    1: { uid: 1, comment: 'custom-global', content: '<% myOwnFlag = true; %>' },
    2: { uid: 2, comment: 'generic-compound', content: '<% result += 1; %>' },
    3: { uid: 3, comment: 'custom-inc', content: '<% ++counterFlag; %>' },
    4: { uid: 4, comment: 'global-bracket', content: "<% globalThis['bracketFlag'] = 1; %>" },
    5: { uid: 5, comment: 'self-global', content: '<% self.selfFlag = 1; %>' },
  });

  await expect(page.locator('.finding').filter({ hasText: 'custom-global' }).filter({ hasText: '[L4]' })).toHaveCount(1);
  await expect(page.locator('.finding').filter({ hasText: 'custom-global' }).filter({ hasText: '[L5]' })).toHaveCount(0);
  await expect(page.locator('.finding').filter({ hasText: 'generic-compound' }).filter({ hasText: '[L5]' })).toContainText('阻断');
  await expect(page.locator('.finding').filter({ hasText: 'custom-inc' }).filter({ hasText: '[L4]' })).toHaveCount(1);
  await expect(page.locator('.finding').filter({ hasText: 'global-bracket' }).filter({ hasText: '[L4]' })).toHaveCount(1);
  await expect(page.locator('.finding').filter({ hasText: 'self-global' }).filter({ hasText: '[L4]' })).toHaveCount(1);
});

test('certification status distinguishes pass, review and fail', async ({ page }) => {
  await loadEntries(page, {
    1: { uid: 1, comment: 'safe', content: '<% { const localOnly = 1; } %>' },
  }, 'pass.json');
  await expect(page.locator('#mStatus')).toHaveText('通过');
  await expect(page.locator('#certSummary')).toContainText('审核报告为绿色');
  const passReport = await page.evaluate(() => window.EjsPreflight.getReport());
  expect(passReport.standard).toBe('PW-CODE-CHECK-v1');
  expect(passReport.certification).toBe('pass');
  expect(passReport.gate).toBe('accept');
  expect(passReport.audit).toBe('green');

  await loadEntries(page, {
    1: { uid: 1, comment: 'review', content: '<% globalThis.__PW_demo__ = {}; %>' },
  }, 'review.json');
  await expect(page.locator('#mStatus')).toHaveText('需确认');

  await loadEntries(page, {
    1: { uid: 1, comment: 'fail', content: '<% const exposed = 1; %>' },
  }, 'fail.json');
  await expect(page.locator('#mStatus')).toHaveText('未通过');
});

test('project namespace globals can be shared across entries without L6 blocker', async ({ page }) => {
  await loadEntries(page, {
    1: { uid: 1, comment: 'namespace-a', content: '<% globalThis.__PW_demo__ = globalThis.__PW_demo__ || {}; %>' },
    2: { uid: 2, comment: 'namespace-b', content: '<% window.__PW_demo__ = window.__PW_demo__ || {}; %>' },
  });

  await expect(page.locator('.finding').filter({ hasText: '[L6]' }).filter({ hasText: '__PW_demo__' })).toHaveCount(0);
  await expect(page.locator('.finding').filter({ hasText: 'namespace-a' }).filter({ hasText: '[L4]' })).toHaveCount(1);
  await expect(page.locator('.finding').filter({ hasText: 'namespace-b' }).filter({ hasText: '[L4]' })).toHaveCount(1);
  await expect(page.locator('#mStatus')).toHaveText('需确认');

  await loadEntries(page, {
    1: { uid: 1, comment: 'ordinary-global-a', content: '<% globalThis.sharedOrdinaryGlobal = {}; %>' },
    2: { uid: 2, comment: 'ordinary-global-b', content: '<% globalThis.sharedOrdinaryGlobal = {}; %>' },
    3: { uid: 3, comment: 'namespace-looking-lexical', content: '<% const __PW_fake__ = 1; %>' },
    4: { uid: 4, comment: 'namespace-looking-lexical-2', content: '<% const __PW_fake__ = 2; %>' },
  }, 'non-namespace-collisions.json');

  await expect(page.locator('.finding').filter({ hasText: '[L6]' }).filter({ hasText: 'sharedOrdinaryGlobal' })).toHaveCount(1);
  await expect(page.locator('.finding').filter({ hasText: '[L6]' }).filter({ hasText: '__PW_fake__' })).toHaveCount(1);
  await expect(page.locator('#mStatus')).toHaveText('未通过');
});

test('cross-file duplicate public names are detected as Workshop composition risk', async ({ page }) => {
  await loadBooks(page, [
    { name: 'book-a.json', entries: { 1: { uid: 1, comment: 'book-a-entry', content: '<% const copiedTemplateName = 1; %>' } } },
    { name: 'book-b.json', entries: { 1: { uid: 1, comment: 'book-b-entry', content: '<% const copiedTemplateName = 2; %>' } } },
  ]);

  const collision = page.locator('.finding').filter({ hasText: '[L6]' }).filter({ hasText: 'copiedTemplateName' });
  await expect(collision).toHaveCount(1);
  await expect(collision).toContainText('book-a-entry');
  await expect(collision).toContainText('book-b-entry');
  await expect(page.locator('#mStatus')).toHaveText('未通过');
});

test('eval in EJS comments or strings is ignored, executable eval is blocked', async ({ page }) => {
  await loadEntries(page, {
    1: { uid: 1, comment: 'ejs-comment', content: '<%# eval("comment only") %>' },
    2: { uid: 2, comment: 'js-comment-string', content: '<% { // eval("comment")\n const s = "eval(\\\"string\\\")"; void s; } %>' },
    3: { uid: 3, comment: 'real-eval', content: '<% { eval("1 + 1"); } %>' },
  });

  await expect(page.locator('.finding').filter({ hasText: 'ejs-comment' }).filter({ hasText: '[M1]' })).toHaveCount(0);
  await expect(page.locator('.finding').filter({ hasText: 'js-comment-string' }).filter({ hasText: '[M1]' })).toHaveCount(0);
  await expect(page.locator('.finding').filter({ hasText: 'real-eval' })).toContainText('[M1]');
});

test('regex inline event handlers are scanned as executable JavaScript', async ({ page }) => {
  await loadRegex(page, {
    id: 'inline-handler',
    scriptName: 'inline-handler',
    findRegex: '/x/g',
    replaceString: '<button onclick="eval(\'1 + 1\')">x</button>',
  });

  await expect(page.locator('.finding').filter({ hasText: 'inline-handler' }).filter({ hasText: '[M1]' })).toHaveCount(1);
});

test('regex scripts share M/U rules but do not receive EJS L rules', async ({ page }) => {
  await loadRegex(page, {
    id: 'regex-common-rules',
    scriptName: 'regex-common-rules',
    findRegex: '/x/g',
    replaceString: '<div>x</div><script>const theme = localStorage.getItem("qy18_theme"); eval("1"); fetch(apiUrl);</script>',
  });

  const card = page.locator('.finding').filter({ hasText: 'regex-common-rules' });
  await expect(card.filter({ hasText: '[M1]' })).toHaveCount(1);
  await expect(card.filter({ hasText: '[M4]' })).toHaveCount(1);
  await expect(card.filter({ hasText: '[U5]' })).toHaveCount(1);
  await expect(card.filter({ hasText: '[M3]' })).toHaveCount(0);
  for (const rule of ['L1', 'L2', 'L3', 'L4', 'L5', 'L6']) {
    await expect(card.filter({ hasText: '[' + rule + ']' })).toHaveCount(0);
  }
});

test('Dalian dynamic remote path gets U5 while fixed Qianyao/Ellia mappings do not', async ({ page }) => {
  await loadRegex(page, [
    {
      id: 'dalian',
      scriptName: 'Dalian-style',
      findRegex: '/<dalian mood="(.*?)">/g',
      replaceString: "<div style=\"background-image:url('https://cdn.jsdelivr.net/gh/AkabaneSaki/myrepo@main/picture/dalian/$1.png')\"></div>",
    },
    {
      id: 'qianyao',
      scriptName: 'Qianyao-style',
      findRegex: '/<qianyao mood="([^"]*)">/g',
      replaceString: "<svg xmlns=\"http://www.w3.org/2000/svg\"></svg><style>.qm-happy .qb-ai{background-image:url('https://iili.io/BsyJf4I.png')}.qm-calm .qb-ai{background-image:url('https://iili.io/BLC10Ne.png')}</style>",
    },
    {
      id: 'ellia',
      scriptName: 'Ellia-style',
      findRegex: '/x/g',
      replaceString: "<script>const map={smile:'https://files.catbox.moe/a.png',sad:'https://files.catbox.moe/b.png'}; img.src=map[mood];</script>",
    },
  ]);

  await expect(page.locator('.finding').filter({ hasText: 'Dalian-style' }).filter({ hasText: '[U5]' })).toHaveCount(1);
  await expect(page.locator('.finding').filter({ hasText: 'Qianyao-style' }).filter({ hasText: '[U5]' })).toHaveCount(0);
  await expect(page.locator('.finding').filter({ hasText: 'Qianyao-style' }).filter({ hasText: '[U3]' })).toHaveCount(0);
  await expect(page.locator('.finding').filter({ hasText: 'Ellia-style' }).filter({ hasText: '[U5]' })).toHaveCount(0);
});

test('arrow, object and class method var declarations stay function-local', async ({ page }) => {
  await loadEntries(page, {
    1: { uid: 1, comment: 'modern-function-scopes', content: '<% { (() => { var arrowLocal = 1; return arrowLocal; })(); (value => { var singleLocal = value; return singleLocal; })(1); ({ pick() { var methodLocal = 2; return methodLocal; } }).pick(); class Box { read() { var classLocal = 3; return classLocal; } } new Box().read(); } %>' },
  });

  const l1 = page.locator('.finding').filter({ hasText: 'modern-function-scopes' }).filter({ hasText: '[L1]' });
  await expect(l1).toHaveCount(4);
  for (let i = 0; i < 4; i++) await expect(l1.nth(i)).toContainText('信息');
});

test('EJS close markers follow the real ST EJS tokenizer even inside JS strings or regex literals', async ({ page }) => {
  await loadEntries(page, {
    1: { uid: 1, comment: 'close-in-string', content: '<% { const marker = "%>"; void marker; } %>' },
    2: { uid: 2, comment: 'close-in-regex', content: '<% { const marker = /foo%>bar/; void marker; } %>' },
  });

  for (const name of ['close-in-string', 'close-in-regex']) {
    await expect(page.locator('.finding').filter({ hasText: name }).filter({ hasText: '[EJS-PARSE]' })).toHaveCount(1);
  }
});

test('unquoted handlers and browser-valid javascript URLs remain executable for M checks', async ({ page }) => {
  await loadRegex(page, [
    { id: 'unquoted-handler', scriptName: 'unquoted-handler', findRegex: '/x/g', replaceString: '<button onclick=eval(1)>x</button>' },
    { id: 'spaced-js-url', scriptName: 'spaced-js-url', findRegex: '/x/g', replaceString: '<a href="  javascript : eval(1)">x</a>' },
    { id: 'tab-js-url', scriptName: 'tab-js-url', findRegex: '/x/g', replaceString: '<a href="  java&#9;script:eval(1)">x</a>' },
  ]);

  await expect(page.locator('.finding').filter({ hasText: 'unquoted-handler' }).filter({ hasText: '[M1]' })).toHaveCount(1);
  expect(await page.evaluate(() => new URL('  javascript : eval(1)', 'https://example.com/').protocol)).toBe('https:');
  await expect(page.locator('.finding').filter({ hasText: 'spaced-js-url' }).filter({ hasText: '[M1]' })).toHaveCount(0);
  await expect(page.locator('.finding').filter({ hasText: 'tab-js-url' }).filter({ hasText: '[M1]' })).toHaveCount(1);
});

test('obvious bracket and optional-chain capability variants are still detected', async ({ page }) => {
  await loadEntries(page, {
    1: { uid: 1, comment: 'bracket-eval', content: "<% { window['eval']('1'); } %>" },
    2: { uid: 2, comment: 'optional-function', content: "<% { const f = globalThis?.Function('return 1'); void f; } %>" },
    3: { uid: 3, comment: 'bracket-storage', content: "<% { const t = window['localStorage'].getItem('access_token'); void t; } %>" },
    4: { uid: 4, comment: 'optional-fetch', content: "<% { globalThis?.fetch('/ping'); } %>" },
    5: { uid: 5, comment: 'bracket-fetch', content: "<% { window['fetch']('/ping'); } %>" },
    6: { uid: 6, comment: 'optional-eval', content: "<% { globalThis?.eval('1'); } %>" },
    7: { uid: 7, comment: 'bracket-function', content: "<% { const f = window['Function']('return 1'); void f; } %>" },
    8: { uid: 8, comment: 'optional-storage', content: "<% { const t = window?.localStorage?.getItem('session_id'); void t; } %>" },
  });

  await expect(page.locator('.finding').filter({ hasText: 'bracket-eval' }).filter({ hasText: '[M1]' })).toHaveCount(1);
  await expect(page.locator('.finding').filter({ hasText: 'optional-eval' }).filter({ hasText: '[M1]' })).toHaveCount(1);
  await expect(page.locator('.finding').filter({ hasText: 'optional-function' }).filter({ hasText: '[M2]' })).toHaveCount(1);
  await expect(page.locator('.finding').filter({ hasText: 'bracket-function' }).filter({ hasText: '[M2]' })).toHaveCount(1);
  await expect(page.locator('.finding').filter({ hasText: 'bracket-storage' }).filter({ hasText: '[M3]' })).toHaveCount(1);
  await expect(page.locator('.finding').filter({ hasText: 'optional-storage' }).filter({ hasText: '[M3]' })).toHaveCount(1);
  await expect(page.locator('.finding').filter({ hasText: 'optional-fetch' }).filter({ hasText: '[M4]' })).toHaveCount(1);
  await expect(page.locator('.finding').filter({ hasText: 'bracket-fetch' }).filter({ hasText: '[M4]' })).toHaveCount(1);
});

test('named regex capture substitutions in remote URLs get U5', async ({ page }) => {
  await loadRegex(page, {
    id: 'named-capture-url',
    scriptName: 'named-capture-url',
    findRegex: '/<mood>(?<mood>.*?)<\\/mood>/g',
    replaceString: '<img src="https://cdn.example.net/mood/$<mood>.png">',
  });

  await expect(page.locator('.finding').filter({ hasText: 'named-capture-url' }).filter({ hasText: '[U5]' })).toHaveCount(1);
});

test('for loops with an empty condition are M5 even when init and update exist', async ({ page }) => {
  await loadEntries(page, {
    1: { uid: 1, comment: 'empty-condition-for', content: '<% { for (let i = 0; ; i++) { void i; } } %>' },
  });

  await expect(page.locator('.finding').filter({ hasText: 'empty-condition-for' }).filter({ hasText: '[M5]' })).toHaveCount(1);
});

test('for-header detection does not depend on a short lookbehind window', async ({ page }) => {
  const padding = ' '.repeat(400);
  await loadEntries(page, {
    1: { uid: 1, comment: 'long-for-header', content: '<% for (' + padding + 'let i = 0; i < 1; i++) { void i; } %>' },
  });

  await expect(page.locator('.finding').filter({ hasText: 'long-for-header' }).filter({ hasText: '[L2]' })).toHaveCount(0);
});

test('re-scanning the same entry resets symbols instead of accumulating stale state', async ({ page }) => {
  await page.goto(toolUrl);
  const result = await page.evaluate(() => {
    const inputs = [{fileName:'same.json', type:'worldbook', text:JSON.stringify({entries:{1:{uid:1,comment:'same-entry',content:'<% const exposedOnce = 1; %>'}}})}];
    const firstFindings = window.PoemEjsChecker.analyzeProjectCode(inputs).findings;
    firstFindings.push({ruleId:'L6',entry:'staleBetweenScans'});
    const secondFindings = window.PoemEjsChecker.analyzeProjectCode(inputs).findings;
    return {
      firstL2: firstFindings.filter(x => x.ruleId === 'L2').length,
      secondL2: secondFindings.filter(x => x.ruleId === 'L2').length,
      secondL6: secondFindings.filter(x => x.ruleId === 'L6').length,
    };
  });

  expect(result.secondL6).toBe(0);
  expect(result.firstL2).toBe(1);
  expect(result.secondL2).toBe(1);
});

test('audit hints use question-mark severity and never change certification by themselves', async ({ page }) => {
  await loadRegex(page, {
    id: 'hint-only',
    scriptName: 'hint-only',
    findRegex: '/x/g',
    replaceString: "<script>const decoded = atob('Zm9v'); void decoded;</script>",
  });

  const hint = page.locator('.finding').filter({ hasText: 'hint-only' }).filter({ hasText: '[AH1]' });
  await expect(hint).toHaveCount(1);
  await expect(hint).toContainText('人工留意');
  await expect(page.locator('#mHints')).toHaveText('1');
  await expect(page.locator('#mStatus')).toHaveText('需确认');
  const report = await page.evaluate(() => window.EjsPreflight.getReport());
  expect(report.certification).toBe('pass');
  expect(report.gate).toBe('accept');
  expect(report.audit).toBe('yellow');
  await expect(page.locator('#findings')).not.toContainText('[M6]');
});

test('EJS literal opener does not swallow later executable tags', async ({ page }) => {
  await loadEntries(page, {
    1: { uid: 1, comment: 'literal-opener', content: '<%% literal opener\n<% { eval("1"); } %>' },
  });
  await expect(page.locator('.finding').filter({ hasText: 'literal-opener' }).filter({ hasText: '[M1]' })).toHaveCount(1);
});

test('EJS close delimiter inside a line comment still closes the tag like ST Prompt Template', async ({ page }) => {
  await loadEntries(page, {
    1: { uid: 1, comment: 'comment-close', content: '<% // comment closes here %>\n<% { eval("1"); } %>' },
  });
  await expect(page.locator('.finding').filter({ hasText: 'comment-close' }).filter({ hasText: '[EJS-PARSE]' })).toHaveCount(0);
  await expect(page.locator('.finding').filter({ hasText: 'comment-close' }).filter({ hasText: '[M1]' })).toHaveCount(1);
});

test('regex literals after control parentheses do not corrupt lexical brace depth', async ({ page }) => {
  await loadEntries(page, {
    1: { uid: 1, comment: 'regex-depth', content: '<% if (true) /{/.test("x"); const exposedAfterRegex = 1; %>' },
  });
  await expect(page.locator('.finding').filter({ hasText: 'regex-depth' }).filter({ hasText: '[L2]' })).toHaveCount(1);
});

test('function parameter reassignment is local while an outer write is still L4', async ({ page }) => {
  await loadEntries(page, {
    1: { uid: 1, comment: 'param-write', content: '<% { function pick(card) { card = { ok: true }; return card; } void pick; } %>' },
    2: { uid: 2, comment: 'block-does-not-forgive-outer', content: '<% { let scopedOnly = 1; void scopedOnly; } scopedOnly = 2; %>' },
  });
  await expect(page.locator('.finding').filter({ hasText: 'param-write' }).filter({ hasText: '[L4]' })).toHaveCount(0);
  await expect(page.locator('.finding').filter({ hasText: 'block-does-not-forgive-outer' }).filter({ hasText: '[L4]' })).toHaveCount(1);
});

test('nested declarations inside callback bodies are not bare L4 writes', async ({ page }) => {
  const ejs = '<' + '% { const fn = () => { let value = 1; const copy = [value]; for (let i = 0; i < copy.length; i++) void copy[i]; return copy; }; void fn; } %' + '>';
  await loadEntries(page, { 1: { uid: 1, comment: 'nested-declarations', content: ejs } });
  await expect(page.locator('.finding').filter({ hasText: 'nested-declarations' }).filter({ hasText: '[L4]' })).toHaveCount(0);
});

test('dollar-prefixed and Unicode identifiers are tracked as whole bindings', async ({ page }) => {
  const safe = '<' + '% { let $messages = []; const 源A = 1; const 上一轮AI = \'ok\'; $messages = [$messages.length]; void 源A; void 上一轮AI; } %' + '>';
  const unsafe = '<' + '% { $rogue = 1; 裸变量 = 2; } %' + '>';
  await loadEntries(page, {
    1: { uid: 1, comment: 'unicode-safe', content: safe },
    2: { uid: 2, comment: 'unicode-bare', content: unsafe },
  });
  await expect(page.locator('.finding').filter({ hasText: 'unicode-safe' }).filter({ hasText: '[L4]' })).toHaveCount(0);
  const unsafeL4 = page.locator('.finding').filter({ hasText: 'unicode-bare' }).filter({ hasText: '[L4]' });
  await expect(unsafeL4).toHaveCount(2);
  await expect(unsafeL4.filter({ hasText: '$rogue' })).toHaveCount(1);
  await expect(unsafeL4.filter({ hasText: '裸变量' })).toHaveCount(1);
});

test('same filenames do not collapse distinct entries for L6', async ({ page }) => {
  await loadBooks(page, [
    { name: 'worldbook.json', entries: { 1: { uid: 1, comment: 'same-file-a', content: '<% const sameFileCollision = 1; %>' } } },
    { name: 'worldbook.json', entries: { 1: { uid: 1, comment: 'same-file-b', content: '<% const sameFileCollision = 2; %>' } } },
  ]);
  const l6 = page.locator('.finding').filter({ hasText: '[L6]' }).filter({ hasText: 'sameFileCollision' });
  await expect(l6).toHaveCount(1);
  await expect(l6).toContainText('same-file-a');
  await expect(l6).toContainText('same-file-b');
});

test('M3 catches API-key names and broad storage enumeration without substring noise', async ({ page }) => {
  await loadEntries(page, {
    1: { uid: 1, comment: 'api-key', content: '<% { const k = localStorage.getItem("openai_api_key"); void k; } %>' },
    2: { uid: 2, comment: 'storage-enum', content: '<% { const all = Object.entries(localStorage); void all; } %>' },
    3: { uid: 3, comment: 'ordinary-key', content: '<% { const x = localStorage.getItem("keyboard_layout"); void x; } %>' },
  });
  await expect(page.locator('.finding').filter({ hasText: 'api-key' }).filter({ hasText: '[M3]' })).toHaveCount(1);
  await expect(page.locator('.finding').filter({ hasText: 'storage-enum' }).filter({ hasText: '[M3]' })).toHaveCount(1);
  await expect(page.locator('.finding').filter({ hasText: 'ordinary-key' }).filter({ hasText: '[M3]' })).toHaveCount(0);
});

test('L4 catches for-of, destructuring, chained and bitwise bare writes', async ({ page }) => {
  await loadEntries(page, {
    1: { uid: 1, comment: 'for-of-leak', content: '<% for (leakedItem of [1,2]) { void leakedItem; } %>' },
    2: { uid: 2, comment: 'destructure-leak', content: '<% ({ leakedA, x: leakedB } = source); %>' },
    3: { uid: 3, comment: 'chain-leak', content: '<% firstLeak = secondLeak = 1; %>' },
    4: { uid: 4, comment: 'bitwise-leak', content: '<% flags |= 1; %>' },
  });
  await expect(page.locator('.finding').filter({ hasText: 'for-of-leak' }).filter({ hasText: '[L4]' })).toHaveCount(1);
  await expect(page.locator('.finding').filter({ hasText: 'destructure-leak' }).filter({ hasText: '[L4]' })).toHaveCount(2);
  await expect(page.locator('.finding').filter({ hasText: 'chain-leak' }).filter({ hasText: '[L4]' })).toHaveCount(2);
  await expect(page.locator('.finding').filter({ hasText: 'bitwise-leak' }).filter({ hasText: '[L4]' })).toHaveCount(1);
});

test('unquoted javascript URLs, protocol-relative dynamic targets and fetch.call stay visible', async ({ page }) => {
  await loadRegex(page, [
    { id: 'unquoted-js', scriptName: 'unquoted-js', findRegex: '/x/g', replaceString: '<a href=javascript:eval(1)>x</a>' },
    { id: 'protocol-dynamic', scriptName: 'protocol-dynamic', findRegex: '/x/g', replaceString: '<img src="//cdn.example.net/avatar/$1.png">' },
    { id: 'fetch-call', scriptName: 'fetch-call', findRegex: '/x/g', replaceString: '<script>fetch.call(window, endpoint)</script>' },
  ]);
  await expect(page.locator('.finding').filter({ hasText: 'unquoted-js' }).filter({ hasText: '[M1]' })).toHaveCount(1);
  await expect(page.locator('.finding').filter({ hasText: 'protocol-dynamic' }).filter({ hasText: '[U5]' })).toHaveCount(1);
  await expect(page.locator('.finding').filter({ hasText: 'fetch-call' }).filter({ hasText: '[M4]' })).toHaveCount(1);
});

test('L findings expose precise position and a copyable LLM repair prompt', async ({ page }) => {
  await loadEntries(page, {
    1: { uid: 1, comment: 'creator-help', content: '<%\nconst creatorState = 1;\n%>' },
  });
  const finding = page.locator('.finding').filter({ hasText: 'creator-help' }).filter({ hasText: '[L2]' });
  await expect(finding).toContainText('第 2 行');
  await expect(finding).toContainText('L2');
  await expect(finding.locator('button[data-llm-fix]')).toHaveCount(1);
  const prompt = await page.evaluate(() => {
    const f = window.EjsPreflight.getReport().findings.find(x => x.ruleId === 'L2');
    return window.EjsPreflight.buildLlmFixPrompt(f);
  });
  expect(prompt).toContain('[L2]');
  expect(prompt).toContain('creator-help');
  expect(prompt).toContain('不要改变原本功能');
  expect(prompt).toContain('const creatorState = 1;');
});

test('object methods merely named eval or Function are not treated as the forbidden globals', async ({ page }) => {
  await loadEntries(page, {
    1: { uid: 1, comment: 'method-names', content: '<% { const sandbox = { eval(){ return 1; }, Function(){ return 2; } }; sandbox.eval(); sandbox.Function(); } %>' },
  });
  const card = page.locator('.finding').filter({ hasText: 'method-names' });
  await expect(card.filter({ hasText: '[M1]' })).toHaveCount(0);
  await expect(card.filter({ hasText: '[M2]' })).toHaveCount(0);
});

test('direct aliases of eval and Function are blocked without trying to become a full data-flow engine', async ({ page }) => {
  await loadEntries(page, {
    1: { uid: 1, comment: 'eval-alias', content: '<% { const runner = eval; void runner; } %>' },
    2: { uid: 2, comment: 'function-alias', content: '<% { const maker = Function; void maker; } %>' },
  });
  await expect(page.locator('.finding').filter({ hasText: 'eval-alias' }).filter({ hasText: '[M1]' })).toHaveCount(1);
  await expect(page.locator('.finding').filter({ hasText: 'function-alias' }).filter({ hasText: '[M2]' })).toHaveCount(1);
});

test('markdown-style trailing punctuation does not make a real URL disappear', async ({ page }) => {
  await loadEntries(page, {
    1: { uid: 1, comment: 'markdown-url', content: 'Reference: [https://third-party.example.net/file.js]' },
  });
  await expect(page.locator('.finding').filter({ hasText: 'markdown-url' }).filter({ hasText: '[U2]' })).toHaveCount(1);
});

test('uploader view hides reviewer-only findings while report keeps their visibility metadata', async ({ page }) => {
  await page.goto(toolUrl + '?audience=uploader');
  await expect(page.locator('#uploaderModeBtn')).toHaveClass(/active/);
  await expect(page.locator('#modeHint')).toContainText('当前：上传者模式');
  await page.locator('#fileInput').setInputFiles({
    name: 'uploader-view.json',
    mimeType: 'application/json',
    buffer: Buffer.from(JSON.stringify({ entries: {
      1: { uid: 1, comment: 'visible-l', content: '<% const topLevel = 1; %>' },
      2: { uid: 2, comment: 'hidden-review', content: '<% { const all = Object.entries(localStorage); void all; } %>' },
    } })),
  });

  await expect(page.locator('#findings')).toContainText('[L2]');
  await expect(page.locator('#findings')).not.toContainText('[M3]');
  await expect(page.locator('#mStatus')).toHaveText('需修改');
  await expect(page.locator('#exportBtn')).toHaveClass(/hidden/);
  const report = await page.evaluate(() => window.EjsPreflight.getReport());
  expect(report.findings.find(x => x.ruleId === 'L2').visibility).toBe('uploader_detailed');
  expect(report.findings.find(x => x.ruleId === 'M3').visibility).toBe('reviewer_only');
});

test('demo UI switches uploader and reviewer views without editing the URL', async ({ page }) => {
  await loadEntries(page, {
    1: { uid: 1, comment: 'visible-l', content: '<% const topLevel = 1; %>' },
    2: { uid: 2, comment: 'review-only', content: '<% { const all = Object.entries(localStorage); void all; } %>' },
  }, 'mode-switch.json');

  await expect(page.locator('#auditModeBtn')).toHaveClass(/active/);
  await expect(page.locator('#modeHint')).toContainText('当前：审核员模式');
  await expect(page.locator('#findings')).toContainText('[M3]');
  await expect(page.locator('#exportBtn')).not.toHaveClass(/hidden/);

  await page.locator('#uploaderModeBtn').click();
  await expect(page.locator('#uploaderModeBtn')).toHaveClass(/active/);
  await expect(page.locator('#modeHint')).toContainText('当前：上传者模式');
  await expect(page.locator('#findings')).toContainText('[L2]');
  await expect(page.locator('#findings')).not.toContainText('[M3]');
  await expect(page.locator('#exportBtn')).toHaveClass(/hidden/);
  expect(await page.evaluate(() => window.EjsPreflight.getAudienceMode())).toBe('uploader');

  await page.locator('#auditModeBtn').click();
  await expect(page.locator('#auditModeBtn')).toHaveClass(/active/);
  await expect(page.locator('#findings')).toContainText('[M3]');
  expect(await page.evaluate(() => window.EjsPreflight.getAudienceMode())).toBe('audit');
});
