import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const adminSource = await readFile(resolve('src/endpoints/admin.ts'), 'utf8');
const dbSource = await readFile(resolve('src/utils/db.ts'), 'utf8');
const r2Source = await readFile(resolve('src/utils/r2.ts'), 'utf8');
const { r2Storage } = await import('../src/utils/r2.ts');

const reviewStart = dbSource.indexOf('review: async (');
const pendingListStart = dbSource.indexOf('getPendingList:', reviewStart);
assert.ok(reviewStart >= 0 && pendingListStart > reviewStart, 'projectDb.review source must be readable');
const reviewSource = dbSource.slice(reviewStart, pendingListStart);

assert.match(reviewSource, /status = 'pending'/, 'review mutation must atomically require pending status');
assert.match(reviewSource, /draft_revision = \?/, 'review mutation must atomically require the reviewed revision');
assert.match(reviewSource, /meta\?\.changes|meta\.changes/, 'review mutation must verify that exactly one row changed');
assert.match(adminSource, /if \(!reviewedAt\)[\s\S]{0,180}409/, 'stale/already-completed reviews must return conflict');
assert.match(adminSource, /restoreApprovedReviewToPending/, 'failed draft publication must restore the review to pending');
assert.match(adminSource, /draftProjectId: null/, 'approving a draft must clear the published working-draft pointer');
assert.match(adminSource, /rejectSupersededSiblingDrafts/, 'approving a draft must retire sibling review snapshots');
assert.match(reviewSource, /reject_reason = '已被其他已通过版本取代'/, 'superseded sibling drafts must get an automatic reason');
assert.match(reviewSource, /status IN \('pending', 'drafting'\)/, 'both submitted and still-editing stale siblings must be retired');
assert.match(reviewSource, /COALESCE\(latest_approved_at, ''\) = COALESCE\(\?, ''\)/, 'direct sibling cleanup must stay on the approved draft base revision');
assert.match(reviewSource, /COALESCE\(published\.latest_approved_at, ''\) <> COALESCE\(projects\.latest_approved_at, ''\)/, 'stale queued drafts must be detectable from their published baseline');

const pendingEndpointStart = adminSource.indexOf('export class AdminPendingList');
const pendingCleanupEndpointStart = adminSource.indexOf('export class AdminPendingCleanup');
const reviewDetailEndpointStart = adminSource.indexOf('export class AdminReviewDetail');
assert.ok(pendingEndpointStart >= 0 && pendingCleanupEndpointStart > pendingEndpointStart, 'admin pending endpoint source must be readable');
assert.ok(reviewDetailEndpointStart > pendingCleanupEndpointStart, 'admin pending cleanup endpoint source must be readable');
const pendingEndpointSource = adminSource.slice(pendingEndpointStart, pendingCleanupEndpointStart);
const pendingCleanupEndpointSource = adminSource.slice(pendingCleanupEndpointStart, reviewDetailEndpointStart);
assert.doesNotMatch(pendingEndpointSource, /readReviewContentText|readDirectReviewContentText|buildProjectReviewDiff|parseWorldbookEntriesPreview|parseRegexEntriesPreview|R2_BUCKET/, 'queue sorting/listing must not read or parse full project content');
assert.match(pendingEndpointSource, /result\.projects\.map/, 'queue listing should map lightweight database metadata only');
assert.doesNotMatch(pendingEndpointSource, /rejectOutdatedDrafts/, 'opening the queue must not trigger a cleanup write');
assert.match(pendingCleanupEndpointSource, /projectDb\.rejectOutdatedDrafts/, 'manual cleanup endpoint must retire outdated drafts');

assert.match(r2Source, /rollback:/, 'published R2 replacement must expose a rollback operation');
assert.match(r2Source, /mutatedKeys/, 'R2 rollback must track only keys changed by the current publication attempt');

