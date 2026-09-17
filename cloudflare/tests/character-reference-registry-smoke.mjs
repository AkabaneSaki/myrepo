import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { DatabaseSync } from 'node:sqlite';
import { computeCompatibilityStatus } from '../src/utils/character-reference.ts';

const migration = await readFile(new URL('../migrations/0014_character_reference_registry.sql', import.meta.url), 'utf8');
const conflictMigration = await readFile(new URL('../migrations/0015_project_original_conflicts.sql', import.meta.url), 'utf8');

{
  const db = new DatabaseSync(':memory:');
  db.exec('PRAGMA foreign_keys = ON; CREATE TABLE projects (id TEXT PRIMARY KEY);');
  db.exec(migration);
  db.exec(conflictMigration);

  const tables = new Set(
    db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all().map(row => String(row.name)),
  );
  for (const required of [
    'character_references',
    'character_reference_versions',
    'character_reference_items',
    'project_metadata_audit_logs',
  ]) {
    assert.ok(tables.has(required), `missing table ${required}`);
  }

  const projectColumns = new Set(
    db.prepare('PRAGMA table_info(projects)').all().map(row => String(row.name)),
  );
  for (const required of [
    'character_reference_id',
    'built_for_reference_version_id',
    'tested_through_reference_version_id',
    'compatibility_status',
    'compatibility_known_incompatible',
    'compatibility_note',
    'compatibility_grace_until',
    'compatibility_updated_at',
    'conflicts_with_original',
    'original_conflict_reference_item_ids',
  ]) {
    assert.ok(projectColumns.has(required), `missing projects.${required}`);
  }

  db.prepare(
    `INSERT INTO character_references (id, name, created_by) VALUES ('char-a', 'Character A', 'admin')`,
  ).run();
  db.prepare(
    `INSERT INTO character_reference_versions (
       id, character_reference_id, version_label, version_ordinal, grace_until, created_by
     ) VALUES (?, 'char-a', ?, ?, '2026-09-23T00:00:00.000Z', 'admin')`,
  ).run('v433', '4.3.3', 1);
  db.prepare(
    `INSERT INTO character_reference_versions (
       id, character_reference_id, version_label, version_ordinal, grace_until, created_by
     ) VALUES (?, 'char-a', ?, ?, '2026-09-24T00:00:00.000Z', 'admin')`,
  ).run('v440', '4.4.0', 2);

  const versions = db.prepare(
    `SELECT id, version_label, version_ordinal
     FROM character_reference_versions
     WHERE character_reference_id = 'char-a'
     ORDER BY version_ordinal ASC`,
  ).all();
  assert.deepEqual(
    versions.map(row => [row.id, row.version_label, row.version_ordinal]),
    [['v433', '4.3.3', 1], ['v440', '4.4.0', 2]],
    'historical reference versions must be retained rather than overwritten',
  );

  assert.throws(() => {
    db.prepare(
      `INSERT INTO character_reference_versions (
         id, character_reference_id, version_label, version_ordinal, grace_until, created_by
       ) VALUES ('duplicate-label', 'char-a', '4.4.0', 3, '2026-09-24T00:00:00.000Z', 'admin')`,
    ).run();
  }, /UNIQUE/);

  db.prepare(
    `INSERT INTO character_reference_items (
       id, reference_version_id, kind, display_name, exact_hash,
       normalized_content_hash, name_hash, structure_hash
     ) VALUES ('item-1', 'v433', 'worldbook', 'Original Status', 'exact', 'content', 'name', 'structure')`,
  ).run();
  db.prepare(
    `INSERT INTO character_reference_items (
       id, reference_version_id, kind, display_name, exact_hash,
       normalized_content_hash, name_hash, structure_hash
     ) VALUES ('item-2', 'v440', 'worldbook', 'Original Status', 'exact-v2', 'content-v2', 'name', 'structure')`,
  ).run();
  assert.equal(
    db.prepare('SELECT COUNT(*) AS count FROM character_reference_items').get().count,
    2,
    'reference items from old versions must coexist with new versions',
  );

  db.close();
}

{
  assert.equal(
    computeCompatibilityStatus({ builtForOrdinal: 2, testedThroughOrdinal: 2, latestOrdinal: 2 }),
    'compatible_latest',
  );
  assert.equal(
    computeCompatibilityStatus({ builtForOrdinal: 2, testedThroughOrdinal: null, latestOrdinal: 2 }),
    null,
  );
  assert.equal(
    computeCompatibilityStatus({ builtForOrdinal: 1, testedThroughOrdinal: null, latestOrdinal: 2 }),
    'based_on_older',
  );
  assert.equal(
    computeCompatibilityStatus({ builtForOrdinal: 1, testedThroughOrdinal: 1, latestOrdinal: 2 }),
    'pending_latest',
  );
  assert.equal(
    computeCompatibilityStatus({ builtForOrdinal: 2, testedThroughOrdinal: 2, latestOrdinal: 2, knownIncompatible: true }),
    'known_incompatible',
  );
}

console.log('character reference registry smoke: ok');
