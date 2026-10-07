import assert from 'node:assert/strict';

// #42 content binding: a device verdict may only approve the exact content, the exact
// draft revision and the exact checker build it was produced for. Every case here is
// a cheap string compare on the Worker side; none of them executes rule analysis.
import {
  CONTENT_BINDING_VERSION,
  contentFilesHash,
  hashContentText,
  issueCreatorAttestation,
  issueReviewChallenge,
  verifyCreatorAttestation,
  verifyReviewerResult,
} from '../src/utils/ejs-checker/attestation.mjs';
import { analyzeProjectCodeV2, CHECKER_VERSION } from '../src/utils/ejs-checker/index.mjs';
import { applyAuditBaseline, buildAuditSnapshot, buildReviewPolicyVersion } from '../src/utils/ejs-checker/audit.mjs';
import { trustedAssetHosts } from '../src/utils/ejs-checker/policy-config.mjs';

const SECRET = 'unit-test-content-binding-secret';
const OTHER_SECRET = 'a-different-secret';
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
const attestation = await issueCreatorAttestation(SECRET, { userId: 'creator', kind: 'worldbook', checkerRevision: CHECKER_REVISION, contentHash: hashA });
const base = { userId: 'creator', kind: 'worldbook', checkerRevision: CHECKER_REVISION, contentHash: hashA };
assert.equal((await verifyCreatorAttestation(SECRET, attestation, base)).ok, true, 'a matching receipt verifies');
assert.equal((await verifyCreatorAttestation(SECRET, attestation, { ...base, contentHash: hashB })).reason, 'content', 'wrong hash is rejected');
assert.equal((await verifyCreatorAttestation(SECRET, attestation, { ...base, userId: 'someone-else' })).reason, 'user', 'another account cannot reuse it');
assert.equal((await verifyCreatorAttestation(SECRET, attestation, { ...base, kind: 'regex' })).reason, 'kind', 'the other file kind cannot reuse it');
assert.equal((await verifyCreatorAttestation(SECRET, attestation, { ...base, checkerRevision: 'v1:old' })).reason, 'checker-revision', 'an old checker build cannot reuse it');
assert.equal((await verifyCreatorAttestation(OTHER_SECRET, attestation, base)).reason, 'signature', 'a foreign secret cannot verify it');
assert.equal((await verifyCreatorAttestation(SECRET, attestation.slice(0, -1) + (attestation.endsWith('0') ? '1' : '0'), base)).reason, 'signature', 'a tampered receipt is rejected');
assert.equal((await verifyCreatorAttestation(SECRET, 'not-a-receipt', base)).reason, 'malformed');
assert.equal((await verifyCreatorAttestation(SECRET, '', base)).reason, 'missing');
assert.equal((await verifyCreatorAttestation(SECRET, undefined, base)).reason, 'missing');
assert.equal((await verifyCreatorAttestation(SECRET, attestation, { ...base, nowMs: Date.now() + 31 * 60 * 1000 })).reason, 'expired', 'an expired receipt is not a pass');
assert.match(attestation, /^[a-f0-9]{64}\./, 'receipts carry no readable verdict');

