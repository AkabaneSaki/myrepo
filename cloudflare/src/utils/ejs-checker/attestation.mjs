// Cheap, isomorphic content binding for #42.
//
// This module must never import the EJS / Acorn / parse5 checker engine. It only
// hashes bytes and verifies HMACs, so the Worker can authoritatively bind a
// device-produced checker result to exact content without ever executing the
// heavy rule analysis itself.

export const CONTENT_BINDING_VERSION = 'PW-CONTENT-BINDING-2026-10-07.1';
export const CREATOR_ATTESTATION_TTL_MS = 30 * 60 * 1000;
export const REVIEW_CHALLENGE_TTL_MS = 20 * 60 * 1000;

const encoder = new TextEncoder();
const GATE_VALUES = ['accept', 'reject'];

async function sha256Hex(value) {
  const digest = await crypto.subtle.digest('SHA-256', encoder.encode(String(value)));
  return Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('');
}

export async function hashContentText(text) {
  return sha256Hex(String(text ?? ''));
}

/** Mirrors the canonical JSON shape buildAuditSnapshot hashes, so the server can
 * recompute a device-produced snapshot hash without parsing or checking anything. */
function canonicalAuditValue(value) {
  if (Array.isArray(value)) return value.map(canonicalAuditValue);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(
    Object.keys(value).sort().map(key => [key, canonicalAuditValue(value[key])]),
  );
}

export function contentFilesHashPayload(inputs) {
  return JSON.stringify(
    canonicalAuditValue(
      (Array.isArray(inputs) ? inputs : []).map(input => ({
        type: input?.type === 'regex' ? 'regex' : 'worldbook',
        text: String(input?.text ?? ''),
      })),
    ),
  );
}

export async function contentFilesHash(inputs) {
  return sha256Hex(contentFilesHashPayload(inputs));
}

