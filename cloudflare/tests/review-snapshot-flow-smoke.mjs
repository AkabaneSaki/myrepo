import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { bumpProjectVersionWithLegacyFallback } from '../src/utils/version.js';

const adminSource = await readFile(resolve('src/endpoints/admin.ts'), 'utf8');
const projectsSource = await readFile(resolve('src/endpoints/projects/write.ts'), 'utf8');
const dbSource = await readFile(resolve('src/utils/db.ts'), 'utf8');
const typesSource = await readFile(resolve('src/types.ts'), 'utf8');
const cardsSource = await readFile(resolve('src/pages/home/render/cards.ts'), 'utf8');

assert.equal(bumpProjectVersionWithLegacyFallback('1.2.3', 'patch'), '1.2.4');
assert.match(typesSource, /ProjectStatus = z\.enum\(\['drafting', 'pending', 'approved', 'rejected'\]\)/);

assert.match(
  adminSource,
  /expectedTargetVersion = bumpProjectVersionWithLegacyFallback\(published\.version, 'patch'\)/,
  'review approval must derive the only acceptable target from the current published version',
);
assert.match(
  adminSource,
  /project\.version !== expectedTargetVersion[\s\S]{0,350}409/,
  'an old frozen review request must fail instead of being promoted to a newer version',
);
assert.match(adminSource, /approvedVersion = project\.version/, 'approval must publish the frozen request version itself');
assert.doesNotMatch(
  adminSource,
  /action === 'reject' && project\.reviewTarget === 'draft'[\s\S]{0,180}draftProjectId: projectId/,
  'rejecting an old review request must not steal the current working-draft pointer',
);

const createDraftStart = dbSource.indexOf('createDraftFromPublished: async (');
const setVisibilityStart = dbSource.indexOf('setVisibility:', createDraftStart);
const createDraftSource = dbSource.slice(createDraftStart, setVisibilityStart);
assert.match(
  createDraftSource,
  /published\.draftProjectId \? await projectDb\.get\(c, published\.draftProjectId\) : null/,
  'new edits must follow only the published project current-draft pointer',
);
assert.doesNotMatch(
  createDraftSource,
  /findDraftByPublishedId/,
  'historical review requests must not be silently reused as the current working draft',
);
assert.match(
  createDraftSource,
  /WHERE id = \? AND draft_project_id IS NULL/,
  'draft creation must atomically claim an empty published draft pointer',
);
assert.doesNotMatch(
  createDraftSource,
  /projectDb\.update\(c, publishedProjectId, \{ draftProjectId: draftId \}\)/,
  'draft creation must not unconditionally overwrite the current draft pointer',
);
assert.match(
  createDraftSource,
  /status: 'drafting'[\s\S]{0,900}claimResult[\s\S]{0,900}status: 'pending'/,
  'an unclaimed candidate must stay out of the review queue until it wins the pointer claim',
);
assert.match(
  createDraftSource,
  /await projectDb\.delete\(c, draftId\)[\s\S]{0,300}createDraftFromPublished/,
  'a losing draft candidate must be removed and retry against the winning pointer',
);

const claimSqlMatch = createDraftSource.match(
  /\`(UPDATE projects\s+SET draft_project_id = \?, updated_at = \?\s+WHERE id = \? AND draft_project_id IS NULL)(?: RETURNING id)?\`/,
);
assert.ok(claimSqlMatch, 'review draft claim SQL must remain directly testable');
const raceDb = new DatabaseSync(':memory:');
raceDb.exec('CREATE TABLE projects (id TEXT PRIMARY KEY, draft_project_id TEXT, updated_at TEXT)');
raceDb.prepare('INSERT INTO projects (id, draft_project_id, updated_at) VALUES (?, NULL, ?)').run('published', 't0');
const claimDraft = raceDb.prepare(claimSqlMatch[1]);
const firstClaim = claimDraft.run('draft-a', 't1', 'published');
const secondClaim = claimDraft.run('draft-b', 't2', 'published');
assert.equal(Number(firstClaim.changes), 1, 'first concurrent draft candidate must win the pointer claim');
assert.equal(Number(secondClaim.changes), 0, 'second concurrent draft candidate must not overwrite the winner');
assert.equal(
  raceDb.prepare('SELECT draft_project_id FROM projects WHERE id = ?').get('published').draft_project_id,
  'draft-a',
  'published project must keep the first successfully claimed draft id',
);
raceDb.close();
assert.match(
  dbSource,
  /UPDATE projects SET draft_project_id = NULL, updated_at = \? WHERE id = \? AND draft_project_id = \?/,
  'deleting an old request must not clear a newer working-draft pointer',
);
const currentDraftIndex = dbSource.indexOf('const currentDraft = publishedProject?.draftProjectId');
const publishedFallbackIndex = dbSource.indexOf('if (publishedProject) return publishedProject;', currentDraftIndex);
const pendingFallbackIndex = dbSource.indexOf('const pendingDraft = projects.find', currentDraftIndex);
assert.ok(
  currentDraftIndex >= 0 && publishedFallbackIndex > currentDraftIndex && pendingFallbackIndex > publishedFallbackIndex,
  'creator project list must show the current draft, then Published, before historical review requests',
);

assert.match(
  projectsSource,
  /project\.reviewTarget === 'draft' && project\.publishedProjectId && project\.status === 'pending'/,
  'continue-edit applies to a frozen update review request',
);
assert.match(projectsSource, /status: 'drafting'/, 'continue-edit must create a non-reviewing working draft');
assert.match(projectsSource, /copyProjectFilesToPublished\([\s\S]{0,180}project\.id,[\s\S]{0,80}nextDraftId/, 'new working draft must inherit the frozen snapshot files');
assert.match(projectsSource, /continuedDraftProjectId: nextDraftId/, 'continue-edit must return the new working draft id');
assert.match(cardsSource, /继续编辑/, 'pending review request UI must expose continue-edit rather than mutable editing');

console.log('review snapshot flow smoke: ok');
