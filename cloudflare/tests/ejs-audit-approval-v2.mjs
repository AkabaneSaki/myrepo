import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';

// #42: audit inheritance, per-risk keys and the hard gate are unchanged; only the
// place the complete checker runs moved from the Worker to the reviewer device.
import { analyzeProjectCodeV2, CHECKER_VERSION } from '../src/utils/ejs-checker/index.mjs';
import { applyAuditBaseline, buildAuditSnapshot, buildReviewPolicyVersion } from '../src/utils/ejs-checker/audit.mjs';

const base = 'http://127.0.0.1:8791';
const token = (admin) => {
  const encode = (value) => Buffer.from(JSON.stringify(value)).toString('base64url');
  const now = Math.floor(Date.now() / 1000);
  const head = encode({ alg: 'HS256', typ: 'JWT' });
  const payload = encode({ userId: admin ? 'cw_audit_admin' : 'cw_audit_creator', username: 'Checker QA', globalName: 'Checker QA', avatar: '', isAdmin: admin, isSuperAdmin: admin, iat: now, exp: now + 3600 });
  return `${head}.${payload}.${createHmac('sha256', 'cw-local-api-test').update(`${head}.${payload}`).digest('base64url')}`;
};
const author = token(false), admin = token(true);
async function api(path, { method = 'GET', auth = admin, body, status = 200, attestation } = {}) {
  const response = await fetch(base + path, { method, headers: { authorization: `Bearer ${auth}`, ...(body !== undefined ? { 'content-type': 'application/json' } : {}), ...(attestation ? { 'x-workshop-content-attestation': attestation } : {}) }, body: body === undefined ? undefined : typeof body === 'string' ? body : JSON.stringify(body) });
  const result = await response.json();
  assert.equal(response.status, status, `${method} ${path}: ${JSON.stringify(result)}`);
  return result;
}
const worldbook = (source) => JSON.stringify({ entries: [{ uid: 7, comment: '审核风险', key: ['test'], content: source, constant: true, position: 0 }] });
const source = '<% { await fetch("https://api.example.org/data"); } %>';
const ids = new Set();

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
async function detail(id) {
  const raw = await api(`/api/admin/review/${id}`);
  const deviceResult = await runDeviceCheck(raw.deviceCheck);
  return { raw, deviceResult, codeCheck: deviceResult.report, detail: { ...raw, codeCheck: deviceResult.report } };
}
async function approve(id, review, status = 200) {
  return api(`/api/admin/review/${id}`, {
    method: 'POST',
    body: {
      action: 'approve',
      expectedRevision: review.raw.project.draftRevision,
      reviewerResult: { ...review.deviceResult, challenge: review.raw.deviceCheck.challenge },
    },
    status,
  });
}
async function upload(id, text) {
  const receipt = await api('/api/projects/preflight/worldbook', { method: 'POST', auth: author, body: text });
  return api(`/api/projects/${id}/upload`, { method: 'POST', auth: author, body: text, attestation: receipt.attestation });
}
try {
  const created = await api('/api/projects', { method: 'POST', auth: author, body: { name: 'Checker inheritance QA', description: 'local disposable test', tags: ['角色'] } });
  const id = created.projectId; ids.add(id);
  await upload(id, worldbook(source));
  const first = await detail(id);
  assert.ok(first.codeCheck.auditSummary.new > 0);
  assert.equal(first.codeCheck.auditSummary.accepted, 0);
  await api(`/api/admin/review/${id}`, { method: 'POST', body: { action: 'approve', expectedRevision: first.raw.project.draftRevision }, status: 409 });
  await approve(id, { ...first, raw: { ...first.raw, deviceCheck: { ...first.raw.deviceCheck, challenge: '0'.repeat(64) } } }, 409);
  await approve(id, first);
  await approve(id, first, 409); // Concurrent/duplicate approval cannot overwrite.
  const publicView = await api(`/api/projects/${id}`, { auth: author });
  assert.ok(!JSON.stringify(publicView).includes('accepted_code_check'));
  assert.ok(!JSON.stringify(publicView).includes('fingerprint'));
  const moved = await upload(id, worldbook('\n\n' + source));
  const draft = moved.projectId; ids.add(draft);
  const inherited = await detail(draft);
  assert.ok(inherited.codeCheck.auditSummary.accepted > 0, 'line movement inherits confirmed semantics');
  assert.equal(inherited.codeCheck.auditSummary.pending, 0);
  const changed = '<% { await fetch("https://api.example.org/data", { method: "POST", body: "private" }); } %>';
  await upload(draft, worldbook(changed));
  await approve(draft, inherited, 409);
  const changedReview = await detail(draft);
  assert.ok(changedReview.codeCheck.auditSummary.pending > 0);
  assert.equal(changedReview.codeCheck.auditSummary.accepted, 0);
  await approve(draft, changedReview);
  ids.delete(draft);
  const removed = await upload(id, worldbook('风险行为已移除'));
  ids.add(removed.projectId);
  const removedReview = await detail(removed.projectId);
  assert.ok(removedReview.codeCheck.auditSummary.removed > 0);
  assert.equal(removedReview.codeCheck.auditSummary.pending, 0);

  // Creator-side rejection is a device verdict too: the complete rule set still
  // blocks eval(), and a blocked upload never reaches R2.
  const beforeBlocked = await api(`/api/projects/${removed.projectId}`, { auth: author });
  const blockedLocal = analyzeProjectCodeV2([{ fileName: 'blocked.json', type: 'worldbook', text: worldbook('<% eval("1") %>') }]);
  assert.equal(blockedLocal.gate, 'reject');
  assert.ok(toUploaderView(blockedLocal).some(item => item.ruleId === 'SCRIPT-RISK'));
  const afterBlocked = await api(`/api/projects/${removed.projectId}`, { auth: author });
  assert.deepEqual(afterBlocked.worldbookEntriesPreview, beforeBlocked.worldbookEntriesPreview, 'a rejected device result cannot replace the stored file');

  function toUploaderView(report) {
    return report.findings.filter(item => item.visibility === 'uploader_generic').map(item => ({ ruleId: item.ruleId === 'M1' ? 'SCRIPT-RISK' : item.ruleId, detail: item.detail }));
  }

  console.log('Code-review binding, atomic approval, persisted inheritance and removal checks passed');
} finally {
  for (const id of [...ids].reverse()) {
    const response = await fetch(`${base}/api/projects/${id}`, { method: 'DELETE', headers: { authorization: `Bearer ${admin}` } });
    assert.ok([200, 404].includes(response.status), `local QA cleanup ${id}: ${response.status}`);
  }
}
