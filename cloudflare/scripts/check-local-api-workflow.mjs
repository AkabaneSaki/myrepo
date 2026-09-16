import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';

const BASE_URL = 'http://127.0.0.1:8791';
const SIGNING_VALUE = 'cw-local-api-test';

function encodeJson(value) {
  return Buffer.from(JSON.stringify(value)).toString('base64url');
}

function createToken({ userId, username, isAdmin }) {
  const now = Math.floor(Date.now() / 1000);
  const header = encodeJson({ alg: 'HS256', typ: 'JWT' });
  const payload = encodeJson({
    userId,
    username,
    globalName: username,
    avatar: '',
    isAdmin,
    isSuperAdmin: isAdmin,
    iat: now,
    exp: now + 3600,
  });
  const signature = createHmac('sha256', SIGNING_VALUE)
    .update(`${header}.${payload}`)
    .digest('base64url');
  return `${header}.${payload}.${signature}`;
}

const creatorToken = createToken({ userId: 'cw_local_creator', username: 'Local Creator', isAdmin: false });
const otherUserToken = createToken({ userId: 'cw_local_other', username: 'Local Other', isAdmin: false });
const adminToken = createToken({ userId: 'cw_local_admin', username: 'Local Admin', isAdmin: true });

async function api(path, { method = 'GET', token, body, expected = 200 } = {}) {
  const headers = {};
  if (token) headers.authorization = `Bearer ${token}`;
  let requestBody;
  if (body !== undefined) {
    headers['content-type'] = 'application/json';
    requestBody = typeof body === 'string' ? body : JSON.stringify(body);
  }

  const response = await fetch(`${BASE_URL}${path}`, { method, headers, body: requestBody });
  const text = await response.text();
  let data = null;
  if (text) {
    try {
      data = JSON.parse(text);
    } catch {
      data = text;
    }
  }
  assert.equal(
    response.status,
    expected,
    `${method} ${path}: expected HTTP ${expected}, got ${response.status}: ${text}`,
  );
  return data;
}

const worldbook = {
  entries: [
    {
      uid: 101,
      comment: 'Alpha',
      content: 'Alpha content',
      key: ['alpha'],
      constant: true,
      position: 0,
      order: 601,
    },
    {
      uid: 102,
      comment: 'Depth',
      content: 'Depth content',
      key: ['depth'],
      constant: false,
      vectorized: false,
      position: 4,
      depth: 3,
      role: 2,
      order: -20,
    },
    {
      uid: 103,
      comment: 'Outlet',
      content: 'Outlet content',
      key: ['outlet'],
      constant: false,
      vectorized: false,
      position: 7,
      outletName: 'AfterStatus',
      order: 7,
    },
  ],
};

const regex = [
  { id: 'r1', scriptName: 'First', findRegex: 'foo', replaceString: 'bar' },
  { id: 'r2', scriptName: 'Second', findRegex: 'hello', replaceString: 'world' },
];

let publishedId = null;
let draftId = null;
let pendingDeleteId = null;
let rejectedId = null;
let rankingFreshnessId = null;

async function cleanupProject(id) {
  if (!id) return;
  try {
    await api(`/api/projects/${id}`, { method: 'DELETE', token: adminToken, expected: 200 });
  } catch {
    // Best-effort cleanup for a failed test; the project may already have been deleted by approval.
  }
}

