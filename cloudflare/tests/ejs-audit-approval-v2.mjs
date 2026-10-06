import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';

const base = 'http://127.0.0.1:8791';
const token = (admin) => {
  const encode = (value) => Buffer.from(JSON.stringify(value)).toString('base64url');
  const now = Math.floor(Date.now() / 1000);
  const head = encode({ alg: 'HS256', typ: 'JWT' });
  const payload = encode({ userId: admin ? 'cw_audit_admin' : 'cw_audit_creator', username: 'Checker QA', globalName: 'Checker QA', avatar: '', isAdmin: admin, isSuperAdmin: admin, iat: now, exp: now + 3600 });
  return `${head}.${payload}.${createHmac('sha256', 'cw-local-api-test').update(`${head}.${payload}`).digest('base64url')}`;
};
const author = token(false), admin = token(true);
async function api(path, { method = 'GET', auth = admin, body, status = 200 } = {}) {
  const response = await fetch(base + path, { method, headers: { authorization: `Bearer ${auth}`, ...(body !== undefined ? { 'content-type': 'application/json' } : {}) }, body: body === undefined ? undefined : typeof body === 'string' ? body : JSON.stringify(body) });
  const result = await response.json();
  assert.equal(response.status, status, `${method} ${path}: ${JSON.stringify(result)}`);
  return result;
}
const worldbook = (source) => JSON.stringify({ entries: [{ uid: 7, comment: '审核风险', key: ['test'], content: source, constant: true, position: 0 }] });
const source = '<% { await fetch("https://api.example.org/data"); } %>';
const ids = new Set();
async function detail(id) { return api(`/api/admin/review/${id}`); }
async function approve(id, review, status = 200) {
  return api(`/api/admin/review/${id}`, { method: 'POST', body: { action: 'approve', expectedRevision: review.project.draftRevision, reviewToken: review.reviewToken }, status });
}
try {
  const created = await api('/api/projects', { method: 'POST', auth: author, body: { name: 'Checker inheritance QA', description: 'local disposable test', tags: ['角色'] } });
  const id = created.projectId; ids.add(id);
  await api(`/api/projects/${id}/upload`, { method: 'POST', auth: author, body: worldbook(source) });
  const first = await detail(id);
  assert.ok(first.codeCheck.auditSummary.new > 0);
  assert.equal(first.codeCheck.auditSummary.accepted, 0);
  await api(`/api/admin/review/${id}`, { method: 'POST', body: { action: 'approve', expectedRevision: first.project.draftRevision }, status: 409 });
  await approve(id, { ...first, reviewToken: '0'.repeat(64) }, 409);
  await approve(id, first);
  await approve(id, first, 409); // Concurrent/duplicate approval cannot overwrite.
  const publicView = await api(`/api/projects/${id}`, { auth: author });
  assert.ok(!JSON.stringify(publicView).includes('accepted_code_check'));
  assert.ok(!JSON.stringify(publicView).includes('fingerprint'));
  const moved = await api(`/api/projects/${id}/upload`, { method: 'POST', auth: author, body: worldbook('\n\n' + source) });
  const draft = moved.projectId; ids.add(draft);
  const inherited = await detail(draft);
  assert.ok(inherited.codeCheck.auditSummary.accepted > 0, 'line movement inherits confirmed semantics');
  assert.equal(inherited.codeCheck.auditSummary.pending, 0);
  const changed = '<% { await fetch("https://api.example.org/data", { method: "POST", body: "private" }); } %>';
  await api(`/api/projects/${draft}/upload`, { method: 'POST', auth: author, body: worldbook(changed) });
  await approve(draft, inherited, 409);
  const changedReview = await detail(draft);
  assert.ok(changedReview.codeCheck.auditSummary.pending > 0);
  assert.equal(changedReview.codeCheck.auditSummary.accepted, 0);
  await approve(draft, changedReview);
  ids.delete(draft);
  const removed = await api(`/api/projects/${id}/upload`, { method: 'POST', auth: author, body: worldbook('风险行为已移除') });
  ids.add(removed.projectId);
  const removedReview = await detail(removed.projectId);
  assert.ok(removedReview.codeCheck.auditSummary.removed > 0);
  assert.equal(removedReview.codeCheck.auditSummary.pending, 0);
  const blocked = await api(`/api/projects/${removed.projectId}/upload`, { method: 'POST', auth: author, body: worldbook('<% eval("1") %>'), status: 422 });
  assert.equal(blocked.codeCheck.gate, 'reject');
  assert.ok(blocked.codeCheck.findings.some(finding => finding.ruleId === 'SCRIPT-RISK' && /eval|字符串/.test(finding.detail)));
  console.log('Code-review token, atomic approval, persisted inheritance and removal checks passed');
} finally {
  for (const id of [...ids].reverse()) {
    const response = await fetch(`${base}/api/projects/${id}`, { method: 'DELETE', headers: { authorization: `Bearer ${admin}` } });
    assert.ok([200, 404].includes(response.status), `local QA cleanup ${id}: ${response.status}`);
  }
}
