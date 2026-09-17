import type { AppContext } from '../types';
import {
  fingerprintRegexEntry,
  fingerprintWorldbookEntry,
  type CharacterReferenceFingerprint,
} from './character-reference-fingerprint.ts';
import { parseRegexEntriesPreview, parseWorldbookEntriesPreview } from './project-preview.ts';

export const CHARACTER_REFERENCE_GRACE_DAYS = 7;
export const COMPATIBILITY_STATUSES = [
  'compatible_latest',
  'pending_latest',
  'based_on_older',
  'known_incompatible',
] as const;
export type CompatibilityStatus = (typeof COMPATIBILITY_STATUSES)[number];

export type CharacterReferenceVersionSummary = {
  id: string;
  versionLabel: string;
  versionOrdinal: number;
  graceUntil: string;
  createdAt: string;
  worldbookCount: number;
  regexCount: number;
};

export type CharacterReferenceSummary = {
  id: string;
  name: string;
  description: string | null;
  createdAt: string;
  updatedAt: string;
  versions: CharacterReferenceVersionSummary[];
};

type ReferenceVersionRow = {
  id: string;
  character_reference_id: string;
  version_label: string;
  version_ordinal: number;
  grace_until: string;
  created_at: string;
};

function makeId(prefix: string): string {
  return `${prefix}_${crypto.randomUUID().replace(/-/g, '')}`;
}

function utcNow(nowMs = Date.now()): string {
  return new Date(nowMs).toISOString();
}

function graceUntil(nowMs: number): string {
  return new Date(nowMs + CHARACTER_REFERENCE_GRACE_DAYS * 86_400_000).toISOString();
}

export function computeCompatibilityStatus(input: {
  builtForOrdinal: number;
  testedThroughOrdinal: number | null;
  latestOrdinal: number;
  knownIncompatible?: boolean;
}): CompatibilityStatus {
  if (input.knownIncompatible) return 'known_incompatible';
  if (input.testedThroughOrdinal === input.latestOrdinal) return 'compatible_latest';
  if (input.builtForOrdinal < input.latestOrdinal && input.testedThroughOrdinal === null) return 'based_on_older';
  return 'pending_latest';
}

async function getVersion(c: AppContext, versionId: string): Promise<ReferenceVersionRow | null> {
  return c.env.DB.prepare(
    `SELECT id, character_reference_id, version_label, version_ordinal, grace_until, created_at
     FROM character_reference_versions
     WHERE id = ?`,
  )
    .bind(versionId)
    .first<ReferenceVersionRow>();
}

async function getLatestVersion(c: AppContext, characterReferenceId: string): Promise<ReferenceVersionRow | null> {
  return c.env.DB.prepare(
    `SELECT id, character_reference_id, version_label, version_ordinal, grace_until, created_at
     FROM character_reference_versions
     WHERE character_reference_id = ?
     ORDER BY version_ordinal DESC
     LIMIT 1`,
  )
    .bind(characterReferenceId)
    .first<ReferenceVersionRow>();
}

