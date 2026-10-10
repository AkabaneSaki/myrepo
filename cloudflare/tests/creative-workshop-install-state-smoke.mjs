import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFile } from 'node:fs/promises';
import ts from '../../node_modules/typescript/lib/typescript.js';

async function compile(relativePath) {
  const source = await readFile(new URL(`../../${relativePath}`, import.meta.url), 'utf8');
  return ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, esModuleInterop: true },
  }).outputText;
}

function loadCommonJs(compiled, context, filename) {
  const module = { exports: {} };
  vm.runInNewContext(compiled, { ...context, module, exports: module.exports }, { filename });
  return module.exports;
}

const source = await readFile(new URL('../../src/CreativeWorkshop/services/install-state.ts', import.meta.url), 'utf8');
const hostSource = await readFile(new URL('../../src/CreativeWorkshop/bridge/host.ts', import.meta.url), 'utf8');
const indexSource = await readFile(new URL('../../src/CreativeWorkshop/index.ts', import.meta.url), 'utf8');
const compiled = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, esModuleInterop: true },
}).outputText;

const identityApi = loadCommonJs(
  await compile('src/CreativeWorkshop/services/install-identity.ts'),
  { JSON, String, Number, Object, Array, Error },
  'install-identity.ts',
);

function lodashGet(value, path, fallback) {
  const result = String(path).split('.').reduce((current, key) => current == null ? undefined : current[key], value);
  return result === undefined ? fallback : result;
}

function makeLodash() {
  return {
    get: lodashGet,
    isString: value => typeof value === 'string',
    uniq: values => [...new Set(values)],
    groupBy: (values, selector) => values.reduce((groups, value) => {
      const key = selector(value);
      (groups[key] ||= []).push(value);
      return groups;
    }, {}),
  };
}

function loadInstallStateHarness({
  initialNames,
  namesAfterRefresh,
  worldbooks,
  relevantNames = ['DLC'],
  boundNames = ['DLC'],
  regexes = [],
  installRecords = {},
  manifest = { projects: [], pending: [] },
}) {
  let names = [...initialNames];
  let refreshCount = 0;
  let worldbookReadCount = 0;
  const module = { exports: {} };

  const context = {
    module,
    exports: module.exports,
    require(specifier) {
      if (specifier === './install-registry') {
        return {
          createCreativeWorkshopRegexIdentityResolver: () => regex => identityApi.parseCreativeWorkshopRegexId(String(regex?.id || '')),
          getCreativeWorkshopInstallRecords: () => structuredClone(installRecords),
          getCreativeWorkshopInstallRecord: id => structuredClone(installRecords[id] || null),
          getCreativeWorkshopRelevantWorldbookNames: () => [...relevantNames],
          getCreativeWorkshopBoundWorldbookNames: () => [...boundNames],
        };
      }
      if (specifier === './regex-record') return { readCreativeWorkshopRegexManifest: async () => structuredClone(manifest) };
      if (specifier === './install-identity') return identityApi;
      if (specifier === './regex-name') {
        return {
          getCreativeWorkshopRegexIdentity: regex => identityApi.parseCreativeWorkshopRegexId(String(regex?.id || '')),
        };
      }
      throw new Error(`Unexpected require: ${specifier}`);
    },
    console, Promise, Map, Set, structuredClone, setTimeout, clearTimeout,
    _: makeLodash(),
    getWorldbookNames: () => [...names],
    getWorldbook: async name => {
      worldbookReadCount += 1;
      const sourceValue = worldbooks[name];
      const value = typeof sourceValue === 'function' ? await sourceValue(worldbookReadCount) : sourceValue;
      if (value instanceof Error) throw value;
      return Array.isArray(value) ? value : [];
    },
    getTavernRegexes: () => structuredClone(regexes),
    getCharWorldbookNames: () => ({ primary: boundNames[0] || null, additional: boundNames.slice(1) }),
    SillyTavern: {
      getContext: () => ({
        updateWorldInfoList: async () => {
          refreshCount += 1;
          names = [...namesAfterRefresh];
        },
      }),
    },
  };

  vm.runInNewContext(compiled, context, { filename: 'install-state.ts' });
  return { api: module.exports, counts: () => ({ refreshCount, worldbookReadCount }) };
}

