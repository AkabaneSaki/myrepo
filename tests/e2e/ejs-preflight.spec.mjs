import { test, expect } from '@playwright/test';
import { pathToFileURL } from 'node:url';
import path from 'node:path';

const toolUrl = pathToFileURL(path.resolve('util/ejs-preflight.html')).href;

test('offline selftest passes', async ({ page }) => {
  await page.goto(toolUrl + '?selftest=1');
  await expect(page).toHaveTitle(/SELFTEST PASS/);
  await expect(page.locator('#selftest')).toHaveText('SELFTEST PASS');
});

test('multi-book collision and private var behavior', async ({ page }) => {
  await page.goto(toolUrl);
  await page.locator('#fileInput').setInputFiles([
    {
      name: 'book-a.json',
      mimeType: 'application/json',
      buffer: Buffer.from(JSON.stringify({
        entries: {
          1: { uid: 1, comment: 'private-var', content: '@@private\n<% var state = 1; %>' },
          2: { uid: 2, comment: 'collision-a', content: '<% const collision = 1; %>' },
          3: { uid: 3, comment: 'write-a', content: '<% setGlobalVar("shared.hp", 100); %>' },
        },
      })),
    },
    {
      name: 'book-b.json',
      mimeType: 'application/json',
      buffer: Buffer.from(JSON.stringify({
        entries: {
          1: { uid: 1, comment: 'collision-b', content: '<% const collision = 2; %>' },
          2: { uid: 2, comment: 'write-b', content: '<% setGlobalVar("shared.hp", 50); %>' },
          3: { uid: 3, comment: 'network', content: '<% await fetch("https://example.com/x"); %>' },
        },
      })),
    },
  ]);

  const findings = page.locator('#findings');
  await expect(findings).toContainText('跨世界书 EJS 确定冲突');
  await expect(findings).toContainText('多个世界书写入同一状态键');
  await expect(findings).toContainText('检测到网络访问能力');
  await expect(findings).not.toContainText('private-var');
});

test('async helpers and dynamic template checks avoid literal false positives', async ({ page }) => {
  await page.goto(toolUrl);
  await page.locator('#fileInput').setInputFiles({
    name: 'async.json',
    mimeType: 'application/json',
    buffer: Buffer.from(JSON.stringify({
      entries: {
        1: { uid: 1, comment: 'missing-await', content: '<%= getwi("Target") %>' },
        2: { uid: 2, comment: 'Target', content: '<% const targetReady = true; %>' },
        3: { uid: 3, comment: 'dynamic-template', content: '<% const tpl = getvar("tpl", { defaults: "Hello" }); %><%= await evalTemplate(tpl) %>' },
        4: { uid: 4, comment: 'literal-template', content: '<%= await evalTemplate("Hello") %>' },
      },
    })),
  });

  const findings = page.locator('#findings');
  await expect(findings).toContainText('异步 helper 未 await');
  await expect(findings).toContainText('动态 evalTemplate 输入');
  const literalFinding = page.locator('.finding').filter({ hasText: 'literal-template' });
  await expect(literalFinding).toHaveCount(0);
});

test('detects getwi dependency hazards across uploaded books', async ({ page }) => {
  await page.goto(toolUrl);
  await page.locator('#fileInput').setInputFiles([
    {
      name: 'book-a.json',
      mimeType: 'application/json',
      buffer: Buffer.from(JSON.stringify({
        entries: {
          1: { uid: 1, comment: 'Loop A', content: '<%= await getwi("Loop B") %>' },
          2: { uid: 2, comment: 'Weather', content: 'Valley weather: low cloud and steady rain.' },
          3: { uid: 3, comment: 'Weather User', content: '<%= await getwi("Weather") %>' },
          4: { uid: 4, comment: 'Self Loop', content: '<%= await getwi("Self Loop") %>' },
        },
      })),
    },
    {
      name: 'book-b.json',
      mimeType: 'application/json',
      buffer: Buffer.from(JSON.stringify({
        entries: {
          1: { uid: 1, comment: 'Loop B', content: '<%= await getwi("Loop A") %>' },
          2: { uid: 2, comment: 'Weather', content: 'Harbour weather: salt fog off the water.' },
        },
      })),
    },
  ]);

  const findings = page.locator('#findings');
  await expect(findings).toContainText('检测到 getwi 循环依赖');
  await expect(findings).toContainText('getwi 标题在多本世界书中重名');
  await expect(findings).toContainText('getwi 可能递归调用自身');
});

test('detects async callback and state scope/path conflicts', async ({ page }) => {
  await page.goto(toolUrl);
  await page.locator('#fileInput').setInputFiles([
    {
      name: 'state-a.json',
      mimeType: 'application/json',
      buffer: Buffer.from(JSON.stringify({
        entries: {
          1: { uid: 1, comment: 'scope', content: '<% setvar("realm_policy", 1); const x = getvar("realm_policy", { scope: "global" }); %>' },
          2: { uid: 2, comment: 'parent', content: '<% incvar("tension", 1, { min: 0, max: 10 }); [1,2].forEach(async () => { await getwi("Helper"); }); %>' },
          3: { uid: 3, comment: 'Helper', content: '<% const ok = true; %>' },
        },
      })),
    },
    {
      name: 'state-b.json',
      mimeType: 'application/json',
      buffer: Buffer.from(JSON.stringify({
        entries: {
          1: { uid: 1, comment: 'child', content: '<% setvar("tension.phase", "high"); %>' },
        },
      })),
    },
  ]);

  const findings = page.locator('#findings');
  await expect(findings).toContainText('forEach(async ...) 不会等待回调');
  await expect(findings).toContainText('同一项目对同一状态键使用不同作用域');
  await expect(findings).toContainText('跨世界书状态路径重叠');
});