export async function resolveProjectCompatibilitySelection(
  c: AppContext,
  input: {
    builtForReferenceVersionId: string | null | undefined;
    testedThroughReferenceVersionId?: string | null;
    knownIncompatible?: boolean;
  },
): Promise<{
  characterReferenceId: string | null;
  builtForReferenceVersionId: string | null;
  testedThroughReferenceVersionId: string | null;
  compatibilityStatus: CompatibilityStatus | null;
  compatibilityGraceUntil: string | null;
}> {
  const builtForId = input.builtForReferenceVersionId?.trim() || null;
  const testedThroughId = input.testedThroughReferenceVersionId?.trim() || null;
  if (!builtForId) {
    if (testedThroughId) throw new Error('Tested through requires a Built for reference version');
    return {
      characterReferenceId: null,
      builtForReferenceVersionId: null,
      testedThroughReferenceVersionId: null,
      compatibilityStatus: null,
      compatibilityGraceUntil: null,
    };
  }

  const builtFor = await getVersion(c, builtForId);
  if (!builtFor) throw new Error('Built for reference version not found');

  let testedThrough: ReferenceVersionRow | null = null;
  if (testedThroughId) {
    testedThrough = await getVersion(c, testedThroughId);
    if (!testedThrough) throw new Error('Tested through reference version not found');
    if (testedThrough.character_reference_id !== builtFor.character_reference_id) {
      throw new Error('Built for and Tested through must belong to the same character reference');
    }
    if (Number(testedThrough.version_ordinal) < Number(builtFor.version_ordinal)) {
      throw new Error('Tested through cannot be older than Built for');
    }
  }

  const latest = await getLatestVersion(c, builtFor.character_reference_id);
  if (!latest) throw new Error('Character reference has no versions');
  return {
    characterReferenceId: builtFor.character_reference_id,
    builtForReferenceVersionId: builtFor.id,
    testedThroughReferenceVersionId: testedThrough?.id || null,
    compatibilityStatus: computeCompatibilityStatus({
      builtForOrdinal: Number(builtFor.version_ordinal),
      testedThroughOrdinal: testedThrough ? Number(testedThrough.version_ordinal) : null,
      latestOrdinal: Number(latest.version_ordinal),
      knownIncompatible: Boolean(input.knownIncompatible),
    }),
    compatibilityGraceUntil: latest.grace_until,
  };
}

export async function listCharacterReferences(c: AppContext): Promise<CharacterReferenceSummary[]> {
  const references = await c.env.DB.prepare(
    `SELECT id, name, description, created_at, updated_at
     FROM character_references
     ORDER BY name COLLATE NOCASE ASC`,
  ).all<Record<string, unknown>>();
  const versions = await c.env.DB.prepare(
    `SELECT v.id, v.character_reference_id, v.version_label, v.version_ordinal, v.grace_until, v.created_at,
            SUM(CASE WHEN i.kind = 'worldbook' THEN 1 ELSE 0 END) AS worldbook_count,
            SUM(CASE WHEN i.kind = 'regex' THEN 1 ELSE 0 END) AS regex_count
     FROM character_reference_versions v
     LEFT JOIN character_reference_items i ON i.reference_version_id = v.id
     GROUP BY v.id
     ORDER BY v.character_reference_id ASC, v.version_ordinal DESC`,
  ).all<Record<string, unknown>>();

  const versionsByReference = new Map<string, CharacterReferenceVersionSummary[]>();
  for (const row of versions.results || []) {
    const referenceId = String(row.character_reference_id || '');
    const list = versionsByReference.get(referenceId) || [];
    list.push({
      id: String(row.id),
      versionLabel: String(row.version_label),
      versionOrdinal: Number(row.version_ordinal),
      graceUntil: String(row.grace_until),
      createdAt: String(row.created_at),
      worldbookCount: Number(row.worldbook_count || 0),
      regexCount: Number(row.regex_count || 0),
    });
    versionsByReference.set(referenceId, list);
  }

  return (references.results || []).map(row => ({
    id: String(row.id),
    name: String(row.name),
    description: row.description === null || row.description === undefined ? null : String(row.description),
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
    versions: versionsByReference.get(String(row.id)) || [],
  }));
}

export async function createCharacterReference(
  c: AppContext,
  input: { name: string; description?: string | null; actorId: string; actorName: string },
) {
  const name = input.name.trim();
  if (!name) throw new Error('Character reference name is required');
  if (name.length > 120) throw new Error('Character reference name is too long');
  const existing = await c.env.DB.prepare(`SELECT id FROM character_references WHERE name = ? COLLATE NOCASE`)
    .bind(name)
    .first<{ id: string }>();
  if (existing) throw new Error('Character reference already exists');

  const id = makeId('charref');
  const timestamp = utcNow();
  await c.env.DB.prepare(
    `INSERT INTO character_references (id, name, description, created_by, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?)`,
  )
    .bind(id, name, input.description?.trim() || null, input.actorId, timestamp, timestamp)
    .run();
  return { id, name, description: input.description?.trim() || null, createdAt: timestamp };
}

