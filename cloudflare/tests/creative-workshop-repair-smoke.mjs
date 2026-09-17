import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFile } from 'node:fs/promises';
import ts from '../../node_modules/typescript/lib/typescript.js';

const repairSource = await readFile(new URL('../../src/CreativeWorkshop/services/repair.ts', import.meta.url), 'utf8');
const repairUiSource = await readFile(new URL('../src/pages/home/repair-ui.ts', import.meta.url), 'utf8');
const bridgeSource = await readFile(new URL('../../src/CreativeWorkshop/bridge/host.ts', import.meta.url), 'utf8');
const protocolSource = await readFile(new URL('../../src/CreativeWorkshop/bridge/protocol.ts', import.meta.url), 'utf8');

const compiled = ts.transpileModule(repairSource, {
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

function lodashSet(value, path, nextValue) {
  const keys = String(path).split('.');
  let current = value;
  for (const key of keys.slice(0, -1)) current = current[key] ||= {};
  current[keys.at(-1)] = nextValue;
  return value;
}

function makeLodash() {
  return {
    get: lodashGet,
    set: lodashSet,
    isString: value => typeof value === 'string',
    isObject: value => value !== null && typeof value === 'object' && !Array.isArray(value),
    uniq: values => [...new Set(values)],
    groupBy: (values, selector) => values.reduce((groups, value) => {
      const key = selector(value);
      (groups[key] ||= []).push(value);
      return groups;
    }, {}),
  };
}

function createHarness({ worldbooks: initialWorldbooks, regexes: initialRegexes = [], failFirstApply = false } = {}) {
  const worldbooks = Object.fromEntries(Object.entries(initialWorldbooks || {}).map(([name, entries]) => [name, structuredClone(entries)]));
  let regexes = structuredClone(initialRegexes);
  let variables = {};
  let applyAttempts = 0;
  const installRecords = new Map();

  const module = { exports: {} };
  const context = {
    module,
    exports: module.exports,
    require(specifier) {
      if (specifier === './install-registry') {
        return {
          deleteCreativeWorkshopInstallRecord: projectId => installRecords.delete(projectId),
          setCreativeWorkshopInstallRecord: (projectId, record) => installRecords.set(projectId, { ...record }),
        };
      }
      if (specifier === './project-fetch') {
        return { invalidateCreativeWorkshopProjectCache: () => {} };
      }
      if (specifier === './regex') {
        return {
          prepareCreativeWorkshopRegexEntries: detail => detail.regexEntriesPreview || [],
          applyPreparedCreativeWorkshopRegex: async (projectId, detail, prepared) => {
            regexes = regexes.filter(regex => !String(regex.id || '').startsWith(`creative_workshop:${projectId}:`));
            regexes.push(...prepared.map((entry, index) => ({ id: `creative_workshop:${projectId}:${index}`, script_name: entry.script_name || `new-${index}` })));
          },
        };
      }
      if (specifier === './regex-name') {
        return { getCreativeWorkshopRegexId: regex => String(regex?.id || '') };
      }
      if (specifier === './worldbook') {
        return {
          ensureCreativeWorkshopTargetWorldbook: async name => name,
          prepareCreativeWorkshopProject: async projectId => ({
            detail: {
              project: { id: projectId, name: 'Workshop 秋日祭', version: '9.9.9' },
              regexEntriesPreview: [{ script_name: 'latest-regex' }],
            },
            prepared: [{ entryKey: 'latest-entry' }],
          }),
          applyPreparedCreativeWorkshopProject: async (projectId, detail, prepared, worldbookName) => {
            applyAttempts += 1;
            if (failFirstApply && applyAttempts === 1) throw new Error('simulated install interruption');
            worldbooks[worldbookName] ||= [];
            worldbooks[worldbookName].push({
              uid: 999,
              name: '[DLC][事件][秋日祭][WS]最新版',
              extra: {
                cw_project_id: projectId,
                cw_project_name_display: detail.project.name,
                cw_project_version: detail.project.version,
                cw_entry_key: `${projectId}:latest-entry`,
                cw_name_format_version: '2',
              },
            });
          },
        };
      }
      throw new Error(`Unexpected require: ${specifier}`);
    },
    console,
    Promise,
    Map,
    Set,
    Date,
    Object,
    Array,
    String,
    Number,
    structuredClone,
    _: makeLodash(),
    getCurrentCharacterName: () => 'Tester',
    getScriptId: () => 'creative-workshop-test',
    getVariables: () => structuredClone(variables),
    updateVariablesWith: updater => { variables = updater(structuredClone(variables)); },
    getWorldbookNames: () => Object.keys(worldbooks),
    getWorldbook: async name => structuredClone(worldbooks[name] || []),
    getTavernRegexes: () => structuredClone(regexes),
    deleteWorldbookEntries: async (name, predicate) => {
      const before = worldbooks[name] || [];
      const deletedEntries = before.filter(predicate);
      worldbooks[name] = before.filter(entry => !predicate(entry));
      return { deleted_entries: structuredClone(deletedEntries), worldbook: structuredClone(worldbooks[name]) };
    },
    updateTavernRegexesWith: async updater => {
      regexes = updater(structuredClone(regexes));
      return structuredClone(regexes);
    },
  };

  vm.runInNewContext(compiled, context, { filename: 'repair.ts' });
  return {
    api: module.exports,
    worldbooks,
    regexes: () => structuredClone(regexes),
    installRecords,
    applyAttempts: () => applyAttempts,
  };
}

const brokenEntries = [
  {
    uid: 101,
    name: '[DLC][事件][秋日祭][WS]规则',
    extra: {
      cw_project_name_display: '秋日祭',
      cw_project_version: '1.0.0',
    },
  },
  {
    uid: 102,
    name: '[DLC][事件][秋日祭][WS]角色',
    extra: {
      cw_project_name_display: '秋日祭',
      cw_project_version: '1.0.0',
      cw_entry_key: 'old:key',
    },
  },
];

{
  const harness = createHarness({ worldbooks: { DLC: brokenEntries } });
  const report = await harness.api.scanCreativeWorkshopRepairCandidates();
  assert.equal(report.candidates.length, 1);
  const candidate = report.candidates[0];
  assert.equal(candidate.name, '秋日祭');
  assert.equal(candidate.worldbookName, 'DLC');
  assert.equal(candidate.entryCount, 2);
  assert.deepEqual(Array.from(candidate.entryUids), [101, 102]);
  assert.equal(candidate.unaddressableEntryCount, 0);
  assert.equal(candidate.workshopSourceMarkerCount, 2);
  assert.equal(candidate.detectedProjectId, null);
  const projectIdMeta = candidate.metadata.find(item => item.field === 'cw_project_id');
  const entryKeyMeta = candidate.metadata.find(item => item.field === 'cw_entry_key');
  assert.equal(projectIdMeta.status, 'missing');
  assert.equal(entryKeyMeta.status, 'partial');
  assert.ok(candidate.problems.some(problem => problem.includes('缺少 cw_project_id')));
}

{
  const harness = createHarness({
    worldbooks: {
      DLC: [
        ...brokenEntries,
        { uid: 777, name: '玩家自己的无关条目', extra: {} },
      ],
    },
    regexes: [
      { id: 'legacy-broken-regex', script_name: '[工坊] 秋日祭 - 旧正则' },
      { id: 'keep-regex', script_name: '玩家自己的正则' },
    ],
  });
  const result = await harness.api.repairCreativeWorkshopProject({
    candidateId: 'DLC::秋日祭',
    projectId: 'new-project-id',
    worldbookName: 'DLC',
    entryUids: [101, 102],
    regexIds: ['legacy-broken-regex'],
    expectedEntryCount: 2,
    expectedRegexCount: 1,
    sourceProjectIds: ['old-broken-id'],
  });
  assert.equal(result.success, true);
  assert.deepEqual(harness.worldbooks.DLC.map(entry => entry.uid).sort((a, b) => a - b), [777, 999]);
  assert.equal(harness.worldbooks.DLC.some(entry => entry.uid === 101 || entry.uid === 102), false, 'selected old entries must be removed by UID even when metadata is broken');
  assert.equal(harness.worldbooks.DLC.some(entry => entry.uid === 777), true, 'unselected player content must survive');
  assert.deepEqual(harness.regexes().map(regex => regex.id).sort(), ['creative_workshop:new-project-id:0', 'keep-regex']);
  assert.equal(harness.api.getCreativeWorkshopPendingRepairs().length, 0);
  assert.equal(harness.installRecords.get('new-project-id')?.installedVersion, '9.9.9');
}

{
  const harness = createHarness({
    worldbooks: { DLC: brokenEntries },
    failFirstApply: true,
  });
  const target = {
    candidateId: 'DLC::秋日祭',
    projectId: 'retry-project-id',
    worldbookName: 'DLC',
    entryUids: [101, 102],
    regexIds: [],
    expectedEntryCount: 2,
    expectedRegexCount: 0,
  };

  await assert.rejects(() => harness.api.repairCreativeWorkshopProject(target), /simulated install interruption/);
  assert.equal(harness.worldbooks.DLC.length, 0, 'the simulated interruption happens after selected old entries were removed');
  const pendingAfterFailure = harness.api.getCreativeWorkshopPendingRepairs();
  assert.equal(pendingAfterFailure.length, 1);
  assert.equal(pendingAfterFailure[0].status, 'failed');

  const retryResult = await harness.api.repairCreativeWorkshopProject(target);
  assert.equal(retryResult.success, true, 'retry must succeed even when the old UIDs were already deleted by the interrupted attempt');
  assert.equal(harness.applyAttempts(), 2);
  assert.equal(harness.worldbooks.DLC.filter(entry => entry.extra?.cw_project_id === 'retry-project-id').length, 1);
  assert.equal(harness.api.getCreativeWorkshopPendingRepairs().length, 0);
}

{
  const harness = createHarness({ worldbooks: { DLC: brokenEntries } });
  await assert.rejects(
    () => harness.api.repairCreativeWorkshopProject({
      candidateId: 'DLC::秋日祭',
      projectId: 'unsafe-partial-project',
      worldbookName: 'DLC',
      entryUids: [101],
      regexIds: [],
      expectedEntryCount: 2,
      expectedRegexCount: 0,
    }),
    /条目快照不完整/,
  );
  assert.deepEqual(harness.worldbooks.DLC.map(entry => entry.uid), [101, 102], 'incomplete snapshots must fail before deleting anything');
}

{
  const harness = createHarness({ worldbooks: { DLC: brokenEntries }, failFirstApply: true });
  const firstTarget = {
    candidateId: 'DLC::秋日祭',
    projectId: 'wrong-project-id',
    worldbookName: 'DLC',
    entryUids: [101, 102],
    regexIds: [],
    expectedEntryCount: 2,
    expectedRegexCount: 0,
  };
  await assert.rejects(() => harness.api.repairCreativeWorkshopProject(firstTarget), /simulated install interruption/);
  assert.equal(harness.api.getCreativeWorkshopPendingRepairs().length, 1);
  const correctedTarget = { ...firstTarget, projectId: 'correct-project-id' };
  const correctedResult = await harness.api.repairCreativeWorkshopProject(correctedTarget);
  assert.equal(correctedResult.success, true);
  assert.equal(harness.api.getCreativeWorkshopPendingRepairs().length, 0, 'a corrected mapping must replace the stale pending record for the same local candidate');
  assert.equal(harness.worldbooks.DLC.filter(entry => entry.extra?.cw_project_id === 'correct-project-id').length, 1);
}

assert.match(protocolSource, /bridge:repair:scan/);
assert.match(protocolSource, /bridge:repair:project/);
assert.match(bridgeSource, /scanCreativeWorkshopRepairCandidates/);
assert.match(bridgeSource, /repairCreativeWorkshopProject/);
assert.match(repairUiSource, /buildDlcRepairReportText/);
assert.match(repairUiSource, /Promise\.all\(selected\.map/);
assert.match(repairUiSource, /for \(const item of runnable\)/, 'Workshop matching may run in parallel, but local replacement must be sequential');
assert.match(repairUiSource, /复制报告/);
assert.match(repairUiSource, /UID 可定位/);
assert.match(repairUiSource, /Workshop 数据库/);

console.log('CreativeWorkshop DLC repair smoke: ok');
