import assert from 'node:assert/strict';

// #42 content binding: a trusted reviewer's submitted result may only be used for the
// exact content, exact draft revision and exact checker build. This suite verifies
// binding/staleness only; it does not remotely attest honest browser execution.
// Every case here is a cheap Worker-side compare; none executes rule analysis.
import {
  CONTENT_BINDING_VERSION,
  contentFilesHash,
  hashContentText,
  issueCreatorAttestation,
  issueReviewChallenge,
  verifyCreatorAttestation,
  verifyReviewerResult,
  validateHumanReviewOverride,
} from '../src/utils/ejs-checker/attestation.mjs';
import { analyzeProjectCodeV2, CHECKER_VERSION } from '../src/utils/ejs-checker/index.mjs';
import { applyAuditBaseline, buildAuditSnapshot, buildReviewPolicyVersion } from '../src/utils/ejs-checker/audit.mjs';
import { trustedAssetHosts } from '../src/utils/ejs-checker/policy-config.mjs';

const TEST_KEY = 'test-key-alpha';
const ALT_TEST_KEY = 'test-key-beta';
const CHECKER_REVISION = `${CHECKER_VERSION.engine}:${CHECKER_VERSION.policyVersion}`;
const worldbook = content => JSON.stringify({ entries: [{ uid: 1, comment: 'Entry', key: ['k'], constant: false, content }] });
const worldbookFiles = text => [{ fileName: 'project-a.json', type: 'worldbook', text }];

// --- content identity -----------------------------------------------------------
const hashA = await contentFilesHash(worldbookFiles(worldbook('<% { const a = 1; void a; } %>')));
const hashB = await contentFilesHash(worldbookFiles(worldbook('<% { const b = 1; void b; } %>')));
assert.notEqual(hashA, hashB, 'a result for content A can never be reused for content B');
assert.equal(hashA, await contentFilesHash(worldbookFiles(worldbook('<% { const a = 1; void a; } %>'))), 'the same content always hashes the same');
assert.equal(hashA.length, 64);

// --- creator attestation -------------------------------------------------------
const attestation = await issueCreatorAttestation(TEST_KEY, { userId: 'creator', kind: 'worldbook', checkerRevision: CHECKER_REVISION, contentHash: hashA });
const base = { userId: 'creator', kind: 'worldbook', checkerRevision: CHECKER_REVISION, contentHash: hashA };
assert.equal((await verifyCreatorAttestation(TEST_KEY, attestation, base)).ok, true, 'a matching receipt verifies');
assert.equal((await verifyCreatorAttestation(TEST_KEY, attestation, { ...base, contentHash: hashB })).reason, 'content', 'wrong hash is rejected');
assert.equal((await verifyCreatorAttestation(TEST_KEY, attestation, { ...base, userId: 'someone-else' })).reason, 'user', 'another account cannot reuse it');
assert.equal((await verifyCreatorAttestation(TEST_KEY, attestation, { ...base, kind: 'regex' })).reason, 'kind', 'the other file kind cannot reuse it');
assert.equal((await verifyCreatorAttestation(TEST_KEY, attestation, { ...base, checkerRevision: 'v1:old' })).reason, 'checker-revision', 'an old checker build cannot reuse it');
assert.equal((await verifyCreatorAttestation(ALT_TEST_KEY, attestation, base)).reason, 'signature', 'a foreign secret cannot verify it');
assert.equal((await verifyCreatorAttestation(TEST_KEY, attestation.slice(0, -1) + (attestation.endsWith('0') ? '1' : '0'), base)).reason, 'signature', 'a tampered receipt is rejected');
assert.equal((await verifyCreatorAttestation(TEST_KEY, 'not-a-receipt', base)).reason, 'malformed');
assert.equal((await verifyCreatorAttestation(TEST_KEY, '', base)).reason, 'missing');
assert.equal((await verifyCreatorAttestation(TEST_KEY, undefined, base)).reason, 'missing');
assert.equal((await verifyCreatorAttestation(TEST_KEY, attestation, { ...base, nowMs: Date.now() + 31 * 60 * 1000 })).reason, 'expired', 'an expired receipt is not a pass');
assert.match(attestation, /^[a-f0-9]{64}\./, 'receipts carry no readable verdict');

