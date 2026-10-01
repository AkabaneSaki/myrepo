import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const readSource = await readFile(new URL('../src/endpoints/projects/read.ts', import.meta.url), 'utf8');
const dbSource = await readFile(new URL('../src/utils/db.ts', import.meta.url), 'utf8');

assert.match(
  readSource,
  /const cacheable = page < 3 &&/,
  'public list cache eligibility must not exclude authenticated viewers',
);
assert.doesNotMatch(
  readSource,
  /const cacheable = !payload/,
  'authenticated viewers must be allowed to reuse the viewer-neutral public list cache',
);
assert.match(
  readSource,
  /currentUser: null,/,
  'the project list stored in shared cache must be built without viewer-specific state',
);
assert.match(
  readSource,
  /return applyProjectListViewerLikes\(c, payload\?\.userId, cachedResponse\);/,
  'cached public responses must restore the current viewer like state before returning',
);

const cacheWriteIndex = readSource.indexOf('caches.default.put');
const personalizedReturnIndex = readSource.indexOf('return applyProjectListViewerLikes(c, payload?.userId, response);');
assert.ok(cacheWriteIndex >= 0, 'shared cache write must exist');
assert.ok(personalizedReturnIndex > cacheWriteIndex, 'viewer likes must be applied only after the shared response is cached');

assert.match(
  dbSource,
  /getLikedProjectIds: async[\s\S]*FROM project_likes[\s\S]*json_each/,
  'viewer likes must be fetched with one bounded batch lookup',
);

console.log('public project list cache: ok');
