import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { DatabaseSync } from 'node:sqlite';

const db = new DatabaseSync(':memory:');
db.exec('CREATE TABLE projects (id TEXT PRIMARY KEY, name TEXT NOT NULL);');
const migration = await readFile(new URL('../migrations/0007_project_inspection_summary.sql', import.meta.url), 'utf8');
db.exec(migration);
const columns = db.prepare('PRAGMA table_info(projects)').all();
assert.equal(columns.some(column => column.name === 'has_ejs'), true);
assert.equal(columns.some(column => column.name === 'has_character_artwork'), true);
db.prepare('INSERT INTO projects (id, name) VALUES (?, ?)').run('demo', 'Demo');
const row = db.prepare('SELECT has_ejs, has_character_artwork FROM projects WHERE id = ?').get('demo');
assert.equal(row.has_ejs, 0);
assert.equal(row.has_character_artwork, 0);
console.log('project inspection summary migration smoke: ok');
