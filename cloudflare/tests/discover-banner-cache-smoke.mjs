import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const siteSettings = await readFile(new URL('../src/utils/site-settings.ts', import.meta.url), 'utf8');
const endpointSource = await readFile(new URL('../src/endpoints/site-settings.ts', import.meta.url), 'utf8');
const apiSource = await readFile(new URL('../src/pages/home/api.ts', import.meta.url), 'utf8');
const stateSource = await readFile(new URL('../src/pages/home/state.ts', import.meta.url), 'utf8');
const presentationSource = await readFile(new URL('../src/pages/home/presentation.ts', import.meta.url), 'utf8');
const indexSource = await readFile(new URL('../src/index.ts', import.meta.url), 'utf8');

assert.match(siteSettings, /DISCOVER_BANNER_CACHE_TTL_SECONDS = 5 \* 60/);
assert.match(siteSettings, /caches\.default\.match\(cacheRequest\)/);
assert.match(siteSettings, /caches\.default\.put\(cacheRequest/);
assert.match(siteSettings, /caches\.default\.delete\(getDiscoverBannerCacheRequest\(c\)\)/);

assert.doesNotMatch(endpointSource, /discover-preview-banner\.png/);
assert.doesNotMatch(stateSource, /discover-preview-banner\.png/);
assert.doesNotMatch(presentationSource, /discover-preview-banner\.png/);
assert.match(presentationSource, /imageSrcAttribute = imageUrl \? ' src=/);

assert.match(apiSource, /apiFetch\('\/api\/site\/discover-banner'\)/);
assert.doesNotMatch(apiSource, /api\/site\/discover-banner'[\s\S]{0,80}cache:\s*'no-store'/);
assert.match(
  indexSource,
  /c\.req\.path === '\/api\/site\/discover-banner'[\s\S]{0,180}public, max-age=0, must-revalidate/,
);

console.log('discover banner cache: ok');
