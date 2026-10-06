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
      resolveJsonModule: true,
    },
  }).outputText;
}

function loadCommonJs(compiled, context, filename) {
  const module = { exports: {} };
  vm.runInNewContext(compiled, { ...context, module, exports: module.exports }, { filename });
  return module.exports;
}

const workshopConfig = JSON.parse(await readFile(new URL('../../config/workshop.json', import.meta.url), 'utf8'));
assert.deepEqual(workshopConfig.projectCommunity.discordGuildIds, ['1417861565679669272']);

const discordApi = loadCommonJs(
  await compile('src/utils/project-discord.ts'),
  {
    URL,
    Error,
    Set,
    Array,
    String,
    require(specifier) {
      if (specifier === '../../../config/workshop.json') return workshopConfig;
      throw new Error('Unexpected require: ' + specifier);
    },
  },
  'project-discord.ts',
);

const allowed = 'https://discord.com/channels/1417861565679669272/1473340658713624798';
assert.equal(discordApi.normalizeProjectDiscordThreadUrl(allowed), allowed);
assert.equal(
  discordApi.normalizeProjectDiscordThreadUrl('https://www.discord.com/channels/1417861565679669272/1473340658713624798'),
  allowed,
);
assert.equal(discordApi.normalizeProjectDiscordThreadUrl(''), null);
assert.throws(
  () => discordApi.normalizeProjectDiscordThreadUrl('https://discord.com/channels/999999999999999999/1473340658713624798'),
  /允许的游戏讨论服务器/,
);
assert.throws(
  () => discordApi.normalizeProjectDiscordThreadUrl(allowed + '/1501937377684488402'),
  /不要填写单条消息链接/,
);
assert.throws(
  () => discordApi.normalizeProjectDiscordThreadUrl('https://discord.gg/example'),
  /不要填写单条消息链接|必须使用 discord\.com/,
);
assert.throws(
  () => discordApi.normalizeProjectDiscordThreadUrl('http://discord.com/channels/1417861565679669272/1473340658713624798'),
  /HTTPS/,
);

const db = new DatabaseSync(':memory:');
db.exec('CREATE TABLE projects (id TEXT PRIMARY KEY, name TEXT NOT NULL);');
const migration = await readFile(new URL('../migrations/0024_project_discord_thread_url.sql', import.meta.url), 'utf8');
db.exec(migration);
assert.ok(
  db.prepare("SELECT name FROM pragma_table_info('projects') WHERE name='discord_thread_url'").get(),
  'Discord thread migration must add discord_thread_url',
);
db.close();

const updateCenterModule = loadCommonJs(
  await compile('src/pages/home/update-center.ts'),
  {},
  'update-center.ts',
);

const storage = new Map();
const localStorage = {
  getItem(key) { return storage.has(key) ? storage.get(key) : null; },
  setItem(key, value) { storage.set(key, String(value)); },
  removeItem(key) { storage.delete(key); },
  clear() { storage.clear(); },
};
const state = {
  tavern: {
    installedProjects: [
      { projectId: 'project-1', localVersion: '1.0.0' },
      { projectId: 'project-2', localVersion: '2.0.0' },
    ],
    installedProjectsLoaded: true,
    dlcUpdateKnown: false,
    dlcUpdateAvailable: false,
    dlcUpdateCheckedAt: 0,
    dlcUpdateSignature: '',
    dlcUpdateCheckPending: false,
  },
};
let apiCalls = 0;
let nextApiResult = {
  success: true,
  hasUpdate: true,
  updates: [{ id: 'project-1', name: 'One', installedVersion: '1.0.0', latestVersion: '1.1.0' }],
};
const updateContext = {
  state,
  localStorage,
  console,
  Date,
  JSON,
  String,
  Array,
  Boolean,
  Map,
  Promise,
  renderApp() {},
  apiFetch: async (endpoint, options) => {
    apiCalls += 1;
    assert.equal(endpoint, '/api/projects/version-check');
    assert.equal(options.method, 'POST');
    return nextApiResult;
  },
};
vm.createContext(updateContext);
vm.runInContext(
  updateCenterModule.homeUpdateCenterScript
    + '\n;globalThis.__updateTest = { requestDlcVersionCheck, getInstalledProjectVersionPayload, readDlcUpdateStatusCache };',
  updateContext,
);
const updateApi = updateContext.__updateTest;

let result = await updateApi.requestDlcVersionCheck();
assert.equal(apiCalls, 1);
assert.equal(result.hasUpdate, true);
assert.equal(state.tavern.dlcUpdateAvailable, true);

result = await updateApi.requestDlcVersionCheck();
assert.equal(apiCalls, 1, 'known true status must not keep recounting updates in the background');
assert.equal(result.cached, true);

nextApiResult = {
  success: true,
  hasUpdate: true,
  updates: [
    { id: 'project-1', name: 'One', installedVersion: '1.0.0', latestVersion: '1.2.0' },
    { id: 'project-2', name: 'Two', installedVersion: '2.0.0', latestVersion: '2.1.0' },
  ],
};
result = await updateApi.requestDlcVersionCheck({ fresh: true });
assert.equal(apiCalls, 2, 'opening the update center must perform a fresh batch check');
assert.equal(result.updates.length, 2);

localStorage.clear();
state.tavern.dlcUpdateKnown = false;
state.tavern.dlcUpdateAvailable = false;
nextApiResult = { success: true, hasUpdate: false, updates: [] };
await updateApi.requestDlcVersionCheck();
assert.equal(apiCalls, 3);
await updateApi.requestDlcVersionCheck();
assert.equal(apiCalls, 3, 'known false status must respect the background TTL');

state.tavern.installedProjects[0].localVersion = '1.1.0';
await updateApi.requestDlcVersionCheck();
assert.equal(apiCalls, 4, 'changing the local installed-version signature must invalidate the old cache');

const detailSource = await readFile(new URL('../src/pages/home/render/detail-modal.ts', import.meta.url), 'utf8');
const editorSource = await readFile(new URL('../src/pages/home/modal/project-editor.ts', import.meta.url), 'utf8');
const readEndpointSource = await readFile(new URL('../src/endpoints/projects/read.ts', import.meta.url), 'utf8');
const layoutSource = await readFile(new URL('../src/pages/home/render/layout.ts', import.meta.url), 'utf8');

assert.match(editorSource, /Discord 讨论帖（可选）/);
assert.match(editorSource, /id=\"discordThreadUrl\"/);
assert.match(detailSource, /detail-discord-thread/);
assert.match(detailSource, />Discord 讨论帖</);
assert.match(detailSource, /target=\"_blank\" rel=\"noopener noreferrer\"/);
assert.match(layoutSource, /<span>有更新<\/span>/);
assert.match(layoutSource, /无更新/);

const versionCheckClass = readEndpointSource.slice(
  readEndpointSource.indexOf('export class ProjectVersionCheck'),
  readEndpointSource.indexOf('/**\r\n * 获取当前用户的所有项目', readEndpointSource.indexOf('export class ProjectVersionCheck')),
);
assert.match(versionCheckClass, /SELECT p\.id, p\.name, p\.version/);
assert.doesNotMatch(versionCheckClass, /SELECT p\.\*/);
assert.doesNotMatch(versionCheckClass, /enrichProjects/);

console.log('project Discord link + DLC update center smoke: ok');
