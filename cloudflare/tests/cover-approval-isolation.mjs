import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { analyzeProjectCodeV2, CHECKER_VERSION } from '../src/utils/ejs-checker/index.mjs';
import { applyAuditBaseline, buildAuditSnapshot, buildReviewPolicyVersion } from '../src/utils/ejs-checker/audit.mjs';

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

const creatorToken = createToken({ userId: 'cw_cover_creator', username: 'Cover Creator', isAdmin: false });
const adminToken = createToken({ userId: 'cw_cover_admin', username: 'Cover Admin', isAdmin: true });

async function api(path, { method = 'GET', token, body, expected = 200, attestation } = {}) {
  const headers = {};
  if (token) headers.authorization = `Bearer ${token}`;
  if (attestation) headers['x-workshop-content-attestation'] = attestation;
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

/** Stands in for a device: runs the complete checker over the exact pending content. */
async function runDeviceCheck(deviceCheck) {
  const report = analyzeProjectCodeV2(deviceCheck.files);
  const auditSnapshot = report.gate === 'reject' ? null : await buildAuditSnapshot(deviceCheck.files, report);
  return {
    success: true,
    gate: report.gate,
    engine: report.engine,
    parserCompatibility: report.parserCompatibility,
    policyVersion: auditSnapshot?.policyVersion ?? buildReviewPolicyVersion(CHECKER_VERSION),
    checkerRevision: CHECKER_VERSION.engine + ':' + CHECKER_VERSION.policyVersion,
    trustedAssetHosts: deviceCheck.trustedAssetHosts,
    projectId: deviceCheck.projectId,
    draftRevision: deviceCheck.draftRevision,
    filesHash: auditSnapshot?.filesHash ?? '',
    auditSnapshot,
    report: auditSnapshot ? applyAuditBaseline(report, auditSnapshot, deviceCheck.baseline) : report,
  };
}

async function approveProject(projectId) {
  const detail = await api(`/api/admin/review/${projectId}`, { token: adminToken });
  return api(`/api/admin/review/${projectId}`, {
    method: 'POST',
    token: adminToken,
    body: {
      action: 'approve',
      expectedRevision: detail.project.draftRevision,
      reviewerResult: {
        ...(await runDeviceCheck(detail.deviceCheck)),
        challenge: detail.deviceCheck.challenge,
      },
    },
  });
}

async function uploadCover(projectId, bytes, contentType, fileName) {  const form = new FormData();
  form.set('cover', new Blob([bytes], { type: contentType }), fileName);
  const response = await fetch(`${BASE_URL}/api/projects/${projectId}/upload-cover`, {
    method: 'POST',
    headers: { authorization: `Bearer ${creatorToken}` },
    body: form,
  });
  const text = await response.text();
  assert.equal(response.status, 200, `cover upload failed: HTTP ${response.status}: ${text}`);
  return text ? JSON.parse(text) : null;
}

async function fetchFile(path, { token, expected = 200 } = {}) {
  const headers = token ? { authorization: `Bearer ${token}` } : {};
  const response = await fetch(`${BASE_URL}${path}`, { headers });
  const body = Buffer.from(await response.arrayBuffer());
  assert.equal(response.status, expected, `GET ${path}: expected HTTP ${expected}, got ${response.status}`);
  return body;
}

const worldbook = {
  entries: [
    {
      uid: 1,
      comment: 'Cover test',
      content: 'Cover isolation test content',
      key: ['cover-test'],
      constant: true,
      position: 0,
      order: 100,
    },
  ],
};

const initialCover = Buffer.from('initial-cover-png');
const replacementCoverWebp = Buffer.from('replacement-cover-webp');
const replacementCoverJpg = Buffer.from('replacement-cover-jpg');

let publishedId = null;
let draftId = null;

async function cleanupProject(id) {
  if (!id) return;
  try {
    await api(`/api/projects/${id}`, { method: 'DELETE', token: adminToken });
  } catch {
    // Best-effort cleanup for a project that approval may already have removed.
  }
}

try {
  const created = await api('/api/projects', {
    method: 'POST',
    token: creatorToken,
    body: {
      name: 'Cover Isolation Test',
      description: 'Local-only integration test',
      version: '1.0.0',
      tags: ['角色'],
    },
  });
  publishedId = created.projectId;
  assert.ok(publishedId);

  const worldbookReceipt = await api('/api/projects/preflight/worldbook', {
    method: 'POST',
    token: creatorToken,
    body: JSON.stringify(worldbook),
  });
  await api(`/api/projects/${publishedId}/upload`, {
    method: 'POST',
    token: creatorToken,
    body: JSON.stringify(worldbook),
    attestation: worldbookReceipt.attestation,
  });
  await uploadCover(publishedId, initialCover, 'image/png', 'initial.png');

  await approveProject(publishedId);

  assert.deepEqual(await fetchFile(`/api/files/projects/${publishedId}/cover.png`), initialCover);

  const firstReplacement = await uploadCover(
    publishedId,
    replacementCoverWebp,
    'image/webp',
    'replacement.webp',
  );
  draftId = firstReplacement.projectId;
  assert.ok(draftId);
  assert.notEqual(draftId, publishedId);

  const secondReplacement = await uploadCover(
    publishedId,
    replacementCoverJpg,
    'image/jpeg',
    'replacement.jpg',
  );
  assert.equal(secondReplacement.projectId, draftId);

  assert.deepEqual(await fetchFile(`/api/files/projects/${publishedId}/cover.png`), initialCover);
  await fetchFile(`/api/files/projects/${draftId}/cover.jpg`, { expected: 404 });
  assert.deepEqual(
    await fetchFile(`/api/files/projects/${draftId}/cover.jpg`, { token: creatorToken }),
    replacementCoverJpg,
  );

  await approveProject(draftId);
  draftId = null;

  const published = await api(`/api/projects/${publishedId}`);
  assert.ok(published.project.coverImage.includes(`projects/${publishedId}/cover.jpg`));
  assert.deepEqual(await fetchFile(`/api/files/projects/${publishedId}/cover.jpg`), replacementCoverJpg);
  await fetchFile(`/api/files/projects/${publishedId}/cover.png`, { expected: 404 });

  console.log('cover approval isolation: ok');
} finally {
  await cleanupProject(draftId);
  await cleanupProject(publishedId);
}
