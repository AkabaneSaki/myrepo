import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { DatabaseSync } from 'node:sqlite';

const db = new DatabaseSync(':memory:');
db.exec(`
  CREATE TABLE projects (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    description TEXT
  );
`);
const migration = await readFile(new URL('../migrations/0016_project_precautions.sql', import.meta.url), 'utf8');
db.exec(migration);

const columns = db.prepare('PRAGMA table_info(projects)').all();
assert.equal(columns.some(column => column.name === 'precautions'), true);

const text = '<script>alert(1)</script>\n先安装依赖';
db.prepare('INSERT INTO projects (id, name, precautions) VALUES (?, ?, ?)').run('demo', 'Demo', text);
assert.equal(db.prepare('SELECT precautions FROM projects WHERE id = ?').get('demo').precautions, text);

const formSource = await readFile(new URL('../src/pages/home/modal/project-editor.ts', import.meta.url), 'utf8');
const detailSource = await readFile(new URL('../src/pages/home/render/detail-modal.ts', import.meta.url), 'utf8');
const typesSource = await readFile(new URL('../src/types.ts', import.meta.url), 'utf8');
const adminSource = await readFile(new URL('../src/endpoints/admin.ts', import.meta.url), 'utf8');

assert.match(formSource, /id="projPrecautions"/);
assert.match(formSource, /maxlength="2000"/);
assert.match(formSource, /const precautions = form\.querySelector\('#projPrecautions'\)/);
assert.match(detailSource, /escapeHtml\(precautionsText\)/);
assert.doesNotMatch(detailSource, /renderProjectDescriptionMarkdown\(precautionsText/);
assert.match(typesSource, /precautions: z\.string\(\)\.max\(2000\)/);
assert.match(adminSource, /precautions: project\.precautions \?\? null/);

console.log('project precautions smoke: ok');
