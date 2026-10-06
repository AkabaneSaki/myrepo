import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFile } from 'node:fs/promises';
import ts from '../../node_modules/typescript/lib/typescript.js';

async function compile(relativePath) {
  const source = await readFile(new URL(`../../${relativePath}`, import.meta.url), 'utf8');
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

function lodashGet(value, path, fallback) {
  const result = String(path).split('.').reduce((current, key) => current == null ? undefined : current[key], value);
  return result === undefined ? fallback : result;
}

const lodash = {
  get: lodashGet,
  isObject: value => value !== null && typeof value === 'object',
  isString: value => typeof value === 'string',
  isNumber: value => typeof value === 'number' && Number.isFinite(value),
  uniq: values => [...new Set(values)],
  groupBy: (values, selector) => values.reduce((groups, value) => {
    const key = selector(value);
    (groups[key] ||= []).push(value);
    return groups;
  }, {}),
  set(value, path, nextValue) {
    const keys = String(path).split('.');
    let current = value;
    for (const key of keys.slice(0, -1)) current = (current[key] ||= {});
    current[keys.at(-1)] = nextValue;
    return value;
  },
  pickBy: (value, predicate) => Object.fromEntries(Object.entries(value).filter(([, item]) => predicate(item))),
};

const projectId = '11111111-1111-4111-8111-111111111111';
const generatedRegexIds = [
  'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
];
let generatedRegexIndex = 0;
const cryptoStub = {
  randomUUID() {
    const value = generatedRegexIds[generatedRegexIndex];
    generatedRegexIndex += 1;
    if (!value) throw new Error('UUID test queue exhausted');
    return value;
  },
};

const identityApi = loadCommonJs(
  await compile('src/CreativeWorkshop/services/install-identity.ts'),
  { JSON, String, Number, Object, Array, Error, Set, crypto: cryptoStub },
  'install-identity.ts',
);

assert.deepEqual(
  JSON.parse(JSON.stringify(identityApi.parseCreativeWorkshopRegexId(
    `creative_workshop:${projectId}:v1:id%3Aabc:1.2.3`,
  ))),
  { schemaVersion: 1, projectId, entryKey: 'id:abc', installedVersion: '1.2.3' },
);
assert.deepEqual(
  JSON.parse(JSON.stringify(identityApi.parseCreativeWorkshopRegexId(
    `creative_workshop:${projectId}:id:abc`,
  ))),
  { schemaVersion: 0, projectId, entryKey: 'id:abc', installedVersion: null },
  'legacy 2.1.x regex ids must remain readable during migration',
);

const regexNameApi = loadCommonJs(
  await compile('src/CreativeWorkshop/services/regex-name.ts'),
  {
    require(specifier) {
      if (specifier === './install-identity') return identityApi;
      throw new Error(`Unexpected require: ${specifier}`);
    },
  },
  'regex-name.ts',
);

assert.equal(regexNameApi.getCreativeWorkshopRegexEntryKey({ id: 'abc' }, 0), 'id:abc');
assert.equal(regexNameApi.getCreativeWorkshopRegexEntryKey({ id: 0 }, 5), 'id:0');
assert.equal(regexNameApi.getCreativeWorkshopRegexEntryKey({}, 2), 'index:2');

let scriptVariables = {};
const registryContext = {
  require(specifier) {
    if (specifier === './install-identity') return identityApi;
    throw new Error(`Unexpected require: ${specifier}`);
  },
  JSON, String, Number, Object, Array, Error, Set, Map, Date,
  _: lodash,
  getVariables: () => scriptVariables,
  getScriptId: () => 'test-script',
  getCurrentCharacterName: () => 'Test Card',
  updateVariablesWith: updater => {
    scriptVariables = updater(scriptVariables);
    return scriptVariables;
  },
  getCharWorldbookNames: () => ({ primary: null, additional: [] }),
  getChatWorldbookName: () => null,
  getGlobalWorldbookNames: () => [],
  getWorldbookNames: () => [],
  getWorldbook: async () => [],
};
const installRegistryApi = loadCommonJs(
  await compile('src/CreativeWorkshop/services/install-registry.ts'),
  registryContext,
  'install-registry.ts',
);

const recordPayload = identityApi.buildCreativeWorkshopRegexRecordPayload({
  schemaVersion: 1,
  projectId,
  projectNameDisplay: '测试项目',
  installedVersion: '1.2.3',
  entries: [{
    regexId: generatedRegexIds[0],
    entryKey: 'id:abc',
    installedVersion: '1.2.3',
  }],
});
const recoveredRegex = {
  id: generatedRegexIds[0],
  script_name: '[工坊] 测试项目 - R',
  find_regex: 'foo',
  replace_string: 'bar',
};
const recoveryRecord = {
  id: projectId,
  script_name: '[工坊记录] 测试项目（请勿删除）',
  enabled: false,
  replace_string: recordPayload,
};

let resolver = installRegistryApi.createCreativeWorkshopRegexIdentityResolver([recoveredRegex, recoveryRecord]);
assert.deepEqual(
  JSON.parse(JSON.stringify(resolver(recoveredRegex))),
  { schemaVersion: 2, projectId, entryKey: 'id:abc', installedVersion: '1.2.3' },
  'a disabled Workshop record must recover UUID regex ownership when the script registry is lost',
);
assert.equal(resolver(recoveryRecord), null, 'the Workshop record itself must never count as an installed content regex');

scriptVariables = {
  creative_workshop_install_registry: {
    'Test Card': {
      [projectId]: {
        projectId,
        worldbookName: null,
        installedVersion: '1.2.3',
        regexEntries: [{
          regexId: generatedRegexIds[0],
          entryKey: 'id:abc',
          installedVersion: '1.2.3',
        }],
        installedAt: 1,
      },
    },
  },
};
resolver = installRegistryApi.createCreativeWorkshopRegexIdentityResolver([recoveredRegex]);
assert.deepEqual(
  JSON.parse(JSON.stringify(resolver(recoveredRegex))),
  { schemaVersion: 2, projectId, entryKey: 'id:abc', installedVersion: '1.2.3' },
  'the install registry must resolve normal UUID regex ids without encoding business metadata into regex.id',
);

const detailV1 = {
  project: { id: projectId, name: '测试项目', version: '1.0.0' },
  worldbookEntriesPreview: [],
  regexEntriesPreview: [
    { id: 'abc', scriptName: 'R', findRegex: 'foo', replaceString: 'bar' },
  ],
};
let currentDetail = detailV1;
let localRegexes = [{
  id: `creative_workshop:${projectId}:v1:id%3Aabc:0.9.0`,
  script_name: '[工坊] 测试项目 - R',
  find_regex: 'foo',
  replace_string: 'old',
}];
scriptVariables = {};

const regexApi = loadCommonJs(
  await compile('src/CreativeWorkshop/services/regex.ts'),
  {
    require(specifier) {
      if (specifier === './install-registry') return installRegistryApi;
      if (specifier === './install-identity') return identityApi;
      if (specifier === './project-fetch') {
        return { fetchCreativeWorkshopProjectDetail: async () => currentDetail };
      }
      if (specifier === './regex-name') return regexNameApi;
      throw new Error(`Unexpected require: ${specifier}`);
    },
    console, Promise, Map, Set, Date, JSON,
    _: lodash,
    updateTavernRegexesWith: async updater => {
      localRegexes = updater(localRegexes);
      return localRegexes;
    },
  },
  'regex.ts',
);

await regexApi.installCreativeWorkshopRegex(projectId, undefined, '1.0.0');
assert.equal(localRegexes.length, 2, 'migration should leave one real regex plus one disabled recovery record');
const migratedRegex = localRegexes.find(regex => regex.id !== projectId);
const migratedRecord = localRegexes.find(regex => regex.id === projectId);
assert.ok(migratedRegex);
assert.ok(migratedRecord);
assert.equal(identityApi.isCreativeWorkshopUuid(migratedRegex.id), true, 'new Workshop content regex ids must be UUIDs');
assert.equal(String(migratedRegex.id).startsWith('creative_workshop:'), false);
assert.equal(migratedRegex.id, generatedRegexIds[0], 'legacy encoded ids must migrate to a fresh UUID exactly once');
assert.equal(migratedRecord.enabled, false);
assert.equal(migratedRecord.script_name, '[工坊记录] 测试项目（请勿删除）');

let registry = scriptVariables.creative_workshop_install_registry['Test Card'][projectId];
assert.deepEqual(
  JSON.parse(JSON.stringify(registry.regexEntries)),
  [{ regexId: generatedRegexIds[0], entryKey: 'id:abc', installedVersion: '1.0.0' }],
);

currentDetail = {
  ...detailV1,
  project: { ...detailV1.project, version: '1.1.0' },
  regexEntriesPreview: [
    { id: 'abc', scriptName: 'R', findRegex: 'foo', replaceString: 'new' },
  ],
};
await regexApi.updateCreativeWorkshopRegex(projectId, '1.1.0');
const updatedRealRegex = localRegexes.find(regex => regex.id !== projectId);
assert.equal(updatedRealRegex.id, generatedRegexIds[0], 'normal updates must preserve the stable UUID for the same entryKey');
assert.equal(updatedRealRegex.replace_string, 'new');
assert.equal(localRegexes.filter(regex => regex.id === projectId).length, 1, 'updates must replace, not duplicate, the recovery record');

registry = scriptVariables.creative_workshop_install_registry['Test Card'][projectId];
assert.equal(registry.installedVersion, '1.1.0');
assert.equal(registry.regexEntries[0].regexId, generatedRegexIds[0]);
assert.equal(registry.regexEntries[0].installedVersion, '1.1.0');

scriptVariables = {};
const installStateApi = loadCommonJs(
  await compile('src/CreativeWorkshop/services/install-state.ts'),
  {
    require(specifier) {
      if (specifier === './install-registry') return installRegistryApi;
      if (specifier === './install-identity') return identityApi;
      throw new Error(`Unexpected require: ${specifier}`);
    },
    console, Promise, Map, Set, Date, JSON,
    _: lodash,
    getWorldbookNames: () => [],
    getWorldbook: async () => [],
    getTavernRegexes: () => localRegexes,
    SillyTavern: {
      getContext: () => ({
        updateWorldInfoList: async () => {},
      }),
    },
  },
  'install-state.ts',
);
const recoveredScan = await installStateApi.scanInstalledCreativeWorkshopProjects();
assert.equal(recoveredScan.projects.length, 1, 'Regex-only projects must survive loss of the script install registry');
assert.equal(recoveredScan.projects[0].projectId, projectId);
assert.equal(recoveredScan.projects[0].regexCount, 1);
assert.equal(recoveredScan.projects[0].localVersion, '1.1.0');

const diffApi = loadCommonJs(
  await compile('src/CreativeWorkshop/services/diff.ts'),
  {
    require(specifier) {
      if (specifier === './install-registry') return installRegistryApi;
      if (specifier === './project-fetch') return { fetchCreativeWorkshopProjectDetail: async () => currentDetail };
      if (specifier === './project-type') return { formatCreativeWorkshopEntryName: comment => comment };
      if (specifier === './install-identity') return identityApi;
      if (specifier === './regex-name') return regexNameApi;
      throw new Error(`Unexpected require: ${specifier}`);
    },
    console, Promise, Map, Set, Date, JSON,
    _: lodash,
    getVariables: () => scriptVariables,
    getScriptId: () => 'test-script',
    updateVariablesWith: updater => {
      scriptVariables = updater(scriptVariables);
      return scriptVariables;
    },
    getCharWorldbookNames: () => ({ primary: null }),
    getWorldbookNames: () => [],
    getWorldbook: async () => [],
    getTavernRegexes: () => localRegexes,
  },
  'diff.ts',
);

const diffResult = await diffApi.getCreativeWorkshopProjectDiff(projectId, '1.1.0');
assert.equal(diffResult.diff.added.regexEntries.length, 0);
assert.equal(diffResult.diff.removed.regexEntries.length, 0);
assert.equal(diffResult.diff.modified.regexEntries.length, 0, 'record recovery must keep diff stable even after the script registry is lost');

currentDetail = {
  ...currentDetail,
  project: { ...currentDetail.project, version: '1.2.0' },
  regexEntriesPreview: [
    { id: 'abc', scriptName: 'R', findRegex: 'foo', replaceString: 'newer' },
  ],
};
const changedDiffResult = await diffApi.getCreativeWorkshopProjectDiff(projectId, '1.2.0');
assert.equal(changedDiffResult.diff.modified.regexEntries.length, 1);
assert.equal(changedDiffResult.diff.reviewDiff.summary.changed, 1);
assert.equal(changedDiffResult.diff.reviewDiff.regex.length, 1);
assert.equal(changedDiffResult.diff.reviewDiff.regex[0].status, 'modified');
assert.equal(changedDiffResult.diff.reviewDiff.regex[0].previous.replaceString, 'new');
assert.equal(changedDiffResult.diff.reviewDiff.regex[0].current.replaceString, 'newer');
assert.match(changedDiffResult.diff.reviewDiff.regex[0].previousReviewText, /replaceString: new/);
assert.match(changedDiffResult.diff.reviewDiff.regex[0].currentReviewText, /replaceString: newer/);

await regexApi.uninstallCreativeWorkshopRegex(projectId);
assert.equal(localRegexes.length, 0, 'record recovery must allow safe uninstall after the script registry is lost');

console.log('CreativeWorkshop regex identity smoke: ok');
