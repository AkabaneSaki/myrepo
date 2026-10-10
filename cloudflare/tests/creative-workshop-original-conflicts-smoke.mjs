import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFile } from 'node:fs/promises';
import ts from '../../node_modules/typescript/lib/typescript.js';

const source = await readFile(new URL('../../src/CreativeWorkshop/services/original-conflicts.ts', import.meta.url), 'utf8');
const compiled = ts.transpileModule(source, {
  compilerOptions: {
    module: ts.ModuleKind.CommonJS,
    target: ts.ScriptTarget.ES2020,
    esModuleInterop: true,
  },
}).outputText;
const stageSource = await readFile(new URL('../../src/CreativeWorkshop/services/worldbook-stage.ts', import.meta.url), 'utf8');
const stageCompiled = ts.transpileModule(stageSource, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } }).outputText;

const ORIGINAL_ENTRY_NAME = '[本体][势力][诺斯加德联盟][城镇][白曜城]五馆街';

function loadHarness({
  entryEnabled = true,
  entryName = ORIGINAL_ENTRY_NAME,
  entryUid = null,
  regexEntries = [],
} = {}) {
  const worldbooks = {
    Original: [
      {
        name: entryName,
        comment: entryName,
        enabled: entryEnabled,
        ...(entryUid ? { uid: entryUid } : {}),
      },
    ],
  };
  const records = {};
  let regexes = structuredClone(regexEntries);
  const module = { exports: {} };
  let stageApi;
  const context = {
    module,
    exports: module.exports,
    require(specifier) {
      if (specifier === './install-registry') {
        return {
          getCreativeWorkshopInstallRecord: projectId => records[projectId] || null,
          getCreativeWorkshopInstallRecords: () => records,
        };
      }
      if (specifier === './install-identity') return {};
      if (specifier === './worldbook-stage') return stageApi;
      throw new Error(`Unexpected require: ${specifier}`);
    },
    Promise,
    Map,
    Set,
    console,
    _: {
      isString: value => typeof value === 'string',
      uniq: values => [...new Set(values)],
    },
    getCharWorldbookNames: () => ({ primary: 'Original', additional: [] }),
    getTavernRegexes: () => structuredClone(regexes),
    updateTavernRegexesWith: async updater => {
      regexes = updater(structuredClone(regexes));
      return regexes;
    },
    getWorldbookNames: () => Object.keys(worldbooks),
    getWorldbook: async name => structuredClone(worldbooks[name] || []),
    updateWorldbookWith: async (name, updater) => {
      const next = await updater(worldbooks[name] || []);
      worldbooks[name] = Array.isArray(next) ? next : worldbooks[name];
      return worldbooks[name];
    },
  };
  const stageModule = { exports: {} };
  vm.runInNewContext(stageCompiled, { ...context, module: stageModule, exports: stageModule.exports });
  stageApi = stageModule.exports;
  vm.runInNewContext(compiled, context, { filename: 'original-conflicts.ts' });
  return { api: module.exports, worldbooks, records, get regexes() { return regexes; } };
}

function conflictDetail(conflictsWithOriginal = true, entryNames = [ORIGINAL_ENTRY_NAME]) {
  return {
    project: {
      conflictsWithOriginal,
      originalConflictEntryNames: conflictsWithOriginal ? entryNames : [],
    },
    worldbookEntriesPreview: [],
    regexEntriesPreview: [],
  };
}

{
  const harness = loadHarness({ entryEnabled: true, entryUid: '7' });
  const states = await harness.api.syncCreativeWorkshopOriginalConflicts('A', conflictDetail(true));
  assert.equal(states.length, 1);
  assert.equal(states[0].displayName, ORIGINAL_ENTRY_NAME);
  assert.equal(states[0].entryUid, '7', 'local UID may be captured only after the exact-name match succeeds');
  assert.equal(states[0].wasEnabled, true);
  assert.equal(harness.worldbooks.Original[0].enabled, false);
  harness.records.A = { projectId: 'A', worldbookName: 'DLC-A', originalEntryStates: states };
  assert.equal(harness.api.restoreCreativeWorkshopOriginalConflicts, undefined, 'historical restore API is removed');
  assert.equal(harness.worldbooks.Original[0].enabled, false, 'uninstall must not replay an obsolete historical snapshot');
}

{
  const harness = loadHarness({ entryEnabled: false });
  const states = await harness.api.syncCreativeWorkshopOriginalConflicts('A', conflictDetail(true));
  assert.equal(states[0].wasEnabled, false);
  harness.records.A = { projectId: 'A', worldbookName: 'DLC-A', originalEntryStates: states };
  assert.equal(harness.worldbooks.Original[0].enabled, false, 'pre-disabled original content must stay disabled');
}

