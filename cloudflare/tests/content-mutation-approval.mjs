import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import Module, { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

// Compile trusted repository modules in memory; never execute submitted content.
const root = fileURLToPath(new URL('../', import.meta.url));
const built = await build({
  stdin: { contents: 'export {projectDb} from "./src/utils/db.ts"; export {r2Storage} from "./src/utils/r2.ts"; export {jwt} from "./src/utils/jwt.ts"; export {ProjectUpload,ProjectRegexUpload,ProjectEntryRemove} from "./src/endpoints/projects/assets.ts";', resolveDir: root, loader: 'ts' },
  bundle: true, write: false, platform: 'node', format: 'cjs', logLevel: 'silent',
});
const modulePath = fileURLToPath(new URL('content-mutation-test-bundle.cjs', import.meta.url));
const compiled = new Module(modulePath);
compiled.paths = Module._nodeModulePaths(root);
compiled.require = createRequire(import.meta.url);
compiled._compile(built.outputFiles[0].text, modulePath);
const { projectDb, r2Storage, jwt, ProjectUpload, ProjectRegexUpload, ProjectEntryRemove } = compiled.exports;

const sqlite = new DatabaseSync(':memory:');
sqlite.exec(`CREATE TABLE projects (
  id TEXT PRIMARY KEY, status TEXT, draft_revision INTEGER, content_mutation_token TEXT,
  reviewed_at TEXT, reviewer_id TEXT, reject_reason TEXT, updated_at TEXT,
  latest_approved_at TEXT, accepted_code_check TEXT, download_url TEXT, file_size INTEGER,
  has_ejs INTEGER, has_character_artwork INTEGER
);`);
const db = { prepare(sql) { return { bind(...values) { const statement = sqlite.prepare(sql); return {
  async first() { return statement.get(...values) ?? null; },
  async run() { return statement.run(...values); },
}; } }; } };
const c = { env: { DB: db, JWT_SECRET: 'local-mutation-check', R2_BUCKET: { async get() { return null; } } },
  json(body, status) { return { body, status }; } };
const auth = await jwt.sign(c, { userId: 'creator', username: 'Creator', avatar: '', isAdmin: false });
const read = () => sqlite.prepare('SELECT * FROM projects WHERE id = ?').get('project');
projectDb.get = async () => { const row = read(); return { id: row.id, status: row.status, draftRevision: row.draft_revision, authorId: 'creator', isPublished: false, publishedProjectId: null }; };
function reset() {
  sqlite.exec('DELETE FROM projects');
  sqlite.prepare("INSERT INTO projects (id,status,draft_revision) VALUES (?, 'pending', 1)").run('project');
}
const worldbook = JSON.stringify({ entries: [{ uid: 1, comment: 'entry', content: '安全内容' }] });
const regex = JSON.stringify([{ id: 'regex', scriptName: '脚本', findRegex: 'x', replaceString: 'safe' }]);
function endpoint(Class, body, validatedBody) {
  const route = new Class();
  route.getValidatedData = async () => ({ params: { projectId: 'project' }, body: validatedBody });
  return route.handle({ ...c, req: {
    header(name) { return name === 'authorization' ? `Bearer ${auth}` : name === 'content-type' ? 'application/json' : undefined; },
    async arrayBuffer() { return new TextEncoder().encode(body).buffer; },
  } });
}
const defer = () => { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; };

for (const [Class, body, removeBody] of [
  [ProjectUpload, worldbook], [ProjectRegexUpload, regex],
  [ProjectEntryRemove, '', { kind: 'worldbook', entryKey: 'uid:1' }],
]) {
  reset();
  c.env.R2_BUCKET.get = async key => key.endsWith('.json') && key.includes('project-project') ? { async text() { return worldbook; } } : null;
  const entered = defer(), release = defer();
  let puts = 0;
  r2Storage.uploadProjectFile = async () => { puts++; entered.resolve(); await release.promise; return { url: '/file', size: 123 }; };
  const pending = endpoint(Class, body, removeBody);
  await entered.promise;
  assert.equal(read().status, 'drafting');
  assert.equal(read().draft_revision, 2);
  assert.ok(read().content_mutation_token);
  const approval = await projectDb.review(c, 'project', 'admin', 'approve', undefined, 2, { filesHash: 'reviewed' });
  assert.equal(approval, null, 'approval cannot run while R2 put is paused');
  const concurrent = await endpoint(Class, body, removeBody);
  assert.equal(concurrent.status, 409, 'a later request reading drafting also cannot claim');
  assert.equal(puts, 1);
  await assert.rejects(projectDb.bumpDraftRevision(c, 'project'), /文件正在保存/);
  await assert.rejects(projectDb.update(c, 'project', { status: 'pending' }), /文件正在保存/);
  release.resolve();
  assert.equal((await pending).success, true);
  assert.equal(read().status, 'pending');
  assert.equal(read().content_mutation_token, null);
  assert.equal(await projectDb.review(c, 'project', 'admin', 'approve', undefined, 1, { filesHash: 'stale' }), null);
  assert.ok(await projectDb.review(c, 'project', 'admin', 'approve', undefined, 2, { filesHash: 'new' }));
  assert.equal(read().status, 'approved');
}

reset();
r2Storage.uploadProjectFile = async () => { throw new Error('controlled R2 failure'); };
await assert.rejects(endpoint(ProjectUpload, worldbook), /controlled R2 failure/);
assert.equal(read().status, 'pending');
assert.equal(read().content_mutation_token, null);
assert.equal(read().draft_revision, 2, 'a failed save still invalidates the old review');
r2Storage.uploadProjectFile = async () => ({ url: '/retry', size: 123 });
assert.equal((await endpoint(ProjectUpload, worldbook)).success, true);
assert.equal(read().draft_revision, 3);
sqlite.close();
console.log('Content mutation: paused R2 blocks approval, concurrent writers and metadata changes; failure releases ownership and invalidates old review: ok');