const projectId = '11111111-1111-4111-8111-111111111111';
const managedEntry = {
  name: '[DLC][角色][测试]角色设定',
  extra: {
    cw_project_id: projectId,
    cw_project_name_display: '测试项目',
    cw_project_version: '1.0.0',
  },
};

{
  const harness = loadInstallStateHarness({
    initialNames: [],
    namesAfterRefresh: ['DLC'],
    worldbooks: { DLC: [managedEntry] },
  });
  const result = await harness.api.scanInstalledCreativeWorkshopProjects();
  assert.equal(result.complete, true);
  assert.equal(result.projects.length, 1);
  assert.equal(result.projects[0].installedProjectId, projectId);
  assert.equal(result.projects[0].projectNameHint, '测试项目');
  assert.equal(result.projects[0].localVersion, '1.0.0');
  assert.equal(result.projects[0].worldbookName, 'DLC');
  assert.deepEqual(harness.counts(), { refreshCount: 1, worldbookReadCount: 1 });
}

{
  const embeddedContent = identityApi.injectCreativeWorkshopWorldbookMetadata('原本正文', {
    cw_project_id: projectId,
    cw_project_name_display: '只剩正文备份',
    cw_project_version: '1.5.0',
    cw_remote_version: '1.5.0',
    cw_entry_key: projectId + ':uid:7',
    cw_name_format_version: 4,
  });
  const harness = loadInstallStateHarness({
    initialNames: ['DLC'],
    namesAfterRefresh: ['DLC'],
    worldbooks: { DLC: [{ name: '[WS][DLC][角色]角色设定', content: embeddedContent }] },
  });
  const result = await harness.api.scanInstalledCreativeWorkshopProjects();
  assert.equal(result.projects.length, 1, 'content backup must recover a project when extra metadata is gone');
  assert.equal(result.projects[0].installedProjectId, projectId);
  assert.equal(result.projects[0].projectNameHint, '只剩正文备份');
  assert.equal(result.projects[0].localVersion, '1.5.0');
}

{
  const regexId = identityApi.buildCreativeWorkshopRegexId(projectId, 'id:only-regex', '3.4.5');
  const harness = loadInstallStateHarness({
    initialNames: [],
    namesAfterRefresh: [],
    worldbooks: {},
    relevantNames: [],
    boundNames: [],
    regexes: [{ id: regexId, script_name: '[工坊] 纯正则项目 - R' }],
  });
  const result = await harness.api.scanInstalledCreativeWorkshopProjects();
  assert.equal(result.projects.length, 1, 'regex-only installs must be discoverable without the local registry');
  assert.equal(result.projects[0].installedProjectId, projectId);
  assert.equal(result.projects[0].localVersion, '3.4.5', 'v1 regex identity must recover the installed version');
  assert.equal(result.projects[0].regexCount, 1);
}

{
  const harness = loadInstallStateHarness({
    initialNames: [],
    namesAfterRefresh: [],
    worldbooks: { DLC: [managedEntry] },
  });
  const result = await harness.api.scanInstalledCreativeWorkshopProjects();
  assert.equal(result.complete, false, 'a bound worldbook still missing after refresh must stay incomplete');
  assert.deepEqual(Array.from(result.unreadableWorldbookNames), ['DLC']);
  assert.deepEqual(harness.counts(), { refreshCount: 1, worldbookReadCount: 0 });
}

{
  const harness = loadInstallStateHarness({
    initialNames: ['DLC'],
    namesAfterRefresh: ['DLC'],
    worldbooks: { DLC: [] },
  });
  const result = await harness.api.scanInstalledCreativeWorkshopProjects();
  assert.equal(result.complete, true, 'a readable empty worldbook is valid, not a readiness failure');
  assert.equal(result.projects.length, 0);
  assert.deepEqual(harness.counts(), { refreshCount: 0, worldbookReadCount: 1 });
}