function serializeFingerprintRows(versionId: string, fingerprints: CharacterReferenceFingerprint[]) {
  return fingerprints.map(fingerprint => ({
    id: makeId('refitem'),
    referenceVersionId: versionId,
    kind: fingerprint.kind,
    sourceKey: fingerprint.sourceKey,
    displayName: fingerprint.displayName,
    exactHash: fingerprint.exactHash,
    normalizedContentHash: fingerprint.normalizedContentHash,
    nameHash: fingerprint.nameHash,
    keysHash: fingerprint.keysHash,
    structureHash: fingerprint.structureHash,
  }));
}

export async function createCharacterReferenceVersion(
  c: AppContext,
  input: {
    characterReferenceId: string;
    versionLabel: string;
    worldbookJson?: string | null;
    regexJson?: string | null;
    actorId: string;
    actorName: string;
    nowMs?: number;
  },
) {
  const reference = await c.env.DB.prepare(`SELECT id, name FROM character_references WHERE id = ?`)
    .bind(input.characterReferenceId)
    .first<{ id: string; name: string }>();
  if (!reference) throw new Error('Character reference not found');

  const versionLabel = input.versionLabel.trim();
  if (!versionLabel) throw new Error('Reference version label is required');
  if (versionLabel.length > 80) throw new Error('Reference version label is too long');
  const duplicate = await c.env.DB.prepare(
    `SELECT id FROM character_reference_versions WHERE character_reference_id = ? AND version_label = ?`,
  )
    .bind(reference.id, versionLabel)
    .first<{ id: string }>();
  if (duplicate) throw new Error('Reference version already exists');

  const worldbookEntries = input.worldbookJson?.trim()
    ? parseWorldbookEntriesPreview(input.worldbookJson)
    : [];
  const regexEntries = input.regexJson?.trim()
    ? parseRegexEntriesPreview(input.regexJson)
    : [];
  if (worldbookEntries.length === 0 && regexEntries.length === 0) {
    throw new Error('Reference version must contain at least one Worldbook or Regex item');
  }

  const [worldbookFingerprints, regexFingerprints] = await Promise.all([
    Promise.all(worldbookEntries.map(entry => fingerprintWorldbookEntry(entry as typeof entry & Record<string, unknown>))),
    Promise.all(regexEntries.map(entry => fingerprintRegexEntry(entry as typeof entry & Record<string, unknown>))),
  ]);
  const versionId = makeId('refver');
  const itemRows = serializeFingerprintRows(versionId, [...worldbookFingerprints, ...regexFingerprints]);
  const ordinalRow = await c.env.DB.prepare(
    `SELECT COALESCE(MAX(version_ordinal), 0) + 1 AS next_ordinal
     FROM character_reference_versions
     WHERE character_reference_id = ?`,
  )
    .bind(reference.id)
    .first<{ next_ordinal: number }>();
  const versionOrdinal = Math.max(1, Number(ordinalRow?.next_ordinal || 1));
  const nowMs = input.nowMs ?? Date.now();
  const createdAt = utcNow(nowMs);
  const versionGraceUntil = graceUntil(nowMs);
  const rowsJson = JSON.stringify(itemRows);

  await c.env.DB.batch([
    c.env.DB.prepare(
      `INSERT INTO character_reference_versions (
         id, character_reference_id, version_label, version_ordinal, grace_until, created_by, created_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?)`,
    ).bind(versionId, reference.id, versionLabel, versionOrdinal, versionGraceUntil, input.actorId, createdAt),
    c.env.DB.prepare(
      `INSERT INTO character_reference_items (
         id, reference_version_id, kind, source_key, display_name,
         exact_hash, normalized_content_hash, name_hash, keys_hash, structure_hash, created_at
       )
       SELECT
         json_extract(value, '$.id'),
         json_extract(value, '$.referenceVersionId'),
         json_extract(value, '$.kind'),
         json_extract(value, '$.sourceKey'),
         json_extract(value, '$.displayName'),
         json_extract(value, '$.exactHash'),
         json_extract(value, '$.normalizedContentHash'),
         json_extract(value, '$.nameHash'),
         json_extract(value, '$.keysHash'),
         json_extract(value, '$.structureHash'),
         ?
       FROM json_each(?)`,
    ).bind(createdAt, rowsJson),
    c.env.DB.prepare(`UPDATE character_references SET updated_at = ? WHERE id = ?`).bind(createdAt, reference.id),
    c.env.DB.prepare(
      `UPDATE projects
       SET compatibility_status = CASE
             WHEN compatibility_known_incompatible = 1 THEN 'known_incompatible'
             WHEN tested_through_reference_version_id = ? THEN 'compatible_latest'
             WHEN tested_through_reference_version_id IS NULL
                  AND built_for_reference_version_id IS NOT NULL
                  AND built_for_reference_version_id <> ? THEN 'based_on_older'
             ELSE 'pending_latest'
           END,
           compatibility_grace_until = ?,
           compatibility_updated_at = ?
       WHERE character_reference_id = ? AND built_for_reference_version_id IS NOT NULL`,
    ).bind(versionId, versionId, versionGraceUntil, createdAt, reference.id),
  ]);

  return {
    id: versionId,
    characterReferenceId: reference.id,
    characterName: reference.name,
    versionLabel,
    versionOrdinal,
    graceUntil: versionGraceUntil,
    worldbookCount: worldbookFingerprints.length,
    regexCount: regexFingerprints.length,
    itemCount: itemRows.length,
  };
}