function createFakeBucket({ failAtPut = null } = {}) {
  const state = new Map([
    ['projects/draft/project-draft.json', { body: 'NEW_PROJECT', httpMetadata: { contentType: 'application/json' }, customMetadata: {} }],
    ['projects/draft/regex-draft.json', { body: 'NEW_REGEX', httpMetadata: { contentType: 'application/json' }, customMetadata: {} }],
    ['projects/draft/cover.png', { body: 'NEW_COVER', httpMetadata: { contentType: 'image/png' }, customMetadata: {} }],
    ['projects/live/project-live.json', { body: 'OLD_PROJECT', httpMetadata: { contentType: 'application/json' }, customMetadata: {} }],
    ['projects/live/regex-live.json', { body: 'OLD_REGEX', httpMetadata: { contentType: 'application/json' }, customMetadata: {} }],
    ['projects/live/cover.jpg', { body: 'OLD_COVER', httpMetadata: { contentType: 'image/jpeg' }, customMetadata: {} }],
  ]);
  let putCount = 0;

  const toArrayBuffer = value => new TextEncoder().encode(value).buffer;
  const fromArrayBuffer = value => new TextDecoder().decode(new Uint8Array(value));
  const objectFor = (key, value) => ({
    key,
    size: new TextEncoder().encode(value.body).byteLength,
    httpMetadata: value.httpMetadata,
    customMetadata: value.customMetadata,
    async arrayBuffer() {
      return toArrayBuffer(value.body);
    },
  });

  return {
    state,
    bucket: {
      async list({ prefix }) {
        return {
          objects: [...state.keys()].filter(key => key.startsWith(prefix)).map(key => ({ key })),
        };
      },
      async get(key) {
        const value = state.get(key);
        return value ? objectFor(key, value) : null;
      },
      async put(key, body, options = {}) {
        putCount += 1;
        if (failAtPut === putCount) throw new Error(`forced put failure ${putCount}`);
        const text = fromArrayBuffer(body);
        const value = {
          body: text,
          httpMetadata: options.httpMetadata || {},
          customMetadata: options.customMetadata || {},
        };
        state.set(key, value);
        return objectFor(key, value);
      },
      async delete(keyOrKeys) {
        const keys = Array.isArray(keyOrKeys) ? keyOrKeys : [keyOrKeys];
        for (const key of keys) state.delete(key);
      },
    },
  };
}

function makeContext(bucket) {
  return {
    env: { R2_BUCKET: bucket },
    req: { url: 'https://workshop.test/api/admin/review/draft' },
  };
}

{
  const { bucket, state } = createFakeBucket();
  const result = await r2Storage.copyProjectFilesToPublished(
    makeContext(bucket),
    'draft',
    'live',
    'projects/draft/cover.png',
  );
  assert.equal(state.get('projects/live/project-live.json')?.body, 'NEW_PROJECT');
  assert.equal(state.get('projects/live/regex-live.json')?.body, 'NEW_REGEX');
  assert.equal(state.get('projects/live/cover.png')?.body, 'NEW_COVER');
  assert.equal(state.has('projects/live/cover.jpg'), false);

  await result.rollback();
  assert.equal(state.get('projects/live/project-live.json')?.body, 'OLD_PROJECT');
  assert.equal(state.get('projects/live/regex-live.json')?.body, 'OLD_REGEX');
  assert.equal(state.get('projects/live/cover.jpg')?.body, 'OLD_COVER');
  assert.equal(state.has('projects/live/cover.png'), false);
}

{
  const { bucket, state } = createFakeBucket({ failAtPut: 2 });
  await assert.rejects(
    r2Storage.copyProjectFilesToPublished(
      makeContext(bucket),
      'draft',
      'live',
      'projects/draft/cover.png',
    ),
    /forced put failure 2/,
  );
  assert.equal(state.get('projects/live/project-live.json')?.body, 'OLD_PROJECT');
  assert.equal(state.get('projects/live/regex-live.json')?.body, 'OLD_REGEX');
  assert.equal(state.get('projects/live/cover.jpg')?.body, 'OLD_COVER');
  assert.equal(state.has('projects/live/cover.png'), false);
}

{
  const { bucket, state } = createFakeBucket();
  const result = await r2Storage.copyProjectFilesToPublished(
    makeContext(bucket), 'draft', 'live', 'projects/draft/cover.png',
    [{ type: 'worldbook', text: 'REVIEWED_PROJECT' }, { type: 'regex', text: 'REVIEWED_REGEX' }],
  );
  assert.equal(state.get('projects/live/project-live.json')?.body, 'REVIEWED_PROJECT', 'a later draft upload must not replace the reviewed bytes');
  assert.equal(state.get('projects/live/regex-live.json')?.body, 'REVIEWED_REGEX');
  await result.rollback();
  assert.equal(state.get('projects/live/project-live.json')?.body, 'OLD_PROJECT');
  assert.equal(state.get('projects/live/regex-live.json')?.body, 'OLD_REGEX');
}

console.log('Admin review recovery smoke checks passed.');
