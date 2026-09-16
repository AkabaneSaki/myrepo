import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import {
  isFinalizingReviewDraft,
  isProjectMutationReviewLocked,
  PROJECT_REVIEW_FINALIZING_ERROR,
} from '../src/utils/project-review-lock.ts';

const baseProject = {
  id: 'project-1',
  status: 'pending',
  reviewTarget: 'project',
  publishedProjectId: null,
  isPublished: false,
};

const finalizingDraft = {
  ...baseProject,
  id: 'draft-1',
  status: 'approved',
  reviewTarget: 'draft',
  publishedProjectId: 'published-1',
};

assert.equal(isFinalizingReviewDraft(finalizingDraft), true);
assert.equal(isFinalizingReviewDraft({ ...finalizingDraft, status: 'pending' }), false);
assert.equal(isFinalizingReviewDraft({ ...finalizingDraft, publishedProjectId: null }), false);
assert.match(PROJECT_REVIEW_FINALIZING_ERROR, /review.*finalized|review.*finalizing/i);

let linkedLookupCount = 0;
assert.equal(
  await isProjectMutationReviewLocked(finalizingDraft, async () => {
    linkedLookupCount += 1;
    return null;
  }),
  true,
);
assert.equal(linkedLookupCount, 0, 'direct finalizing draft must lock without a linked lookup');

const publishedProject = {
  ...baseProject,
  id: 'published-1',
  status: 'approved',
  isPublished: true,
};
assert.equal(await isProjectMutationReviewLocked(publishedProject, async () => finalizingDraft), true);
assert.equal(
  await isProjectMutationReviewLocked(publishedProject, async () => ({ ...finalizingDraft, status: 'pending' })),
  false,
);
assert.equal(await isProjectMutationReviewLocked({ ...publishedProject, status: 'pending' }, async () => finalizingDraft), false);

const projectSource = await readFile(resolve('src/endpoints/projects.ts'), 'utf8');
const mutationClasses = [
  'ProjectUpload',
  'ProjectCoverUpload',
  'ProjectCoverPresentationUpdate',
  'ProjectUpdate',
  'ProjectDelete',
  'ProjectRegexUpload',
  'ProjectVisibilityUpdate',
  'ProjectEntryRemove',
];
for (const className of mutationClasses) {
  const start = projectSource.indexOf(`export class ${className} `);
  assert.ok(start >= 0, `${className} source must exist`);
  const next = projectSource.indexOf('\nexport class ', start + 1);
  const source = projectSource.slice(start, next >= 0 ? next : undefined);
  assert.match(source, /isMutationLockedDuringReview\(c, project\)/, `${className} must enforce the review-finalizing lock`);
}

const dbSource = await readFile(resolve('src/utils/db.ts'), 'utf8');
const createDraftStart = dbSource.indexOf('createDraftFromPublished: async (');
const visibilityStart = dbSource.indexOf('setVisibility:', createDraftStart);
assert.ok(createDraftStart >= 0 && visibilityStart > createDraftStart, 'createDraftFromPublished source must be readable');
const createDraftSource = dbSource.slice(createDraftStart, visibilityStart);
assert.match(
  createDraftSource,
  /existingDraft\.reviewTarget === 'draft' && existingDraft\.status === 'approved'[\s\S]{0,120}return null/,
  'createDraftFromPublished must fail closed instead of reusing a draft being finalized',
);

console.log('Project review-finalizing mutation lock smoke checks passed.');
