import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { bumpProjectVersionWithLegacyFallback } from '../src/utils/version.js';

const adminSource = await readFile(resolve('src/endpoints/admin.ts'), 'utf8');
const projectsSource = await readFile(resolve('src/endpoints/projects.ts'), 'utf8');
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
