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

function loadHarness({ entryEnabled = true, entryName = '[本体][势力][诺斯加德联盟][城镇][白曜城]五馆街', entryUid = null, referenceDisplayName = '[本体][势力][诺斯加德联盟][城镇][白曜城]五馆街', referenceSourceKey = 'index:0' } = {}) {
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
  const referenceItems = [
    {
      id: 'base-1',
      referenceVersionId: 'v433',
      kind: 'worldbook',
      sourceKey: referenceSourceKey,
      displayName: referenceDisplayName,
    },
  ];
  const module = { exports: {} };
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
      if (specifier === './project-fetch') {
        return {
          fetchCreativeWorkshopReferenceVersionItems: async () => referenceItems,
        };
      }
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
    getWorldbookNames: () => Object.keys(worldbooks),
    getWorldbook: async name => worldbooks[name] || [],
    updateWorldbookWith: async (name, updater) => {
      const next = await updater(worldbooks[name] || []);
      worldbooks[name] = Array.isArray(next) ? next : worldbooks[name];
      return worldbooks[name];
    },
  };
  vm.runInNewContext(compiled, context, { filename: 'original-conflicts.ts' });
  return { api: module.exports, worldbooks, records };
}

function conflictDetail(conflictsWithOriginal = true) {
  return {
    project: {
      builtForReferenceVersionId: 'v433',
      conflictsWithOriginal,
      originalConflictReferenceItemIds: conflictsWithOriginal ? ['base-1'] : [],
    },
    worldbookEntriesPreview: [],
    regexEntriesPreview: [],
  };
}

{
  const harness = loadHarness({ entryEnabled: true });
  const states = await harness.api.syncCreativeWorkshopOriginalConflicts('A', conflictDetail(true));
  assert.equal(states.length, 1);
  assert.equal(states[0].wasEnabled, true);
  assert.equal(harness.worldbooks.Original[0].enabled, false);
  harness.records.A = { projectId: 'A', worldbookName: 'DLC-A', originalEntryStates: states };
  await harness.api.restoreCreativeWorkshopOriginalConflicts('A');
  assert.equal(harness.worldbooks.Original[0].enabled, true);
}

{
  const harness = loadHarness({ entryEnabled: false });
  const states = await harness.api.syncCreativeWorkshopOriginalConflicts('A', conflictDetail(true));
  assert.equal(states[0].wasEnabled, false);
  harness.records.A = { projectId: 'A', worldbookName: 'DLC-A', originalEntryStates: states };
  await harness.api.restoreCreativeWorkshopOriginalConflicts('A');
  assert.equal(harness.worldbooks.Original[0].enabled, false, 'pre-disabled original content must stay disabled');
}

{
  const harness = loadHarness({ entryEnabled: true });
  const statesA = await harness.api.syncCreativeWorkshopOriginalConflicts('A', conflictDetail(true));
  harness.records.A = { projectId: 'A', worldbookName: 'DLC-A', originalEntryStates: statesA };
  const statesB = await harness.api.syncCreativeWorkshopOriginalConflicts('B', conflictDetail(true));
  harness.records.B = { projectId: 'B', worldbookName: 'DLC-B', originalEntryStates: statesB };
  assert.equal(statesB[0].wasEnabled, true, 'second DLC must inherit the original pre-disable state');

  await harness.api.restoreCreativeWorkshopOriginalConflicts('A');
  assert.equal(harness.worldbooks.Original[0].enabled, false, 'removing one claimant must not re-enable an entry still claimed by another DLC');
  delete harness.records.A;
  await harness.api.restoreCreativeWorkshopOriginalConflicts('B');
  assert.equal(harness.worldbooks.Original[0].enabled, true, 'last claimant must restore the original state');
}

{
  const harness = loadHarness({ entryEnabled: true });
  const states = await harness.api.syncCreativeWorkshopOriginalConflicts('A', conflictDetail(true));
  harness.records.A = { projectId: 'A', worldbookName: 'DLC-A', originalEntryStates: states };
  const nextStates = await harness.api.syncCreativeWorkshopOriginalConflicts('A', conflictDetail(false));
  assert.deepEqual(Array.from(nextStates), []);
  assert.equal(harness.worldbooks.Original[0].enabled, true, 'updating a DLC to no longer conflict must restore the entry');
}


{
  const harness = loadHarness({
    entryEnabled: true,
    entryName: '[本体][玩家改名]五馆街',
    entryUid: '7',
    referenceDisplayName: '[本体][势力][诺斯加德联盟][城镇][白曜城]五馆街',
    referenceSourceKey: 'uid:7',
  });
  const states = await harness.api.syncCreativeWorkshopOriginalConflicts('A', conflictDetail(true));
  assert.equal(states[0].entryUid, '7');
  assert.equal(states[0].displayName, '[本体][玩家改名]五馆街');
  assert.equal(harness.worldbooks.Original[0].enabled, false, 'UID fallback must disable the resolved local entry even if its name changed');
  harness.records.A = { projectId: 'A', worldbookName: 'DLC-A', originalEntryStates: states };
  await harness.api.restoreCreativeWorkshopOriginalConflicts('A');
  assert.equal(harness.worldbooks.Original[0].enabled, true, 'UID fallback must restore the same local entry');
}

{
  const harness = loadHarness({ entryEnabled: true });
  harness.worldbooks.Original.push({ ...harness.worldbooks.Original[0] });
  await assert.rejects(
    () => harness.api.syncCreativeWorkshopOriginalConflicts('A', conflictDetail(true)),
    /多个同名条目/,
    'ambiguous duplicate names must fail closed instead of toggling every match',
  );
}


{
  const harness = loadHarness({ entryEnabled: true });
  delete harness.worldbooks.Original[0].enabled;
  harness.worldbooks.Original[0].disable = true;
  const states = await harness.api.syncCreativeWorkshopOriginalConflicts('A', conflictDetail(true));
  assert.equal(states[0].wasEnabled, false, 'legacy disable=true must be remembered as originally disabled');
}

console.log('CreativeWorkshop original-conflict smoke: ok');