async function importHmacKey(secret) {
  const raw = typeof secret === 'string' ? secret : '';
  if (!raw) throw new Error('内容校验密钥未配置');
  return crypto.subtle.importKey(
    'raw',
    encoder.encode(raw),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
}

async function hmacHex(secret, payload) {
  const key = await importHmacKey(secret);
  const signature = await crypto.subtle.sign('HMAC', key, encoder.encode(payload));
  return Array.from(new Uint8Array(signature), byte => byte.toString(16).padStart(2, '0')).join('');
}

function base64UrlEncode(bytes) {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function base64UrlDecode(value) {
  const padded = String(value).replace(/-/g, '+').replace(/_/g, '/');
  const binary = atob(padded + '='.repeat((4 - (padded.length % 4)) % 4));
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return new TextDecoder().decode(bytes);
}

async function packToken(secret, payload) {
  const body = base64UrlEncode(encoder.encode(JSON.stringify(payload)));
  return `${await hmacHex(secret, `${CONTENT_BINDING_VERSION}.${body}`)}.${body}`;
}

async function unpackToken(secret, token) {
  if (token === undefined || token === null || token === '') return { ok: false, reason: 'missing' };
  if (typeof token !== 'string') return { ok: false, reason: 'malformed' };
  const separator = token.indexOf('.');
  if (separator < 0) return { ok: false, reason: 'malformed' };
  const signature = token.slice(0, separator);
  const body = token.slice(separator + 1);
  if (!signature || !body) return { ok: false, reason: 'malformed' };
  const expected = await hmacHex(secret, `${CONTENT_BINDING_VERSION}.${body}`);
  if (expected.length !== signature.length) return { ok: false, reason: 'signature' };
  // Constant-time compare; a forged token must never leak a prefix match.
  let difference = 0;
  for (let index = 0; index < expected.length; index += 1) {
    difference |= expected.charCodeAt(index) ^ signature.charCodeAt(index);
  }
  if (difference !== 0) return { ok: false, reason: 'signature' };
  let payload;
  try {
    payload = JSON.parse(base64UrlDecode(body));
  } catch {
    return { ok: false, reason: 'malformed' };
  }
  if (!payload || typeof payload !== 'object') return { ok: false, reason: 'malformed' };
  if (payload.v !== CONTENT_BINDING_VERSION) return { ok: false, reason: 'version' };
  return { ok: true, payload };
}

function constantTimeEquals(left, right) {
  if (typeof left !== 'string' || typeof right !== 'string' || left.length !== right.length) return false;
  let difference = 0;
  for (let index = 0; index < left.length; index += 1) {
    difference |= left.charCodeAt(index) ^ right.charCodeAt(index);
  }
  return difference === 0;
}

function withinWindow(nowMs, issuedAt, expiresAt) {
  return Number.isFinite(nowMs)
    && Number.isFinite(issuedAt)
    && Number.isFinite(expiresAt)
    && issuedAt <= nowMs
    && nowMs < expiresAt;
}

/**
 * Server-stamped receipt proving the Worker validated exactly these bytes. It says
 * nothing about whether a checker passed: the verdict lives on the creator device.
 */
export async function issueCreatorAttestation(secret, { userId, kind, checkerRevision, contentHash, nowMs = Date.now() }) {
  return packToken(secret, {
    v: CONTENT_BINDING_VERSION,
    role: 'creator',
    iat: nowMs,
    exp: nowMs + CREATOR_ATTESTATION_TTL_MS,
    uid: String(userId ?? ''),
    kind: kind === 'regex' ? 'regex' : 'worldbook',
    rev: String(checkerRevision ?? ''),
    hash: String(contentHash ?? ''),
  });
}

export async function verifyCreatorAttestation(
  secret,
  token,
  { userId, kind, checkerRevision, contentHash, nowMs = Date.now() },
) {
  const opened = await unpackToken(secret, token);
  if (!opened.ok) return { ok: false, reason: opened.reason };
  const payload = opened.payload;
  if (payload.role !== 'creator') return { ok: false, reason: 'role' };
  if (!withinWindow(nowMs, payload.iat, payload.exp)) return { ok: false, reason: 'expired' };
  if (payload.uid !== String(userId ?? '')) return { ok: false, reason: 'user' };
  if (payload.kind !== (kind === 'regex' ? 'regex' : 'worldbook')) return { ok: false, reason: 'kind' };
  if (payload.rev !== String(checkerRevision ?? '')) return { ok: false, reason: 'checker-revision' };
  if (!constantTimeEquals(payload.hash, String(contentHash ?? ''))) return { ok: false, reason: 'content' };
  return { ok: true, payload };
}

/**
 * Single-purpose challenge bound to one exact draft revision and one exact content
 * hash. A reviewer device must return it with its result, so a result produced for
 * other content, another revision, or another checker build cannot be replayed.
 */
export async function issueReviewChallenge(
  secret,
  { projectId, draftRevision, filesHash, checkerRevision, nowMs = Date.now() },
) {
  return packToken(secret, {
    v: CONTENT_BINDING_VERSION,
    role: 'review',
    iat: nowMs,
    exp: nowMs + REVIEW_CHALLENGE_TTL_MS,
    pid: String(projectId ?? ''),
    dr: Number(draftRevision),
    rev: String(checkerRevision ?? ''),
    fh: String(filesHash ?? ''),
  });
}

export async function verifyReviewChallenge(secret, token, nowMs = Date.now()) {
  const opened = await unpackToken(secret, token);
  if (!opened.ok) return { ok: false, reason: opened.reason };
  const payload = opened.payload;
  if (payload.role !== 'review') return { ok: false, reason: 'role' };
  if (!withinWindow(nowMs, payload.iat, payload.exp)) return { ok: false, reason: 'expired' };
  return { ok: true, payload };
}

function isPlainObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

/**
 * Cheap structural and binding validation of a reviewer-device result. Every check
 * here is a string compare or an array walk; no rule analysis is performed.
 */
export async function verifyReviewerResult(
  secret,
  result,
  { projectId, draftRevision, filesHash, checkerRevision, policyVersion, engine, parserCompatibility, nowMs = Date.now() },
) {
  const failed = reason => ({ ok: false, reason });
  if (!isPlainObject(result)) return failed('missing');

  const challenge = await verifyReviewChallenge(secret, result.challenge, nowMs);
  if (!challenge.ok) return failed(`challenge:${challenge.reason}`);
  const claim = challenge.payload;

  if (claim.pid !== String(projectId)) return failed('project');
  if (Number(claim.dr) !== Number(draftRevision)) return failed('revision');
  if (claim.rev !== String(checkerRevision) || claim.rev !== String(result.checkerRevision ?? '')) {
    return failed('checker-revision');
  }
  if (!constantTimeEquals(claim.fh, String(filesHash))) return failed('content');
  if (!constantTimeEquals(String(result.filesHash ?? ''), String(filesHash))) {
    return failed('result-content');
  }
  if (Number(result.draftRevision) !== Number(draftRevision)) return failed('result-revision');
  if (String(result.projectId ?? '') !== String(projectId)) return failed('result-project');

  if (!GATE_VALUES.includes(result.gate)) return failed('gate');

  const snapshot = result.auditSnapshot;
  if (!isPlainObject(snapshot)) return failed('snapshot');
  if (!Array.isArray(snapshot.findings)) return failed('snapshot-findings');
  if (!constantTimeEquals(String(snapshot.filesHash ?? ''), String(filesHash))) {
    return failed('snapshot-content');
  }
  if (String(snapshot.policyVersion ?? '') !== String(policyVersion)) return failed('snapshot-policy');
  if (String(snapshot.engine ?? '') !== String(engine)) return failed('snapshot-engine');
  if (String(snapshot.parserCompatibility ?? '') !== String(parserCompatibility)) return failed('snapshot-parser');
  for (const finding of snapshot.findings) {
    if (!isPlainObject(finding)) return failed('snapshot-finding');
    if (typeof finding.key !== 'string' || typeof finding.fingerprint !== 'string' || typeof finding.rule !== 'string') {
      return failed('snapshot-finding');
    }
  }

  return { ok: true, snapshot, gate: result.gate };
}
