import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFile } from 'node:fs/promises';
import ts from '../../node_modules/typescript/lib/typescript.js';

const source = await readFile(new URL('../../src/CreativeWorkshop/services/worldbook-stage.ts', import.meta.url), 'utf8');
const compiled = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
}).outputText;

const projectId = 'dlc-123';
function entry(uid, key, version, content, enabled = true) {
  return { uid, name: 'Item ' + key, content, enabled,
    extra: { cw_project_id: projectId, cw_entry_key: projectId + ':' + key, cw_project_version: version } };
}
function desiredEntries() {
  return Array.from({ length: 10 }, (_, n) => {
    const key = 'key-' + n;
    return {
      stableKey: projectId + ':' + key,
      legacyKey: projectId + ':' + n,
      sourceName: key,
      payload: entry(undefined, key, '2.0.0', 'new:' + n),
    };
  });
}

function createHarness({ stageCount = 10, failSwitch = false, stageThrowAfterSave = false, switchThrowAfterSave = false, corruptStage = false, mutateOld = false, unreadableAfterWrite = false } = {}) {
  const worldbooks = {
    A: Array.from({ length: 10 }, (_, n) => entry(n + 1, 'key-' + n, '1.0.0', 'old:' + n)),
    B: [
      ...Array.from({ length: 10 }, (_, n) => entry(n + 1, 'key-' + n, '1.0.0', 'old:' + n, n !== 0)),
      { uid: 99, name: 'Other entry', enabled: true, content: 'keep', extra: {} },
    ],
  };
  let nextUid = 200;
  let failCommit = failSwitch;
  let actualStageCount = stageCount;
  let writes = 0;
  let unreadable = false;
  const clone = value => structuredClone(value);
  const api = { exports: {} };
  const context = {
    module: api,
    exports: api.exports,
    console,
    Set,
    Map,
    Array,
    String,
    JSON,
    crypto: { randomUUID: () => 'op-test' },
    require(specifier) {
      if (specifier === './install-registry') return { getCreativeWorkshopBoundWorldbookNames: () => ['A', 'B'] };
      if (specifier === './install-identity') {
        return { getCreativeWorkshopWorldbookMetadataString: (entry, field) => entry.extra?.[field] ?? null };
      }
      throw new Error('Unexpected dependency: ' + specifier);
    },
    getWorldbookNames: () => Object.keys(worldbooks),
    getWorldbook: async name => { if (unreadable) throw new Error('read failure'); return clone(worldbooks[name]); },
    createWorldbookEntries: async (name, inputs) => {
      const created = clone(inputs.slice(0, actualStageCount)).map(item => ({ ...item, uid: ++nextUid }));
      worldbooks[name].push(...clone(created));
      writes++;
      if (corruptStage) worldbooks[name].at(-1).name = 'corrupted';
      if (mutateOld) worldbooks[name][0].content = 'manual edit during update';
      if (unreadableAfterWrite) unreadable = true;
      if (stageThrowAfterSave) throw new Error('save response lost');
      return { worldbook: clone(worldbooks[name]), new_entries: created };
    },
    updateWorldbookWith: async (name, updater) => {
      if (failCommit) {
        failCommit = false;
        throw new Error('simulated switch failure');
      }
      const next = await updater(clone(worldbooks[name]));
      worldbooks[name] = clone(next);
      writes++;
      if (switchThrowAfterSave) throw new Error('switch response lost');
      return clone(next);
    },
  };
  vm.runInNewContext(compiled, context, { filename: 'worldbook-stage.ts' });
  return { api: api.exports, worldbooks,
    get writes() { return writes; },
    allowCompleteStage() { actualStageCount = 10; },
    clone };
}

