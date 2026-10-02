import { test, expect } from '@playwright/test';
import { pathToFileURL } from 'node:url';
import path from 'node:path';

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

test('offline coworker fixture selftest passes', async ({ page }) => {
  await page.goto(toolUrl + '?selftest=1');
  await expect(page).toHaveTitle(/SELFTEST PASS/);
  await expect(page.locator('#selftest')).toHaveText('SELFTEST PASS');
});

test('plain-text links cover unknown, HTTP, IPv4 and IPv6 without EJS', async ({ page }) => {
  const findings = await loadEntries(page, {
    1: { uid: 1, comment: 'official', content: 'https://testingcf.jsdelivr.net/gh/StageDog/tavern_resource/dist/util/mvu_zod.js' },
    2: { uid: 2, comment: 'unknown', content: 'https://ejs-fixture.example.com/tool.js' },
    3: { uid: 3, comment: 'http-upper', content: 'HTTP://ejs-fixture.example.com/tool.js' },
    4: { uid: 4, comment: 'ipv4', content: 'https://203.0.113.10/ejs-fixture.js' },
    5: { uid: 5, comment: 'ipv6', content: 'HTTPS://[2001:db8::1]/ejs-fixture.js' },
  }, 'links.json');

  await expect(findings).not.toContainText('official');
  await expect(findings).toContainText('[U2]');
  await expect(findings).toContainText('[U3]');
  await expect(findings).toContainText('[U4]');
  await expect(page.locator('.finding').filter({ hasText: 'ipv6' })).toContainText('[U4]');
  await expect(page.locator('#mEntries')).toHaveText('5');
});

test('parse errors are explicit and include repair fields', async ({ page }) => {
  await loadEntries(page, {
    1: { uid: 1, comment: 'broken-ejs', content: '<% const broken = ; %>' },
  }, 'broken.json');

  const finding = page.locator('.finding').filter({ hasText: 'broken-ejs' }).first();
  await expect(finding).toContainText('[EJS-PARSE]');
  await expect(finding).toContainText('行号：');
  await expect(finding).toContainText('建议：');
});

test('ordinary let/const and loop variables do not warn by themselves and L7 is gone', async ({ page }) => {
  await loadEntries(page, {
    1: { uid: 1, comment: 'ordinary-top', content: '<% let one = 1; const two = 2; %><%= one + two %>' },
    2: { uid: 2, comment: 'reassign', content: '<% { let state = {}; const step = {}; state = step; } %>' },
    3: { uid: 3, comment: 'loop', content: '<% let out = ""; for (const item of list) { out += item.name; } %>' },
    4: { uid: 4, comment: 'style-only-let', content: '<% { let neverReassigned = 1; } %>' },
  });

  for (const name of ['ordinary-top', 'reassign', 'loop', 'style-only-let']) {
    const card = page.locator('.finding').filter({ hasText: name });
    await expect(card.filter({ hasText: '[L2]' })).toHaveCount(0);
    await expect(card.filter({ hasText: '[L7]' })).toHaveCount(0);
  }
  await expect(page.locator('.finding').filter({ hasText: '[L7]' })).toHaveCount(0);
});

test('var gets precaution info, repeated var warns, and cross-entry var gets L6', async ({ page }) => {
  await loadEntries(page, {
    1: { uid: 1, comment: 'unique-var', content: '<% var uniqueVar = 1; %>' },
    2: { uid: 2, comment: 'repeat-var', content: '<% var repeated = 1; var repeated = 2; %>' },
    3: { uid: 3, comment: 'var-a', content: '<% var sharedVar = "A"; %>' },
    4: { uid: 4, comment: 'var-b', content: '<% var sharedVar = "B"; %>' },
  });

  await expect(page.locator('.finding').filter({ hasText: 'unique-var' })).toContainText('[L1]');
  await expect(page.locator('.finding').filter({ hasText: 'repeat-var' }).filter({ hasText: '重复声明同名 var' })).toHaveCount(1);
  const collision = page.locator('.finding').filter({ hasText: '[L6]' }).filter({ hasText: 'sharedVar' });
  await expect(collision).toHaveCount(1);
  await expect(collision).toContainText('var-a');
  await expect(collision).toContainText('var-b');
});

test('cross-entry lexical declarations get L2 and same-name functions get L3', async ({ page }) => {
  await loadEntries(page, {
    1: { uid: 1, comment: 'lex-a', content: '<% const sharedLex = "A"; %>' },
    2: { uid: 2, comment: 'lex-b', content: '<% const sharedLex = "B"; %>' },
    3: { uid: 3, comment: 'fn-a', content: '<% function sameFn(){ return "A"; } %><%= sameFn() %>' },
    4: { uid: 4, comment: 'fn-b', content: '<% function sameFn(){ return "B"; } %><%= sameFn() %>' },
  });

  const lexical = page.locator('.finding').filter({ hasText: '[L2]' }).filter({ hasText: 'sharedLex' });
  await expect(lexical).toHaveCount(1);
  await expect(lexical).toContainText('高风险');
  await expect(lexical).toContainText('lex-a');
  await expect(lexical).toContainText('lex-b');

  const functions = page.locator('.finding').filter({ hasText: '[L3]' }).filter({ hasText: 'sameFn' });
  await expect(functions).toHaveCount(1);
  await expect(functions).toContainText('fn-a');
  await expect(functions).toContainText('fn-b');
});

