import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { DatabaseSync } from 'node:sqlite';

const read = path => readFile(new URL('../src/' + path, import.meta.url), 'utf8');
const [recommendations, dbSource, stateSource, apiSource] = await Promise.all([
  read('endpoints/recommendations.ts'), read('utils/db.ts'),
  read('pages/home/state.ts'), read('pages/home/api.ts'),
]);
const functionSource = (source, name) => {
  const match = source.match(new RegExp('(?:async )?function ' + name + '\\([^]*?\\n\\}'));
  assert.ok(match, name + ' must remain testable');
  return match[0];
};

const state = {
  currentUser: { id: 'admin-a', isAdmin: true },
  editorRecommendations: [], editorRecommendationsRequestToken: 0,
  myRecommendedProjectIds: [], likesMap: new Map(), subsMap: new Map(),
};
let token = 'session-a';
const storage = { getItem: () => token };
const pending = [];
const setUser = new Function('state', 'createDefaultDailyRandomDrawState',
  functionSource(stateSource, 'setCurrentUser') + '\nreturn setCurrentUser;',
)(state, () => ({}));
const fetchPicks = new Function('state', 'localStorage', 'TOKEN_KEY', 'apiFetch',
  functionSource(stateSource, 'setEditorRecommendations') + '\n'
  + functionSource(stateSource, 'syncProjectStats') + '\n'
  + functionSource(apiSource, 'fetchDevTeamRecommendations') + '\nreturn fetchDevTeamRecommendations;',
)(state, storage, 'token', () => new Promise(resolve => pending.push(resolve)));
const pick = (id, userLiked) => ({ id, likesCount: 3, userLiked });

const oldUserRequest = fetchPicks();
token = 'session-b';
setUser({ id: 'admin-b', isAdmin: true });
const newUserRequest = fetchPicks();
pending[1]({ recommendations: [pick('b', true)], myRecommendedProjectIds: ['b'] });
await newUserRequest;
pending[0]({ recommendations: [pick('a', true)], myRecommendedProjectIds: ['a'] });
await oldUserRequest;
assert.deepEqual(state.myRecommendedProjectIds, ['b'], 'a previous account response must not change recommendation ownership');
assert.equal(state.likesMap.has('a'), false, 'a previous account response must not restore its likes');

const firstRequest = fetchPicks();
const latestRequest = fetchPicks();
pending[3]({ recommendations: [pick('latest', false)], myRecommendedProjectIds: ['latest'] });
await latestRequest;
pending[2]({ recommendations: [pick('old', true)], myRecommendedProjectIds: ['old'] });
await firstRequest;
assert.deepEqual(state.myRecommendedProjectIds, ['latest'], 'the latest request must win within the same account');
state.likesMap.get('latest').liked = true;
token = null;
setUser(null);
assert.deepEqual(state.myRecommendedProjectIds, []);
assert.equal(state.likesMap.get('latest').liked, false, 'logout must clear personalized editor likes immediately');
const anonymousRequest = fetchPicks();
token = 'session-c';
setUser({ id: 'admin-c', isAdmin: true });
const loggedInRequest = fetchPicks();
pending[5]({ recommendations: [pick('c', true)], myRecommendedProjectIds: ['c'] });
await loggedInRequest;
pending[4]({ recommendations: [pick('anonymous', false)] });
await anonymousRequest;
assert.deepEqual(state.myRecommendedProjectIds, ['c'], 'an anonymous startup response must not clear a new login');

let finishExpiredRequest;
const requestApi = new Function('localStorage', 'TOKEN_KEY', 'API_BASE', 'fetch',
  'clearAuthenticatedCoverObjectUrls', 'invalidateAllProjectDetailCaches', 'setCurrentUser',
  'renderApp', 'parseResponseBody', 'resolveApiErrorMessage',
  functionSource(apiSource, 'apiFetch') + '\nreturn apiFetch;',
)(storage, 'token', '', () => new Promise(resolve => { finishExpiredRequest = resolve; }),
  () => assert.fail('a stale 401 must not clear the new account'), () => {}, setUser,
  () => {}, async () => ({ rawText: '', data: { error: 'Expired' } }), () => 'Expired');
const expiredRequest = requestApi('/api/devteam-recommendations');
token = 'session-d';
setUser({ id: 'admin-d', isAdmin: true });
finishExpiredRequest({ status: 401, ok: false });
await assert.rejects(expiredRequest, /Expired/);
assert.equal(state.currentUser.id, 'admin-d');
assert.equal(token, 'session-d');

