import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const apiSource = await readFile(new URL('../src/pages/home/api.ts', import.meta.url), 'utf8');

assert.match(apiSource, /PROJECT_LIST_CLIENT_CACHE_FRESH_MS = 15 \* 1000/);
assert.match(apiSource, /PROJECT_LIST_CLIENT_CACHE_MAX_STALE_MS = 60 \* 1000/);
assert.match(apiSource, /PROJECT_LIST_CLIENT_CACHE_MAX_ENTRIES = 24/);
assert.match(apiSource, /const projectListClientCache = new Map\(\)/);
assert.match(
  apiSource,
  /projectListClientCacheKey = \(state\.currentUser\?\.id \|\| 'anonymous'\) \+ '\\|' \+ params\.toString\(\)/,
  'client cache must be viewer-scoped so one account cannot reuse another account\'s personalized list body',
);
assert.match(
  apiSource,
  /forceRefresh = Boolean\(forceRefresh && options\.bypassClientCache\);[\s\S]*Writes clear this cache directly/,
  'legacy navigation refresh calls must keep the in-memory cache unless an explicit bypass is requested',
);
assert.match(apiSource, /applyProjectListClientCacheData\(cached\.data, pageSize\)/);
assert.match(apiSource, /ageMs <= PROJECT_LIST_CLIENT_CACHE_FRESH_MS[\s\S]*return cached\.data/);
assert.match(apiSource, /writeProjectListClientCache\(projectListClientCacheKey, data\)/);
assert.match(
  apiSource,
  /cachedFallbackData[\s\S]*项目列表后台刷新失败，继续显示刚才的内容/,
  'a stale cached page should remain visible if background refresh fails',
);
assert.match(
  apiSource,
  /updateLikeState\(projectId,[\s\S]*clearProjectListClientCache\(\)/,
  'a like mutation must invalidate personalized list cache entries',
);

for (const signature of [
  'async function createProject(payload) {',
  'async function updateProject(projectId, payload) {',
  'async function updateProjectVisibility(projectId, visibility) {',
  'async function deleteProject(projectId) {',
  'async function updateCoverPresentation(projectId, presentation) {',
  'async function reviewProject(projectId, payload) {',
  'async function removeProjectEntry(projectId, kind, entryKey) {',
]) {
  const start = apiSource.indexOf(signature);
  assert.ok(start >= 0, `missing mutation helper: ${signature}`);
  const bodyStart = start + signature.length;
  assert.equal(
    apiSource.slice(bodyStart, bodyStart + 80).includes('clearProjectListClientCache();'),
    true,
    `mutation helper must invalidate list cache: ${signature}`,
  );
}

console.log('project list client cache: ok');