// --- reviewer result binding ----------------------------------------------------
async function deviceResultFor(text, overrides = {}) {
  const inputs = worldbookFiles(text);
  const report = analyzeProjectCodeV2(inputs);
  const auditSnapshot = await buildAuditSnapshot(inputs, report);
  const result = {
    success: true,
    gate: report.gate,
    engine: report.engine,
    parserCompatibility: report.parserCompatibility,
    policyVersion: auditSnapshot?.policyVersion ?? buildReviewPolicyVersion(CHECKER_VERSION),
    checkerRevision: CHECKER_REVISION,
    trustedAssetHosts: [...trustedAssetHosts],
    projectId: 'project-1',
    draftRevision: 3,
    filesHash: auditSnapshot?.filesHash ?? '',
    auditSnapshot,
    report: auditSnapshot ? applyAuditBaseline(report, auditSnapshot, null) : report,
  };
  return { ...result, ...overrides };
}

const safeText = worldbook('<% { const a = 1; void a; } %>');
const safeResult = await deviceResultFor(safeText);
assert.equal(safeResult.gate, 'accept');

const challenge = await issueReviewChallenge(TEST_KEY, { projectId: 'project-1', draftRevision: 3, filesHash: hashA, checkerRevision: CHECKER_REVISION });
const expected = {
  projectId: 'project-1',
  draftRevision: 3,
  filesHash: hashA,
  checkerRevision: CHECKER_REVISION,
  policyVersion: buildReviewPolicyVersion(CHECKER_VERSION),
  engine: CHECKER_VERSION.engine,
  parserCompatibility: CHECKER_VERSION.parserCompatibility,
  trustedAssetHosts: [...trustedAssetHosts],
};
assert.equal((await verifyReviewerResult(TEST_KEY, { ...safeResult, challenge }, expected)).ok, true, 'a matching reviewer result verifies');

// missing result
assert.equal((await verifyReviewerResult(TEST_KEY, undefined, expected)).reason, 'missing');
assert.equal((await verifyReviewerResult(TEST_KEY, { trustedAssetHosts: [...trustedAssetHosts] }, expected)).reason, 'challenge:missing');
// tampered result
assert.equal((await verifyReviewerResult(TEST_KEY, { ...safeResult, challenge: challenge.slice(0, -1) + (challenge.endsWith('0') ? '1' : '0') }, expected)).reason, 'challenge:signature');
assert.equal((await verifyReviewerResult(ALT_TEST_KEY, { ...safeResult, challenge }, expected)).reason, 'challenge:signature');
// wrong hash
assert.equal((await verifyReviewerResult(TEST_KEY, { ...safeResult, challenge, filesHash: '0'.repeat(64) }, expected)).reason, 'result-content');
assert.equal((await verifyReviewerResult(TEST_KEY, { ...safeResult, challenge, auditSnapshot: { ...safeResult.auditSnapshot, filesHash: '0'.repeat(64) } }, expected)).reason, 'snapshot-content');
// content that does not match what the server holds
assert.equal((await verifyReviewerResult(TEST_KEY, { ...safeResult, challenge }, { ...expected, filesHash: hashB })).reason, 'content');
// stale draft
assert.equal((await verifyReviewerResult(TEST_KEY, { ...safeResult, challenge }, { ...expected, draftRevision: 4 })).reason, 'revision');
assert.equal((await verifyReviewerResult(TEST_KEY, { ...safeResult, challenge, draftRevision: 4 }, expected)).reason, 'result-revision');
// wrong checker revision
assert.equal((await verifyReviewerResult(TEST_KEY, { ...safeResult, challenge, checkerRevision: 'v1:old' }, expected)).reason, 'checker-revision');
assert.equal((await verifyReviewerResult(TEST_KEY, { ...safeResult, challenge }, { ...expected, checkerRevision: 'v1:old' })).reason, 'checker-revision');
// wrong rule identity
assert.equal((await verifyReviewerResult(TEST_KEY, { ...safeResult, challenge, auditSnapshot: { ...safeResult.auditSnapshot, policyVersion: 'forged' } }, expected)).reason, 'snapshot-policy');
assert.equal((await verifyReviewerResult(TEST_KEY, { ...safeResult, challenge, auditSnapshot: { ...safeResult.auditSnapshot, engine: 'v1' } }, expected)).reason, 'snapshot-engine');
assert.equal((await verifyReviewerResult(TEST_KEY, { ...safeResult, challenge, auditSnapshot: { ...safeResult.auditSnapshot, findings: [{ key: 'a' }] } }, expected)).reason, 'snapshot-finding');
assert.equal((await verifyReviewerResult(TEST_KEY, { ...safeResult, challenge, gate: 'maybe' }, expected)).reason, 'gate');
// expired challenge
assert.equal((await verifyReviewerResult(TEST_KEY, { ...safeResult, challenge }, { ...expected, nowMs: Date.now() + 21 * 60 * 1000 })).reason, 'challenge:expired');
// foreign project
const foreignChallenge = await issueReviewChallenge(TEST_KEY, { projectId: 'project-2', draftRevision: 3, filesHash: hashA, checkerRevision: CHECKER_REVISION });
assert.equal((await verifyReviewerResult(TEST_KEY, { ...safeResult, challenge: foreignChallenge }, expected)).reason, 'project');

