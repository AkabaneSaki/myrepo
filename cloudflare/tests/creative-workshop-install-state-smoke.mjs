import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFile } from 'node:fs/promises';
import ts from '../../node_modules/typescript/lib/typescript.js';

const source = await readFile(new URL('../../src/CreativeWorkshop/services/install-state.ts', import.meta.url), 'utf8');
const hostSource = await readFile(new URL('../../src/CreativeWorkshop/bridge/host.ts', import.meta.url), 'utf8');
const compiled = ts.transpileModule(source, {
  compilerOptions: {
    module: ts.ModuleKind.CommonJS,
    target: ts.ScriptTarget.ES2020,
    esModuleInterop: true,
  },
}).outputText;

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

function loadInstallStateHarness({ initialNames, namesAfterRefresh, worldbooks, relevantNames = ['DLC'], boundNames = ['DLC'] }) {
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
          getCreativeWorkshopInstallRecords: () => ({}),
          getCreativeWorkshopRelevantWorldbookNames: () => [...relevantNames],
          getCreativeWorkshopBoundWorldbookNames: () => [...boundNames],
        };
      }
      if (specifier === './regex-name') {
        return { getCreativeWorkshopRegexId: () => '' };
      }
      throw new Error(`Unexpected require: ${specifier}`);
    },
    console,
    Promise,
    Map,
    Set,
    _: makeLodash(),
    getWorldbookNames: () => [...names],
    getWorldbook: async name => {
      worldbookReadCount += 1;
      const sourceValue = worldbooks[name];
      const value = typeof sourceValue === 'function' ? await sourceValue(worldbookReadCount) : sourceValue;
      if (value instanceof Error) throw value;
      return Array.isArray(value) ? value : [];
    },
    getTavernRegexes: () => [],
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
  return {
    api: module.exports,
    counts: () => ({ refreshCount, worldbookReadCount }),
  };
}

const managedEntry = {
  name: '[DLC][角色][测试]角色设定',
  extra: {
    cw_project_id: '11111111-1111-4111-8111-111111111111',
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
  assert.equal(result.projects[0].worldbookName, 'DLC');
  assert.deepEqual(harness.counts(), { refreshCount: 1, worldbookReadCount: 1 });
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
assert.match(hostSource, /getCompleteInitialInstalledProjects/);
assert.doesNotMatch(source, /loadWorldInfo/);

console.log('CreativeWorkshop install-state readiness smoke: ok');
