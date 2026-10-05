import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { createHmac } from 'node:crypto';

const base = 'http://127.0.0.1:8791';
const encode = value => Buffer.from(JSON.stringify(value)).toString('base64url');
const now = Math.floor(Date.now() / 1000);
const head = encode({ alg: 'HS256', typ: 'JWT' });
const payload = encode({ userId: 'cw_content_service_qa', username: 'Content service QA', avatar: '', isAdmin: true, isSuperAdmin: true, iat: now, exp: now + 3600 });
const authJwt = `${head}.${payload}.${createHmac('sha256', 'cw-local-api-test').update(`${head}.${payload}`).digest('base64url')}`;
const headers = { authorization: 'Bearer ' + authJwt, 'content-type': 'application/json' };
async function api(path, body, status = 200, method = body === undefined ? 'GET' : 'POST') {
  const response = await fetch(base + path, { method, headers, body: body === undefined ? undefined : typeof body === 'string' ? body : JSON.stringify(body) });
  const result = await response.json();
  assert.equal(response.status, status, JSON.stringify(result));
  return result;
}
const scripts = Array.from({ length: 200 }, (_, id) => ({ id: String(id), scriptName: 'Bounded script ' + id, findRegex: 'x', replaceString: '<script>(() => { const local = 1; return local; })();</script>' }));
const input = JSON.stringify(scripts);
assert.equal((await api('/api/projects/preflight/regex', input)).codeCheck.gate, 'accept');
const unauthorized = await fetch(base + '/api/projects/preflight/regex', { method: 'POST', body: input, headers: { 'content-type': 'application/json' } });
assert.equal(unauthorized.status, 401);
const created = await api('/api/projects', { name: 'Content service disposable QA', description: 'local only', tags: ['扩展'] });
const id = created.projectId;
try {
  await api(`/api/projects/${id}/upload-regex`, input);
  const original = await api(`/api/projects/${id}`);
  assert.equal(original.regexEntriesPreview.length, 200);
  for (const path of [`/api/projects/${id}`, `/api/admin/review/${id}`]) {
    const response = await fetch(base + path, { method: 'HEAD', headers });
    assert.equal(response.status, 200);
    assert.equal(await response.text(), '');
  }
  for (const source of ['eval("1")', 'Function("return 1")()', 'while(true){}']) {
    const bad = [{ id: 'bad', scriptName: 'Blocked script', findRegex: 'x', replaceString: '<script>' + source + '</script>', codeCheck: { gate: 'accept' } }];
    const rejected = await api(`/api/projects/${id}/upload-regex`, bad, 422);
    assert.ok(rejected.error.length > 0);
    const after = await api(`/api/projects/${id}`);
    assert.deepEqual(after.regexEntriesPreview, original.regexEntriesPreview, 'forged local success cannot replace the original file');
    assert.equal(after.project.draftRevision, original.project.draftRevision);
  }
  const tooComplex = [{ scriptName: 'Too complex', findRegex: 'x', replaceString: '<script>' + '0;'.repeat(40000) + '</script>' }];
  const rejected = await api('/api/projects/preflight/regex', tooComplex, 422);
  assert.ok(rejected.codeCheck.findings.some(f => f.ruleId === 'CHECKER-LIMIT'));
  const review = await api(`/api/admin/review/${id}`);
  assert.equal(review.codeCheck.gate, 'accept');
  await api(`/api/admin/review/${id}`, { action: 'approve', expectedRevision: review.project.draftRevision, reviewToken: review.reviewToken });
  const published = await api(`/api/projects/${id}`);
  assert.equal(published.project.status, 'approved');
  assert.equal(published.regexEntriesPreview.length, 200);
} finally {
  await api(`/api/projects/${id}`, undefined, 200, 'DELETE');
}
if (process.argv[2]) {
  const source = await fs.readFile(process.argv[2], 'utf8');
  const result = await api('/api/projects/preflight/worldbook', source, 422);
  assert.equal(result.codeCheck.engine, 'v2');
  assert.ok(result.codeCheck.findings.some(f => /^L[1-7]$/.test(f.ruleId)));
  assert.ok(!result.codeCheck.findings.some(f => /PARSE|INTERNAL|LIMIT/.test(f.ruleId)));
}
console.log('Durable Object routes: 200 scripts, authorization, forged local verdict rejection, unchanged content, review and optional real worldbook: passed');
