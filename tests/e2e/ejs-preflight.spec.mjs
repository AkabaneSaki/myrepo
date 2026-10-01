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
