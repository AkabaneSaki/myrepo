import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const recommendations = await readFile(new URL('../src/endpoints/recommendations.ts', import.meta.url), 'utf8');
const indexSource = await readFile(new URL('../src/index.ts', import.meta.url), 'utf8');

assert.match(recommendations, /DLC_KITCHEN_CACHE_TTL_SECONDS = 5 \* 60/);
assert.match(recommendations, /public_project_counts WHERE scope = '\*'/);
assert.match(recommendations, /site_settings WHERE key = 'dlc_kitchen_revision'/);
assert.match(recommendations, /caches\.default\.match\(cacheRequest\)/);
assert.match(recommendations, /caches\.default\.put\(cacheRequest/);
assert.match(recommendations, /0 AS user_liked/);
assert.doesNotMatch(recommendations, /viewer_like/);
assert.match(recommendations, /applyDlcKitchenViewerLikes\(c, publicResponse, currentUser\?\.userId\)/);
assert.match(recommendations, /projectDb\.getLikedProjectIds/);
assert.match(recommendations, /import \{ r2Storage \} from '\.\.\/utils\/r2'/);
assert.match(recommendations, /normalizeDlcKitchenCoverImage\(c, parsedProject\.coverImage\)/);
assert.match(recommendations, /coverImage\.includes\('\/api\/files\/'\)/);
assert.match(recommendations, /r2Storage\.getProxyUrl\(c, key\)/);

const revisionBumps = recommendations.match(/await bumpDlcKitchenRevision\(c, payload\.userId\)/g) || [];
assert.equal(revisionBumps.length, 3, 'profile save, recommendation save, and recommendation delete must bump the cache revision');

assert.match(
  indexSource,
  /c\.req\.path === '\/api\/devteam-recommendations'[\s\S]{0,180}Vary[\s\S]{0,180}private, no-store/,
  'personalized kitchen response must not enter browser/CDN shared cache',
);

console.log('DLC Kitchen cache: ok');