// --- reviewer result binding ----------------------------------------------------
async function deviceResultFor(text, overrides = {}) {
  const inputs = worldbookFiles(text);
  const report = analyzeProjectCodeV2(inputs);
  const auditSnapshot = report.gate === 'reject' ? null : await buildAuditSnapshot(inputs, report);
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

const challenge = await issueReviewChallenge(SECRET, { projectId: 'project-1', draftRevision: 3, filesHash: hashA, checkerRevision: CHECKER_REVISION });
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
assert.equal((await verifyReviewerResult(SECRET, { ...safeResult, challenge }, expected)).ok, true, 'a matching reviewer result verifies');

// missing result
assert.equal((await verifyReviewerResult(SECRET, undefined, expected)).reason, 'missing');
assert.equal((await verifyReviewerResult(SECRET, { trustedAssetHosts: [...trustedAssetHosts] }, expected)).reason, 'challenge:missing');
// tampered result
assert.equal((await verifyReviewerResult(SECRET, { ...safeResult, challenge: challenge.slice(0, -1) + (challenge.endsWith('0') ? '1' : '0') }, expected)).reason, 'challenge:signature');
assert.equal((await verifyReviewerResult(OTHER_SECRET, { ...safeResult, challenge }, expected)).reason, 'challenge:signature');
// wrong hash
assert.equal((await verifyReviewerResult(SECRET, { ...safeResult, challenge, filesHash: '0'.repeat(64) }, expected)).reason, 'result-content');
assert.equal((await verifyReviewerResult(SECRET, { ...safeResult, challenge, auditSnapshot: { ...safeResult.auditSnapshot, filesHash: '0'.repeat(64) } }, expected)).reason, 'snapshot-content');
// content that does not match what the server holds
assert.equal((await verifyReviewerResult(SECRET, { ...safeResult, challenge }, { ...expected, filesHash: hashB })).reason, 'content');
// stale draft
assert.equal((await verifyReviewerResult(SECRET, { ...safeResult, challenge }, { ...expected, draftRevision: 4 })).reason, 'revision');
assert.equal((await verifyReviewerResult(SECRET, { ...safeResult, challenge, draftRevision: 4 }, expected)).reason, 'result-revision');
// wrong checker revision
assert.equal((await verifyReviewerResult(SECRET, { ...safeResult, challenge, checkerRevision: 'v1:old' }, expected)).reason, 'checker-revision');
assert.equal((await verifyReviewerResult(SECRET, { ...safeResult, challenge }, { ...expected, checkerRevision: 'v1:old' })).reason, 'checker-revision');
// wrong rule identity
assert.equal((await verifyReviewerResult(SECRET, { ...safeResult, challenge, auditSnapshot: { ...safeResult.auditSnapshot, policyVersion: 'forged' } }, expected)).reason, 'snapshot-policy');
assert.equal((await verifyReviewerResult(SECRET, { ...safeResult, challenge, auditSnapshot: { ...safeResult.auditSnapshot, engine: 'v1' } }, expected)).reason, 'snapshot-engine');
assert.equal((await verifyReviewerResult(SECRET, { ...safeResult, challenge, auditSnapshot: { ...safeResult.auditSnapshot, findings: [{ key: 'a' }] } }, expected)).reason, 'snapshot-finding');
assert.equal((await verifyReviewerResult(SECRET, { ...safeResult, challenge, gate: 'maybe' }, expected)).reason, 'gate');
// expired challenge
assert.equal((await verifyReviewerResult(SECRET, { ...safeResult, challenge }, { ...expected, nowMs: Date.now() + 21 * 60 * 1000 })).reason, 'challenge:expired');
// foreign project
const foreignChallenge = await issueReviewChallenge(SECRET, { projectId: 'project-2', draftRevision: 3, filesHash: hashA, checkerRevision: CHECKER_REVISION });
assert.equal((await verifyReviewerResult(SECRET, { ...safeResult, challenge: foreignChallenge }, expected)).reason, 'project');

// creator pass / creator reject
assert.equal((await verifyCreatorAttestation(SECRET, await issueCreatorAttestation(SECRET, base), base)).ok, true, 'creator pass');
const rejectedText = worldbook('<% eval("1") %>');
const rejectedResult = await deviceResultFor(rejectedText);
assert.equal(rejectedResult.gate, 'reject', 'the complete rule set still rejects eval()');
assert.equal(rejectedResult.auditSnapshot, null, 'a rejected device run produces no approvable snapshot');
assert.ok(rejectedResult.report.findings.some(item => item.ruleId === 'M1'), 'M rules are unchanged');

// reviewer re-check produces a stable binding for identical content
const rerun = await deviceResultFor(safeText);
assert.equal(rerun.filesHash, safeResult.filesHash);
assert.deepEqual(rerun.auditSnapshot.findings, safeResult.auditSnapshot.findings);
assert.equal(rerun.checkerRevision, CHECKER_REVISION);
assert.equal(await hashContentText(safeText).then(value => value.length), 64);

assert.match(CONTENT_BINDING_VERSION, /^PW-CONTENT-BINDING-/);
console.log('Content binding: tamper, wrong hash, stale draft, changed content, wrong checker revision, missing result, creator pass/reject, reviewer re-check: ok');
