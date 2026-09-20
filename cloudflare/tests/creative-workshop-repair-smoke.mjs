import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import vm from 'node:vm';
import { readFile } from 'node:fs/promises';
import ts from '../../node_modules/typescript/lib/typescript.js';

const repairSource = await readFile(new URL('../../src/CreativeWorkshop/services/repair.ts', import.meta.url), 'utf8');
const repairUiSource = await readFile(new URL('../src/pages/home/repair-ui.ts', import.meta.url), 'utf8');
const bridgeSource = await readFile(new URL('../../src/CreativeWorkshop/bridge/host.ts', import.meta.url), 'utf8');
const protocolSource = await readFile(new URL('../../src/CreativeWorkshop/bridge/protocol.ts', import.meta.url), 'utf8');
const officialBaseline = JSON.parse(await readFile(new URL('../../data/official-card-baselines/poem-of-destiny/v4.3.3/worldbook-fingerprints.json', import.meta.url), 'utf8'));

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

function createHarness({ worldbooks: initialWorldbooks, regexes: initialRegexes = [], failFirstApply = false, boundWorldbookNames = null, initialVariables = {} } = {}) {
  const worldbooks = Object.fromEntries(Object.entries(initialWorldbooks || {}).map(([name, entries]) => [name, structuredClone(entries)]));
  let regexes = structuredClone(initialRegexes);
  let variables = structuredClone(initialVariables);
  let applyAttempts = 0;
  const installRecords = new Map();

  const module = { exports: {} };
  const context = {
    module,
    exports: module.exports,
    require(specifier) {
      if (specifier.includes('worldbook-fingerprints.json')) return officialBaseline;
      if (specifier === './install-registry') {
        return {
          deleteCreativeWorkshopInstallRecord: projectId => installRecords.delete(projectId),
          getCreativeWorkshopBoundWorldbookNames: () => Array.isArray(boundWorldbookNames)
            ? [...boundWorldbookNames]
            : Object.keys(worldbooks),
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
              name: '[WS][DLC][事件]最新版',
              extra: {
                cw_project_id: projectId,
                cw_project_name_display: detail.project.name,
                cw_project_version: detail.project.version,
                cw_entry_key: `${projectId}:latest-entry`,
                cw_name_format_version: '4',
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
    Uint8Array,
    TextEncoder,
    crypto: globalThis.crypto,
    structuredClone,
    _: makeLodash(),
    getCurrentCharacterName: () => 'Tester',
    getScriptId: () => 'creative-workshop-test',
    getVariables: () => structuredClone(variables),
    updateVariablesWith: updater => { variables = updater(structuredClone(variables)); },
    getWorldbookNames: () => Object.keys(worldbooks),
    getWorldbook: async name => structuredClone(worldbooks[name] || []),
    updateWorldbookWith: async (name, updater) => {
      worldbooks[name] = updater(structuredClone(worldbooks[name] || []));
      return structuredClone(worldbooks[name]);
    },
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
    variables: () => structuredClone(variables),
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

assert.equal(officialBaseline.character_version, 'V4.3.3');
assert.ok(Array.isArray(officialBaseline.entries) && officialBaseline.entries.length > 0, 'tracked official fingerprint index must not be empty');
const officialRuntimeEntry = {
  uid: 501,
  name: '[DLC][角色][Smoke官方原版]Smoke官方原版',
  content: 'official baseline smoke content',
  extra: {},
};
const canonicalOfficialEntry = JSON.stringify({
  name: officialRuntimeEntry.name,
  content: officialRuntimeEntry.content,
});
const syntheticFingerprint = createHash('sha256').update(canonicalOfficialEntry).digest('hex');
officialBaseline.entries = [
  ...officialBaseline.entries,
  {
    source_entry_id: 'smoke',
    name: officialRuntimeEntry.name,
    fingerprint: syntheticFingerprint,
    content_sha256: createHash('sha256').update(officialRuntimeEntry.content).digest('hex'),
  },
];

{
  const harness = createHarness({ worldbooks: { Official: [officialRuntimeEntry] }, boundWorldbookNames: ['Official'] });
  const report = await harness.api.scanCreativeWorkshopRepairCandidates();
  assert.equal(report.candidates.length, 0, 'exact official baseline entries must not become repair candidates');
  assert.equal(report.officialBaselineVersion, 'V4.3.3');
  assert.equal(report.officialBaselineSkippedCount, 1);
  assert.equal(report.modifiedOfficialBaselineEntries.length, 0);

  const modifiedHarness = createHarness({
    worldbooks: { Official: [{ ...officialRuntimeEntry, content: officialRuntimeEntry.content + '\n玩家修改' }] },
    boundWorldbookNames: ['Official'],
  });
  const modifiedReport = await modifiedHarness.api.scanCreativeWorkshopRepairCandidates();
  assert.equal(modifiedReport.candidates.length, 0, 'modified official baseline entries must remain fail-closed');
  assert.equal(modifiedReport.officialBaselineSkippedCount, 0);
  assert.equal(modifiedReport.modifiedOfficialBaselineEntries.length, 1);

  const workshopManagedHarness = createHarness({
    worldbooks: { Official: [{ ...officialRuntimeEntry, extra: { cw_project_id: 'managed-project-id' } }] },
    boundWorldbookNames: ['Official'],
  });
  const workshopManagedReport = await workshopManagedHarness.api.scanCreativeWorkshopRepairCandidates();
  assert.equal(workshopManagedReport.candidates.length, 1, 'explicit Workshop metadata must override official-name baseline suppression');
}

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
  const sentinel = harness.worldbooks.DLC.find(entry => entry.name === '[工坊精灵]我是好人请不要打开我也不要刪掉我喵');
  assert.ok(sentinel, 'repair scan must create the integrity sentinel');
  assert.equal(sentinel.enabled, false, 'repair integrity sentinel must stay disabled');
  assert.equal(sentinel.extra?.cw_project_id, '__cw_repair_integrity_sentinel__');
  assert.equal(sentinel.extra?.cw_project_name_display, 'Creative Workshop Repair Integrity Sentinel');
  assert.equal(sentinel.extra?.cw_project_version, '1');
  assert.equal(sentinel.extra?.cw_entry_key, '__cw_repair_integrity_sentinel__:sentinel');
  assert.equal(String(sentinel.extra?.cw_name_format_version), '4');
}

{
  const harness = createHarness({ worldbooks: { DLC: brokenEntries } });
  const firstReport = await harness.api.scanCreativeWorkshopRepairCandidates();
  assert.equal(firstReport.repairIntegrityLocked, false);
  const sentinel = harness.worldbooks.DLC.find(entry => entry.name === '[工坊精灵]我是好人请不要打开我也不要刪掉我喵');
  sentinel.extra.cw_entry_key = '';
  const lockedReport = await harness.api.scanCreativeWorkshopRepairCandidates();
  assert.equal(lockedReport.repairIntegrityLocked, true, 'damaged sentinel metadata must lock DLC Repair');
  assert.equal(lockedReport.candidates.length, 0, 'integrity lock must suppress all repair candidates');
  const brokenEntryKey = lockedReport.repairIntegrityFields.find(item => item.field === 'cw_entry_key');
  assert.equal(brokenEntryKey?.status, 'missing', 'integrity report must identify the exact missing sentinel metadata');
  await assert.rejects(
    () => harness.api.repairCreativeWorkshopProject({
      candidateId: 'DLC::秋日祭',
      projectId: 'new-project-id',
      worldbookName: 'DLC',
      entryUids: [101, 102],
      regexIds: [],
      expectedEntryCount: 2,
      expectedRegexCount: 0,
    }),
    /DLC 修复已锁定/,
    'backend repair must fail closed when the integrity sentinel is damaged',
  );
}

{
  const v4Entries = [
    {
      uid: 291,
      name: '[WS][DLC][角色]姚（圣堂,廿廿）',
      extra: {
        cw_project_id: 'v4-project',
        cw_project_name_display: 'V4项目',
        cw_project_version: '1.0.0',
        cw_entry_key: 'v4-project:uid:0',
        cw_name_format_version: '4',
      },
    },
    {
      uid: 292,
      name: '[WS][DLC][势力][圣堂]势力介绍',
      extra: {
        cw_project_id: 'v4-project',
        cw_project_name_display: 'V4项目',
        cw_project_version: '1.0.0',
        cw_entry_key: 'v4-project:uid:1',
        cw_name_format_version: '4',
      },
    },
  ];
  const harness = createHarness({ worldbooks: { DLC: v4Entries } });
  const report = await harness.api.scanCreativeWorkshopRepairCandidates();
  assert.equal(report.candidates.length, 1, 'v4 WS-first entries must be recognized by Repair');
  assert.equal(report.candidates[0].name, 'V4项目');
  assert.equal(report.candidates[0].entryCount, 2);
  assert.equal(report.candidates[0].dlcHeaderCount, 2);
  assert.equal(report.candidates[0].workshopSourceMarkerCount, 2);
}

{
  const v3Entries = [
    {
      uid: 301,
      name: '[DLC][角色][WS]姚（圣堂,廿廿）',
      extra: {
        cw_project_id: 'saint-project',
        cw_project_name_display: '圣堂',
        cw_project_version: '1.0.0',
        cw_entry_key: 'saint-project:uid:0',
        cw_name_format_version: '3',
      },
    },
    {
      uid: 302,
      name: '[DLC][势力][WS][圣堂]势力介绍',
      extra: {
        cw_project_id: 'saint-project',
        cw_project_name_display: '圣堂',
        cw_project_version: '1.0.0',
        cw_entry_key: 'saint-project:uid:1',
        cw_name_format_version: '3',
      },
    },
  ];
  const harness = createHarness({ worldbooks: { DLC: v3Entries } });
  const report = await harness.api.scanCreativeWorkshopRepairCandidates();
  assert.equal(report.candidates.length, 1, 'v3 entries with different visible categories must still group by Workshop metadata');
  assert.equal(report.candidates[0].name, '圣堂');
  assert.equal(report.candidates[0].entryCount, 2);
  assert.equal(report.candidates[0].workshopSourceMarkerCount, 2);
}

{
  const harness = createHarness({
    worldbooks: {
      EnabledDLC: brokenEntries,
      DisabledDLC: [{ uid: 201, name: '[DLC][扩展][关闭中的测试][WS]规则', extra: {} }],
    },
    boundWorldbookNames: ['EnabledDLC'],
  });
  const defaultReport = await harness.api.scanCreativeWorkshopRepairCandidates();
  assert.deepEqual(Array.from(defaultReport.availableWorldbookNames).sort(), ['DisabledDLC', 'EnabledDLC']);
  assert.deepEqual(Array.from(defaultReport.enabledWorldbookNames), ['EnabledDLC']);
  assert.deepEqual(Array.from(defaultReport.scannedWorldbookNames), ['EnabledDLC']);
  assert.equal(defaultReport.candidates.length, 1, 'default repair scan must only inspect enabled/bound worldbooks');
  assert.equal(defaultReport.candidates[0].worldbookName, 'EnabledDLC');

  const manualReport = await harness.api.scanCreativeWorkshopRepairCandidates({ worldbookNames: ['DisabledDLC'] });
  assert.deepEqual(Array.from(manualReport.scannedWorldbookNames), ['DisabledDLC']);
  assert.equal(manualReport.candidates.length, 1, 'manual picker must allow scanning an unbound worldbook');
  assert.equal(manualReport.candidates[0].worldbookName, 'DisabledDLC');
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
  assert.deepEqual(harness.worldbooks.DLC.map(entry => entry.uid).filter(uid => uid !== undefined).sort((a, b) => a - b), [777, 999]);
  assert.equal(harness.worldbooks.DLC.some(entry => entry.name === '[工坊精灵]我是好人请不要打开我也不要刪掉我喵'), true, 'repair sentinel must survive repair');
  assert.equal(harness.worldbooks.DLC.some(entry => entry.uid === 101 || entry.uid === 102), false, 'selected old entries must be removed by UID even when metadata is broken');
  assert.equal(harness.worldbooks.DLC.some(entry => entry.uid === 777), true, 'unselected player content must survive');
  assert.deepEqual(harness.regexes().map(regex => regex.id).sort(), ['creative_workshop:new-project-id:0', 'keep-regex']);
  assert.equal(harness.api.getCreativeWorkshopPendingRepairs().length, 0);
  assert.equal(harness.installRecords.get('new-project-id')?.installedVersion, '9.9.9');
  const sameRuntimeReport = await harness.api.scanCreativeWorkshopRepairCandidates();
  assert.equal(sameRuntimeReport.repairRestartRequired, true, 'successful repair must require a Tavern restart before passing integrity check');

  const restartedHarness = createHarness({
    worldbooks: harness.worldbooks,
    regexes: harness.regexes(),
    initialVariables: harness.variables(),
  });
  const restartedReport = await restartedHarness.api.scanCreativeWorkshopRepairCandidates();
  assert.equal(restartedReport.repairRestartRequired, false, 'a fresh runtime must satisfy the restart guard');
  assert.equal(restartedReport.repairIntegrityStatus, 'healthy', 'healthy sentinel after restart must pass the device integrity check');
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
  assert.equal(harness.worldbooks.DLC.length, 1, 'only the disabled repair sentinel should remain after selected old entries were removed');
  assert.equal(harness.worldbooks.DLC[0].name, '[工坊精灵]我是好人请不要打开我也不要刪掉我喵');
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
assert.match(repairUiSource, /resolveWorkshopRepairCandidates\(requests\)/, 'select all must use the bounded batch resolver');
assert.doesNotMatch(repairUiSource, /Promise\.all\(selected\.map\(item => analyzeDlcRepairItem/, 'select all must not fan out one resolver request per DLC');
assert.match(repairUiSource, /for \(const item of runnable\)/, 'Workshop matching may run in parallel, but local replacement must be sequential');
assert.match(repairUiSource, /复制诊断资料/);
assert.match(repairUiSource, /UID 可定位/);
assert.match(repairUiSource, /对应工坊项目/);
assert.match(repairUiSource, /candidate\.problems\.length > 0/, 'repair UI must hide healthy DLCs');
assert.match(repairUiSource, /喵喵！我放在你家养的工坊精灵怎么丢了资料！修理按钮我幫你保管了！去DC找我/, 'repair UI must show the integrity lock instead of allowing reinstall');
assert.match(repairUiSource, /好啦修理成功喵！現在重开酒馆，然后再來工坊DLC检查多次看看吧!/, 'first successful repair must ask for a Tavern restart');
assert.match(repairUiSource, /知道了喵/);
assert.match(repairUiSource, /不行，再看一眼/);
assert.match(repairUiSource, /別再点了快点重开酒馆/);
assert.match(repairUiSource, /你过关！/, 'healthy sentinel after restart must show the pass message');
assert.match(repairUiSource, /buildRepairIntegrityFieldsHtml/, 'broken sentinel UI must show field-level metadata details');
assert.match(repairUiSource, /dlcRepairSelectAllBtn/, 'repair UI must expose one-click select all');
assert.match(repairUiSource, /选择此项目/, 'ambiguous Workshop candidates must have an explicit selection affordance');
assert.match(repairUiSource, /dlcRepairWorldbookSelect/, 'repair UI must allow choosing another worldbook when automatic scan misses it');
assert.match(repairUiSource, /重新扫描/, 'repair UI must expose one simple rescan action');
assert.doesNotMatch(repairUiSource, /dlcRepairAnalyzeBtn/, 'Workshop matching should happen automatically after selection');
assert.doesNotMatch(repairUiSource, /dlcRepairScanEnabledBtn/, 'enabled worldbooks should be scanned automatically');
assert.doesNotMatch(repairUiSource, /dlcRepairScanBookBtn/, 'choosing another worldbook should trigger scanning without a second button');
assert.match(repairUiSource, /closeDlcRepairModal/, 'repair UI must be able to close itself after the queue is emptied');

console.log('CreativeWorkshop DLC repair smoke: ok');
