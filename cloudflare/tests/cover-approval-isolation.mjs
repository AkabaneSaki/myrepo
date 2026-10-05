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

const creatorToken = createToken({ userId: 'cw_cover_creator', username: 'Cover Creator', isAdmin: false });
const adminToken = createToken({ userId: 'cw_cover_admin', username: 'Cover Admin', isAdmin: true });

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

async function uploadCover(projectId, bytes, contentType, fileName) {
  const form = new FormData();
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

  await api(`/api/projects/${publishedId}/upload`, {
    method: 'POST',
    token: creatorToken,
    body: JSON.stringify(worldbook),
  });
  await uploadCover(publishedId, initialCover, 'image/png', 'initial.png');

  const pending = await api(`/api/admin/review/${publishedId}`, { token: adminToken });
  await api(`/api/admin/review/${publishedId}`, {
    method: 'POST',
    token: adminToken,
    body: { action: 'approve', expectedRevision: pending.project.draftRevision, reviewToken: pending.reviewToken },
  });

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

  const draft = await api(`/api/admin/review/${draftId}`, { token: adminToken });
  await api(`/api/admin/review/${draftId}`, {
    method: 'POST',
    token: adminToken,
    body: { action: 'approve', expectedRevision: draft.project.draftRevision, reviewToken: draft.reviewToken },
  });
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