{
  const harness = loadInstallStateHarness({
    initialNames: [],
    namesAfterRefresh: [],
    worldbooks: { OldDLC: [managedEntry] },
    relevantNames: ['OldDLC'],
    boundNames: [],
  });
  const result = await harness.api.scanInstalledCreativeWorkshopProjects();
  assert.equal(result.complete, true, 'a registry-only deleted worldbook must not block startup');
  assert.equal(result.projects.length, 0);
  assert.deepEqual(harness.counts(), { refreshCount: 0, worldbookReadCount: 0 });
}

{
  let attempts = 0;
  const harness = loadInstallStateHarness({
    initialNames: ['DLC'],
    namesAfterRefresh: ['DLC'],
    worldbooks: {
      DLC: () => {
        attempts += 1;
        return attempts === 1 ? new Error('temporary read failure') : [managedEntry];
      },
    },
  });
  const result = await harness.api.scanInstalledCreativeWorkshopProjects();
  assert.equal(result.complete, true, 'a transient read failure must recover after one refresh and one retry');
  assert.equal(result.projects.length, 1);
  assert.deepEqual(harness.counts(), { refreshCount: 1, worldbookReadCount: 2 });
}

assert.match(hostSource, /initialInstalledProjectScanInFlight/);
assert.match(hostSource, /onReady\?\.\(\)/);
assert.match(hostSource, /INITIAL_INSTALL_SCAN_TIMEOUT_MS/);
assert.match(hostSource, /scan = await getInitialInstalledProjectScan\(\)/);
assert.match(hostSource, /complete: false, unreadableWorldbookNames: \[\]/);
assert.doesNotMatch(hostSource, /getCompleteInitialInstalledProjects/);
assert.match(source, /INSTALL_STATE_STEP_TIMEOUT_MS/);
assert.match(indexSource, /removeAttr\('srcdoc'\)/);
assert.match(indexSource, /正在打开创意工坊/);
assert.match(indexSource, /打开时间较长，可以退出后重试/);
assert.doesNotMatch(indexSource, /location\.replace\(creativeWorkshopUrl\)/);
assert.doesNotMatch(source, /loadWorldInfo/);


{
  const second = structuredClone(managedEntry);
  second.extra.cw_project_version = '2.0.0';
  const harness = loadInstallStateHarness({
    initialNames: ['A', 'B'],
    namesAfterRefresh: ['A', 'B'],
    relevantNames: ['A', 'B'],
    boundNames: ['A', 'B'],
    worldbooks: { A: [managedEntry], B: [second] },
    installRecords: { [projectId]: { projectId, worldbookName: 'OUTDATED', installedVersion: '9.9.9' } },
  });
  const scan = await harness.api.scanInstalledCreativeWorkshopProjects();
  assert.equal(scan.complete, true);
  assert.equal(scan.projects.length, 2, 'two bound worldbooks must remain two installations');
  assert.deepEqual(Array.from(scan.projects, item => item.worldbookName).sort(), ['A', 'B']);
  assert.deepEqual(Array.from(scan.projects, item => item.localVersion).sort(), ['1.0.0', '2.0.0']);
  assert.equal(new Set(scan.projects.map(item => item.installKey)).size, 2);
  assert.equal(scan.projects.every(item => item.worldbookBound === true), true);
}


{
  const h = loadInstallStateHarness({
    initialNames: ['DLC'], namesAfterRefresh: ['DLC'], worldbooks: { DLC: [] },
    manifest: { projects: [], pending: [{
      schemaVersion: 1, projectId, projectNameDisplay: '等待完成的 Regex DLC',
      installedVersion: '2.0.0', entries: [{ regexId: 'missing-regex', entryKey: 'entry-1', installedVersion: '2.0.0' }],
    }] },
  });
  const scan = await h.api.scanInstalledCreativeWorkshopProjects();
  assert.equal(scan.projects.length, 1, 'pending regex-only installs must not disappear from installed view');
  assert.equal(scan.projects[0].regexInstallPending, true);
  assert.equal(scan.projects[0].regexRecordWorldbookName, 'DLC');
  assert.equal(scan.projects[0].localVersion, null, 'pending version is not verified installed version');
  assert.equal(scan.projects[0].worldbookName, null);
}
console.log('CreativeWorkshop install-state readiness smoke: ok');
