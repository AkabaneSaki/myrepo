import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { createHmac } from 'node:crypto';

// #42: the Worker performs only lightweight authoritative validation. The complete
// checker runs on the creator and reviewer devices, and the server verifies only
// that a device result belongs to this exact content, revision and checker build.
import { analyzeProjectCodeV2, CHECKER_VERSION } from '../src/utils/ejs-checker/index.mjs';
import { applyAuditBaseline, buildAuditSnapshot, buildReviewPolicyVersion } from '../src/utils/ejs-checker/audit.mjs';
import { trustedAssetHosts } from '../src/utils/ejs-checker/policy-config.mjs';import { contentFilesHash, issueReviewChallenge } from '../src/utils/ejs-checker/attestation.mjs';

const base = 'http://127.0.0.1:8791';
const encode = value => Buffer.from(JSON.stringify(value)).toString('base64url');
const now = Math.floor(Date.now() / 1000);
const head = encode({ alg: 'HS256', typ: 'JWT' });
const payload = encode({ userId: 'cw_content_service_qa', username: 'Content service QA', avatar: '', isAdmin: true, isSuperAdmin: true, iat: now, exp: now + 3600 });
const authJwt = `${head}.${payload}.${createHmac('sha256', 'cw-local-api-test').update(`${head}.${payload}`).digest('base64url')}`;
const headers = { authorization: 'Bearer ' + authJwt, 'content-type': 'application/json' };
async function api(path, body, status = 200, method = body === undefined ? 'GET' : 'POST', extraHeaders = {}) {
  const response = await fetch(base + path, { method, headers: { ...headers, ...extraHeaders }, body: body === undefined ? undefined : typeof body === 'string' ? body : JSON.stringify(body) });
  const result = await response.json();
  assert.equal(response.status, status, JSON.stringify(result));
  return result;
}

/** Stands in for a device: runs the complete checker over the exact given content. */
async function runDeviceCheck(deviceCheck) {
  const files = deviceCheck.files;
  const report = analyzeProjectCodeV2(files);
  const auditSnapshot = report.gate === 'reject' ? null : await buildAuditSnapshot(files, report);
  return {
    success: true,
    gate: report.gate,
    engine: report.engine,
    parserCompatibility: report.parserCompatibility,
    policyVersion: auditSnapshot?.policyVersion ?? buildReviewPolicyVersion(CHECKER_VERSION),
    checkerRevision: CHECKER_VERSION.engine + ':' + CHECKER_VERSION.policyVersion,
    trustedAssetHosts: [...trustedAssetHosts],
    projectId: deviceCheck.projectId,
    draftRevision: deviceCheck.draftRevision,
    filesHash: auditSnapshot ? auditSnapshot.filesHash : '',
    auditSnapshot,
    report: auditSnapshot ? applyAuditBaseline(report, auditSnapshot, deviceCheck.baseline) : report,
  };
}

async function attest(fileText, kind) {
  const result = await api('/api/projects/preflight/' + kind, fileText);
  assert.equal(result.success, true);
  return result;
}

const scripts = Array.from({ length: 200 }, (_, id) => ({ id: String(id), scriptName: 'Bounded script ' + id, findRegex: 'x', replaceString: '<script>(() => { const local = 1; return local; })();</script>' }));
const input = JSON.stringify(scripts);

// Creator pass: the receipt is issued and the upload with that receipt succeeds.
const preflight = await attest(input, 'regex');
assert.match(preflight.attestation, /^[a-f0-9]{64}\./);
assert.equal(preflight.contentHash.length, 64);
const unauthorized = await fetch(base + '/api/projects/preflight/regex', { method: 'POST', body: input, headers: { 'content-type': 'application/json' } });
assert.equal(unauthorized.status, 401);

const created = await api('/api/projects', { name: 'Content service disposable QA', description: 'local only', tags: ['扩展'] });
const id = created.projectId;
const cleanup = async () => { await api(`/api/projects/${id}`, undefined, 200, 'DELETE').catch(() => {}); };