{
  const harness = loadHarness({ entryEnabled: true });
  const statesA = await harness.api.syncCreativeWorkshopOriginalConflicts('A', conflictDetail(true));
  harness.records.A = { projectId: 'A', worldbookName: 'DLC-A', originalEntryStates: statesA };
  const statesB = await harness.api.syncCreativeWorkshopOriginalConflicts('B', conflictDetail(true));
  harness.records.B = { projectId: 'B', worldbookName: 'DLC-B', originalEntryStates: statesB };
  assert.equal(statesB[0].wasEnabled, false, 'new consent observes the current state, not a historical snapshot');

  assert.equal(harness.worldbooks.Original[0].enabled, false, 'removing one claimant must not re-enable an entry still claimed by another DLC');
  delete harness.records.A;
  assert.equal(harness.worldbooks.Original[0].enabled, false, 'uninstall must not override a user-controlled state');
}

{
  const harness = loadHarness({ entryEnabled: true });
  const states = await harness.api.syncCreativeWorkshopOriginalConflicts('A', conflictDetail(true));
  harness.records.A = { projectId: 'A', worldbookName: 'DLC-A', originalEntryStates: states };
  const nextStates = await harness.api.syncCreativeWorkshopOriginalConflicts('A', conflictDetail(false));
  assert.deepEqual(Array.from(nextStates), []);
  assert.equal(harness.worldbooks.Original[0].enabled, false, 'dropping conflicts must not restore old snapshots');
}

{
  const harness = loadHarness({
    entryEnabled: true,
    entryName: '[本体][玩家改名]五馆街',
    entryUid: '7',
  });
  const states = await harness.api.syncCreativeWorkshopOriginalConflicts('A', conflictDetail(true));
  assert.equal(states.length, 0, 'a deleted/renamed original is not guessed from a historical UID');
  assert.equal(harness.worldbooks.Original[0].enabled, true);
}

{
  const harness = loadHarness({ entryEnabled: true });
  harness.worldbooks.Original.push({ ...harness.worldbooks.Original[0] });
  await assert.rejects(
    () => harness.api.syncCreativeWorkshopOriginalConflicts('A', conflictDetail(true)),
    /多个同名原版内容/,
    'ambiguous duplicate names must fail closed instead of toggling every match',
  );
  assert.equal(harness.worldbooks.Original.every(entry => entry.enabled === true), true);
}

{
  const harness = loadHarness({ entryEnabled: true });
  await assert.rejects(
    () => harness.api.syncCreativeWorkshopOriginalConflicts('A', conflictDetail(true, [])),
    /没有可自动匹配的原版条目名称.*自己关闭/,
    'legacy or incomplete projects without stored names must fail closed',
  );
}

{
  const harness = loadHarness({ entryEnabled: true });
  delete harness.worldbooks.Original[0].enabled;
  harness.worldbooks.Original[0].disable = true;
  const states = await harness.api.syncCreativeWorkshopOriginalConflicts('A', conflictDetail(true));
  assert.equal(states[0].wasEnabled, false, 'legacy disable=true must be remembered as originally disabled');
}


{
  const harness = loadHarness({
    entryName: '无关原版世界书',
    regexEntries: [{ id: 'regex-1', script_name: '原版冲突 Regex', enabled: true, find_regex: 'X', replace_string: 'Y' }],
  });
  const states = await harness.api.syncCreativeWorkshopOriginalConflicts('A', conflictDetail(true, ['原版冲突 Regex']));
  assert.equal(states.length, 0, 'regex-only conflict has no worldbook entry');
  assert.equal(harness.regexes[0].enabled, false, 'matching original Regex must be disabled after consent');
  assert.equal(harness.regexes[0].enabled, false, 'uninstall must not automatically reactivate regex');
}

{
  const harness = loadHarness({
    regexEntries: [{ id: 'regex-2', script_name: ORIGINAL_ENTRY_NAME, enabled: true }],
  });
  await assert.rejects(
    () => harness.api.syncCreativeWorkshopOriginalConflicts('A', conflictDetail(true)),
    /同时匹配多个世界书\/Regex/,
    'matching WB and Regex by the same name must not silently pick one',
  );
  assert.equal(harness.regexes[0].enabled, true);
  assert.equal(harness.worldbooks.Original[0].enabled, true);
}