export async function updateProjectCompatibilityMetadata(
  c: AppContext,
  input: {
    projectId: string;
    publishedProjectId?: string | null;
    builtForReferenceVersionId?: string | null;
    beforeTestedThroughReferenceVersionId?: string | null;
    beforeStatus?: string | null;
    beforeKnownIncompatible?: boolean;
    beforeNote?: string | null;
    testedThroughReferenceVersionId?: string | null;
    knownIncompatible?: boolean;
    note?: string | null;
    actorId: string;
    actorName: string;
  },
) {
  if (!input.builtForReferenceVersionId) throw new Error('Project has no Built for character reference version');
  const selection = await resolveProjectCompatibilitySelection(c, {
    builtForReferenceVersionId: input.builtForReferenceVersionId,
    testedThroughReferenceVersionId: input.testedThroughReferenceVersionId,
    knownIncompatible: Boolean(input.knownIncompatible),
  });
  const targetProjectId = input.publishedProjectId || input.projectId;
  const timestamp = utcNow();
  const beforeValue = JSON.stringify({
    testedThroughReferenceVersionId: input.beforeTestedThroughReferenceVersionId || null,
    status: input.beforeStatus || null,
    knownIncompatible: Boolean(input.beforeKnownIncompatible),
    note: input.beforeNote?.trim() || null,
  });
  const afterValue = JSON.stringify({
    testedThroughReferenceVersionId: selection.testedThroughReferenceVersionId,
    status: selection.compatibilityStatus,
    knownIncompatible: Boolean(input.knownIncompatible),
    note: input.note?.trim() || null,
  });

  await c.env.DB.batch([
    c.env.DB.prepare(
      `UPDATE projects
       SET tested_through_reference_version_id = ?,
           compatibility_status = ?,
           compatibility_known_incompatible = ?,
           compatibility_note = ?,
           compatibility_grace_until = ?,
           compatibility_updated_at = ?,
           updated_at = ?
       WHERE id = ? OR (published_project_id = ? AND review_target = 'draft')`,
    ).bind(
      selection.testedThroughReferenceVersionId,
      selection.compatibilityStatus,
      input.knownIncompatible ? 1 : 0,
      input.note?.trim() || null,
      selection.compatibilityGraceUntil,
      timestamp,
      timestamp,
      targetProjectId,
      targetProjectId,
    ),
    c.env.DB.prepare(
      `INSERT INTO project_metadata_audit_logs (
         id, project_id, action, actor_id, actor_name, before_value, after_value, created_at
       ) VALUES (?, ?, 'compatibility_updated', ?, ?, ?, ?, ?)`,
    ).bind(makeId('metaudit'), targetProjectId, input.actorId, input.actorName, beforeValue, afterValue, timestamp),
  ]);

  return selection;
}