try {
  // Missing attestation: rejected, and never mistaken for a pass.
  await api(`/api/projects/${id}/upload-regex`, input, 409);
  // Tampered attestation: rejected.
  const tampered = await attest(input, 'regex');
  await api(`/api/projects/${id}/upload-regex`, input, 409, 'POST', { 'x-workshop-content-attestation': tampered.attestation.slice(0, -2) + 'xx' });
  // Receipt for other content (wrong hash): rejected — a result for content A can
  // never authorise content B.
  const otherContent = await attest(JSON.stringify(scripts.map(s => ({ ...s, scriptName: s.scriptName + ' B' }))), 'regex');
  await api(`/api/projects/${id}/upload-regex`, input, 409, 'POST', { 'x-workshop-content-attestation': otherContent.attestation });
  // Receipt issued for the other file kind: rejected.
  await api(`/api/projects/${id}/upload-regex`, input, 409, 'POST', { 'x-workshop-content-attestation': (await attest(JSON.stringify({ entries: [{ uid: 1, comment: 'A', content: 'ok', key: [], constant: false }] }), 'worldbook')).attestation });

  await api(`/api/projects/${id}/upload-regex`, input, 200, 'POST', { 'x-workshop-content-attestation': tampered.attestation });
  const original = await api(`/api/projects/${id}`);
  assert.equal(original.regexEntriesPreview.length, 200);
  for (const path of [`/api/projects/${id}`, `/api/admin/review/${id}`]) {
    const response = await fetch(base + path, { method: 'HEAD', headers });
    assert.equal(response.status, 200);
    assert.equal(await response.text(), '');
  }

  // 200 scripts still upload; the server does no heavy checker work of its own.
  const detail = await api(`/api/admin/review/${id}`);
  assert.ok(detail.deviceCheck.files.length >= 1);
  assert.equal(detail.deviceCheck.checkerRevision, CHECKER_VERSION.engine + ':' + CHECKER_VERSION.policyVersion);
  assert.deepEqual(detail.deviceCheck.trustedAssetHosts, [...trustedAssetHosts]);
  assert.equal(await contentFilesHash(detail.deviceCheck.files), detail.deviceCheck.filesHash);

  // Missing reviewer result: rejected.
  await api(`/api/admin/review/${id}`, { action: 'approve', expectedRevision: detail.project.draftRevision }, 409);

  // Reviewer device check for this exact content/revision/checker.
  const deviceResult = await runDeviceCheck(detail.deviceCheck);
  const reviewerResult = { ...deviceResult, challenge: detail.deviceCheck.challenge };

  // Stale draft revision: rejected.
  await api(`/api/admin/review/${id}`, { action: 'approve', expectedRevision: detail.project.draftRevision + 1, reviewerResult }, 409);
  // Wrong checker revision: rejected.
  await api(`/api/admin/review/${id}`, { action: 'approve', expectedRevision: detail.project.draftRevision, reviewerResult: { ...reviewerResult, checkerRevision: 'v2:stale-policy' } }, 409);
  // Wrong content hash: rejected.
  await api(`/api/admin/review/${id}`, { action: 'approve', expectedRevision: detail.project.draftRevision, reviewerResult: { ...reviewerResult, filesHash: '0'.repeat(64) } }, 409);
  // Foreign challenge (issued for another project): rejected.
  const foreignChallenge = await issueReviewChallenge('cw-local-api-test', { projectId: 'some-other-project', draftRevision: detail.project.draftRevision, filesHash: detail.deviceCheck.filesHash, checkerRevision: detail.deviceCheck.checkerRevision });
  await api(`/api/admin/review/${id}`, { action: 'approve', expectedRevision: detail.project.draftRevision, reviewerResult: { ...reviewerResult, challenge: foreignChallenge } }, 409);
  // Changed content after the device check: rejected.
  const changedScripts = scripts.map(s => ({ ...s, replaceString: '<script>(() => { const local = 2; return local; })();</script>' }));
  const changedText = JSON.stringify(changedScripts);
  await api(`/api/projects/${id}/upload-regex`, changedText, 200, 'POST', { 'x-workshop-content-attestation': (await attest(changedText, 'regex')).attestation });
  const changedDetail = await api(`/api/admin/review/${id}`);
  assert.notEqual(changedDetail.deviceCheck.filesHash, detail.deviceCheck.filesHash, 'changed content must produce a different content identity');
  await api(`/api/admin/review/${id}`, { action: 'approve', expectedRevision: changedDetail.project.draftRevision, reviewerResult }, 409);

  // Changed content again, this time without revision movement: still rejected on
  // the content hash, because the result no longer matches the stored bytes.
  const sameRevisionScripts = changedScripts.map(s => ({ ...s, replaceString: '<script>(() => { const local = 3; return local; })();</script>' }));
  const sameRevisionText = JSON.stringify(sameRevisionScripts);
  await api(`/api/projects/${id}/upload-regex`, sameRevisionText, 200, 'POST', { 'x-workshop-content-attestation': (await attest(sameRevisionText, 'regex')).attestation });
  const sameRevisionDetail = await api(`/api/admin/review/${id}`);
  await api(`/api/admin/review/${id}`, { action: 'approve', expectedRevision: sameRevisionDetail.project.draftRevision, reviewerResult }, 409);

  // Tampered snapshot: rejected.
  const tamperedDetail = await api(`/api/admin/review/${id}`);
  const tamperedBase = { ...(await runDeviceCheck(tamperedDetail.deviceCheck)), challenge: tamperedDetail.deviceCheck.challenge };
  await api(`/api/admin/review/${id}`, { action: 'approve', expectedRevision: tamperedDetail.project.draftRevision, reviewerResult: { ...tamperedBase, auditSnapshot: { ...tamperedBase.auditSnapshot, policyVersion: 'PW-CODE-POLICY-forged' } } }, 409);

  // Reviewer re-check for the current content: approved.
  const finalDetail = await api(`/api/admin/review/${id}`);
  const finalResult = { ...(await runDeviceCheck(finalDetail.deviceCheck)), challenge: finalDetail.deviceCheck.challenge };
  assert.equal(finalResult.gate, 'accept');
  assert.equal(finalResult.filesHash, finalDetail.deviceCheck.filesHash, 'a device check must agree with the server content identity');
  assert.equal(finalResult.checkerRevision, finalDetail.deviceCheck.checkerRevision);
  await api(`/api/admin/review/${id}`, { action: 'approve', expectedRevision: finalDetail.project.draftRevision, reviewerResult: finalResult });
  // Duplicate / concurrent approval cannot overwrite.
  await api(`/api/admin/review/${id}`, { action: 'approve', expectedRevision: finalDetail.project.draftRevision, reviewerResult: finalResult }, 409);

  const published = await api(`/api/projects/${id}`);
  assert.equal(published.project.status, 'approved');
  assert.equal(published.regexEntriesPreview.length, 200);
} finally {
  await cleanup();
}

if (process.argv[2]) {
  const source = await fs.readFile(process.argv[2], 'utf8');
  const receipt = await attest(source, 'worldbook');
  assert.match(receipt.attestation, /^[a-f0-9]{64}\./);
  // The heavy verdict for this content is produced on a device, not by the Worker.
  const files = [{ fileName: 'project-qa.json', type: 'worldbook', text: source }];
  const deviceResult = await runDeviceCheck({ files });
  assert.equal(deviceResult.gate, 'reject');
  assert.ok(deviceResult.report.findings.some(f => /^L[1-7]$/.test(f.ruleId)));
}

console.log('Device-bound content path: attestation, tampered/wrong-hash/stale rejection, reviewer result binding, approval: passed');
