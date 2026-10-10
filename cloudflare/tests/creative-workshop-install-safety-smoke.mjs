import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFile } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { webcrypto } from 'node:crypto';
import ts from '../../node_modules/typescript/lib/typescript.js';
import * as projectVersionApi from '../src/utils/version.js';
import { parseRegexEntriesPreview } from '../src/utils/project-preview.ts';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../../src/CreativeWorkshop');
const compiled = new Map();
for (const path of ['bridge/host', 'bridge/protocol', ...['worldbook', 'worldbook-stage', 'worldbook-normalize',
  'worldbook-reconcile', 'project-type', 'regex', 'regex-name', 'install-registry', 'install-identity',
  'install-state', 'original-conflicts', 'regex-record', 'installed-transfer'].map(name => 'services/' + name)]) {
  compiled.set(resolve(root, path + '.ts'), ts.transpileModule(await readFile(resolve(root, path + '.ts'), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
  }).outputText);
}
const projectId = '11111111-1111-4111-8111-111111111111';
const secondProjectId = '22222222-2222-4222-8222-222222222222';
function detail(version, regexOnly = false, id = projectId) {
  const source = regexOnly ? [] : [{ uid: 1, __cwEntryKey: 'uid:1', comment: '正文', content: 'content-' + version,
    constant: true, disable: false, sticky: 0, group: 'shared-group', groupWeight: 42 }];
  return { project: { id, name: '测试 DLC', version, downloadUrl: source.length ? 'https://test.invalid/package.json' : null },
    worldbookEntriesPreview: source.map(entry => ({ ...entry, entryKey: 'uid:1' })),
    regexEntriesPreview: [{ id: 'r', findRegex: '/foo/g', replaceString: 'regex-' + version,
      trimStrings: ['trim'], placement: [1, 2, 5], markdownOnly: true, minDepth: 2, maxDepth: 9 }], source };
}
const get = (object, path, fallback) => String(path).split('.').reduce((value, key) => value?.[key], object) ?? fallback;
const lodash = {
  get, isString: value => typeof value === 'string', isNumber: value => typeof value === 'number',
  isBoolean: value => typeof value === 'boolean', isObject: value => value !== null && typeof value === 'object',
  uniq: values => [...new Set(values)],
  groupBy: (values, selector) => values.reduce((result, value) => { (result[selector(value)] ||= []).push(value); return result; }, {}),
  set(object, path, value) { const keys = path.split('.'); let current = object;
    for (const key of keys.slice(0, -1)) current = (current[key] ||= {}); current[keys.at(-1)] = value; },
};
function harness(initial = detail('1.0.0')) {
  const h = { books: { Records: [], A: [], B: [], Disabled: [] }, bound: ['Records', 'A', 'B'], regexes: [], variables: {},
    details: new Map([[initial.project.id, initial]]), posts: [], reads: [], worldbookWrites: 0, regexWrites: 0,
    regexFailure: false, downloadFailure: false, corruptRegex: false, unreadable: false, failFinalScan: false,
    activeWrites: 0, maxWrites: 0, dlcWorldbookWrites: 0,
    regexDownloads: 0, regexFileFailure: false, omitRegexUrl: false, characterAvatar: 'card.png' };
  const clone = value => structuredClone(value);
  const duringWrite = async task => {
    h.activeWrites++; h.maxWrites = Math.max(h.maxWrites, h.activeWrites);
    try { await new Promise(resolve => setTimeout(resolve, 1)); return await task(); } finally { h.activeWrites--; }
  };
  const globals = {
    _: lodash, crypto: webcrypto, structuredClone, setTimeout, clearTimeout, console: { info() {}, warn() {}, error() {} },
    getScriptId: () => 'script', getCurrentCharacterName: () => 'card', getVariables: () => clone(h.variables),
    updateVariablesWith: updater => { h.variables = clone(updater(clone(h.variables))); return clone(h.variables); },
    getCharWorldbookNames: () => ({ primary: h.bound[0] || null, additional: h.bound.slice(1) }),
    getGlobalWorldbookNames: () => [], getChatWorldbookName: () => null,
    getWorldbookNames: () => Object.keys(h.books),
    getWorldbook: async name => {
      h.reads.push(name);
      if (h.unreadable || (h.failFinalScan && h.posts.some(post =>
        post.type === 'bridge:operation-progress' && post.payload?.phase === 'final_verify')))
        throw new Error('read unavailable');
      return clone(h.books[name]);
    },
    createWorldbook: async name => { h.books[name] ||= []; h.afterWorldbookCreate?.(); },
    rebindCharWorldbooks: async (_, names) => { h.bound = [names.primary, ...names.additional].filter(Boolean); },
    updateWorldbookWith: async (name, updater) => duringWrite(async () => {
      const entries = await updater(clone(h.books[name]));
      let nextUid = Math.max(0, ...h.books[name].map(entry => entry.uid));
      // Mimic TavernHelper: uid allocated per book, name replaces raw comment; arbitrary raw fields are absent.
      h.books[name] = clone(entries.map(entry => {
        const { comment, ...saved } = entry; return { ...saved, uid: saved.uid ?? ++nextUid };
      }));
      h.worldbookWrites++; if (name !== 'Records') h.dlcWorldbookWrites++; h.afterWorldbookWrite?.(); return clone(h.books[name]);
    }),
    getTavernRegexes: () => clone(h.regexes),
    updateTavernRegexesWith: async updater => duringWrite(async () => {
      const next = await updater(clone(h.regexes)); h.regexWrites++;
      if (h.regexFailure) throw new Error('Regex write failed');
      h.regexes = clone(next.map(regex => { const { placement, substitute_regex, ...saved } = regex; return saved; }));
      if (h.corruptRegex) h.regexes[0].destination.display = !h.regexes[0].destination.display;
      return clone(h.regexes);
    }),
    SillyTavern: { getContext: () => ({ characters: [{ avatar: h.characterAvatar }], characterId: 0, updateWorldInfoList: async () => {} }) },
  };
  globals.createWorldbookEntries = async (name, entries) => {
    const before = h.books[name].length;
    const worldbook = await globals.updateWorldbookWith(name, current => [...current, ...entries]);
    return { worldbook, new_entries: worldbook.slice(before) };
  };
  const cache = new Map();
  function load(path) {
    path = resolve(path);
    if (cache.has(path)) return cache.get(path).exports;
    const module = { exports: {} }; cache.set(path, module);
    const require = specifier => {
      if (specifier === '../../../cloudflare/src/utils/version.js') return projectVersionApi;
      if (specifier.endsWith('/project-fetch') || specifier === './project-fetch') return {
        invalidateCreativeWorkshopProjectCache() {},
        fetchCreativeWorkshopProjectDetail: async (id, version) => {
          if (h.downloadFailure) throw new Error('download failed'); const current = h.details.get(id);
          if (version && current.project.version !== version) throw new Error('version mismatch'); h.afterDownload?.(); return clone(current);
        }, fetchCreativeWorkshopProjectWorldbookSource: async data => clone(data.source),
        fetchCreativeWorkshopProjectRegexSource: async (url, data) => {
          if (h.regexFileFailure) throw new Error('regex download unavailable');
          assert.match(url, /\/api\/files\/projects\//);
          assert.equal(data.worldbookEntriesPreview.length, 0);
          h.regexDownloads++;
        },
      };
      if (path.endsWith('host.ts')) {
        if (specifier === '../services/config') return { getCreativeWorkshopOrigin: () => 'https://workshop.invalid' };
        if (specifier === '../services/context') return { getCurrentCreativeWorkshopContext: () => ({ connected: true }) };
        if (specifier === '../version') return { CREATIVE_WORKSHOP_CLIENT_VERSION: '2.2.1' };
        if (specifier === '../services/diff') return {};
        if (specifier === '../services/repair') return {};
        if (specifier === '../services/script-dependency') return {};
      }
      return load(resolve(dirname(path), specifier + '.ts'));
    };
    if (!compiled.has(path)) throw new Error('Unexpected module ' + path);
    vm.runInNewContext(compiled.get(path), { ...globals, module, exports: module.exports, require }, { filename: path });
    return module.exports;
  }
  h.load = name => load(resolve(root, 'services', name + '.ts'));
  const listeners = [];
  const frame = { postMessage(message) { h.posts.push(clone(message)); } };
  load(resolve(root, 'bridge/host.ts')).createCreativeWorkshopBridgeHost({ iframe: { contentWindow: frame, getAttribute: () => 'https://workshop.invalid' },
    targetOrigin: 'https://workshop.invalid', hostWindow: { addEventListener(_, listener) { listeners.push(listener); }, removeEventListener() {} } });
  h.send = async (type, payload = {}) => {
    // Simulate the new Web install-info -> Bridge contract for Regex-only projects.
    const active = h.details.get(payload.projectId);
    if ((type === 'bridge:install-project' || type === 'bridge:confirm-project-update') &&
        active?.source.length === 0 && !h.omitRegexUrl) {
      payload = { ...payload, regexDownloadUrl: 'https://workshop.invalid/api/files/projects/' +
        payload.projectId + '/regex-' + payload.projectId + '.json' };
    }
    const requestId = webcrypto.randomUUID();
    for (const listener of listeners) await listener({ source: frame, origin: 'https://workshop.invalid',
      data: { namespace: 'creative-workshop-bridge', type, requestId, payload } });
    return h.posts.findLast(post => post.requestId === requestId && post.type !== 'bridge:context');
  };
  return h;
}
const install = h => h.send('bridge:install-project', { projectId, worldbookName: 'A', projectVersion: '1.0.0' });
const update = (h, book = 'A') => h.send('bridge:confirm-project-update', { projectId, projectVersion: '2.0.0', ...(book ? { worldbookName: book } : {}) });
function changeRegexRecordVersion(h, version) {
  const entry = h.books.Records[0];
  const boundary = entry.content.indexOf('\n') + 1;
  const manifest = JSON.parse(entry.content.slice(boundary));
  const record = manifest.projects.find(record => record.projectId === projectId);
  record.installedVersion = version;
  record.entries.forEach(entry => { entry.installedVersion = version; });
  entry.content = entry.content.slice(0, boundary) + JSON.stringify(manifest);
}

{
  const h = harness(); assert.equal((await install(h)).type, 'bridge:install-result');
  h.details.set(projectId, detail('2.0.0')); h.downloadFailure = true;
  const old = structuredClone(h.books.A);
  assert.equal((await update(h)).type, 'bridge:error'); assert.deepEqual(h.books.A, old);
  h.downloadFailure = false; h.regexFailure = true;
  const failed = await update(h);
  assert.equal(failed.type, 'bridge:error'); assert.match(failed.payload.message, /部分完成/);
  assert.equal(failed.payload.projects[0].localVersion, '2.0.0'); assert.equal(failed.payload.projects[0].regexVersionMismatch, true);
  assert.equal(h.load('install-registry').getCreativeWorkshopInstallRecord(projectId).installedVersion, '1.0.0');
  const saved = structuredClone(h.books.A); const writes = h.dlcWorldbookWrites;
  h.regexFailure = false; assert.equal((await update(h)).type, 'bridge:update-result');
  assert.deepEqual(h.books.A, saved); assert.equal(h.dlcWorldbookWrites, writes, 'retry completes only Regex and its metadata');
  assert.equal(h.load('install-registry').getCreativeWorkshopInstallRecord(projectId).installedVersion, '2.0.0');
}
{
  const h = harness(); await install(h); h.books.B = structuredClone(h.books.A); h.details.set(projectId, detail('2.0.0'));
  const before = structuredClone(h.books); const writes = h.worldbookWrites;
  const denied = await update(h); assert.match(denied.payload.message, /授权/);
  assert.deepEqual(h.books, before); assert.equal(h.worldbookWrites, writes, 'shared version guard precedes worldbook write');
  // A=v1, B=v2, shared Regex=v2: updating A may reuse Regex v2 and must leave B untouched.
  const single = harness(detail('2.0.0'));
  assert.equal((await single.send('bridge:install-project', { projectId, worldbookName: 'B', projectVersion: '2.0.0' })).type, 'bridge:install-result');
  h.books.B = structuredClone(single.books.B); h.regexes = structuredClone(single.regexes); h.books.Records = structuredClone(single.books.Records);
  const bookB = structuredClone(h.books.B);
  const regexes = structuredClone(h.regexes);
  const removed = await h.send('bridge:uninstall-project', { projectId, worldbookName: 'A' });
  assert.equal(removed.type, 'bridge:uninstall-result'); assert.deepEqual(h.books.B, bookB); assert.deepEqual(h.regexes, regexes);
  assert.equal(removed.payload.projects[0].worldbookName, 'B');
  assert.equal((await h.send('bridge:uninstall-project', { projectId, worldbookName: 'B' })).type, 'bridge:uninstall-result');
  assert.equal(h.regexes.length, 0);
}
{
  const h = harness(); await install(h); h.books.B = structuredClone(h.books.A); h.details.set(projectId, detail('2.0.0'));
  const payload = { projectId, projectVersion: '2.0.0', worldbookName: 'A', approvedDuplicates: [{ worldbookName: 'B', localVersion: '1.0.0', entryCount: 1 }] };
  h.regexFailure = true;
  assert.match((await h.send('bridge:confirm-project-update', payload)).payload.message, /部分完成/);
  assert.equal(h.books.B.length, 1, 'Regex failure preserves the authorized duplicate until final verification');
  const selected = structuredClone(h.books.A);
  h.regexFailure = false;
  assert.equal((await h.send('bridge:confirm-project-update', payload)).type, 'bridge:update-result');
  assert.deepEqual(h.books.A, selected, 'consolidation retry does not restage the selected source');
  assert.equal(h.books.B.length, 0, 'only explicitly authorized duplicate is deleted');
}
{
  const h = harness(); await install(h); h.books.B = structuredClone(h.books.A); h.details.set(projectId, detail('2.0.0'));
  const before = structuredClone(h.books);
  const stale = await h.send('bridge:confirm-project-update', { projectId, projectVersion: '2.0.0', worldbookName: 'A', approvedDuplicates: [{ worldbookName: 'B', localVersion: '0', entryCount: 1 }] });
  assert.equal(stale.type, 'bridge:error'); assert.deepEqual(h.books, before, 'stale duplicate consent cannot mutate books');
  const result = await h.send('bridge:confirm-project-update', { projectId, projectVersion: '2.0.0', worldbookName: 'B', approvedDuplicates: [{ worldbookName: 'A', localVersion: '1.0.0', entryCount: 1 }] });
  assert.equal(result.type, 'bridge:update-result'); assert.equal(h.books.A.length, 0); assert.equal(h.books.B[0].extra.cw_project_version, '2.0.0');
}
{
  const h = harness(detail('1.0.0', true)); await install(h);
  assert.equal(h.regexDownloads, 1, 'Regex-only install downloads the real JSON');
  h.details.set(projectId, detail('2.0.0', true));
  assert.equal((await update(h, null)).type, 'bridge:update-result');
  assert.equal(h.regexDownloads, 2, 'Regex-only update downloads the real JSON once more');
  assert.equal(h.dlcWorldbookWrites, 0);
  assert.equal((await h.send('bridge:uninstall-project', { projectId })).type, 'bridge:uninstall-result'); assert.equal(h.regexes.length, 0);
}
{
  const h = harness(); await install(h); h.books.A[0].enabled = false;
  h.books.B = h.books.A; h.books.A = []; h.books.Disabled = structuredClone(h.books.B);
  h.details.set(projectId, detail('2.0.0'));
  const result = await update(h, null); assert.equal(result.type, 'bridge:update-result');
  assert.equal(result.payload.projects[0].worldbookName, 'B'); assert.equal(h.books.B[0].enabled, false);
  assert.equal(h.reads.includes('Disabled'), false, 'unbound worldbooks are outside scan and mutation scope');
}
{
  const h = harness(); await install(h); h.details.set(projectId, detail('2.0.0')); h.corruptRegex = true;
  const result = await update(h); assert.equal(result.type, 'bridge:error'); assert.match(result.payload.message, /验收/);
  assert.equal(h.load('install-registry').getCreativeWorkshopInstallRecord(projectId).installedVersion, '1.0.0');
}
{
  const h = harness(); h.details.set(secondProjectId, detail('1.0.0', false, secondProjectId));
  const results = await Promise.all([install(h), h.send('bridge:install-project', { projectId: secondProjectId, worldbookName: 'A', projectVersion: '1.0.0' })]);
  assert.equal(results.every(result => result.type === 'bridge:install-result'), true);
  assert.equal(h.maxWrites, 1, 'Bridge serializes writes from independent projects');
}
{
  const h = harness(); await install(h); h.books.B = structuredClone(h.books.A);
  for (const entry of h.books.B) delete entry.extra;
  h.details.set(projectId, detail('2.0.0'));
  const result = await h.send('bridge:confirm-project-update', { projectId, projectVersion: '2.0.0', worldbookName: 'A', approvedDuplicates: [{ worldbookName: 'B', localVersion: '1.0.0', entryCount: 1 }] });
  assert.equal(result.type, 'bridge:update-result'); assert.equal(h.books.B.length, 0, 'content identity remains authoritative after extra is dropped');
}
for (const change of ['modify', 'unbind', 'new-location']) {
  const h = harness(); await install(h); h.books.B = structuredClone(h.books.A); h.details.set(projectId, detail('2.0.0'));
  const writes = [h.worldbookWrites, h.regexWrites];
  h.afterDownload = () => {
    if (change === 'modify') h.books.B[0].enabled = false;
    if (change === 'unbind') h.bound = ['B'];
    if (change === 'new-location') { h.books.C = structuredClone(h.books.B); h.bound.push('C'); }
  };
  const result = await h.send('bridge:confirm-project-update', { projectId, projectVersion: '2.0.0', worldbookName: 'A', approvedDuplicates: [{ worldbookName: 'B', localVersion: '1.0.0', entryCount: 1 }] });
  assert.equal(result.type, 'bridge:error'); assert.deepEqual([h.worldbookWrites, h.regexWrites], writes, change + ' must stop before persistent writes');
}
{
  const h = harness(); await install(h); h.books.B = structuredClone(h.books.A); h.details.set(projectId, detail('2.0.0'));
  const regexWrites = h.regexWrites;
  h.afterWorldbookWrite = () => { if (h.books.A.length === 1 && h.books.A[0].extra.cw_project_version === '2.0.0') h.books.B[0].content += ' manual'; };
  const result = await h.send('bridge:confirm-project-update', { projectId, projectVersion: '2.0.0', worldbookName: 'A', approvedDuplicates: [{ worldbookName: 'B', localVersion: '1.0.0', entryCount: 1 }] });
  assert.equal(result.type, 'bridge:error'); assert.match(result.payload.message, /部分完成/);
  assert.equal(h.regexWrites, regexWrites, 'changed duplicate stops shared Regex write'); assert.equal(h.books.B.length, 1);
}
for (const regexOnly of [false, true]) {
  const h = harness(detail('1.3.25', regexOnly));
  assert.equal((await h.send('bridge:install-project', { projectId, worldbookName: 'A', projectVersion: '1.3.25' })).type, 'bridge:install-result');
  const before = structuredClone({ books: h.books, regexes: h.regexes, variables: h.variables });
  const writes = [h.worldbookWrites, h.regexWrites];
  h.details.set(projectId, detail('1.3.19', regexOnly));
  const result = await h.send('bridge:confirm-project-update', { projectId, projectVersion: '1.3.19', ...(regexOnly ? {} : { worldbookName: 'A' }) });
  assert.equal(result.type, 'bridge:error'); assert.match(result.payload.message, /避免降级/);
  assert.deepEqual({ books: h.books, regexes: h.regexes, variables: h.variables }, before);
  assert.deepEqual([h.worldbookWrites, h.regexWrites], writes, 'downgrade must perform zero persistent writes');
}
{
  const h = harness(detail('1.3.9')); await h.send('bridge:install-project', { projectId, worldbookName: 'A', projectVersion: '1.3.9' });
  h.details.set(projectId, detail('1.3.10'));
  assert.equal((await h.send('bridge:confirm-project-update', { projectId, projectVersion: '1.3.10', worldbookName: 'A' })).type, 'bridge:update-result');
}
for (const unknown of [false, true]) {
  const h = harness(); await install(h);
  h.details.set(projectId, detail('2.0.0'));
  changeRegexRecordVersion(h, unknown ? null : '3.0.0');
  const writes = [h.worldbookWrites, h.regexWrites];
  assert.equal((await update(h)).type, 'bridge:error');
  assert.deepEqual([h.worldbookWrites, h.regexWrites], writes, 'unknown or newer Regex stops before worldbook writes');
}
{
  const h = harness(); await install(h); h.books.B = structuredClone(h.books.A);
  const identity = h.load('install-identity');
  h.books.B[0].content = identity.injectCreativeWorkshopWorldbookMetadata(h.books.B[0].content,
    { ...identity.readCreativeWorkshopWorldbookMetadata(h.books.B[0].content), cw_project_version: '3.0.0' });
  h.books.B[0].extra.cw_project_version = '3.0.0';
  h.details.set(projectId, detail('2.0.0'));
  const writes = [h.worldbookWrites, h.regexWrites];
  const result = await h.send('bridge:confirm-project-update', { projectId, projectVersion: '2.0.0', worldbookName: 'A', approvedDuplicates: [{ worldbookName: 'B', localVersion: '3.0.0', entryCount: 1 }] });
  assert.equal(result.type, 'bridge:error'); assert.match(result.payload.message, /避免降级/);
  assert.deepEqual([h.worldbookWrites, h.regexWrites], writes, 'a newer duplicate is preserved');
}
{
  const h = harness(); await install(h); h.details.set(projectId, detail('2.0.0'));
  h.afterWorldbookWrite = () => {
    changeRegexRecordVersion(h, '3.0.0');
  };
  const writes = h.regexWrites;
  const result = await update(h);
  assert.equal(result.type, 'bridge:error'); assert.match(result.payload.message, /部分完成/);
  assert.equal(h.regexWrites, writes, 'Regex version is checked again at the actual write');
  assert.equal(h.load('install-registry').getCreativeWorkshopInstallRecord(projectId).installedVersion, '1.0.0');
}

// Legacy hidden Regex records must migrate to a disabled primary-worldbook entry,
// without removing the actual executable Regex or duplicating it on retry.
for (const corruptManifest of [false, true]) for (const regexOnly of [false, true]) {
  const h = harness(detail('1.0.0', regexOnly)); await install(h);
  const identity = h.load('install-identity');
  const worldbookRecord = h.books.Records[0];
  const payload = JSON.parse(worldbookRecord.content.slice(worldbookRecord.content.indexOf('\n') + 1));
  const legacy = payload.projects[0];
  h.regexes.push({ id: projectId, script_name: '[工坊记录] 测试 DLC', enabled: false,
    find_regex: '(?!)', scope: 'character', replace_string: identity.buildCreativeWorkshopRegexRecordPayload(legacy) });
  h.books.Records = [];
  if (corruptManifest) h.afterWorldbookWrite = () => {
    if (h.books.Records.length) h.books.Records[0].content = 'poem-workshop-character-regex-meta:v1\n{invalid';
  };
  const beforeExecutable = structuredClone(h.regexes.find(regex => regex.id !== projectId));
  const result = await h.send('bridge:list-installed-projects');
  if (corruptManifest) {
    assert.equal(result.type, 'bridge:error', 'corrupt saved manifest must not trigger old record removal');
    assert.equal(h.regexes.some(regex => regex.id === projectId), true);
  } else {
    assert.equal(result.type, 'bridge:installed-projects');
    assert.equal(h.books.Records.length, 1);
    assert.equal(h.books.Records[0].enabled, false);
    assert.equal(h.regexes.some(regex => regex.id === projectId), false);
    assert.deepEqual(h.regexes.find(regex => regex.id !== projectId), beforeExecutable);
    const saved = structuredClone(h.books.Records);
    assert.equal((await h.send('bridge:list-installed-projects')).type, 'bridge:installed-projects');
    assert.deepEqual(h.books.Records, saved, 'repeated scanning is idempotent');
  }
}


// A migrated legacy record must never make a pending, interrupted Regex update look completed.
{
  const h = harness(); await install(h);
  const identity = h.load('install-identity');
  const entry = h.books.Records[0];
  const prefixEnd = entry.content.indexOf('\n') + 1;
  const value = JSON.parse(entry.content.slice(prefixEnd));
  const oldRecord = structuredClone(value.projects[0]);
  h.regexes.push({ id: projectId, script_name: '[工坊记录] 测试 DLC', enabled: false,
    find_regex: '(?!)', scope: 'character', replace_string: identity.buildCreativeWorkshopRegexRecordPayload(oldRecord) });
  value.projects = [];
  value.pending = [oldRecord];
  entry.content = entry.content.slice(0, prefixEnd) + JSON.stringify(value);
  const before = structuredClone({ books: h.books, regexes: h.regexes });
  const result = await h.send('bridge:list-installed-projects');
  assert.equal(result.type, 'bridge:error', 'pending Regex migration must refuse to certify old identity');
  assert.match(result.payload.message, /待完成/);
  assert.deepEqual({ books: h.books, regexes: h.regexes }, before, 'legacy backup and pending state must remain intact');
}


// If the new disabled manifest already exists, migration only needs to remove
// the legacy Regex metadata. It must not rewrite the user's main worldbook.
{
  const h = harness(); await install(h);
  const identity = h.load('install-identity');
  const entry = h.books.Records[0];
  const originalManifest = JSON.parse(entry.content.slice(entry.content.indexOf('\n') + 1));
  const legacy = originalManifest.projects[0];
  h.regexes.push({ id: projectId, script_name: '[工坊记录] 测试 DLC', enabled: false,
    find_regex: '(?!)', scope: 'character', replace_string: identity.buildCreativeWorkshopRegexRecordPayload(legacy) });
  const book = structuredClone(h.books.Records);
  const before = h.worldbookWrites;
  assert.equal((await h.send('bridge:list-installed-projects')).type, 'bridge:installed-projects');
  assert.deepEqual(h.books.Records, book);
  assert.equal(h.worldbookWrites, before, 'identical manifest must not cause a worldbook write');
  assert.equal(h.regexes.some(regex => regex.id === projectId), false);
}


// A user-enabled legacy metadata Regex is not safe to delete automatically.
{
  const h = harness(); await install(h);
  const identity = h.load('install-identity');
  const manifest = JSON.parse(h.books.Records[0].content.split(String.fromCharCode(10)).slice(1).join(String.fromCharCode(10)));
  h.regexes.push({ id: projectId, script_name: '[工坊记录] 测试 DLC', enabled: true,
    find_regex: '(?!)', scope: 'character',
    replace_string: identity.buildCreativeWorkshopRegexRecordPayload(manifest.projects[0]) });
  const before = structuredClone({ books: h.books, regexes: h.regexes });
  const result = await h.send('bridge:list-installed-projects');
  assert.equal(result.type, 'bridge:error');
  assert.match(result.payload.message, /已经被修改或启用/);
  assert.deepEqual({ books: h.books, regexes: h.regexes }, before);
}


// All progress events must belong to the actual request and describe true milestones.
{
  const h = harness(); await install(h);
  h.details.set(projectId, detail('2.0.0'));
  const result = await update(h);
  assert.equal(result.type, 'bridge:update-result');
  const phases = h.posts.filter(row => row.type === 'bridge:operation-progress' && row.requestId === result.requestId)
    .map(row => row.payload.phase);
  for (const phase of ['queued','preflight','download','validate','install','install_verify',
    'remove_old','worldbook_verify','regex','regex_verify','registry','final_verify'])
    assert.equal(phases.includes(phase), true, 'missing actual progress step: ' + phase);
  assert.equal(phases.indexOf('install') < phases.indexOf('remove_old'), true,
    'new entries must be saved before reporting deletion of old entries');
  assert.equal(phases.indexOf('regex') > phases.indexOf('worldbook_verify'), true);
  const wrongRequest = h.posts.filter(row => row.type === 'bridge:operation-progress' &&
    row.requestId !== result.requestId && row.payload.action === 'bridge:confirm-project-update');
  assert.equal(wrongRequest.length, 0, 'progress may not be misattributed to another request');
}
for (const [fault, code, phase] of [
  ['download', 'CW-U-020', 'download'],
  ['regex', 'CW-U-090', 'regex'],
]) {
  const h = harness(); await install(h); h.details.set(projectId, detail('2.0.0'));
  if (fault === 'download') h.downloadFailure = true;
  else h.regexFailure = true;
  const result = await update(h);
  assert.equal(result.type, 'bridge:error');
  assert.equal(result.payload.errorCode, code);
  assert.equal(result.payload.phase, phase);
  assert.equal(h.posts.some(row => row.type === 'bridge:operation-progress' &&
    row.requestId === result.requestId && row.payload.phase === phase), true);
}
{
  const h = harness(); h.downloadFailure = true;
  const result = await install(h);
  assert.equal(result.type, 'bridge:error');
  assert.equal(result.payload.errorCode, 'CW-I-020');
}
{
  const hostCode = await readFile(resolve(root, 'bridge/host.ts'), 'utf8');
  const codes = Array.from(hostCode.matchAll(/^  [a-z_]+: '(\d{3})',$/gm), match => match[1]);
  assert.equal(codes.length >= 13, true);
  assert.equal(new Set(codes).size, codes.length, 'each phase must have a unique stable code');
}


// Final installed-state scan is a Guard, not decorative data returned in success.
{
  const h = harness();
  h.failFinalScan = true;
  const result = await install(h);
  assert.equal(result.type, 'bridge:error');
  assert.equal(result.payload.errorCode, 'CW-I-130');
  assert.equal(result.payload.phase, 'final_verify');
  assert.equal(h.posts.some(post => post.requestId === result.requestId &&
    post.type === 'bridge:install-result'), false, 'incomplete final scan cannot report success');
  assert.equal(h.books.A.some(entry => entry.extra?.cw_project_id === projectId), true,
    'error at final verification must not roll back a real successful write');
}


// A missing or failing Regex-only file must not silently fall back to detail preview.
for (const cause of ['absentUrl','networkFailure']) {
  const h = harness(detail('1.0.0', true));
  if (cause === 'absentUrl') h.omitRegexUrl = true;
  else h.regexFileFailure = true;
  const result = await install(h);
  assert.equal(result.type, 'bridge:error');
  assert.equal(result.payload.errorCode, 'CW-I-020');
  assert.equal(h.regexes.length, 0);
  assert.equal(h.dlcWorldbookWrites, 0);
}


// Upload and install must preserve BOTH SillyTavern surface-replacement options.
// ST's native JSON and TavernHelper's live-character snapshot use different keys.
for (const [sourceLabel, raw] of [
  ['native ST export', { markdownOnly: true, promptOnly: true }],
  ['TavernHelper character snapshot', { destination: { display: true, prompt: true } }],
  ['native fields take precedence', {
    markdownOnly: true, promptOnly: false, destination: { display: false, prompt: true },
  }],
]) {
  const source = [{
    id: 'r', scriptName: '表层替换测试', findRegex: '/foo/g',
    replaceString: 'regex-1.0.0', disabled: false, placement: [2],
    ...raw,
  }];
  const preview = parseRegexEntriesPreview(JSON.stringify(source));
  const expectedDisplay = source[0].markdownOnly ?? source[0].destination?.display ?? false;
  const expectedPrompt = source[0].promptOnly ?? source[0].destination?.prompt ?? false;
  assert.equal(preview[0].markdownOnly, expectedDisplay, sourceLabel + ' display preview');
  assert.equal(preview[0].promptOnly, expectedPrompt, sourceLabel + ' prompt preview');
  const d = detail('1.0.0', true);
  d.regexEntriesPreview = preview;
  const h = harness(d);
  const installed = await install(h);
  assert.equal(installed.type, 'bridge:install-result', sourceLabel + ' install');
  assert.equal(h.regexes.length, 1);
  assert.equal(h.regexes[0].destination.display, expectedDisplay,
    sourceLabel + ' display must survive ST write');
  assert.equal(h.regexes[0].destination.prompt, expectedPrompt,
    sourceLabel + ' prompt must survive ST write');
  // The fresh-read post-install verifier must not accept silently reset flags.
  assert.equal((await h.load('regex').verifyCreativeWorkshopRegexInstallation(projectId, d)), undefined);
}


// Updating an existing Regex-only DLC must also update both surface flags,
// rather than keeping the old (unchecked) values.
{
  const makePreview = (version, destination) => parseRegexEntriesPreview(JSON.stringify([{
    id: 'r', scriptName: '表层替换更新测试',
    findRegex: '/foo/g', replaceString: 'regex-' + version,
    placement: [2], destination,
  }]));
  const first = detail('1.0.0', true);
  first.regexEntriesPreview = makePreview('1.0.0', { display: false, prompt: false });
  const h = harness(first);
  assert.equal((await install(h)).type, 'bridge:install-result');
  assert.equal(h.regexes[0].destination.display, false);
  assert.equal(h.regexes[0].destination.prompt, false);
  const next = detail('2.0.0', true);
  next.regexEntriesPreview = makePreview('2.0.0', { display: true, prompt: true });
  h.details.set(projectId, next);
  assert.equal((await update(h, null)).type, 'bridge:update-result');
  assert.equal(h.regexes[0].destination.display, true);
  assert.equal(h.regexes[0].destination.prompt, true);
  assert.equal((await h.load('regex').verifyCreativeWorkshopRegexInstallation(projectId, next)), undefined);
}


// Transfer preserves all non-DLC entries and character Regex, changes only the
// selected source worldbook, and re-reads the destination before removing source.
{
  const h = harness(detail('1.0.0'));
  const tracked = {uid:17,name:'DLC',content:'content',enabled:true,
    extra:{cw_project_id:projectId,cw_project_version:'1.0.0',cw_entry_key:'1'}};
  h.books.A=[tracked,{uid:18,name:'User note',content:'private',enabled:true,extra:{}}];
  h.books.B=[{uid:2,name:'Other DLC',content:'other',enabled:true,extra:{}}];
  h.regexes=[{id:'character-rx',script_name:'user regex',enabled:true}];
  const beforeRegexes=structuredClone(h.regexes);
  const beforeUnrelated=structuredClone(h.books.B[0]);
  await h.load('installed-transfer').transferCreativeWorkshopInstalledWorldbook(projectId,'A','B');
  assert.equal(h.books.A.length,1);
  assert.equal(h.books.A[0].name,'User note');
  assert.equal(h.books.B.length,2);
  assert.deepEqual(h.books.B[0],beforeUnrelated);
  assert.equal(h.books.B[1].content,tracked.content);
  assert.equal(h.books.B[1].enabled,true);
  assert.equal(Boolean(h.books.B[1].extra.cw_transfer_stage),false);
  assert.notEqual(h.books.B[1].uid,2);
  assert.deepEqual(h.regexes,beforeRegexes);
  assert.equal(h.regexWrites,0,'transfer must never write character Regex');
  await assert.rejects(
    h.load('installed-transfer').transferCreativeWorkshopInstalledWorldbook(projectId,'A','B'),/没有此 DLC/,
  );
}
{
  const h=harness(detail('1.0.0'));
  h.books.A=[{uid:17,enabled:true,content:'DLC',extra:{cw_project_id:projectId,cw_entry_key:'1'}}];
  h.books.B=[{uid:20,enabled:true,content:'same project',extra:{cw_project_id:projectId,cw_entry_key:'1'}}];
  const before=structuredClone(h.books);
  await assert.rejects(
    h.load('installed-transfer').transferCreativeWorkshopInstalledWorldbook(projectId,'A','B'),/已包含此 DLC/,
  );
  assert.deepEqual(h.books,before,'duplicate destination must be rejected without writes');
}
// An unbound existing book is a valid destination. The transfer must never bind it.
{
  const h=harness(detail('1.0.0'));
  const installed=await h.send('bridge:install-project',{projectId,worldbookName:'A'});
  assert.equal(installed.type,'bridge:install-result');
  const beforeRegex=structuredClone(h.regexes);
  const originalBindings=[...h.bound];
  const moved=await h.send('bridge:transfer-installed-worldbook',{
    projectId,sourceWorldbookName:'A',targetWorldbookName:'Disabled',
  });
  assert.equal(moved.type,'bridge:transfer-installed-result');
  assert.equal(moved.payload.movedOutsideScan,true);
  assert.deepEqual(h.bound,originalBindings,'moving to unbound destination never changes bindings');
  assert.equal(h.books.A.filter(row => row.extra?.cw_project_id===projectId).length,0);
  assert.ok(h.books.Disabled.some(row => row.extra?.cw_project_id===projectId));
  assert.deepEqual(h.regexes,beforeRegex,'character Regex remains installed');
  assert.equal(moved.payload.projects.some(row => row.projectId===projectId),false,
    'unbound DLC must disappear instead of returning as Regex-only');
  h.bound.push('Disabled');
  const rebound=await h.load('install-state').scanInstalledCreativeWorkshopProjects();
  assert.ok(rebound.projects.some(row => row.projectId===projectId && row.worldbookName==='Disabled'),
    're-binding the worldbook makes DLC visible again');
}
{
  const h=harness(detail('1.0.0'));
  const created=await h.send('bridge:create-additional-worldbook',{worldbookName:'New-Additional'});
  assert.equal(created.type,'bridge:create-additional-worldbook-result');
  assert.ok(h.bound.includes('New-Additional'));
  assert.deepEqual(h.books['New-Additional'],[]);
  const duplicate=await h.send('bridge:create-additional-worldbook',{worldbookName:'new-additional'});
  assert.equal(duplicate.type,'bridge:error');
  assert.equal(h.bound.filter(name => name==='New-Additional').length,1);
}
{
  const h=harness(detail('1.0.0',true));
  await assert.rejects(
    h.load('installed-transfer').transferCreativeWorkshopInstalledWorldbook(projectId,'A','B'),
    /Regex-only/,
  );
  assert.equal(h.worldbookWrites,0,'Regex-only transfer must not write worldbooks');
}
{
  const h=harness(detail('1.0.0'));
  h.books.A=[{uid:17,enabled:true,content:'DLC',extra:{cw_project_id:projectId,cw_entry_key:'1'}}];
  const sourceBefore=structuredClone(h.books.A);
  let once=false;
  h.afterWorldbookWrite=()=>{ if (!once){once=true;h.books.A[0].content='edited by user';} };
  await assert.rejects(
    h.load('installed-transfer').transferCreativeWorkshopInstalledWorldbook(projectId,'A','B'),
    /来源世界书.*变化/,
  );
  assert.equal(h.books.A.length,1,'source is never removed after concurrent modification');
  assert.notEqual(h.books.A[0].content,sourceBefore[0].content);
}

{
  const h=harness(detail('1.0.0'));
  h.books.A=[{uid:17,enabled:true,content:'legacy',extra:{cw_project_id:projectId}}];
  await assert.rejects(
    h.load('installed-transfer').transferCreativeWorkshopInstalledWorldbook(projectId,'A','B'),
    /缺少唯一的现代条目身份/,
  );
  assert.equal(h.worldbookWrites,0,'unidentified legacy content must not be moved');
}

// Bridge transfer stays serialized and does not run legacy Regex-migration writes.
{
  const h=harness(detail('1.0.0'));
  h.books.A=[{uid:17,name:'DLC',enabled:true,content:'moved through bridge',
    extra:{cw_project_id:projectId,cw_project_version:'1.0.0',cw_entry_key:'key:one'}}];
  h.books.B=[];
  const reply=await h.send('bridge:transfer-installed-worldbook',{
    projectId,sourceWorldbookName:'A',targetWorldbookName:'B',
  });
  assert.equal(reply.type,'bridge:transfer-installed-result');
  assert.equal(reply.payload.complete,true);
  assert.equal(reply.payload.projects.some(item => item.projectId===projectId &&
    item.worldbookName==='B'),true);
  assert.equal(h.books.A.length,0);
  assert.equal(h.books.B.length,1);
  assert.equal(h.regexWrites,0);
}

// Switching characters during an async operation must never bind or delete for the new character.
{
  const h = harness();
  const bindings = [...h.bound];
  h.afterWorldbookCreate = () => { h.characterAvatar = 'other.png'; };
  await assert.rejects(h.load('installed-transfer').createCreativeWorkshopAdditionalWorldbook('New'), /角色或绑定世界书已变化/);
  assert.deepEqual(h.bound, bindings);
  assert.deepEqual(h.books.New, []);
}
for (const change of ['character', 'bindings']) {
  const h = harness();
  h.books.A = [{ uid: 17, enabled: true, content: 'DLC', extra: { cw_project_id: projectId, cw_entry_key: '1' } }];
  const source = structuredClone(h.books.A);
  const variables = structuredClone(h.variables);
  h.afterWorldbookWrite = () => {
    if (change === 'character') h.characterAvatar = 'other.png';
    else h.bound = ['Records'];
  };
  await assert.rejects(h.load('installed-transfer').transferCreativeWorkshopInstalledWorldbook(projectId, 'A', 'B'), /角色或绑定世界书已变化/);
  assert.deepEqual(h.books.A, source);
  assert.deepEqual(h.variables, variables);
  assert.equal(h.books.B[0].enabled, false);
}

console.log('CreativeWorkshop actual-read install/update/uninstall safety and recovery: ok');