for (const options of [{ stageThrowAfterSave: true }, { switchThrowAfterSave: true }]) {
  const h = createHarness(options);
  await h.api.stageAndSwitchCreativeWorkshopWorldbook('B', projectId, '2.0.0', desiredEntries());
  assert.equal(h.worldbooks.B.filter(e => e.extra?.cw_project_id === projectId).length, 10);
  const saved = h.clone(h.worldbooks.B);
  const writes = h.writes;
  await h.api.stageAndSwitchCreativeWorkshopWorldbook('B', projectId, '2.0.0', desiredEntries());
  assert.equal(h.writes, writes, 'retry after worldbook success/regex failure never stages a duplicate');
  assert.deepEqual(h.worldbooks.B, saved, 'UID and current user settings survive retry');
}
for (const options of [{ corruptStage: true }, { mutateOld: true }, { unreadableAfterWrite: true }]) {
  const h = createHarness(options);
  await assert.rejects(() => h.api.stageAndSwitchCreativeWorkshopWorldbook('B', projectId, '2.0.0', desiredEntries()));
  assert.equal(h.worldbooks.B.filter(e => e.extra?.cw_project_version === '1.0.0').length, 10, 'failed stage cannot delete old UIDs');
}
{
  const h = createHarness();
  const desired = desiredEntries();
  desired[0].payload.enabled = false;
  await h.api.stageAndSwitchCreativeWorkshopWorldbook('A', projectId, '2.0.0', desired);
  assert.equal(h.worldbooks.A[0].enabled, true, 'manually enabled entry stays enabled even if new package defaults disabled');
  h.worldbooks.A[1].probability = 12;
  const configured = desiredEntries();
  configured[1].payload.probability = 100;
  await assert.rejects(() => h.api.stageAndSwitchCreativeWorkshopWorldbook('A', projectId, '2.0.0', configured), /配置/);
}

const desired = desiredEntries();
{
  const h = createHarness();
  const originalA = h.clone(h.worldbooks.A);
  await h.api.stageAndSwitchCreativeWorkshopWorldbook('B', projectId, '2.0.0', desired);
  const projectRows = h.worldbooks.B.filter(e => e.extra?.cw_project_id === projectId);
  assert.equal(projectRows.length, 10);
  assert.equal(new Set(projectRows.map(e => e.uid)).size, 10);
  assert.equal(projectRows.some(e => e.uid <= 10), false);
  assert.equal(projectRows[0].enabled, false, 'manual disabled status preserved');
  assert.equal(projectRows[1].enabled, true);
  assert.equal(projectRows.every(e => e.extra?.cw_project_version === '2.0.0'), true);
  assert.deepEqual(h.worldbooks.A, originalA, 'other installation in A must remain untouched');
  assert.equal(h.worldbooks.B.find(e => e.uid === 99)?.content, 'keep');
}

{
  const h = createHarness({ stageCount: 8 });
  await assert.rejects(
    () => h.api.stageAndSwitchCreativeWorkshopWorldbook('B', projectId, '2.0.0', desired),
    /新版写入数量不完整/,
  );
  assert.equal(h.worldbooks.B.filter(e => e.extra?.cw_project_version === '1.0.0').length, 10);
  assert.equal(h.worldbooks.B.filter(e => e.extra?.cw_update_stage).length, 8);
  h.allowCompleteStage();
  await h.api.stageAndSwitchCreativeWorkshopWorldbook('B', projectId, '2.0.0', desired);
  assert.equal(h.worldbooks.B.filter(e => e.extra?.cw_project_id === projectId).length, 10);
  assert.equal(h.worldbooks.B.some(e => e.extra?.cw_update_stage), false);
}

{
  const h = createHarness({ failSwitch: true });
  await assert.rejects(
    () => h.api.stageAndSwitchCreativeWorkshopWorldbook('B', projectId, '2.0.0', desired),
    /simulated switch failure/,
  );
  assert.equal(h.worldbooks.B.filter(e => e.extra?.cw_project_version === '1.0.0').length, 10);
  assert.equal(h.worldbooks.B.filter(e => e.extra?.cw_update_stage).length, 10);
  await h.api.stageAndSwitchCreativeWorkshopWorldbook('B', projectId, '2.0.0', desired);
  assert.equal(h.worldbooks.B.filter(e => e.extra?.cw_project_id === projectId).length, 10);
  assert.equal(h.worldbooks.B.filter(e => e.extra?.cw_update_stage).length, 0);
}

{
  const h = createHarness();
  const broken = desiredEntries();
  broken[1].stableKey = broken[0].stableKey;
  await assert.rejects(() => h.api.stageAndSwitchCreativeWorkshopWorldbook('B', projectId, '2.0.0', broken), /身份重复/);
  assert.equal(h.worldbooks.B.filter(e => e.extra?.cw_project_id === projectId).length, 10);
}

console.log('CreativeWorkshop staged installation and retry guards: ok');