test('block scope and @@private prevent false cross-entry lexical collisions', async ({ page }) => {
  await loadEntries(page, {
    1: { uid: 1, comment: 'block-a', content: '<% { const isolated = "A"; } %>' },
    2: { uid: 2, comment: 'block-b', content: '<% { const isolated = "B"; } %>' },
    3: { uid: 3, comment: 'private-a', content: '@@private\n<% const privateSame = "A"; %>' },
    4: { uid: 4, comment: 'private-b', content: '@@private\n<% const privateSame = "B"; %>' },
  });

  await expect(page.locator('.finding').filter({ hasText: '[L2]' })).toHaveCount(0);
  await expect(page.locator('.finding').filter({ hasText: '[L3]' })).toHaveCount(0);
});

test('function-local var still gets L1 but does not pollute L6', async ({ page }) => {
  const findings = await loadEntries(page, {
    1: { uid: 1, comment: 'func-a', content: '<% { function alpha() { var shared = 1; } } %>' },
    2: { uid: 2, comment: 'func-b', content: '<% { function beta() { var shared = 2; } } %>' },
  });

  await expect(findings).toContainText('[L1]');
  await expect(findings).not.toContainText('[L6]');
});

test('implicit env/global writes get L4, generic names only add L5 info, and shared writes get L6', async ({ page }) => {
  await loadEntries(page, {
    1: { uid: 1, comment: 'env-write', content: '<% userName = "HIJACKED"; %>' },
    2: { uid: 2, comment: 'custom-a', content: '<% customShared = 1; %>' },
    3: { uid: 3, comment: 'custom-b', content: '<% customShared = 2; %>' },
    4: { uid: 4, comment: 'generic', content: '<% result = 3; %>' },
    5: { uid: 5, comment: 'global-a', content: '<% globalThis.projectState = "A"; %>' },
    6: { uid: 6, comment: 'global-b', content: '<% globalThis.projectState = "B"; %>' },
  });

  await expect(page.locator('.finding').filter({ hasText: 'env-write' }).filter({ hasText: '[L4]' })).toHaveCount(1);
  await expect(page.locator('.finding').filter({ hasText: 'generic' }).filter({ hasText: '[L4]' })).toHaveCount(1);
  const l5 = page.locator('.finding').filter({ hasText: 'generic' }).filter({ hasText: '[L5]' });
  await expect(l5).toHaveCount(1);
  await expect(l5).toContainText('信息');

  await expect(page.locator('.finding').filter({ hasText: '[L6]' }).filter({ hasText: 'customShared' })).toHaveCount(1);
  await expect(page.locator('.finding').filter({ hasText: '[L6]' }).filter({ hasText: 'projectState' })).toHaveCount(1);
});

test('documented explicit global is informational but still remains visible', async ({ page }) => {
  await loadEntries(page, {
    1: {
      uid: 1,
      comment: 'documented-global',
      content: '<%\n// Intentional shared state. Owner: this entry.\n// Lifecycle: one render. Cleanup: delete globalThis.documentedState.\nglobalThis.documentedState = 1;\n%>',
    },
  });

  const finding = page.locator('.finding').filter({ hasText: 'documented-global' }).filter({ hasText: '[L4]' });
  await expect(finding).toHaveCount(1);
  await expect(finding).toContainText('信息');
});

test('regex literals do not blind later checks and M5 never hides syntax errors', async ({ page }) => {
  await loadEntries(page, {
    1: { uid: 1, comment: 'regex-then-global', content: '<% { const re = /["\']/; globalThis.appState = 1; } %>' },
    2: { uid: 2, comment: 'broken-loop', content: '<% { while (true) { let broken = ; } } %>' },
  });

  const regexCase = page.locator('.finding').filter({ hasText: 'regex-then-global' });
  await expect(regexCase).toContainText('[L4]');

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
    6: { uid: 6, comment: 'storage-window', content: "<% { const t = window.localStorage.getItem('x'); } %>" },
  });

  await expect(page.locator('.finding').filter({ hasText: 'function-direct' })).toContainText('[M2]');
  await expect(page.locator('.finding').filter({ hasText: 'function-window' })).toContainText('[M2]');
  await expect(page.locator('.finding').filter({ hasText: 'function-globalThis' })).toContainText('[M2]');
  await expect(page.locator('.finding').filter({ hasText: 'safe-property' }).filter({ hasText: '[M3]' })).toHaveCount(0);
  await expect(page.locator('.finding').filter({ hasText: 'cookie-bracket' })).toContainText('[M3]');
  await expect(page.locator('.finding').filter({ hasText: 'storage-window' })).toContainText('[M3]');
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

  await expect(page.locator('.finding').filter({ hasText: 'generic-compound' }).filter({ hasText: '[L4]' })).toHaveCount(1);
  const l5 = page.locator('.finding').filter({ hasText: 'generic-compound' }).filter({ hasText: '[L5]' });
  await expect(l5).toHaveCount(1);
  await expect(l5).toContainText('信息');

  await expect(page.locator('.finding').filter({ hasText: 'custom-inc' }).filter({ hasText: '[L4]' })).toHaveCount(1);
  await expect(page.locator('.finding').filter({ hasText: 'global-bracket' }).filter({ hasText: '[L4]' })).toHaveCount(1);
  await expect(page.locator('.finding').filter({ hasText: 'self-global' }).filter({ hasText: '[L4]' })).toHaveCount(1);
});
