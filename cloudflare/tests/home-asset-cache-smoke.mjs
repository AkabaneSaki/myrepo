import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const homeSource = await readFile(new URL('../src/pages/home.ts', import.meta.url), 'utf8');
const indexSource = await readFile(new URL('../src/index.ts', import.meta.url), 'utf8');

assert.match(homeSource, /getHomeScriptRevision\(source: string\)/);
assert.match(homeSource, /HOME_SCRIPT_REVISION = getHomeScriptRevision\(homeScript\)/);
assert.match(
  homeSource,
  /<script src="\/assets\/home\.js\?v=\$\{HOME_SCRIPT_REVISION\}"><\/script>/,
  'HTML shell must point at a content-versioned home script URL',
);

const immutableHeaders = indexSource.match(/public, max-age=31536000, immutable/g) || [];
assert.equal(
  immutableHeaders.length >= 2,
  true,
  'home.js middleware and route response must both keep the immutable cache policy',
);
assert.doesNotMatch(
  indexSource,
  /c\.req\.path === '\/assets\/home\.js'[\s\S]{0,160}no-store/,
  'home.js middleware must not overwrite the immutable response with no-store',
);

console.log('home asset cache: ok');