try {
  const rejectCandidate = await api('/api/projects', {
    method: 'POST',
    token: creatorToken,
    body: {
      name: 'Local API Reject Test',
      description: 'Admin review reject and permission checks',
      tags: ['系统'],
    },
  });
  rejectedId = rejectCandidate.projectId;
  assert.ok(rejectedId);
  await api(`/api/projects/${rejectedId}/upload`, {
    method: 'POST',
    token: creatorToken,
    body: JSON.stringify(worldbook),
  });
  const rejectCandidateDetail = await api(`/api/projects/${rejectedId}`, { token: creatorToken });
  const rejectRevision = rejectCandidateDetail.project.draftRevision;

  await api(`/api/admin/review/${rejectedId}`, { token: creatorToken, expected: 403 });
  await api(`/api/admin/review/${rejectedId}`, {
    method: 'POST',
    token: creatorToken,
    body: { action: 'reject', rejectReason: 'creator must not review', expectedRevision: rejectRevision },
    expected: 403,
  });
  const missingReason = await api(`/api/admin/review/${rejectedId}`, {
    method: 'POST',
    token: adminToken,
    body: { action: 'reject', expectedRevision: rejectRevision },
    expected: 400,
  });
  assert.match(String(missingReason.error), /Reject reason required/i);
  await api(`/api/admin/review/${rejectedId}`, {
    method: 'POST',
    token: adminToken,
    body: { action: 'reject', rejectReason: 'Please revise this test project', expectedRevision: rejectRevision },
  });
  const rejected = await api(`/api/projects/${rejectedId}`, { token: creatorToken });
  assert.equal(rejected.project.status, 'rejected');
  assert.equal(rejected.project.rejectReason, 'Please revise this test project');

  const removablePending = await api('/api/projects', {
    method: 'POST',
    token: creatorToken,
    body: {
      name: 'Local API Pending Delete',
      description: 'Pending project should be deletable by its creator',
      versionLabel: '待删除',
      tags: ['系统'],
    },
  });
  pendingDeleteId = removablePending.projectId;
  assert.ok(pendingDeleteId);
  await api(`/api/projects/${pendingDeleteId}/upload`, {
    method: 'POST',
    token: creatorToken,
    body: JSON.stringify(worldbook),
  });
  await api(`/api/projects/${pendingDeleteId}`, { method: 'DELETE', token: creatorToken });
  await api(`/api/projects/${pendingDeleteId}`, { token: creatorToken, expected: 404 });
  pendingDeleteId = null;

  const created = await api('/api/projects', {
    method: 'POST',
    token: creatorToken,
    body: {
      name: 'Local API Test Base',
      description: 'Base description',
      versionLabel: '初版',
      tags: ['角色'],
    },
  });
  publishedId = created.projectId;
  assert.ok(publishedId);

  await api(`/api/projects/${publishedId}/upload`, {
    method: 'POST',
    token: creatorToken,
    body: JSON.stringify(worldbook),
  });
  await api(`/api/projects/${publishedId}/upload-regex`, {
    method: 'POST',
    token: creatorToken,
    body: JSON.stringify(regex),
  });

  const pendingDetail = await api(`/api/projects/${publishedId}`, { token: creatorToken });
  const versionedPendingDetail = await api(`/api/projects/${publishedId}?v=1.0.0`, { token: creatorToken });
  assert.equal(versionedPendingDetail.project.id, publishedId);
  assert.equal(pendingDetail.worldbookEntriesPreview.length, 3);
  assert.equal(pendingDetail.regexEntriesPreview.length, 2);
  assert.equal(pendingDetail.worldbookEntriesPreview[0].order, 601);
  assert.equal(pendingDetail.worldbookEntriesPreview[1].depth, 3);
  assert.equal(pendingDetail.worldbookEntriesPreview[1].order, -20);
  assert.equal(pendingDetail.worldbookEntriesPreview[2].position, 7);
  assert.equal(pendingDetail.project.version, '1.0.0');
  assert.equal(pendingDetail.project.versionLabel, '初版');
  const firstReviewRevision = pendingDetail.project.draftRevision;
  assert.equal(Number.isInteger(firstReviewRevision), true);

  await api(`/api/admin/review/${publishedId}`, {
    method: 'POST',
    token: adminToken,
    body: { action: 'approve', expectedRevision: firstReviewRevision },
  });

  const approved = await api(`/api/projects/${publishedId}`);
  assert.equal(approved.project.status, 'approved');
  assert.equal(approved.project.isPublished, true);
  assert.equal(approved.project.version, '1.0.0');
  assert.equal(approved.project.versionLabel, '初版');
  assert.equal(approved.worldbookEntriesPreview.length, 3);
  assert.equal(approved.regexEntriesPreview.length, 2);

  const stalePostApprovalReview = await api(`/api/admin/review/${publishedId}`, {
    method: 'POST',
    token: adminToken,
    body: {
      action: 'reject',
      rejectReason: 'stale review request must not overwrite an approved project',
      expectedRevision: firstReviewRevision,
    },
    expected: 409,
  });
  assert.match(String(stalePostApprovalReview.error), /already reviewed|changed|conflict/i);
  const approvedAfterStaleReview = await api(`/api/projects/${publishedId}`);
  assert.equal(approvedAfterStaleReview.project.status, 'approved');
  assert.equal(approvedAfterStaleReview.project.isPublished, true);

  await api('/api/projects?page=0&pageSize=50&sort=discover');
  const rankingFreshnessProject = await api('/api/projects', {
    method: 'POST',
    token: creatorToken,
    body: {
      name: 'Ranking Freshness Probe',
      description: 'Must become searchable immediately after approval invalidates discovery snapshot',
      tags: ['角色'],
    },
  });
  rankingFreshnessId = rankingFreshnessProject.projectId;
  assert.ok(rankingFreshnessId);
  await api(`/api/projects/${rankingFreshnessId}/upload`, {
    method: 'POST',
    token: creatorToken,
    body: JSON.stringify(worldbook),
  });
  const rankingFreshnessPending = await api(`/api/projects/${rankingFreshnessId}`, { token: creatorToken });
  await api(`/api/admin/review/${rankingFreshnessId}`, {
    method: 'POST',
    token: adminToken,
    body: { action: 'approve', expectedRevision: rankingFreshnessPending.project.draftRevision },
  });
  const rankingFreshnessSearch = await api(
    '/api/projects?page=0&pageSize=50&sort=discover&search=Ranking%20Freshness%20Probe',
  );
  assert.ok(
    rankingFreshnessSearch.projects.some(project => project.id === rankingFreshnessId),
    'newly approved projects must be searchable immediately even when the current discovery bucket already had a snapshot',
  );
  await cleanupProject(rankingFreshnessId);
  rankingFreshnessId = null;

  await api(`/api/projects/${publishedId}/visibility`, {
    method: 'PUT',
    token: otherUserToken,
    body: { visibility: false },
    expected: 403,
  });
  const hiddenByAdmin = await api(`/api/projects/${publishedId}/visibility`, {
    method: 'PUT',
    token: adminToken,
    body: { visibility: false },
  });
  assert.equal(hiddenByAdmin.visibility, false);
  const restoredByAdmin = await api(`/api/projects/${publishedId}/visibility`, {
    method: 'PUT',
    token: adminToken,
    body: { visibility: true },
  });
  assert.equal(restoredByAdmin.visibility, true);

  const withdrawDraftUpdate = await api(`/api/projects/${publishedId}`, {
    method: 'PUT',
    token: creatorToken,
    body: { description: 'Temporary draft that should be withdrawn' },
  });
  const withdrawnDraftId = withdrawDraftUpdate.draftProjectId;
  assert.ok(withdrawnDraftId);
  await api(`/api/projects/${withdrawnDraftId}`, { method: 'DELETE', token: creatorToken });
  await api(`/api/projects/${withdrawnDraftId}`, { token: creatorToken, expected: 404 });
  const publishedAfterWithdraw = await api(`/api/projects/${publishedId}`, { token: creatorToken });
  assert.equal(publishedAfterWithdraw.project.status, 'approved');
  assert.equal(publishedAfterWithdraw.project.description, 'Base description');
  assert.equal(publishedAfterWithdraw.project.draftProjectId, null);

  const firstDraftUpdate = await api(`/api/projects/${publishedId}`, {
    method: 'PUT',
    token: creatorToken,
    body: { name: 'Local API Draft Name', versionLabel: '2026夏季版' },
  });
  draftId = firstDraftUpdate.draftProjectId;
  assert.ok(draftId);
  assert.equal(firstDraftUpdate.targetVersion, '1.0.1');
  assert.equal('versionBump' in firstDraftUpdate, false);

  const draftAfterName = await api(`/api/projects/${draftId}`, { token: creatorToken });
  assert.equal(draftAfterName.project.version, '1.0.1');
  assert.equal(draftAfterName.project.versionLabel, '2026夏季版');
  const revisionAfterName = draftAfterName.project.draftRevision;

  const secondDraftUpdate = await api(`/api/projects/${publishedId}`, {
    method: 'PUT',
    token: creatorToken,
    body: { description: 'Draft description changed later' },
  });
  assert.equal(secondDraftUpdate.draftProjectId, draftId);
  assert.equal(secondDraftUpdate.targetVersion, '1.0.1');

  const inheritedDraft = await api(`/api/projects/${draftId}`, { token: creatorToken });
  assert.equal(inheritedDraft.project.name, 'Local API Draft Name');
  assert.equal(inheritedDraft.project.description, 'Draft description changed later');
  assert.ok(inheritedDraft.project.draftRevision > revisionAfterName);

  const staleRevision = inheritedDraft.project.draftRevision;
  await api(`/api/projects/${draftId}`, {
    method: 'PUT',
    token: creatorToken,
    body: { name: 'Local API Draft Name Fixed' },
  });
  const changedDuringReview = await api(`/api/projects/${draftId}`, { token: creatorToken });
  assert.ok(changedDuringReview.project.draftRevision > staleRevision);

  const staleReview = await api(`/api/admin/review/${draftId}`, {
    method: 'POST',
    token: adminToken,
    body: { action: 'approve', expectedRevision: staleRevision },
    expected: 409,
  });
  assert.match(String(staleReview.error), /Draft changed/i);

  const removedWorldbook = await api(`/api/projects/${publishedId}/entries/remove`, {
    method: 'POST',
    token: creatorToken,
    body: { kind: 'worldbook', entryKey: 'uid:102' },
  });
  assert.equal(removedWorldbook.projectId, draftId);

  const afterWorldbookDelete = await api(`/api/projects/${draftId}`, { token: creatorToken });
  assert.equal(afterWorldbookDelete.worldbookEntriesPreview.length, 2);
  assert.ok(!afterWorldbookDelete.worldbookEntriesPreview.some(entry => entry.entryKey === 'uid:102'));

  const removedRegex = await api(`/api/projects/${publishedId}/entries/remove`, {
    method: 'POST',
    token: creatorToken,
    body: { kind: 'regex', entryKey: 'id:r2' },
  });
  assert.equal(removedRegex.projectId, draftId);

  const readyToApprove = await api(`/api/projects/${draftId}`, { token: creatorToken });
  assert.equal(readyToApprove.regexEntriesPreview.length, 1);
  assert.ok(!readyToApprove.regexEntriesPreview.some(entry => entry.entryKey === 'id:r2'));

  await api(`/api/admin/review/${draftId}`, {
    method: 'POST',
    token: adminToken,
    body: { action: 'approve', expectedRevision: readyToApprove.project.draftRevision },
  });
  draftId = null;

  const finalPublished = await api(`/api/projects/${publishedId}`);
  assert.equal(finalPublished.project.name, 'Local API Draft Name Fixed');
  assert.equal(finalPublished.project.description, 'Draft description changed later');
  assert.equal(finalPublished.project.status, 'approved');
  assert.equal(finalPublished.project.isPublished, true);
  assert.equal(finalPublished.project.version, '1.0.1');
  assert.equal(finalPublished.project.versionLabel, '2026夏季版');
  assert.equal(finalPublished.worldbookEntriesPreview.length, 2);
  assert.equal(finalPublished.regexEntriesPreview.length, 1);
  assert.ok(!finalPublished.worldbookEntriesPreview.some(entry => entry.entryKey === 'uid:102'));
  assert.ok(!finalPublished.regexEntriesPreview.some(entry => entry.entryKey === 'id:r2'));

  const cascadeDraftUpdate = await api(`/api/projects/${publishedId}`, {
    method: 'PUT',
    token: creatorToken,
    body: { description: 'Draft that should be deleted with the published project' },
  });
  draftId = cascadeDraftUpdate.draftProjectId;
  assert.ok(draftId);
  await api(`/api/projects/${draftId}`, { token: creatorToken });
  await api(`/api/projects/${publishedId}`, { method: 'DELETE', token: adminToken });
  await api(`/api/projects/${publishedId}`, { token: creatorToken, expected: 404 });
  await api(`/api/projects/${draftId}`, { token: creatorToken, expected: 404 });
  draftId = null;
  publishedId = null;

  console.log('local API workflow OK');
} finally {
  await cleanupProject(rejectedId);
  await cleanupProject(pendingDeleteId);
  await cleanupProject(rankingFreshnessId);
  await cleanupProject(draftId);
  await cleanupProject(publishedId);
}
