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

const creatorToken = createToken({ userId: 'cw_validation_creator', username: 'Validation Creator', isAdmin: false });
const adminToken = createToken({ userId: 'cw_validation_admin', username: 'Validation Admin', isAdmin: true });

async function api(path, { method = 'GET', token, body, expected = 200, contentType = 'application/json', attestation } = {}) {
  const headers = {};
  if (token) headers.authorization = `Bearer ${token}`;
  if (attestation) headers['x-workshop-content-attestation'] = attestation;
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

/** Uploads a file the way the creator UI does: attest first, then upload. */
async function uploadFile(projectId, path, text) {
  const receipt = await api(`/api/projects/preflight/${path.endsWith('upload-regex') ? 'regex' : 'worldbook'}`, {
    method: 'POST',
    token: creatorToken,
    body: text,
  });
  return api(`/api/projects/${projectId}/${path}`, {
    method: 'POST',
    token: creatorToken,
    body: text,
    attestation: receipt.attestation,
  });
}

async function approve(projectId, expected = 200) {
  const detail = await api(`/api/admin/review/${projectId}`, { token: adminToken });
  const reviewerResult = {
    ...(await runDeviceCheck(detail.deviceCheck)),
    challenge: detail.deviceCheck.challenge,
  };
  return api(`/api/admin/review/${projectId}`, {
    method: 'POST',
    token: adminToken,
    body: { action: 'approve', expectedRevision: detail.project.draftRevision, reviewerResult },
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
const updatedRegex = JSON.stringify([
  { id: 'regex-only', scriptName: 'Regex only edited', findRegex: 'foo', replaceString: 'baz' },
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

  await uploadFile(empty.projectId, 'upload', worldbook);
  await approve(empty.projectId);

  const metadataDraft = await api(`/api/projects/${empty.projectId}`, {
    method: 'PUT',
    token: creatorToken,
    body: { name: 'Validation Empty Renamed' },
  });
  cleanupIds.add(metadataDraft.projectId);
  await approve(metadataDraft.projectId);
  cleanupIds.delete(metadataDraft.projectId);

  const structuredExtensionWithoutSubtype = await api('/api/projects', {
    method: 'POST',
    token: creatorToken,
    body: {
      name: 'Validation Structured Extension Without Subtype',
      description: 'taxonomy validation test',
      projectType: '扩展',
      customTags: [],
      tags: ['扩展'],
    },
  });
  cleanupIds.add(structuredExtensionWithoutSubtype.projectId);
  const structuredExtensionWithoutSubtypeDetail = await api(`/api/projects/${structuredExtensionWithoutSubtype.projectId}`, { token: creatorToken });
  assert.equal(structuredExtensionWithoutSubtypeDetail.project.projectType, '扩展');
  assert.equal(structuredExtensionWithoutSubtypeDetail.project.extensionType, null);

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
      customTags: ['纯爱', '慢热', '人鱼', '纯爱'],
      displayTags: ['人鱼', '纯爱', '慢热', '人鱼'],
      tags: ['角色', '纯爱', '慢热'],
    },
  });
  cleanupIds.add(structuredCharacter.projectId);
  await uploadFile(structuredCharacter.projectId, 'upload', worldbook);

  const structuredCharacterDraftDetail = await api(`/api/projects/${structuredCharacter.projectId}`, { token: creatorToken });
  assert.equal(structuredCharacterDraftDetail.project.projectType, '角色');
  assert.equal(structuredCharacterDraftDetail.project.extensionType, null);
  assert.deepEqual(structuredCharacterDraftDetail.project.facets.种族, ['人鱼']);
  assert.deepEqual(structuredCharacterDraftDetail.project.facets.个性, ['hnh']);
  assert.deepEqual(structuredCharacterDraftDetail.project.customTags, ['纯爱', '慢热']);
  assert.deepEqual(structuredCharacterDraftDetail.project.displayTags, ['人鱼', '纯爱', '慢热']);
  assert.deepEqual(structuredCharacterDraftDetail.project.tags, ['角色', '纯爱', '慢热']);
  await approve(structuredCharacter.projectId);

  const structuredCharacterPublished = await api(`/api/projects/${structuredCharacter.projectId}`);
  assert.equal(structuredCharacterPublished.project.projectType, '角色');
  assert.deepEqual(structuredCharacterPublished.project.facets.势力, ['王国']);
  assert.deepEqual(structuredCharacterPublished.project.customTags, ['纯爱', '慢热']);
  assert.deepEqual(structuredCharacterPublished.project.displayTags, ['人鱼', '纯爱', '慢热']);
  const facetFilteredProjects = await api('/api/projects?page=0&pageSize=50&tag=' + encodeURIComponent('人鱼'));
  assert.ok(facetFilteredProjects.projects.some(project => project.id === structuredCharacter.projectId));
  const multiFacetFilteredProjects = await api('/api/projects?page=0&pageSize=50&tags=' + encodeURIComponent('人鱼,圣女'));
  assert.ok(multiFacetFilteredProjects.projects.some(project => project.id === structuredCharacter.projectId));
  const mismatchedMultiFacetProjects = await api('/api/projects?page=0&pageSize=50&tags=' + encodeURIComponent('人鱼,规则'));
  assert.ok(!mismatchedMultiFacetProjects.projects.some(project => project.id === structuredCharacter.projectId));

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
  assert.deepEqual(taxonomyDraftDetail.project.displayTags, ['战斗']);
  assert.deepEqual(taxonomyDraftDetail.project.tags, ['扩展', '战斗']);
  await approve(taxonomyDraft.projectId);
  cleanupIds.delete(taxonomyDraft.projectId);
  const extensionTypeFilteredProjects = await api('/api/projects?page=0&pageSize=50&tag=' + encodeURIComponent('规则'));
  assert.ok(extensionTypeFilteredProjects.projects.some(project => project.id === structuredCharacter.projectId));

  const taxonomyPublished = await api(`/api/projects/${structuredCharacter.projectId}`);
  assert.equal(taxonomyPublished.project.projectType, '扩展');
  assert.equal(taxonomyPublished.project.extensionType, '规则');
  assert.deepEqual(taxonomyPublished.project.facets, {});
  assert.deepEqual(taxonomyPublished.project.customTags, ['战斗']);
  assert.deepEqual(taxonomyPublished.project.displayTags, ['战斗']);
  assert.deepEqual(taxonomyPublished.project.tags, ['扩展', '战斗']);

  const roleRegexOnly = await createProject('Validation Regex Only');
  cleanupIds.add(roleRegexOnly.projectId);
  await uploadFile(roleRegexOnly.projectId, 'upload-regex', regex);
  await approve(roleRegexOnly.projectId, 409);

  const extensionRegexOnly = await createProject('Validation Extension Regex Only', ['扩展']);
  cleanupIds.add(extensionRegexOnly.projectId);
  await uploadFile(extensionRegexOnly.projectId, 'upload-regex', regex);
  await approve(extensionRegexOnly.projectId);

  const publishedRegex = await api(`/api/projects/${extensionRegexOnly.projectId}`, { token: creatorToken });
  assert.equal(publishedRegex.project.status, 'approved');
  assert.equal(publishedRegex.regexEntriesPreview.length, 1);

  const regexEditDraft = await api(`/api/projects/${extensionRegexOnly.projectId}`, {
    method: 'PUT',
    token: creatorToken,
    body: { description: 'regex-only edit lifecycle test' },
  });
  assert.ok(regexEditDraft.draftProjectId);
  cleanupIds.add(regexEditDraft.draftProjectId);

  const regexEditUpload = await uploadFile(regexEditDraft.draftProjectId, 'upload-regex', updatedRegex);
  assert.equal(regexEditUpload.projectId, regexEditDraft.draftProjectId);

  const regexEditDraftDetail = await api(`/api/projects/${regexEditDraft.draftProjectId}`, { token: creatorToken });
  assert.equal(regexEditDraftDetail.project.reviewTarget, 'draft');
  assert.equal(regexEditDraftDetail.project.publishedProjectId, extensionRegexOnly.projectId);
  assert.equal(regexEditDraftDetail.regexEntriesPreview.length, 1);
  assert.equal(regexEditDraftDetail.regexEntriesPreview[0].id, 'regex-only');
  assert.equal(regexEditDraftDetail.regexEntriesPreview[0].replaceString, 'baz');

  await approve(regexEditDraft.draftProjectId);
  cleanupIds.delete(regexEditDraft.draftProjectId);

  const republishedRegex = await api(`/api/projects/${extensionRegexOnly.projectId}`, { token: creatorToken });
  assert.equal(republishedRegex.project.status, 'approved');
  assert.equal(republishedRegex.project.description, 'regex-only edit lifecycle test');
  assert.equal(republishedRegex.regexEntriesPreview.length, 1);
  assert.equal(republishedRegex.regexEntriesPreview[0].id, 'regex-only');
  assert.equal(republishedRegex.regexEntriesPreview[0].scriptName, 'Regex only edited');
  assert.equal(republishedRegex.regexEntriesPreview[0].replaceString, 'baz');

  // Removing the last worldbook entry is an explicit tombstone. The remaining
  // valid regex keeps this extension valid, and approval must not revive the old file.
  const mixedDraft = await uploadFile(extensionRegexOnly.projectId, 'upload', worldbook);
  cleanupIds.add(mixedDraft.projectId);
  const mixedDetail = await api(`/api/projects/${mixedDraft.projectId}`, { token: creatorToken });
  const removedEntry = await api(`/api/projects/${mixedDraft.projectId}/entries/remove`, { method: 'POST', token: creatorToken, body: { kind: 'worldbook', entryKey: mixedDetail.worldbookEntriesPreview[0].entryKey } });
  assert.equal(removedEntry.success, true);
  await approve(mixedDraft.projectId);
  cleanupIds.delete(mixedDraft.projectId);
  const afterRemoval = await api(`/api/projects/${extensionRegexOnly.projectId}`);
  assert.equal(afterRemoval.worldbookEntriesPreview.length, 0);
  assert.equal(afterRemoval.regexEntriesPreview.length, 1);

  // The inverse tombstone has no regex sources to inspect but its bytes are
  // still bound to the review and must replace the published regex file.
  const worldbookDraft = await uploadFile(extensionRegexOnly.projectId, 'upload', worldbook);
  cleanupIds.add(worldbookDraft.projectId);
  const inverseDetail = await api(`/api/projects/${worldbookDraft.projectId}`, { token: creatorToken });
  await api(`/api/projects/${worldbookDraft.projectId}/entries/remove`, { method: 'POST', token: creatorToken, body: { kind: 'regex', entryKey: inverseDetail.regexEntriesPreview[0].entryKey } });
  await approve(worldbookDraft.projectId);
  cleanupIds.delete(worldbookDraft.projectId);
  const afterRegexRemoval = await api(`/api/projects/${extensionRegexOnly.projectId}`);
  assert.equal(afterRegexRemoval.regexEntriesPreview.length, 0);
  assert.equal(afterRegexRemoval.worldbookEntriesPreview.length, 1);

  const regexDelete = await api(`/api/projects/${extensionRegexOnly.projectId}`, {
    method: 'DELETE',
    token: creatorToken,
  });
  assert.equal(regexDelete.success, true);
  cleanupIds.delete(extensionRegexOnly.projectId);
  await api(`/api/projects/${extensionRegexOnly.projectId}`, { token: creatorToken, expected: 404 });

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
