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

const creatorToken = createToken({ userId: 'cw_validation_creator', username: 'Validation Creator', isAdmin: false });
const adminToken = createToken({ userId: 'cw_validation_admin', username: 'Validation Admin', isAdmin: true });

async function api(path, { method = 'GET', token, body, expected = 200, contentType = 'application/json' } = {}) {
  const headers = {};
  if (token) headers.authorization = `Bearer ${token}`;
  let requestBody;
  if (body !== undefined) {
    headers['content-type'] = contentType;
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
  assert.equal(response.status, expected, `${method} ${path}: expected ${expected}, got ${response.status}: ${text}`);
  return data;
}

async function createProject(name, tags = ['角色']) {
  return api('/api/projects', {
    method: 'POST',
    token: creatorToken,
    body: { name, description: 'validation test', tags },
  });
}

async function approve(projectId, expected = 200) {
  const detail = await api(`/api/projects/${projectId}`, { token: creatorToken });
  return api(`/api/admin/review/${projectId}`, {
    method: 'POST',
    token: adminToken,
    body: { action: 'approve', expectedRevision: detail.project.draftRevision },
    expected,
  });
}

async function cleanup(id) {
  if (!id) return;
  try {
    await api(`/api/projects/${id}`, { method: 'DELETE', token: adminToken });
  } catch {
    // Best effort: approval may already have removed a draft.
  }
}

const worldbook = JSON.stringify({
  entries: [
    { uid: 1, comment: 'Valid', content: 'hello', key: ['hello'], constant: true, position: 0 },
  ],
});
const regex = JSON.stringify([
  { id: 'regex-only', scriptName: 'Regex only', findRegex: 'foo', replaceString: 'bar' },
]);

const oversizedUpload = 'x'.repeat(10 * 1024 * 1024 + 1);

async function expectOversizedCover(projectId) {
  const formData = new FormData();
  formData.set(
    'cover',
    new Blob([new Uint8Array(10 * 1024 * 1024 + 1)], { type: 'image/png' }),
    'oversized.png',
  );
  const response = await fetch(`${BASE_URL}/api/projects/${projectId}/upload-cover`, {
    method: 'POST',
    headers: { authorization: `Bearer ${creatorToken}` },
    body: formData,
  });
  const text = await response.text();
  assert.equal(response.status, 413, `oversized cover: expected 413, got ${response.status}: ${text}`);
  assert.match(text, /10MB/);
}

const cleanupIds = new Set();
try {
  const empty = await createProject('Validation Empty');
  cleanupIds.add(empty.projectId);

  await api(`/api/projects/${empty.projectId}/upload`, {
    method: 'POST',
    token: creatorToken,
    body: oversizedUpload,
    expected: 413,
  });
  await api(`/api/projects/${empty.projectId}/upload-regex`, {
    method: 'POST',
    token: creatorToken,
    body: oversizedUpload,
    expected: 413,
  });
  await expectOversizedCover(empty.projectId);
  const emptyDetail = await api(`/api/projects/${empty.projectId}`, { token: creatorToken });
  await api(`/api/admin/review/${empty.projectId}`, {
    method: 'POST',
    token: adminToken,
    body: { action: 'approve', expectedRevision: emptyDetail.project.draftRevision },
    expected: 409,
  });

  await api(`/api/projects/${empty.projectId}/upload`, {
    method: 'POST',
    token: creatorToken,
    body: 'not-json',
    expected: 400,
  });
  await api(`/api/projects/${empty.projectId}/upload`, {
    method: 'POST',
    token: creatorToken,
    body: JSON.stringify({ hello: 'world' }),
    expected: 400,
  });
  await api(`/api/projects/${empty.projectId}/upload-regex`, {
    method: 'POST',
    token: creatorToken,
    body: JSON.stringify({ hello: 'world' }),
    expected: 400,
  });

  await api(`/api/projects/${empty.projectId}/upload`, {
    method: 'POST',
    token: creatorToken,
    body: worldbook,
  });
  await approve(empty.projectId);

  const metadataDraft = await api(`/api/projects/${empty.projectId}`, {
    method: 'PUT',
    token: creatorToken,
    body: { name: 'Validation Empty Renamed' },
  });
  cleanupIds.add(metadataDraft.projectId);
  await approve(metadataDraft.projectId);
  cleanupIds.delete(metadataDraft.projectId);

  const invalidStructuredExtension = await api('/api/projects', {
    method: 'POST',
    token: creatorToken,
    body: {
      name: 'Validation Structured Extension Missing Type',
      description: 'taxonomy validation test',
      projectType: '扩展',
      customTags: [],
      tags: ['扩展'],
    },
    expected: 400,
  });
  assert.match(String(invalidStructuredExtension?.error || ''), /规则|内容/);

  const structuredCharacter = await api('/api/projects', {
    method: 'POST',
    token: creatorToken,
    body: {
      name: 'Validation Structured Character',
      description: 'taxonomy lifecycle test',
      projectType: '角色',
      facets: {
        种族: ['人鱼'],
        身份: ['圣女'],
        个性: ['hnh'],
        外貌特征: ['白发红瞳'],
        组织: ['教会/神殿'],
        势力: ['王国'],
      },
      customTags: ['纯爱', '慢热'],
      tags: ['角色', '纯爱', '慢热'],
    },
  });
  cleanupIds.add(structuredCharacter.projectId);
  await api(`/api/projects/${structuredCharacter.projectId}/upload`, {
    method: 'POST',
    token: creatorToken,
    body: worldbook,
  });

  const structuredCharacterDraftDetail = await api(`/api/projects/${structuredCharacter.projectId}`, { token: creatorToken });
  assert.equal(structuredCharacterDraftDetail.project.projectType, '角色');
  assert.equal(structuredCharacterDraftDetail.project.extensionType, null);
  assert.deepEqual(structuredCharacterDraftDetail.project.facets.种族, ['人鱼']);
  assert.deepEqual(structuredCharacterDraftDetail.project.facets.个性, ['hnh']);
  assert.deepEqual(structuredCharacterDraftDetail.project.customTags, ['纯爱', '慢热']);
  assert.deepEqual(structuredCharacterDraftDetail.project.tags, ['角色', '纯爱', '慢热']);
  await approve(structuredCharacter.projectId);

  const structuredCharacterPublished = await api(`/api/projects/${structuredCharacter.projectId}`);
  assert.equal(structuredCharacterPublished.project.projectType, '角色');
  assert.deepEqual(structuredCharacterPublished.project.facets.势力, ['王国']);
  assert.deepEqual(structuredCharacterPublished.project.customTags, ['纯爱', '慢热']);

  const taxonomyDraft = await api(`/api/projects/${structuredCharacter.projectId}`, {
    method: 'PUT',
    token: creatorToken,
    body: {
      projectType: '扩展',
      extensionType: '规则',
      facets: {},
      customTags: ['战斗'],
      tags: ['扩展', '战斗'],
    },
  });
  cleanupIds.add(taxonomyDraft.projectId);
  const taxonomyDraftDetail = await api(`/api/projects/${taxonomyDraft.projectId}`, { token: creatorToken });
  assert.equal(taxonomyDraftDetail.project.projectType, '扩展');
  assert.equal(taxonomyDraftDetail.project.extensionType, '规则');
  assert.deepEqual(taxonomyDraftDetail.project.facets, {});
  assert.deepEqual(taxonomyDraftDetail.project.customTags, ['战斗']);
  assert.deepEqual(taxonomyDraftDetail.project.tags, ['扩展', '战斗']);
  await approve(taxonomyDraft.projectId);
  cleanupIds.delete(taxonomyDraft.projectId);

  const taxonomyPublished = await api(`/api/projects/${structuredCharacter.projectId}`);
  assert.equal(taxonomyPublished.project.projectType, '扩展');
  assert.equal(taxonomyPublished.project.extensionType, '规则');
  assert.deepEqual(taxonomyPublished.project.facets, {});
  assert.deepEqual(taxonomyPublished.project.customTags, ['战斗']);
  assert.deepEqual(taxonomyPublished.project.tags, ['扩展', '战斗']);

  const roleRegexOnly = await createProject('Validation Regex Only');
  cleanupIds.add(roleRegexOnly.projectId);
  await api(`/api/projects/${roleRegexOnly.projectId}/upload-regex`, {
    method: 'POST',
    token: creatorToken,
    body: regex,
  });
  await approve(roleRegexOnly.projectId, 409);

  const extensionRegexOnly = await createProject('Validation Extension Regex Only', ['扩展']);
  cleanupIds.add(extensionRegexOnly.projectId);
  await api(`/api/projects/${extensionRegexOnly.projectId}/upload-regex`, {
    method: 'POST',
    token: creatorToken,
    body: regex,
  });
  await approve(extensionRegexOnly.projectId);

  const publishedRegex = await api(`/api/projects/${extensionRegexOnly.projectId}`);
  assert.equal(publishedRegex.project.status, 'approved');
  assert.equal(publishedRegex.regexEntriesPreview.length, 1);

  const typeMismatch = await createProject('Validation Type Mismatch');
  cleanupIds.add(typeMismatch.projectId);
  await api(`/api/projects/${typeMismatch.projectId}/upload-regex`, {
    method: 'POST',
    token: creatorToken,
    body: worldbook,
    expected: 400,
  });
  await api(`/api/projects/${typeMismatch.projectId}/upload`, {
    method: 'POST',
    token: creatorToken,
    body: regex,
    expected: 400,
  });

  console.log('content validation and approval preconditions: ok');
} finally {
  for (const id of cleanupIds) {
    await cleanup(id);
  }
}
