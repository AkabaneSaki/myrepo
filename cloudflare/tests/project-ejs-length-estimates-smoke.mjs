import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFile } from 'node:fs/promises';
import { DatabaseSync } from 'node:sqlite';
import ts from '../../node_modules/typescript/lib/typescript.js';

async function compile(relativePath) {
  const source = await readFile(new URL('../' + relativePath, import.meta.url), 'utf8');
  return ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2020,
      esModuleInterop: true,
    },
  }).outputText;
}

function loadCommonJs(compiled, context, filename) {
  const module = { exports: {} };
  vm.runInNewContext(compiled, { ...context, module, exports: module.exports }, { filename });
  return module.exports;
}

const db = new DatabaseSync(':memory:');
db.exec('CREATE TABLE projects (id TEXT PRIMARY KEY, name TEXT NOT NULL);');
const migration = await readFile(new URL('../migrations/0023_worldbook_ejs_length_estimates.sql', import.meta.url), 'utf8');
db.exec(migration);
const columns = db.prepare('PRAGMA table_info(projects)').all();
assert.equal(columns.some(column => column.name === 'worldbook_ejs_length_estimates'), true);
db.prepare('INSERT INTO projects (id, name) VALUES (?, ?)').run('demo', 'Demo');
assert.equal(db.prepare('SELECT worldbook_ejs_length_estimates FROM projects WHERE id = ?').get('demo').worldbook_ejs_length_estimates, '{}');
db.close();

const estimateApi = loadCommonJs(
  await compile('src/utils/project-entry-estimates.ts'),
  { JSON, String, Number, Object, Array },
  'project-entry-estimates.ts',
);

const validation = estimateApi.validateWorldbookEjsLengthEstimatesInput({
  'uid:ejs-a': '约 800–1500 字',
  'uid:ejs-b': '动态，视循环次数而定',
});
assert.equal(validation.error, null);
assert.deepEqual(
  JSON.parse(JSON.stringify(validation.value)),
  {
    'uid:ejs-a': '约 800–1500 字',
    'uid:ejs-b': '动态，视循环次数而定',
  },
);

const sourceEntries = Array.from({ length: 10 }, (_, index) => ({
  entryKey: 'uid:' + index,
  hasEjs: index >= 8,
  content: index >= 8 ? '<% if (x) { %>动态<% } %>' : '普通文本',
}));
const attached = estimateApi.attachWorldbookEjsLengthEstimates(sourceEntries, {
  'uid:0': '这条旧值不应该显示',
  'uid:8': '约 500 字',
  'uid:9': '约 1k–2k',
});
assert.equal(attached.filter(entry => entry.authorEstimatedLength).length, 2, 'only EJS entries may expose author estimates');
assert.equal(attached[0].authorEstimatedLength, undefined);
assert.equal(attached[8].authorEstimatedLength, '约 500 字');
assert.equal(attached[9].authorEstimatedLength, '约 1k–2k');

const uploadModule = loadCommonJs(
  await compile('src/pages/home/upload-preview.ts'),
  { String },
  'upload-preview.ts',
);
const clientContext = {
  WeakMap,
  Array,
  Object,
  String,
  Number,
  Set,
  URL,
};
vm.createContext(clientContext);
vm.runInContext(
  uploadModule.homeUploadPreviewScript
    + '\n;globalThis.__ejsEstimateTest = { getUploadWorldbookEntryRefs, getUploadWorldbookEntryKey, normalizeUploadWorldbookEntry, uploadWorldbookEntryHasEjs };',
  clientContext,
);
const client = clientContext.__ejsEstimateTest;

assert.equal(client.uploadWorldbookEntryHasEjs({ content: '普通文本' }), false);
assert.equal(client.uploadWorldbookEntryHasEjs({ content: '<% if (x) { %>A<% } %>' }), true);
assert.equal(
  client.uploadWorldbookEntryHasEjs({
    content: '<% if (x) { %>A<% } %>\n<% if (y) { %>B<% } %>',
  }),
  true,
  'multiple EJS blocks in one worldbook entry still produce one entry-level estimate',
);
assert.equal(
  client.uploadWorldbookEntryHasEjs({
    content: '<%# poem-workshop-meta:v1-start\n{"cw_project_id":"p"}\npoem-workshop-meta:v1-end %>',
  }),
  false,
  'Workshop identity metadata must not create an author-estimate field',
);

const parsed = {
  entries: Array.from({ length: 10 }, (_, index) => ({
    uid: index,
    comment: 'Entry ' + index,
    content: index >= 8 ? '<%= value %>' : 'plain',
  })),
};
const refs = client.getUploadWorldbookEntryRefs(parsed);
const normalized = refs.map(({ entry, index, objectKey }) =>
  client.normalizeUploadWorldbookEntry(entry, index, client.getUploadWorldbookEntryKey(entry, index, objectKey)),
);
assert.equal(normalized.filter(entry => entry.hasEjs).length, 2);
assert.equal(normalized.filter(entry => !entry.hasEjs).length, 8);
assert.equal(normalized[0].contentCharacterCount, 5, 'plain non-EJS content should get a deterministic system character count');
assert.equal(normalized[8].contentCharacterCount, undefined, 'EJS content must not present a fake exact system length');
assert.deepEqual(
  JSON.parse(JSON.stringify(normalized.filter(entry => entry.hasEjs).map(entry => entry.entryKey))),
  ['uid:8', 'uid:9'],
);

const formSource = await readFile(new URL('../src/pages/home/modal/project-editor.ts', import.meta.url), 'utf8');
const detailSource = await readFile(new URL('../src/pages/home/render/detail-modal.ts', import.meta.url), 'utf8');
const adminSource = await readFile(new URL('../src/endpoints/admin.ts', import.meta.url), 'utf8');

assert.match(formSource, /collectWorldbookEjsLengthEstimates/);
assert.match(formSource, /estimateEditable: true/);
assert.match(detailSource, /作者预估输出长度/);
assert.match(detailSource, /作者估算 · 非系统测量/);
assert.match(adminSource, /worldbookEjsLengthEstimates: project\.worldbookEjsLengthEstimates/);

console.log('project EJS length estimates smoke: ok');