// The reference version provides its original Regex ID AND name.
// ID wins even if another installed Regex has the same name.
function typedRegexDetail(sourceKey, displayName = '原版正则') {
  const d = conflictDetail(true, [displayName]);
  d.project.originalConflictReferenceItemIds = ['ref-regex'];
  d.project.originalConflictTargets = [
    { referenceItemId: 'ref-regex', kind: 'regex', sourceKey, displayName },
  ];
  return d;
}
{
  const h = loadHarness({
    entryName: '世界书完全无关',
    regexEntries: [
      {id:'regex-original',script_name:'原版正则',enabled:true},
      {id:'regex-imitation',script_name:'原版正则',enabled:true},
    ],
  });
  const detail = typedRegexDetail('id:regex-original');
  const preview = await h.api.inspectCreativeWorkshopOriginalConflicts(detail);
  assert.equal(preview.ambiguities.length, 0, 'original ID resolves duplicate names without prompting');
  await h.api.syncCreativeWorkshopOriginalConflicts('DLC', detail);
  assert.equal(h.regexes[0].enabled,false,'original ID disabled');
  assert.equal(h.regexes[1].enabled,true,'same-name unrelated regex untouched');
}
{
  const h = loadHarness({
    entryName: '世界书完全无关',
    regexEntries: [{id:'new-local-uuid',script_name:'原版正则',enabled:true}],
  });
  const detail = typedRegexDetail('id:old-import-id');
  assert.equal((await h.api.inspectCreativeWorkshopOriginalConflicts(detail)).ambiguities.length,0);
  await h.api.syncCreativeWorkshopOriginalConflicts('DLC',detail);
  assert.equal(h.regexes[0].enabled,false,'missing original ID falls back to unique name');
}
{
  const h = loadHarness({
    entryName: '世界书完全无关',
    regexEntries: [
      {id:'candidate-A',script_name:'原版正则',enabled:true},
      {id:'candidate-B',script_name:'[本体]原版正则',enabled:true},
    ],
  });
  const detail = typedRegexDetail('id:missing', '[本体]原版正则');
  const preview = await h.api.inspectCreativeWorkshopOriginalConflicts(detail);
  assert.equal(preview.ambiguities.length,1,'two normalized same names require explicit user choice');
  assert.equal(preview.ambiguities[0].candidates.length,2);
  await assert.rejects(h.api.assertCreativeWorkshopOriginalConflictsResolved(detail),/选择/);
  await assert.rejects(h.api.syncCreativeWorkshopOriginalConflicts('DLC',detail),/选择/);
  assert.equal(h.regexes.every(regex=>regex.enabled),true,'no regex mutated before user selection');
  await assert.rejects(
    h.api.assertCreativeWorkshopOriginalConflictsResolved(detail,[{referenceItemId:'ref-regex',regexId:'forged'}]),
    /玩家选择的原版 Regex 已变化/,
  );
  const consent = [{referenceItemId:'ref-regex',regexId:'candidate-B'}];
  await h.api.assertCreativeWorkshopOriginalConflictsResolved(detail,consent);
  await h.api.syncCreativeWorkshopOriginalConflicts('DLC',detail,consent);
  assert.equal(h.regexes[0].enabled,true);
  assert.equal(h.regexes[1].enabled,false);
}
{
  const h = loadHarness({
    entryName: '世界书完全无关',
    regexEntries: [
      {id:'same-A',script_name:'无标签正则',enabled:true},
      {id:'same-B',script_name:'无标签正则',enabled:true},
    ],
  });
  const d = conflictDetail(true,['无标签正则']); // Historical project: name only.
  assert.equal((await h.api.inspectCreativeWorkshopOriginalConflicts(d)).ambiguities.length,1);
  await h.api.syncCreativeWorkshopOriginalConflicts('DLC',d,[{referenceItemId:'legacy:0',regexId:'same-A'}]);
  assert.equal(h.regexes[0].enabled,false);
  assert.equal(h.regexes[1].enabled,true);
}
{
  const h = loadHarness({entryName:'无关',regexEntries:[{id:'x',script_name:'目标',enabled:true}]});
  const detail = typedRegexDetail('id:x','目标');
  detail.project.originalConflictTargets = null;
  await assert.rejects(h.api.inspectCreativeWorkshopOriginalConflicts(detail),/基准信息不完整/);
  assert.equal(h.regexes[0].enabled,true,'missing DB baseline cannot trigger name guessing');
}

console.log('CreativeWorkshop original-conflict smoke: ok');
