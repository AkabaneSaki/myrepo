import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { DatabaseSync } from 'node:sqlite';
import { computeCompatibilityStatus, validateOriginalConflictReferenceItems } from '../src/utils/character-reference.ts';

const migration = await readFile(new URL('../migrations/0014_character_reference_registry.sql', import.meta.url), 'utf8');
const conflictMigration = await readFile(new URL('../migrations/0015_project_original_conflicts.sql', import.meta.url), 'utf8');
const conflictNamesMigration = await readFile(new URL('../migrations/0031_original_conflict_entry_names.sql', import.meta.url), 'utf8');

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
     ) VALUES ('item-1', 'v433', 'worldbook', '[本体]Original Status', 'exact', 'content', 'name', 'structure')`,
  ).run();
  db.prepare(
    `INSERT INTO character_reference_items (
       id, reference_version_id, kind, display_name, exact_hash,
       normalized_content_hash, name_hash, structure_hash
     ) VALUES ('item-2', 'v440', 'worldbook', '[本体]Original Status', 'exact-v2', 'content-v2', 'name', 'structure')`,
  ).run();
  assert.equal(
    db.prepare('SELECT COUNT(*) AS count FROM character_reference_items').get().count,
    2,
    'reference items from old versions must coexist with new versions',
  );

  db.prepare(
    `INSERT INTO projects (id, conflicts_with_original, original_conflict_reference_item_ids)
     VALUES ('legacy-good', 1, '["item-1"]'), ('legacy-incomplete', 1, '["missing-item"]')`,
  ).run();
  db.exec(conflictNamesMigration);

  const migratedColumns = new Set(
    db.prepare('PRAGMA table_info(projects)').all().map(row => String(row.name)),
  );
  assert.ok(migratedColumns.has('original_conflict_entry_names'));

  assert.deepEqual(
    JSON.parse(String(db.prepare(`SELECT original_conflict_entry_names AS names FROM projects WHERE id = 'legacy-good'`).get().names)),
    ['[本体]Original Status'],
    'legacy selected reference IDs should be snapshotted to entry names once',
  );
  assert.deepEqual(
    JSON.parse(String(db.prepare(`SELECT original_conflict_entry_names AS names FROM projects WHERE id = 'legacy-incomplete'`).get().names)),
    [],
    'incomplete legacy mappings must remain empty so runtime fails closed',
  );


  const insertBaseline = db.prepare(
    'INSERT INTO character_reference_items (id, reference_version_id, kind, display_name, source_key, exact_hash, normalized_content_hash, name_hash, structure_hash) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
  );
  const addBaseline = (id, versionId, kind, name, sourceKey = null) =>
    insertBaseline.run(id, versionId, kind, name, sourceKey, id, id, id, id);
  addBaseline('wb-real', 'v433', 'worldbook', '[本体][设定]王都');
  addBaseline('wb-other', 'v433', 'worldbook', '[DLC][设定]额外内容');
  addBaseline('rx-real', 'v433', 'regex', '显示修饰规则', 'original-regex-id');
  addBaseline('rx-alt', 'v433', 'regex', '行为覆盖');
  addBaseline('rx-other-version', 'v440', 'regex', '新版角色正则');

  // Use actual migration-backed SQLite and the production SQL, not a stub
  // that would silently accept out-of-version or non-original entries.
  const c = { env: { DB: { prepare(sql) {
    const prepared = db.prepare(sql);
    return { bind(...args) {
      return { all: async () => ({ results: prepared.all(...args) }) };
    } };
  } } } };
  const mixed = await validateOriginalConflictReferenceItems(
    c, 'v433', ['wb-real', 'rx-real', 'rx-alt', 'rx-real'],
  );
  assert.deepEqual(mixed.ids, ['wb-real', 'rx-real', 'rx-alt']);
  assert.deepEqual(mixed.entryNames, ['[本体][设定]王都', '显示修饰规则', '行为覆盖']);
  assert.deepEqual(mixed.targets.map(target => target.sourceKey), [null, 'original-regex-id', null]);
  const regexOnly = await validateOriginalConflictReferenceItems(c, 'v433', ['rx-real']);
  assert.deepEqual(regexOnly.entryNames, ['显示修饰规则']);
  await assert.rejects(validateOriginalConflictReferenceItems(c,'v433',['wb-other']), /只能选择原版/);
  await assert.rejects(validateOriginalConflictReferenceItems(c,'v433',['rx-other-version']), /已经找不到/);
  await assert.rejects(validateOriginalConflictReferenceItems(c,'v433',['rx-real','missing']), /已经找不到/);
  await assert.rejects(validateOriginalConflictReferenceItems(c,null,['rx-real']), /角色卡版本/);

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
