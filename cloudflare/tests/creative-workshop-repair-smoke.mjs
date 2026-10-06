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
const identitySource = await readFile(new URL('../../src/CreativeWorkshop/services/install-identity.ts', import.meta.url), 'utf8');
const identityCompiled = ts.transpileModule(identitySource, {
  compilerOptions: {
    module: ts.ModuleKind.CommonJS,
    target: ts.ScriptTarget.ES2020,
    esModuleInterop: true,
  },
}).outputText;
const identityModule = { exports: {} };
vm.runInNewContext(identityCompiled, {
  module: identityModule,
  exports: identityModule.exports,
  JSON,
  String,
  Number,
  Object,
  Array,
  Error,
}, { filename: 'install-identity.ts' });
const identityApi = identityModule.exports;

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

function createHarness({ worldbooks: initialWorldbooks, regexes: initialRegexes = [], failFirstApply = false, boundWorldbookNames = null, initialVariables = {}, initialInstallRecords = {} } = {}) {
  const worldbooks = Object.fromEntries(Object.entries(initialWorldbooks || {}).map(([name, entries]) => [name, structuredClone(entries)]));
  let regexes = structuredClone(initialRegexes);
  let variables = structuredClone(initialVariables);
  let applyAttempts = 0;
  const installRecords = new Map(Object.entries(structuredClone(initialInstallRecords)));

  const module = { exports: {} };
  const context = {
    module,
    exports: module.exports,
    require(specifier) {
      if (specifier.includes('worldbook-fingerprints.json')) return officialBaseline;
      if (specifier === './install-registry') {
        return {
          createCreativeWorkshopRegexIdentityResolver: () => regex => identityApi.parseCreativeWorkshopRegexId(String(regex?.id || '')),
          deleteCreativeWorkshopInstallRecord: projectId => installRecords.delete(projectId),
          getCreativeWorkshopBoundWorldbookNames: () => Array.isArray(boundWorldbookNames)
            ? [...boundWorldbookNames]
            : Object.keys(worldbooks),
          getCreativeWorkshopInstallRecord: projectId => installRecords.get(projectId) || null,
          getCreativeWorkshopInstallRecords: () => Object.fromEntries(
            [...installRecords.entries()].map(([projectId, record]) => [projectId, structuredClone(record)]),
          ),
          getCreativeWorkshopWorldbookInstallEntryKeys: projectId => {
            const value = installRecords.get(projectId)?.worldbookEntryKeys;
            return Array.isArray(value) ? [...new Set(value.filter(item => typeof item === 'string' && item))] : [];
          },
          setCreativeWorkshopInstallRecord: (projectId, record) => installRecords.set(projectId, {
            ...(installRecords.get(projectId) || {}),
            ...structuredClone(record),
          }),
        };
      }
      if (specifier === './project-fetch') {
        return { invalidateCreativeWorkshopProjectCache: () => {} };
      }
      if (specifier === './regex') {
        return {
          prepareCreativeWorkshopRegexEntries: detail => detail.regexEntriesPreview || [],
          applyPreparedCreativeWorkshopRegex: async (projectId, detail, prepared) => {
            regexes = regexes.filter(regex => identityApi.parseCreativeWorkshopRegexId(String(regex.id || ''))?.projectId !== projectId);
            regexes.push(...prepared.map((entry, index) => ({
              id: identityApi.buildCreativeWorkshopRegexId(projectId, `index:${index}`, detail.project.version || null),
              script_name: entry.script_name || `new-${index}`,
            })));
          },
        };
      }
      if (specifier === './regex-name') {
        return {
          getCreativeWorkshopRegexId: regex => String(regex?.id || ''),
          getCreativeWorkshopRegexIdentity: regex => identityApi.parseCreativeWorkshopRegexId(String(regex?.id || '')),
        };
      }
      if (specifier === './install-identity') return identityApi;
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
              content: identityApi.injectCreativeWorkshopWorldbookMetadata('', {
                cw_project_id: projectId,
                cw_project_name_display: detail.project.name,
                cw_project_version: detail.project.version,
                cw_remote_version: detail.project.version,
                cw_entry_key: `${projectId}:latest-entry`,
                cw_name_format_version: '4',
              }),
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
  assert.equal(candidate.identityStatus, 'legacy');
  assert.deepEqual(Array.from(candidate.problems), [], 'missing legacy extra fields alone must not be treated as a Repair bug');
  const sentinel = harness.worldbooks.DLC.find(entry => entry.name === '[工坊精灵]我是好人请不要打开我也不要刪掉我喵');
  assert.equal(sentinel, undefined, 'repair scan must never inject the retired integrity sentinel');
}



{
  const projectId = '11111111-2222-4333-8444-555555555555';
  const entry = {
    uid: 201,
    name: '[WS][DLC][事件]身份块缺失测试',
    comment: '[WS][DLC][事件]身份块缺失测试',
    content: '正文仍然存在，但 Workshop 身份 EJS block 被删除',
    extra: {
      cw_project_id: projectId,
      cw_project_name_display: '身份块缺失测试',
      cw_project_version: '1.2.3',
      cw_entry_key: `${projectId}:entry-a`,
      cw_name_format_version: '4',
    },
  };
  const harness = createHarness({ worldbooks: { DLC: [entry] } });
  const report = await harness.api.scanCreativeWorkshopRepairCandidates();
  assert.equal(report.candidates.length, 1, 'extra metadata must not hide a missing embedded Workshop identity block');
  const candidate = report.candidates[0];
  assert.equal(candidate.detectedProjectId, projectId);
  assert.equal(candidate.identityStatus, 'legacy');
  assert.equal(candidate.missingIdentityBlockCount, 1);
  assert.equal(candidate.malformedIdentityBlockCount, 0);
  assert.deepEqual(Array.from(candidate.problems), [], 'missing EJS block is a legacy migration state, not a broken DLC');
}

{
  const orphanSentinel = {
    name: '[工坊精灵]我是好人请不要打开我也不要刪掉我喵',
    comment: '[工坊精灵]我是好人请不要打开我也不要刪掉我喵',
    content: 'creative-workshop-repair-integrity-sentinel:v1',
    enabled: false,
    extra: {
      cw_project_id: '__cw_repair_integrity_sentinel__',
      cw_project_name_display: 'Creative Workshop Repair Integrity Sentinel',
      cw_project_version: '1',
      cw_entry_key: '__cw_repair_integrity_sentinel__:sentinel',
      cw_name_format_version: '4',
    },
  };
  const harness = createHarness({
    worldbooks: { Main: [orphanSentinel], DLC: brokenEntries },
    initialVariables: {
      creative_workshop_repair_integrity_sentinels: { Main: '1' },
    },
  });
  await harness.api.scanCreativeWorkshopRepairCandidates();
  assert.equal(
    harness.worldbooks.Main.some(entry => entry.name === '[工坊精灵]我是好人请不要打开我也不要刪掉我喵'),
    false,
    'scan must clean a legacy sentinel that was injected into a worldbook with no Workshop DLC',
  );
  assert.equal(
    harness.variables().creative_workshop_repair_integrity_sentinels?.Main,
    undefined,
    'cleanup must remove the stale sentinel registry marker too',
  );
}

{
  const projectId = '33333333-3333-4333-8333-333333333333';
  const survivingEntry = {
    uid: 301,
    name: '[WS][DLC][事件]Manifest Smoke',
    extra: {
      cw_project_id: projectId,
      cw_project_name_display: 'Manifest Smoke',
      cw_project_version: '1.2.3',
      cw_entry_key: `${projectId}:entry-a`,
      cw_name_format_version: '4',
    },
  };
  const harness = createHarness({
    worldbooks: { DLC: [survivingEntry] },
    initialInstallRecords: {
      [projectId]: {
        projectId,
        worldbookName: 'DLC',
        installedVersion: '1.2.3',
        worldbookEntryKeys: [`${projectId}:entry-a`, `${projectId}:entry-b`],
        installedAt: Date.now(),
      },
    },
  });
  const report = await harness.api.scanCreativeWorkshopRepairCandidates();
  const candidate = report.candidates.find(item => item.detectedProjectId === projectId);
  assert.ok(candidate, 'registry manifest must keep a partially missing DLC visible to Repair');
  assert.equal(candidate.registryBacked, true);
  assert.deepEqual(Array.from(candidate.missingEntryKeys), [`${projectId}:entry-b`]);
  assert.ok(candidate.problems.some(problem => problem.includes('缺少 1 个已安装')));
}


{
  const projectId = '66666666-6666-4666-8666-666666666666';
  const survivingEntry = {
    uid: 601,
    name: '[WS][DLC][角色]Cross Book Smoke',
    extra: {
      cw_project_id: projectId,
      cw_project_name_display: 'Cross Book Smoke',
      cw_project_version: '1.0.0',
      cw_entry_key: `${projectId}:entry-a`,
      cw_name_format_version: '4',
    },
  };
  const harness = createHarness({
    worldbooks: { Main: [], DLC: [survivingEntry] },
    initialInstallRecords: {
      [projectId]: {
        projectId,
        worldbookName: 'Main',
        installedVersion: '1.0.0',
        worldbookEntryKeys: [`${projectId}:entry-a`, `${projectId}:entry-b`],
        installedAt: Date.now(),
      },
    },
  });
  const report = await harness.api.scanCreativeWorkshopRepairCandidates();
  const candidate = report.candidates.find(item => item.detectedProjectId === projectId);
  assert.ok(candidate, 'Repair must scan all active worldbooks instead of trusting a stale recorded worldbook');
  assert.equal(candidate.worldbookName, 'DLC', 'the actual surviving Workshop entry decides the repair target worldbook');
  assert.deepEqual(Array.from(candidate.missingEntryKeys), [`${projectId}:entry-b`]);
}

{
  const projectId = '44444444-4444-4444-8444-444444444444';
  const harness = createHarness({
    worldbooks: { DLC: [] },
    initialInstallRecords: {
      [projectId]: {
        projectId,
        worldbookName: 'DLC',
        installedVersion: '1.0.0',
        worldbookEntryKeys: [`${projectId}:only-entry`],
        installedAt: Date.now(),
      },
    },
  });
  const report = await harness.api.scanCreativeWorkshopRepairCandidates();
  const candidate = report.candidates.find(item => item.detectedProjectId === projectId);
  assert.ok(candidate, 'registry manifest must surface a project even when every managed Worldbook entry is missing');
  assert.equal(candidate.entryCount, 0);
  assert.equal(candidate.registryBacked, true);
  assert.deepEqual(Array.from(candidate.entryUids), []);
  assert.deepEqual(Array.from(candidate.missingEntryKeys), [`${projectId}:only-entry`]);

  const repaired = await harness.api.repairCreativeWorkshopProject({
    candidateId: candidate.candidateId,
    projectId,
    worldbookName: 'DLC',
    entryUids: [],
    regexIds: [],
    expectedEntryCount: 0,
    expectedRegexCount: 0,
    sourceProjectIds: [projectId],
  });
  assert.equal(repaired.success, true, 'registry-backed fully missing DLC must be reinstallable without deleting unrelated entries');
  assert.equal(harness.worldbooks.DLC.some(entry => identityApi.getCreativeWorkshopWorldbookMetadataString(entry, 'cw_project_id') === projectId), true);
  assert.deepEqual(
    harness.installRecords.get(projectId)?.worldbookEntryKeys,
    [`${projectId}:latest-entry`],
    'successful repair must refresh the expected Worldbook manifest',
  );
  assert.equal(
    harness.worldbooks.DLC.some(entry => entry.name === '[工坊精灵]我是好人请不要打开我也不要刪掉我喵'),
    false,
    'repair must not create the retired integrity sentinel',
  );
}

{
  const recoveredProjectId = '22222222-2222-4222-8222-222222222222';
  const harness = createHarness({
    worldbooks: { DLC: brokenEntries },
    regexes: [{
      id: identityApi.buildCreativeWorkshopRegexId(recoveredProjectId, 'id:old-regex', '7.8.9'),
      script_name: '[工坊] 秋日祭 - 旧正则',
    }],
  });
  const report = await harness.api.scanCreativeWorkshopRepairCandidates();
  assert.equal(report.candidates.length, 1);
  assert.equal(report.candidates[0].detectedProjectId, recoveredProjectId, 'regex identity may recover project id only when worldbook identity is absent');
  assert.equal(report.candidates[0].localVersion, '1.0.0', 'worldbook version remains authoritative when it still exists');
  assert.equal(report.candidates[0].regexCount, 1);

  const entriesWithoutVersion = brokenEntries.map(entry => ({
    ...entry,
    extra: Object.fromEntries(Object.entries(entry.extra || {}).filter(([key]) => key !== 'cw_project_version')),
  }));
  const versionFallbackHarness = createHarness({
    worldbooks: { DLC: entriesWithoutVersion },
    regexes: [{
      id: identityApi.buildCreativeWorkshopRegexId(recoveredProjectId, 'id:old-regex', '7.8.9'),
      script_name: '[工坊] 秋日祭 - 旧正则',
    }],
  });
  const versionFallbackReport = await versionFallbackHarness.api.scanCreativeWorkshopRepairCandidates();
  assert.equal(
    versionFallbackReport.candidates[0].localVersion,
    '7.8.9',
    'regex identity may recover version only when worldbook version metadata is absent',
  );
}

{
  const rightProjectId = '33333333-3333-4333-8333-333333333333';
  const wrongProjectId = '44444444-4444-4444-8444-444444444444';
  const harness = createHarness({
    worldbooks: {
      DLC: [{
        uid: 205,
        name: '[WS][DLC][角色]同名条目',
        extra: {
          cw_project_id: rightProjectId,
          cw_project_name_display: '同名项目',
          cw_project_version: '1.0.0',
          cw_entry_key: rightProjectId + ':uid:205',
          cw_name_format_version: '4',
        },
      }],
    },
    regexes: [{
      id: identityApi.buildCreativeWorkshopRegexId(wrongProjectId, 'id:wrong', '9.9.9'),
      script_name: '[工坊] 同名项目 - 错项目正则',
    }],
  });
  const report = await harness.api.scanCreativeWorkshopRepairCandidates();
  assert.equal(report.candidates.length, 1);
  assert.equal(report.candidates[0].detectedProjectId, rightProjectId);
  assert.equal(report.candidates[0].regexCount, 0, 'same-name regex from another project must not be attached when worldbook identity is known');
  assert.equal(report.candidates[0].localVersion, '1.0.0');
}

{
  const canonicalProjectId = '55555555-5555-4555-8555-555555555555';
  const staleExtraProjectId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
  const healthyContent = identityApi.injectCreativeWorkshopWorldbookMetadata('正文', {
    cw_project_id: canonicalProjectId,
    cw_project_name_display: 'EJS Canonical',
    cw_project_version: '2.0.0',
    cw_remote_version: '2.0.0',
    cw_entry_key: canonicalProjectId + ':entry-a',
    cw_name_format_version: '4',
  });
  const entry = {
    uid: 551,
    name: '[WS][DLC][事件]EJS Canonical',
    content: healthyContent,
    extra: {
      cw_project_id: staleExtraProjectId,
      cw_project_name_display: 'stale extra',
      cw_project_version: '0.0.1',
      cw_entry_key: staleExtraProjectId + ':wrong',
      cw_name_format_version: '3',
    },
  };
  assert.equal(
    identityApi.getCreativeWorkshopWorldbookMetadataString(entry, 'cw_project_id'),
    canonicalProjectId,
    'healthy EJS identity must win over stale extra.cw_* metadata',
  );

  const withoutExtra = { ...entry, extra: {} };
  assert.equal(
    identityApi.getCreativeWorkshopWorldbookMetadataString(withoutExtra, 'cw_project_id'),
    canonicalProjectId,
    'healthy EJS identity must remain valid when extra.cw_* disappears entirely',
  );

  const malformed = {
    ...entry,
    content: `<%# poem-workshop-meta:v1-start
{"cw_project_id":"broken"}
poem-workshop-meta:v1-end %>正文`,
  };
  assert.equal(identityApi.getCreativeWorkshopWorldbookMetadataBlockStatus(malformed.content), 'malformed');
  assert.equal(
    identityApi.getCreativeWorkshopWorldbookMetadataString(malformed, 'cw_project_id'),
    null,
    'malformed EJS identity must not silently fall back to extra.cw_*',
  );

  const harness = createHarness({ worldbooks: { DLC: [entry] } });
  const report = await harness.api.scanCreativeWorkshopRepairCandidates();
  assert.equal(report.candidates.length, 1);
  assert.equal(report.candidates[0].detectedProjectId, canonicalProjectId);
  assert.equal(report.candidates[0].identityStatus, 'healthy');
  assert.deepEqual(Array.from(report.candidates[0].problems), []);
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
  assert.equal(harness.worldbooks.DLC.some(entry => entry.name === '[工坊精灵]我是好人请不要打开我也不要刪掉我喵'), false, 'repair must not create the retired sentinel');
  assert.equal(harness.worldbooks.DLC.some(entry => entry.uid === 101 || entry.uid === 102), false, 'selected old entries must be removed by UID even when metadata is broken');
  assert.equal(harness.worldbooks.DLC.some(entry => entry.uid === 777), true, 'unselected player content must survive');
  assert.deepEqual(
    harness.regexes().map(regex => regex.id).sort(),
    ['creative_workshop:new-project-id:v1:index%3A0:9.9.9', 'keep-regex'],
  );
  assert.equal(harness.api.getCreativeWorkshopPendingRepairs().length, 0);
  assert.equal(harness.installRecords.get('new-project-id')?.installedVersion, '9.9.9');
  const sameRuntimeReport = await harness.api.scanCreativeWorkshopRepairCandidates();
  assert.equal(sameRuntimeReport.repairRestartRequired, true, 'successful repair must require a Tavern restart before rechecking Repair');

  const restartedHarness = createHarness({
    worldbooks: harness.worldbooks,
    regexes: harness.regexes(),
    initialVariables: harness.variables(),
  });
  const restartedReport = await restartedHarness.api.scanCreativeWorkshopRepairCandidates();
  assert.equal(restartedReport.repairRestartRequired, false, 'a fresh runtime must satisfy the restart guard');
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
  assert.equal(harness.worldbooks.DLC.length, 0, 'failed replacement should leave no hidden sentinel behind after selected old entries were removed');
  const pendingAfterFailure = harness.api.getCreativeWorkshopPendingRepairs();
  assert.equal(pendingAfterFailure.length, 1);
  assert.equal(pendingAfterFailure[0].status, 'failed');

  const retryResult = await harness.api.repairCreativeWorkshopProject(target);
  assert.equal(retryResult.success, true, 'retry must succeed even when the old UIDs were already deleted by the interrupted attempt');
  assert.equal(harness.applyAttempts(), 2);
  assert.equal(harness.worldbooks.DLC.filter(entry => identityApi.getCreativeWorkshopWorldbookMetadataString(entry, 'cw_project_id') === 'retry-project-id').length, 1);
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
  assert.equal(harness.worldbooks.DLC.filter(entry => identityApi.getCreativeWorkshopWorldbookMetadataString(entry, 'cw_project_id') === 'correct-project-id').length, 1);
}

const handshakeCaseStart = bridgeSource.indexOf("case 'bridge:handshake':");
const installedCaseStart = bridgeSource.indexOf("case 'bridge:list-installed-projects':");
assert.ok(handshakeCaseStart >= 0 && installedCaseStart > handshakeCaseStart);
const handshakeCaseSource = bridgeSource.slice(handshakeCaseStart, installedCaseStart);
assert.doesNotMatch(handshakeCaseSource, /getCompleteInitialInstalledProjects/, 'bridge handshake must not wait for the expensive installed-project worldbook scan');
assert.match(protocolSource, /bridge:repair:scan/);
assert.match(protocolSource, /bridge:repair:project/);
assert.match(bridgeSource, /scanCreativeWorkshopRepairCandidates/);
assert.match(bridgeSource, /repairCreativeWorkshopProject/);
assert.match(repairUiSource, /buildDlcRepairReportText/);
assert.match(repairUiSource, /resolveWorkshopRepairCandidates\(requests\)/, 'automatic Repair matching must use the bounded batch resolver');
assert.doesNotMatch(repairUiSource, /Promise\.all\(selected\.map\(item => analyzeDlcRepairItem/, 'automatic matching must not fan out one resolver request per DLC');
assert.match(repairUiSource, /await analyzeSelectedDlcRepairs\(\)/, 'opening Repair must automatically resolve safe candidates');
assert.match(repairUiSource, /for \(const item of runnable\)/, 'Workshop matching may run in parallel, but local replacement must be sequential');
assert.match(repairUiSource, /复制诊断资料/);
assert.match(repairUiSource, /UID 可定位/);
assert.match(repairUiSource, /已自动找到/);
assert.match(repairUiSource, /candidate\?\.identityStatus === 'legacy'/, 'repair UI must surface legacy EJS migration candidates even when they are not broken');
assert.match(repairUiSource, /candidate\.problems\.length > 0/, 'repair UI must still surface genuine Repair problems');
assert.match(repairUiSource, /好啦修理成功喵！現在重开酒馆，然后再來工坊DLC检查多次看看吧!/, 'first successful repair must ask for a Tavern restart');
assert.match(repairUiSource, /知道了喵/);
assert.match(repairUiSource, /不行，再看一眼/);
assert.match(repairUiSource, /別再点了快点重开酒馆/);
assert.doesNotMatch(repairUiSource, /dlcRepairSelectAllBtn/, 'normal Repair flow must not require select-all or checkbox management');
assert.match(repairUiSource, /高级：手动查找项目/, 'manual search must be an advanced fallback, not the primary flow');
assert.match(repairUiSource, /选择此项目/, 'only ambiguous Workshop candidates should require explicit selection');
assert.match(repairUiSource, /dlcRepairWorldbookSelect/, 'advanced diagnostics may scan another worldbook when automatic scan misses it');
assert.match(repairUiSource, /重新扫描/, 'advanced diagnostics must retain a rescan action');
assert.doesNotMatch(repairUiSource, /dlcRepairAnalyzeBtn/, 'Workshop matching should happen automatically');
assert.doesNotMatch(repairUiSource, /dlcRepairScanEnabledBtn/, 'enabled worldbooks should be scanned automatically');
assert.doesNotMatch(repairUiSource, /dlcRepairScanBookBtn/, 'choosing another worldbook should trigger scanning without a second button');
assert.match(repairUiSource, /closeDlcRepairModal/, 'repair UI must be able to close itself after the queue is emptied');

console.log('CreativeWorkshop DLC repair smoke: ok');