const sql = (source, pattern) => {
  const match = source.match(pattern);
  assert.ok(match, 'expected directly testable SQL: ' + pattern);
  return match[1];
};
const listSql = sql(recommendations, /`(SELECT\s+p\.\*,[^]*?LIMIT 100)`/);
const curatorSql = sql(recommendations, /`(INSERT INTO devteam_curators[^]*?)`/);
const saveSql = sql(recommendations, /`(INSERT INTO devteam_recommendations[^]*?)`/);
const deleteSql = sql(recommendations, /'(DELETE FROM devteam_recommendations[^']+)'/);
const auditSql = sql(dbSource, /`(INSERT INTO admin_action_logs[^]*?)`/);
const revisionSql = sql(recommendations, /`\s*(INSERT INTO site_settings[^]*?)`/);
assert.equal((recommendations.match(/await c\.env\.DB\.batch\(/g) || []).length, 2, 'save and delete must each use one atomic batch');
assert.doesNotMatch(recommendations, /\.run\(\)|projectDb\.logAdminAction/);

const db = new DatabaseSync(':memory:');
db.exec(`
  CREATE TABLE users (id TEXT PRIMARY KEY, is_admin INTEGER, global_name TEXT);
  CREATE TABLE super_admins (user_id TEXT PRIMARY KEY);
  CREATE TABLE devteam_curators (user_id TEXT PRIMARY KEY, enabled INTEGER, updated_at TEXT);
  CREATE TABLE projects (id TEXT PRIMARY KEY, name TEXT, author_id TEXT, status TEXT, is_published INTEGER, visibility INTEGER);
  CREATE TABLE devteam_recommendations (curator_id TEXT, project_id TEXT, comment_text TEXT, reaction_label TEXT, updated_at TEXT, PRIMARY KEY(curator_id, project_id));
  CREATE INDEX idx_devteam_recommendations_updated ON devteam_recommendations(updated_at);
  CREATE TABLE site_settings (key TEXT PRIMARY KEY, value TEXT, updated_at TEXT, updated_by TEXT);
  CREATE TABLE admin_action_logs (id TEXT PRIMARY KEY, action TEXT, target_type TEXT, target_id TEXT, actor_id TEXT, actor_name TEXT CHECK(actor_name <> 'FAIL'), detail TEXT, created_at TEXT);
`);
for (const id of ['admin-a', 'admin-b']) {
  db.prepare('INSERT INTO users VALUES (?, 1, ?)').run(id, id);
  db.prepare(curatorSql).run(id);
}
for (let index = 0; index < 120; index += 1) {
  const id = 'project-' + String(index).padStart(3, '0');
  db.prepare('INSERT INTO projects VALUES (?, ?, ?, ?, 1, 1)').run(id, id, 'admin-a', 'approved');
  for (const admin of ['admin-a', 'admin-b']) {
    db.prepare('INSERT INTO devteam_recommendations VALUES (?, ?, ?, ?, ?)')
      .run(admin, id, '', '', index < 50 ? '2026-10-09' : '2026-10-08');
  }
}
const listed = db.prepare(listSql).all('');
assert.equal(listed.length, 100, 'duplicate recent picks must not displace older independent projects');
assert.equal(new Set(listed.map(row => row.id)).size, 100);
assert.ok(listed.some(row => row.id === 'project-099'));
db.prepare("UPDATE projects SET visibility = 0 WHERE id = 'project-000'").run();
assert.equal(db.prepare(listSql).all('').some(row => row.id === 'project-000'), false);

const batch = statements => {
  db.exec('BEGIN');
  try {
    for (const [query, values] of statements) db.prepare(query).run(...values);
    db.exec('COMMIT');
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }
};
let logId = 0;
const audit = (action, actorName, changed = false) => [auditSql,
  ['log-' + ++logId, action, 'project', 'target', 'admin-a', actorName, null, '2026-10-09', Number(changed)]];
const save = actorName => batch([
  [curatorSql, ['admin-a']], [saveSql, ['admin-a', 'target', '', null, null]],
  audit('editor_pick_saved', actorName), [revisionSql, ['admin-a']],
]);
const remove = actorName => batch([
  [deleteSql, ['admin-a', 'target']], audit('editor_pick_removed', actorName, true),
  [revisionSql, ['admin-a']],
]);
const revision = () => db.prepare("SELECT value FROM site_settings WHERE key = 'dlc_kitchen_revision'").get()?.value;
assert.throws(() => save('FAIL'), /CHECK constraint failed/);
assert.equal(db.prepare("SELECT COUNT(*) AS n FROM devteam_recommendations WHERE project_id = 'target'").get().n, 0);
assert.equal(revision(), undefined, 'failed audit must roll back the recommendation and revision');
save('Admin A');
assert.equal(revision(), '1');
assert.throws(() => remove('FAIL'), /CHECK constraint failed/);
assert.equal(db.prepare("SELECT COUNT(*) AS n FROM devteam_recommendations WHERE project_id = 'target'").get().n, 1);
assert.equal(revision(), '1', 'failed delete audit must roll back deletion and revision');
remove('Admin A');
remove('Admin A');
assert.equal(db.prepare("SELECT COUNT(*) AS n FROM admin_action_logs WHERE action = 'editor_pick_removed'").get().n, 1, 'retrying an absent removal must not invent an audit event');
db.close();
console.log('Editor picks identity, unique pagination and atomic audit: ok');
