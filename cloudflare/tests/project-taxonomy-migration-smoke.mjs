import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { DatabaseSync } from 'node:sqlite';

const db = new DatabaseSync(':memory:');
db.exec(`
  CREATE TABLE projects (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    status TEXT DEFAULT 'pending',
    is_published INTEGER DEFAULT 0,
    visibility INTEGER DEFAULT 1,
    latest_approved_at TEXT,
    updated_at TEXT,
    tags TEXT DEFAULT '[]'
  );
`);

const insert = db.prepare('INSERT INTO projects (id, name, tags) VALUES (?, ?, ?)');
insert.run('system-dirty', 'System dirty', JSON.stringify(['扩展', '系统', '旧自定义']));
insert.run('character', 'Character', JSON.stringify(['角色', '精灵', '法师']));
insert.run('event', 'Event', JSON.stringify(['事件', '剧情']));
insert.run('extension', 'Extension', JSON.stringify(['扩展', '战斗']));
insert.run('invalid', 'Invalid', 'not-json');

const migration = await readFile(new URL('../migrations/0008_project_taxonomy.sql', import.meta.url), 'utf8');
const displayTagsMigration = await readFile(new URL('../migrations/0009_project_display_tags.sql', import.meta.url), 'utf8');
db.exec(migration);
db.exec(displayTagsMigration);

const columns = db.prepare('PRAGMA table_info(projects)').all();
for (const name of ['project_type', 'extension_type', 'facets', 'custom_tags', 'display_tags']) {
  assert.equal(columns.some(column => column.name === name), true, `missing column ${name}`);
}

const rows = Object.fromEntries(
  db.prepare('SELECT id, project_type, extension_type, facets, custom_tags FROM projects').all().map(row => [row.id, row]),
);

assert.equal(rows['system-dirty'].project_type, '系统核心');
assert.deepEqual(JSON.parse(rows['system-dirty'].custom_tags), ['旧自定义']);
assert.equal(rows.character.project_type, '角色');
assert.deepEqual(JSON.parse(rows.character.custom_tags), ['精灵', '法师']);
assert.deepEqual(JSON.parse(rows.character.facets), {});
assert.equal(rows.event.project_type, '事件');
assert.deepEqual(JSON.parse(rows.event.custom_tags), ['剧情']);
assert.equal(rows.extension.project_type, '扩展');
assert.equal(rows.extension.extension_type, null);
assert.deepEqual(JSON.parse(rows.extension.custom_tags), ['战斗']);
assert.equal(rows.invalid.project_type, '系统核心');
assert.deepEqual(JSON.parse(rows.invalid.custom_tags), []);

insert.run('new-default', 'New default', JSON.stringify([]));
const defaultRow = db
  .prepare('SELECT project_type, extension_type, facets, custom_tags, display_tags FROM projects WHERE id = ?')
  .get('new-default');
assert.equal(defaultRow.project_type, '系统核心');
assert.equal(defaultRow.extension_type, null);
assert.deepEqual(JSON.parse(defaultRow.facets), {});
assert.deepEqual(JSON.parse(defaultRow.custom_tags), []);
assert.equal(defaultRow.display_tags, null);

const indexes = db.prepare("PRAGMA index_list('projects')").all();
assert.equal(indexes.some(index => index.name === 'idx_projects_public_type_published'), true);

console.log('project taxonomy migration smoke: ok');
