import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFile } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { webcrypto } from 'node:crypto';
import ts from '../../node_modules/typescript/lib/typescript.js';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../../src/CreativeWorkshop');
const compiled = new Map();
for (const path of ['bridge/host', 'bridge/protocol', ...['worldbook', 'worldbook-stage', 'worldbook-normalize',
  'worldbook-reconcile', 'project-type', 'regex', 'regex-name', 'install-registry', 'install-identity',
  'install-state', 'original-conflicts'].map(name => 'services/' + name)]) {
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
function harness(initial = detail('1')) {
  const h = { books: { A: [], B: [], Disabled: [] }, bound: ['A', 'B'], regexes: [], variables: {},
    details: new Map([[initial.project.id, initial]]), posts: [], reads: [], worldbookWrites: 0, regexWrites: 0,
    regexFailure: false, downloadFailure: false, corruptRegex: false, unreadable: false,
    activeWrites: 0, maxWrites: 0 };
  const clone = value => structuredClone(value);
  const duringWrite = async task => {
    h.activeWrites++; h.maxWrites = Math.max(h.maxWrites, h.activeWrites);
    try { await new Promise(resolve => setTimeout(resolve, 1)); return await task(); } finally { h.activeWrites--; }
  };
  const globals = {
    _: lodash, crypto: webcrypto, setTimeout, clearTimeout, console: { info() {}, warn() {}, error() {} },
    getScriptId: () => 'script', getCurrentCharacterName: () => 'card', getVariables: () => clone(h.variables),
    updateVariablesWith: updater => { h.variables = clone(updater(clone(h.variables))); return clone(h.variables); },
    getCharWorldbookNames: () => ({ primary: h.bound[0] || null, additional: h.bound.slice(1) }),
    getGlobalWorldbookNames: () => [], getChatWorldbookName: () => null,
    getWorldbookNames: () => Object.keys(h.books),
    getWorldbook: async name => { h.reads.push(name); if (h.unreadable) throw new Error('read unavailable'); return clone(h.books[name]); },
    createWorldbook: async name => { h.books[name] ||= []; },
    rebindCharWorldbooks: async (_, names) => { h.bound = [names.primary, ...names.additional].filter(Boolean); },
    updateWorldbookWith: async (name, updater) => duringWrite(async () => {
      const entries = await updater(clone(h.books[name]));
      let nextUid = Math.max(0, ...h.books[name].map(entry => entry.uid));
      // Mimic TavernHelper: uid allocated per book, name replaces raw comment; arbitrary raw fields are absent.
      h.books[name] = clone(entries.map(entry => {
        const { comment, ...saved } = entry; return { ...saved, uid: saved.uid ?? ++nextUid };
      }));
      h.worldbookWrites++; h.afterWorldbookWrite?.(); return clone(h.books[name]);
    }),
    getTavernRegexes: () => clone(h.regexes),
    updateTavernRegexesWith: async updater => duringWrite(async () => {
      const next = await updater(clone(h.regexes)); h.regexWrites++;
      if (h.regexFailure) throw new Error('Regex write failed');
      h.regexes = clone(next.map(regex => { const { placement, substitute_regex, ...saved } = regex; return saved; }));
      if (h.corruptRegex) h.regexes[0].destination.display = !h.regexes[0].destination.display;
      return clone(h.regexes);
    }),
    SillyTavern: { getContext: () => ({ updateWorldInfoList: async () => {} }) },
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
      if (specifier.endsWith('/project-fetch') || specifier === './project-fetch') return {
        invalidateCreativeWorkshopProjectCache() {},
        fetchCreativeWorkshopProjectDetail: async (id, version) => {
          if (h.downloadFailure) throw new Error('download failed'); const current = h.details.get(id);
          if (version && current.project.version !== version) throw new Error('version mismatch'); h.afterDownload?.(); return clone(current);
        }, fetchCreativeWorkshopProjectWorldbookSource: async data => clone(data.source),
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
    const requestId = webcrypto.randomUUID();
    for (const listener of listeners) await listener({ source: frame, origin: 'https://workshop.invalid',
      data: { namespace: 'creative-workshop-bridge', type, requestId, payload } });
    return h.posts.findLast(post => post.requestId === requestId && post.type !== 'bridge:context');
  };
  return h;
}
const install = h => h.send('bridge:install-project', { projectId, worldbookName: 'A', projectVersion: '1' });
const update = (h, book = 'A') => h.send('bridge:confirm-project-update', { projectId, projectVersion: '2', ...(book ? { worldbookName: book } : {}) });

{
  const h = harness(); assert.equal((await install(h)).type, 'bridge:install-result');
  h.details.set(projectId, detail('2')); h.downloadFailure = true;
  const old = structuredClone(h.books.A);
  assert.equal((await update(h)).type, 'bridge:error'); assert.deepEqual(h.books.A, old);
  h.downloadFailure = false; h.regexFailure = true;
  const failed = await update(h);
  assert.equal(failed.type, 'bridge:error'); assert.match(failed.payload.message, /部分完成/);
  assert.equal(failed.payload.projects[0].localVersion, '2'); assert.equal(failed.payload.projects[0].regexVersionMismatch, true);
  assert.equal(h.load('install-registry').getCreativeWorkshopInstallRecord(projectId).installedVersion, '1');
  const saved = structuredClone(h.books.A); const writes = h.worldbookWrites;
  h.regexFailure = false; assert.equal((await update(h)).type, 'bridge:update-result');
  assert.deepEqual(h.books.A, saved); assert.equal(h.worldbookWrites, writes, 'retry completes only Regex');
  assert.equal(h.load('install-registry').getCreativeWorkshopInstallRecord(projectId).installedVersion, '2');
}
{
  const h = harness(); await install(h); h.books.B = structuredClone(h.books.A); h.details.set(projectId, detail('2'));
  const before = structuredClone(h.books); const writes = h.worldbookWrites;
  const denied = await update(h); assert.match(denied.payload.message, /授权/);
  assert.deepEqual(h.books, before); assert.equal(h.worldbookWrites, writes, 'shared version guard precedes worldbook write');
  // A=v1, B=v2, shared Regex=v2: updating A may reuse Regex v2 and must leave B untouched.
  const single = harness(detail('2'));
  assert.equal((await single.send('bridge:install-project', { projectId, worldbookName: 'B', projectVersion: '2' })).type, 'bridge:install-result');
  h.books.B = structuredClone(single.books.B); h.regexes = structuredClone(single.regexes);
  const bookB = structuredClone(h.books.B);
  const regexes = structuredClone(h.regexes);
  const removed = await h.send('bridge:uninstall-project', { projectId, worldbookName: 'A' });
  assert.equal(removed.type, 'bridge:uninstall-result'); assert.deepEqual(h.books.B, bookB); assert.deepEqual(h.regexes, regexes);
  assert.equal(removed.payload.projects[0].worldbookName, 'B');
  assert.equal((await h.send('bridge:uninstall-project', { projectId, worldbookName: 'B' })).type, 'bridge:uninstall-result');
  assert.equal(h.regexes.length, 0);
}
{
  const h = harness(); await install(h); h.books.B = structuredClone(h.books.A); h.details.set(projectId, detail('2'));
  const payload = { projectId, projectVersion: '2', worldbookName: 'A', approvedDuplicates: [{ worldbookName: 'B', localVersion: '1', entryCount: 1 }] };
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
  const h = harness(); await install(h); h.books.B = structuredClone(h.books.A); h.details.set(projectId, detail('2'));
  const before = structuredClone(h.books);
  const stale = await h.send('bridge:confirm-project-update', { projectId, projectVersion: '2', worldbookName: 'A', approvedDuplicates: [{ worldbookName: 'B', localVersion: '0', entryCount: 1 }] });
  assert.equal(stale.type, 'bridge:error'); assert.deepEqual(h.books, before, 'stale duplicate consent cannot mutate books');
  const result = await h.send('bridge:confirm-project-update', { projectId, projectVersion: '2', worldbookName: 'B', approvedDuplicates: [{ worldbookName: 'A', localVersion: '1', entryCount: 1 }] });
  assert.equal(result.type, 'bridge:update-result'); assert.equal(h.books.A.length, 0); assert.equal(h.books.B[0].extra.cw_project_version, '2');
}
{
  const h = harness(detail('1', true)); await install(h); h.details.set(projectId, detail('2', true));
  assert.equal((await update(h, null)).type, 'bridge:update-result'); assert.equal(h.worldbookWrites, 0);
  assert.equal((await h.send('bridge:uninstall-project', { projectId })).type, 'bridge:uninstall-result'); assert.equal(h.regexes.length, 0);
}
{
  const h = harness(); await install(h); h.books.A[0].enabled = false;
  h.books.B = h.books.A; h.books.A = []; h.books.Disabled = structuredClone(h.books.B);
  h.details.set(projectId, detail('2'));
  const result = await update(h, null); assert.equal(result.type, 'bridge:update-result');
  assert.equal(result.payload.projects[0].worldbookName, 'B'); assert.equal(h.books.B[0].enabled, false);
  assert.equal(h.reads.includes('Disabled'), false, 'unbound worldbooks are outside scan and mutation scope');
}
{
  const h = harness(); await install(h); h.details.set(projectId, detail('2')); h.corruptRegex = true;
  const result = await update(h); assert.equal(result.type, 'bridge:error'); assert.match(result.payload.message, /验收/);
  assert.equal(h.load('install-registry').getCreativeWorkshopInstallRecord(projectId).installedVersion, '1');
}
{
  const h = harness(); h.details.set(secondProjectId, detail('1', false, secondProjectId));
  const results = await Promise.all([install(h), h.send('bridge:install-project', { projectId: secondProjectId, worldbookName: 'A', projectVersion: '1' })]);
  assert.equal(results.every(result => result.type === 'bridge:install-result'), true);
  assert.equal(h.maxWrites, 1, 'Bridge serializes writes from independent projects');
}
{
  const h = harness(); await install(h); h.books.B = structuredClone(h.books.A);
  for (const entry of h.books.B) delete entry.extra;
  h.details.set(projectId, detail('2'));
  const result = await h.send('bridge:confirm-project-update', { projectId, projectVersion: '2', worldbookName: 'A', approvedDuplicates: [{ worldbookName: 'B', localVersion: '1', entryCount: 1 }] });
  assert.equal(result.type, 'bridge:update-result'); assert.equal(h.books.B.length, 0, 'content identity remains authoritative after extra is dropped');
}
for (const change of ['modify', 'unbind', 'new-location']) {
  const h = harness(); await install(h); h.books.B = structuredClone(h.books.A); h.details.set(projectId, detail('2'));
  const writes = [h.worldbookWrites, h.regexWrites];
  h.afterDownload = () => {
    if (change === 'modify') h.books.B[0].enabled = false;
    if (change === 'unbind') h.bound = ['B'];
    if (change === 'new-location') { h.books.C = structuredClone(h.books.B); h.bound.push('C'); }
  };
  const result = await h.send('bridge:confirm-project-update', { projectId, projectVersion: '2', worldbookName: 'A', approvedDuplicates: [{ worldbookName: 'B', localVersion: '1', entryCount: 1 }] });
  assert.equal(result.type, 'bridge:error'); assert.deepEqual([h.worldbookWrites, h.regexWrites], writes, change + ' must stop before persistent writes');
}
{
  const h = harness(); await install(h); h.books.B = structuredClone(h.books.A); h.details.set(projectId, detail('2'));
  const regexWrites = h.regexWrites;
  h.afterWorldbookWrite = () => { if (h.books.A.length === 1 && h.books.A[0].extra.cw_project_version === '2') h.books.B[0].content += ' manual'; };
  const result = await h.send('bridge:confirm-project-update', { projectId, projectVersion: '2', worldbookName: 'A', approvedDuplicates: [{ worldbookName: 'B', localVersion: '1', entryCount: 1 }] });
  assert.equal(result.type, 'bridge:error'); assert.match(result.payload.message, /部分完成/);
  assert.equal(h.regexWrites, regexWrites, 'changed duplicate stops shared Regex write'); assert.equal(h.books.B.length, 1);
}
console.log('CreativeWorkshop actual-read install/update/uninstall safety and recovery: ok');
