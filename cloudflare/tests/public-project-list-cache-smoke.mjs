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
  /return applyProjectListViewerState\(c, payload, cachedResponse\);/,
  'cached public responses must apply viewer-specific state before returning',
);

assert.match(
  readSource,
  /PRIVATE_PROJECT_REVIEW_FIELDS[\s\S]*'draftProjectId'[\s\S]*'rejectReason'[\s\S]*'hasPendingDraft'/,
  'public project responses must hide review-workflow state from unrelated viewers',
);
assert.match(
  readSource,
  /viewer\?\.isAdmin \|\| \(viewer\?\.userId && project\.authorId === viewer\.userId\)/,
  'authors and admins must retain access to project review state',
);
assert.match(
  readSource,
  /hideProjectReviewStateForViewer\(project, payload\)/,
  'project batch and detail responses must use the same review-state visibility rule',
);

const cacheWriteIndex = readSource.indexOf('caches.default.put');
const personalizedReturnIndex = readSource.indexOf('return applyProjectListViewerState(c, payload, response);');
assert.ok(cacheWriteIndex >= 0, 'shared cache write must exist');
assert.ok(personalizedReturnIndex > cacheWriteIndex, 'viewer-specific likes and review visibility must be applied only after the shared response is cached');

assert.match(
  dbSource,
  /getLikedProjectIds: async[\s\S]*FROM project_likes[\s\S]*json_each/,
  'viewer likes must be fetched with one bounded batch lookup',
);

console.log('public project list cache: ok');