// creator pass / creator reject
assert.equal((await verifyCreatorAttestation(TEST_KEY, await issueCreatorAttestation(TEST_KEY, base), base)).ok, true, 'creator pass');
const rejectedText = worldbook('<% eval("1") %>');
const rejectedResult = await deviceResultFor(rejectedText);
assert.equal(rejectedResult.gate, 'reject', 'the complete rule set still rejects eval()');
assert.equal(validateHumanReviewOverride('reject', undefined).valid, false, 'high findings cannot be overridden without a reason');
assert.equal(validateHumanReviewOverride('reject', 'short').valid, false, 'high findings require an explicit explanation');
assert.equal(validateHumanReviewOverride('reject', 'x'.repeat(501)).valid, false, 'override reasons are bounded');
assert.deepEqual(validateHumanReviewOverride('reject', '  已检查全部源代码并确认可接受风险  '), { valid: true, reason: '已检查全部源代码并确认可接受风险' });
assert.deepEqual(validateHumanReviewOverride('accept', undefined), { valid: true, reason: null }, 'ordinary approval needs no override reason');
assert.ok(rejectedResult.auditSnapshot?.filesHash, 'a blocked device run retains a content-bound audit snapshot for explicit human override');
const rejectedHash = await contentFilesHash(worldbookFiles(rejectedText));
const rejectedChallenge = await issueReviewChallenge(TEST_KEY, { projectId: 'project-1', draftRevision: 3, filesHash: rejectedHash, checkerRevision: CHECKER_REVISION });
assert.equal((await verifyReviewerResult(TEST_KEY, { ...rejectedResult, challenge: rejectedChallenge }, { ...expected, filesHash: rejectedHash })).gate, 'reject', 'the gate must remain reject after content binding');
assert.equal((await verifyReviewerResult(TEST_KEY, { ...rejectedResult, challenge: rejectedChallenge }, expected)).reason, 'content', 'human override cannot bypass file-hash binding');
assert.ok(rejectedResult.report.findings.some(item => item.ruleId === 'M1'), 'M rules are unchanged');

// Exercise the real reviewer Web Worker, not only the in-process test helper.
let reviewerWorkerOutput;
globalThis.self = { postMessage: value => { reviewerWorkerOutput = value; } };
await import('../src/utils/ejs-checker/review-worker.mjs');
await globalThis.self.onmessage({ data: {
  files: worldbookFiles(rejectedText), baseline: null, projectId: 'project-1', draftRevision: 3,
} });
delete globalThis.self;
assert.equal(reviewerWorkerOutput?.success, true, 'high-risk content still completes the reviewer device check');
assert.equal(reviewerWorkerOutput?.gate, 'reject', 'the checker verdict is never rewritten by override');
assert.ok(reviewerWorkerOutput?.auditSnapshot?.filesHash, 'high-risk content includes a bound reviewer snapshot');
assert.equal(reviewerWorkerOutput.auditSnapshot.filesHash, rejectedHash);

// reviewer re-check produces a stable binding for identical content
const rerun = await deviceResultFor(safeText);
assert.equal(rerun.filesHash, safeResult.filesHash);
assert.deepEqual(rerun.auditSnapshot.findings, safeResult.auditSnapshot.findings);
assert.equal(rerun.checkerRevision, CHECKER_REVISION);
assert.equal(await hashContentText(safeText).then(value => value.length), 64);

assert.match(CONTENT_BINDING_VERSION, /^PW-CONTENT-BINDING-/);
console.log('Content binding: tamper, wrong hash, stale draft, changed content, wrong checker revision, missing result, creator pass/reject, reviewer re-check: ok');
